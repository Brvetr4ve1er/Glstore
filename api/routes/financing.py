"""
Financing — the public simulator and a signed-in customer's applications.

GET  /financing/terms               what the active rule offers (no rule → unavailable)
POST /financing/simulate            anonymous estimate for a cart
POST /financing/applications        signed-in: open a DRAFT application
GET  /financing/applications        signed-in: my applications
GET  /financing/applications/{id}   signed-in: one of mine, with lines and history

Every figure is computed server-side by api/services/financing/rules.py from
prices read here, never from the client. `FINANCING_TERMS_PUBLIC` decides only
how a figure is PRESENTED: while false (the default) every response labels
itself an estimate and no status reads as approved. Business terms come from
the operator's active rule; this module ships none.

Phase B stops at DRAFT. Submitting, profiles, documents and review are Phase C.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db
from api.core.store_context import Store, require_store
from api.routes.customer_auth import CurrentCustomer, get_current_customer
from api.services.financing import rules as engine
from api.services.financing.repo import PricedLine, load_active_rule, price_lines

router = APIRouter(tags=["financing"])
_settings = get_settings()


# ── Presentation ──────────────────────────────────────────────────────────

_ESTIMATE_LABEL = "Estimation indicative, sous réserve d'acceptation du dossier."
_TERMS_LABEL = "Sous réserve d'acceptation du dossier."

REASON_LABELS = {
    engine.NO_ITEMS: "Le panier est vide.",
    engine.NOTHING_TO_FINANCE: "L'apport couvre la totalité du montant : il n'y a rien à financer.",
    engine.DOWN_PAYMENT_BELOW_MINIMUM: "L'apport est inférieur au minimum requis.",
    engine.BELOW_MIN_FINANCED: "Le montant à financer est inférieur au minimum.",
    engine.ABOVE_MAX_FINANCED: "Le montant à financer dépasse le maximum.",
    engine.DURATION_NOT_OFFERED: "Cette durée n'est pas proposée.",
    engine.DEBT_RATIO_EXCEEDED: "Le remboursement mensuel dépasse la capacité de remboursement déclarée.",
}


def status_label(app_status: str, terms_public: bool) -> str:
    """While terms are not public, nothing reads as approved (plan, Decision 2)."""
    if app_status == "APPROVED":
        return "Acceptée" if terms_public else "Accord de principe, sous réserve d'acceptation définitive"
    return {
        "DRAFT": "Brouillon",
        "SUBMITTED": "Envoyée",
        "UNDER_REVIEW": "En cours d'étude",
        "REJECTED": "Non retenue",
        "SIGNED": "Signée",
    }[app_status]


def presentation() -> dict[str, Any]:
    public = _settings.financing_terms_public
    return {
        "terms_public": public,
        "kind": "TERMS" if public else "ESTIMATE",
        "label": _TERMS_LABEL if public else _ESTIMATE_LABEL,
    }


def decision_out(d: engine.Decision) -> dict[str, Any]:
    out = d.as_dict()
    out["reasons"] = [{"code": c, "label": REASON_LABELS[c]} for c in d.reasons]
    return out


# ── Input ─────────────────────────────────────────────────────────────────

class CartLineIn(BaseModel):
    offer_id: UUID
    quantity: int = Field(ge=1, le=100)


class FinancingRequestIn(BaseModel):
    # No price field: prices are read from the catalogue, never accepted.
    lines: list[CartLineIn] = Field(min_length=1, max_length=50)
    down_payment: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    duration_months: int = Field(ge=1, le=engine.MAX_TERM_MONTHS)

    @field_validator("lines")
    @classmethod
    def _one_line_per_offer(cls, v: list[CartLineIn]) -> list[CartLineIn]:
        ids = [l.offer_id for l in v]
        if len(set(ids)) != len(ids):
            raise ValueError("chaque produit ne doit apparaître qu'une fois")
        return v

    def wanted(self) -> dict[UUID, int]:
        return {l.offer_id: l.quantity for l in self.lines}


_NOT_AVAILABLE = HTTPException(
    status.HTTP_404_NOT_FOUND,
    "Le financement n'est pas disponible pour le moment.",
)
_APPLICATION_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable.")


async def _decide(
    db: AsyncSession, store_id: UUID, body: FinancingRequestIn,
) -> tuple[UUID, list[PricedLine], engine.Decision]:
    active = await load_active_rule(db, store_id)
    if active is None:
        raise _NOT_AVAILABLE
    rule_id, rule = active
    priced = await price_lines(db, store_id, body.wanted())
    decision = engine.evaluate(
        [engine.Line(unit_price=p.unit_price, quantity=p.quantity) for p in priced],
        down_payment=body.down_payment,
        duration_months=body.duration_months,
        rule=rule,
    )
    return rule_id, priced, decision


# ── Public ────────────────────────────────────────────────────────────────

@router.get("/financing/terms")
async def financing_terms(
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
):
    """Enough for a simulator to draw itself: durations and bounds. Markups
    are deliberately absent — a figure is only ever shown as a computed,
    labelled result from /financing/simulate."""
    active = await load_active_rule(db, store.id)
    if active is None:
        return {"available": False, **presentation()}
    _, rule = active
    return {
        "available": True,
        **presentation(),
        "rule_version": rule.version,
        "durations": list(rule.durations),
        "min_down_payment_pct": str(rule.min_down_payment_pct),
        "min_financed": str(rule.min_financed),
        "max_financed": str(rule.max_financed),
    }


@router.post("/financing/simulate")
async def simulate(
    body: FinancingRequestIn,
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
):
    rule_id, priced, decision = await _decide(db, store.id, body)

    simulation_id = (await db.execute(
        text("""
            INSERT INTO financing_simulations (store_id, rule_id, request, decision, eligible)
            VALUES (:sid, :rid, CAST(:request AS JSONB), CAST(:decision AS JSONB), :eligible)
            RETURNING id
        """),
        {
            "sid": store.id,
            "rid": rule_id,
            "request": json.dumps({
                "lines": [p.as_json() for p in priced],
                "down_payment": str(body.down_payment),
                "duration_months": body.duration_months,
            }),
            "decision": json.dumps(decision.as_dict()),
            "eligible": decision.eligible,
        },
    )).scalar_one()
    await db.commit()

    return {"simulation_id": str(simulation_id), **presentation(), "decision": decision_out(decision)}


# ── Signed-in customer ────────────────────────────────────────────────────

async def _next_reference(db: AsyncSession, store: Store) -> str:
    # Serialised per store: two applications opened at the same instant must
    # not both read the same MAX and collide on the UNIQUE reference.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
        {"k": f"application-ref:{store.id}"},
    )
    year = datetime.now(timezone.utc).year
    prefix = f"{store.order_prefix}-F-{year}-"
    n = (await db.execute(
        text("""
            SELECT COALESCE(MAX(CAST(RIGHT(reference, 6) AS INTEGER)), 0) + 1
              FROM applications
             WHERE store_id = :sid AND reference LIKE :like
        """),
        {"sid": store.id, "like": f"{prefix}%"},
    )).scalar_one()
    return f"{prefix}{n:06d}"


_APPLICATION_COLUMNS = """
    id, reference, status::text AS status, cash_total, down_payment, financed_amount,
    markup_amount, total_repayable, duration_months, monthly_instalment,
    created_at, submitted_at
"""


def _application_out(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "reference": row.reference,
        "status": row.status,
        "status_label": status_label(row.status, _settings.financing_terms_public),
        "cash_total": str(row.cash_total),
        "down_payment": str(row.down_payment),
        "financed_amount": str(row.financed_amount),
        "markup_amount": str(row.markup_amount),
        "total_repayable": str(row.total_repayable),
        "duration_months": row.duration_months,
        "monthly_instalment": str(row.monthly_instalment),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
    }


@router.post("/financing/applications", status_code=status.HTTP_201_CREATED)
async def create_application(
    body: FinancingRequestIn,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    rule_id, priced, decision = await _decide(db, store.id, body)
    if not decision.eligible:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {
                "message": "Cette demande ne peut pas être ouverte en l'état.",
                "decision": decision_out(decision),
            },
        )

    reference = await _next_reference(db, store)
    app_row = (await db.execute(
        text(f"""
            INSERT INTO applications (
                store_id, reference, customer_id, rule_id,
                cash_total, down_payment, financed_amount, markup_amount,
                total_repayable, duration_months, monthly_instalment, decision
            ) VALUES (
                :sid, :ref, :cid, :rid,
                :cash, :down, :financed, :markup,
                :total, :months, :monthly, CAST(:decision AS JSONB)
            )
            RETURNING {_APPLICATION_COLUMNS}
        """),
        {
            "sid": store.id,
            "ref": reference,
            "cid": customer.profile.id,
            "rid": rule_id,
            "cash": decision.cash_total,
            "down": decision.down_payment,
            "financed": decision.financed_amount,
            "markup": decision.markup_amount,
            "total": decision.total_repayable,
            "months": decision.duration_months,
            "monthly": decision.monthly_instalment,
            "decision": json.dumps(decision.as_dict()),
        },
    )).first()

    for p in priced:
        await db.execute(
            text("""
                INSERT INTO application_items (
                    store_id, application_id, product_id, offer_id,
                    product_name, variant_sku, unit_price, quantity, line_total
                ) VALUES (
                    :sid, :aid, :pid, :oid, :name, :sku, :price, :qty, :total
                )
            """),
            {
                "sid": store.id,
                "aid": app_row.id,
                "pid": p.product_id,
                "oid": p.offer_id,
                "name": p.product_name,
                "sku": p.variant_sku,
                "price": p.unit_price,
                "qty": p.quantity,
                "total": p.unit_price * p.quantity,
            },
        )

    await db.execute(
        text("""
            INSERT INTO application_status_events
                (store_id, application_id, from_status, to_status, actor_type, actor_id)
            VALUES (:sid, :aid, NULL, 'DRAFT', 'CUSTOMER', :cid)
        """),
        {"sid": store.id, "aid": app_row.id, "cid": customer.profile.id},
    )
    await db.commit()

    return {
        **presentation(),
        **_application_out(app_row),
        "items": [p.as_json() for p in priced],
        "decision": decision_out(decision),
    }


@router.get("/financing/applications")
async def my_applications(
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        text(f"""
            SELECT {_APPLICATION_COLUMNS}
              FROM applications
             WHERE store_id = :sid AND customer_id = :cid
             ORDER BY created_at DESC
             LIMIT 50
        """),
        {"sid": store.id, "cid": customer.profile.id},
    )).all()
    return {**presentation(), "items": [_application_out(r) for r in rows]}


@router.get("/financing/applications/{application_id}")
async def my_application(
    application_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    """Another customer's application — or another brand's — is a 404, the
    same answer as one that does not exist."""
    row = (await db.execute(
        text(f"""
            SELECT {_APPLICATION_COLUMNS}
              FROM applications
             WHERE id = :id AND store_id = :sid AND customer_id = :cid
        """),
        {"id": application_id, "sid": store.id, "cid": customer.profile.id},
    )).first()
    if row is None:
        raise _APPLICATION_NOT_FOUND

    items = (await db.execute(
        text("""
            SELECT offer_id, product_id, product_name, variant_sku, unit_price, quantity, line_total
              FROM application_items
             WHERE store_id = :sid AND application_id = :aid
             ORDER BY product_name
        """),
        {"sid": store.id, "aid": application_id},
    )).all()
    # No actor ids: a customer sees what happened and when, not which staff
    # account did it.
    events = (await db.execute(
        text("""
            SELECT to_status::text AS to_status, created_at
              FROM application_status_events
             WHERE store_id = :sid AND application_id = :aid
             ORDER BY created_at
        """),
        {"sid": store.id, "aid": application_id},
    )).all()

    return {
        **presentation(),
        **_application_out(row),
        "items": [
            {
                "offer_id": str(i.offer_id),
                "product_id": str(i.product_id),
                "product_name": i.product_name,
                "variant_sku": i.variant_sku,
                "unit_price": str(i.unit_price),
                "quantity": i.quantity,
                "line_total": str(i.line_total),
            }
            for i in items
        ],
        "history": [
            {
                "status": e.to_status,
                "label": status_label(e.to_status, _settings.financing_terms_public),
                "at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
    }
