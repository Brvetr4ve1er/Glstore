"""
Financing rules — admin. Store from the authenticated x-store-id.

GET    /financing/rules                 every version, newest first
GET    /financing/rules/{id}            one version
POST   /financing/rules                 create a DRAFT (the next version number)
DELETE /financing/rules/{id}            discard a DRAFT that never went live
POST   /financing/rules/{id}/activate   DRAFT -> ACTIVE; the previous ACTIVE retires
POST   /financing/rules/{id}/retire     ACTIVE -> RETIRED; financing becomes unavailable

There is no PATCH. A rule's terms are frozen the moment it is written — by a
trigger in migration 011, not just here — because an application must forever
reference the terms it was priced under. Changing terms means a new version.

Setting credit policy is SUPER_ADMIN / ADMIN only; operators and viewers read.
The numbers in a rule are the operator's business terms; nothing here
suggests, defaults or seeds any of them.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import CurrentAdmin, get_current_admin, require_role
from api.core.store_context import Store, require_admin_store_for
from api.services.financing import rules as engine
from api.services.financing.repo import RULE_COLUMNS, jsonb_value, rule_from_row, terms_to_json

router = APIRouter(tags=["financing-admin"])

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")
POLICY_ROLES = ("SUPER_ADMIN", "ADMIN")

_RULE_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Règle introuvable.")


class TermIn(BaseModel):
    months: int = Field(ge=1, le=engine.MAX_TERM_MONTHS)
    markup_pct: Decimal = Field(ge=0, lt=engine.MAX_MARKUP_PCT, max_digits=7, decimal_places=3)


class RuleCreateIn(BaseModel):
    min_financed: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    max_financed: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    min_down_payment_pct: Decimal = Field(ge=0, lt=100, max_digits=5, decimal_places=2)
    max_debt_ratio_pct: Decimal | None = Field(default=None, gt=0, le=100, max_digits=5, decimal_places=2)
    terms: list[TermIn] = Field(min_length=1, max_length=24)
    notes: str | None = Field(default=None, max_length=2000)

    def to_rule(self) -> engine.Rule:
        return engine.Rule(
            version=1,
            min_financed=self.min_financed,
            max_financed=self.max_financed,
            min_down_payment_pct=self.min_down_payment_pct,
            max_debt_ratio_pct=self.max_debt_ratio_pct,
            terms=tuple(sorted(
                (engine.Term(months=t.months, markup_pct=t.markup_pct) for t in self.terms),
                key=lambda t: t.months,
            )),
        )


def _rule_out(row: Any) -> dict[str, Any]:
    def ts(v):
        return v.isoformat() if v else None

    return {
        "id": str(row.id),
        "version": row.version,
        "status": row.status,
        "min_financed": str(row.min_financed),
        "max_financed": str(row.max_financed),
        "min_down_payment_pct": str(row.min_down_payment_pct),
        "max_debt_ratio_pct": None if row.max_debt_ratio_pct is None else str(row.max_debt_ratio_pct),
        "terms": jsonb_value(row.terms),
        "notes": row.notes,
        "created_at": ts(row.created_at),
        "activated_at": ts(row.activated_at),
        "retired_at": ts(row.retired_at),
    }


async def _lock_rules(db: AsyncSession, store_id: UUID) -> None:
    """One writer at a time per store: version numbering and the
    retire-then-activate swap must not interleave."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
        {"k": f"financing-rules:{store_id}"},
    )


async def _get_rule(db: AsyncSession, store_id: UUID, rule_id: UUID) -> Any:
    row = (await db.execute(
        text(f"SELECT {RULE_COLUMNS} FROM financing_rules WHERE id = :id AND store_id = :sid"),
        {"id": rule_id, "sid": store_id},
    )).first()
    if row is None:
        raise _RULE_NOT_FOUND
    return row


@router.get("/financing/rules")
async def list_rules(
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        text(f"SELECT {RULE_COLUMNS} FROM financing_rules WHERE store_id = :sid ORDER BY version DESC"),
        {"sid": store.id},
    )).all()
    return {"items": [_rule_out(r) for r in rows]}


@router.get("/financing/rules/{rule_id}")
async def get_rule(
    rule_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    return _rule_out(await _get_rule(db, store.id, rule_id))


@router.post("/financing/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: RuleCreateIn,
    store: Store = Depends(require_admin_store_for(require_role(*POLICY_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    rule = body.to_rule()
    errors = engine.validate_rule(rule)
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"errors": errors})

    await _lock_rules(db, store.id)
    version = (await db.execute(
        text("SELECT COALESCE(MAX(version), 0) + 1 FROM financing_rules WHERE store_id = :sid"),
        {"sid": store.id},
    )).scalar_one()

    row = (await db.execute(
        text(f"""
            INSERT INTO financing_rules (
                store_id, version, min_financed, max_financed,
                min_down_payment_pct, max_debt_ratio_pct, terms, notes, created_by
            ) VALUES (
                :sid, :version, :min_f, :max_f, :min_dp, :max_dr, CAST(:terms AS JSONB), :notes, :by
            )
            RETURNING {RULE_COLUMNS}
        """),
        {
            "sid": store.id,
            "version": version,
            "min_f": rule.min_financed,
            "max_f": rule.max_financed,
            "min_dp": rule.min_down_payment_pct,
            "max_dr": rule.max_debt_ratio_pct,
            "terms": terms_to_json(rule.terms),
            "notes": body.notes,
            "by": admin.id,
        },
    )).first()
    await db.commit()
    return _rule_out(row)


@router.delete("/financing/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft_rule(
    rule_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*POLICY_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_rule(db, store.id, rule_id)
    if row.status != "DRAFT":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Une règle déjà utilisée ne peut pas être supprimée ; retirez-la.",
        )
    await db.execute(
        text("DELETE FROM financing_rules WHERE id = :id AND store_id = :sid AND status = 'DRAFT'"),
        {"id": rule_id, "sid": store.id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/financing/rules/{rule_id}/activate")
async def activate_rule(
    rule_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*POLICY_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    await _lock_rules(db, store.id)
    row = await _get_rule(db, store.id, rule_id)
    if row.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule une version brouillon peut être activée.")
    errors = engine.validate_rule(rule_from_row(row))
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"errors": errors})

    # Retire first: the partial unique index allows one ACTIVE per store, so
    # the swap has to happen in this order inside one transaction.
    await db.execute(
        text("""
            UPDATE financing_rules SET status = 'RETIRED', retired_at = NOW()
             WHERE store_id = :sid AND status = 'ACTIVE'
        """),
        {"sid": store.id},
    )
    activated = (await db.execute(
        text(f"""
            UPDATE financing_rules SET status = 'ACTIVE', activated_at = NOW()
             WHERE id = :id AND store_id = :sid AND status = 'DRAFT'
            RETURNING {RULE_COLUMNS}
        """),
        {"id": rule_id, "sid": store.id},
    )).first()
    await db.commit()
    return _rule_out(activated)


@router.post("/financing/rules/{rule_id}/retire")
async def retire_rule(
    rule_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*POLICY_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    await _lock_rules(db, store.id)
    row = await _get_rule(db, store.id, rule_id)
    if row.status != "ACTIVE":
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule la version active peut être retirée.")
    retired = (await db.execute(
        text(f"""
            UPDATE financing_rules SET status = 'RETIRED', retired_at = NOW()
             WHERE id = :id AND store_id = :sid AND status = 'ACTIVE'
            RETURNING {RULE_COLUMNS}
        """),
        {"id": rule_id, "sid": store.id},
    )).first()
    await db.commit()
    return _rule_out(retired)
