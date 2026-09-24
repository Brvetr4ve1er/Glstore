"""SQL shared by the public and admin financing routes.

Every statement is store-scoped. Kept apart from rules.py on purpose: the
engine stays pure, and these few queries are the only bridge between it and
the database.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.financing.rules import Rule, Term

RULE_COLUMNS = (
    "id, version, status::text AS status, min_financed, max_financed, "
    "min_down_payment_pct, max_debt_ratio_pct, terms, notes, "
    "created_at, activated_at, retired_at"
)

_UNAVAILABLE = HTTPException(
    status.HTTP_404_NOT_FOUND,
    "Un ou plusieurs produits sont introuvables ou indisponibles.",
)


def jsonb_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, (str, bytes)) else value


def terms_to_json(terms: tuple[Term, ...]) -> str:
    return json.dumps([{"months": t.months, "markup_pct": str(t.markup_pct)} for t in terms])


def rule_from_row(row: Any) -> Rule:
    return Rule(
        version=row.version,
        min_financed=Decimal(row.min_financed),
        max_financed=Decimal(row.max_financed),
        min_down_payment_pct=Decimal(row.min_down_payment_pct),
        max_debt_ratio_pct=None if row.max_debt_ratio_pct is None else Decimal(row.max_debt_ratio_pct),
        terms=tuple(
            Term(months=int(t["months"]), markup_pct=Decimal(str(t["markup_pct"])))
            for t in jsonb_value(row.terms)
        ),
    )


async def load_active_rule(db: AsyncSession, store_id: UUID) -> tuple[UUID, Rule] | None:
    row = (await db.execute(
        text(f"SELECT {RULE_COLUMNS} FROM financing_rules WHERE store_id = :sid AND status = 'ACTIVE'"),
        {"sid": store_id},
    )).first()
    return None if row is None else (row.id, rule_from_row(row))


async def transition(
    db: AsyncSession,
    *,
    store_id: UUID,
    application_id: UUID,
    from_status: str,
    to_status: str,
    actor_type: str,
    actor_id: UUID | None,
    note: str | None = None,
    extra_set: str = "",
    extra_params: dict[str, Any] | None = None,
) -> None:
    """Move an application one step, and record it — the only way status changes.

    Compare-and-swap on the current status: if someone else moved it first,
    nothing matches and the caller gets a 409 instead of a double transition.
    The event is written in the same transaction, so there is never a status
    change without its audit row. Migration 013's trigger rejects any
    transition that is not in the plan's machine, whatever calls it.

    `extra_set` is a code-supplied SQL fragment (", decided_at = NOW()"),
    never user input.
    """
    moved = (await db.execute(
        text(f"""
            UPDATE applications
               SET status = CAST(:to_status AS application_status_enum),
                   updated_at = NOW(){extra_set}
             WHERE id = :aid AND store_id = :sid
               AND status = CAST(:from_status AS application_status_enum)
            RETURNING id
        """),
        {
            "aid": application_id, "sid": store_id,
            "from_status": from_status, "to_status": to_status,
            **(extra_params or {}),
        },
    )).first()
    if moved is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette demande a changé d'état entre-temps.")

    await db.execute(
        text("""
            INSERT INTO application_status_events
                (store_id, application_id, from_status, to_status, actor_type, actor_id, note)
            VALUES (
                :sid, :aid,
                CAST(:from_status AS application_status_enum),
                CAST(:to_status AS application_status_enum),
                CAST(:actor_type AS application_actor_enum),
                :actor_id, :note
            )
        """),
        {
            "sid": store_id, "aid": application_id,
            "from_status": from_status, "to_status": to_status,
            "actor_type": actor_type, "actor_id": actor_id, "note": note,
        },
    )


@dataclass(frozen=True, slots=True)
class PricedLine:
    offer_id: UUID
    product_id: UUID
    product_name: str
    variant_sku: str
    unit_price: Decimal
    quantity: int

    def as_json(self) -> dict[str, Any]:
        return {
            "offer_id": str(self.offer_id),
            "product_id": str(self.product_id),
            "product_name": self.product_name,
            "variant_sku": self.variant_sku,
            "unit_price": str(self.unit_price),
            "quantity": self.quantity,
        }


async def price_lines(db: AsyncSession, store_id: UUID, wanted: dict[UUID, int]) -> list[PricedLine]:
    """Resolve offer ids to live prices, IN THIS STORE, the way checkout does.

    The price is never taken from the client. `COALESCE(sale_price,
    retail_price)` mirrors api/services/orders.py so a financed cart and a
    cash cart of the same items cost the same. An offer from another brand's
    catalogue, an inactive offer or a product that is not live all resolve to
    the same 404 — which of the three it was is not the caller's business.
    """
    rows = (await db.execute(
        text("""
            SELECT o.id, o.product_id, o.variant_sku,
                   COALESCE(o.sale_price, o.retail_price) AS unit_price,
                   p.name AS product_name
              FROM offers o
              JOIN products p ON p.id = o.product_id AND p.store_id = o.store_id
             WHERE o.store_id = :sid
               AND o.id = ANY(:ids)
               AND o.is_active
               AND p.status = 'ACTIVE'
        """),
        {"sid": store_id, "ids": list(wanted)},
    )).all()
    found = {r.id: r for r in rows}
    if set(found) != set(wanted):
        raise _UNAVAILABLE
    return [
        PricedLine(
            offer_id=oid,
            product_id=found[oid].product_id,
            product_name=found[oid].product_name,
            variant_sku=found[oid].variant_sku,
            unit_price=Decimal(found[oid].unit_price),
            quantity=qty,
        )
        for oid, qty in wanted.items()
    ]
