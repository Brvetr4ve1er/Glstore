"""
The signed-in customer's own orders.

GET /account/orders          every order this customer placed in this store
GET /account/orders/{id}     one of them, in the same shape as /orders/track

Under /account/ rather than /orders/mine: the admin `/orders/{order_id}`
route would match `/orders/mine` first.

WHICH ORDERS ARE "MINE" (the Phase A follow-up, resolved here): COD checkout
keys customers by digits-only, so one phone typed as `0555…`, `+213555…` and
`555…` may be three customer rows. The verified session belongs to one of
them; the orders belong to all of them. So the lookup is by every legacy key
of the session's phone, not by the session's customer id alone.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.phone import dz_mobile_national, legacy_phone_keys, normalize_phone
from api.core.store_context import Store, require_store
from api.routes.customer_auth import CurrentCustomer, get_current_customer

router = APIRouter(tags=["customer-account"])

_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Commande introuvable.")


def phone_keys(phone: str) -> list[str]:
    """Every customers.phone_normalized value this verified phone may sit under."""
    national = dz_mobile_national(phone)
    if national is None:
        return [normalize_phone(phone)]
    return legacy_phone_keys(national)


@router.get("/account/orders")
async def my_orders(
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        text("""
            SELECT o.id, o.order_number, o.status::text AS status, o.total, o.currency, o.created_at,
                   (SELECT COUNT(*) FROM order_items oi
                     WHERE oi.store_id = o.store_id AND oi.order_id = o.id) AS item_count
              FROM orders o
             WHERE o.store_id = :sid
               AND o.customer_id IN (
                   SELECT c.id FROM customers c
                    WHERE c.store_id = :sid AND c.phone_normalized = ANY(:keys)
               )
             ORDER BY o.created_at DESC
             LIMIT 100
        """),
        {"sid": store.id, "keys": phone_keys(customer.profile.phone)},
    )).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "order_number": r.order_number,
                "status": r.status,
                "total": float(r.total),
                "currency": r.currency,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "item_count": r.item_count,
            }
            for r in rows
        ],
    }


@router.get("/account/orders/{order_id}")
async def my_order(
    order_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Someone else's order — or another brand's — is the same 404 as none."""
    o = (await db.execute(
        text("""
            SELECT o.id, o.order_number, o.status::text AS status, o.payment_status::text AS payment_status,
                   o.payment_method::text AS payment_method, o.subtotal, o.shipping_cost,
                   o.discount_amount, o.tax_amount, o.total, o.currency,
                   o.confirmed_at, o.shipped_at, o.delivered_at, o.cancelled_at, o.created_at,
                   (SELECT c.full_name FROM customers c
                     WHERE c.store_id = o.store_id AND c.id = o.customer_id) AS customer_name
              FROM orders o
             WHERE o.id = :oid AND o.store_id = :sid
               AND o.customer_id IN (
                   SELECT c.id FROM customers c
                    WHERE c.store_id = :sid AND c.phone_normalized = ANY(:keys)
               )
        """),
        {"oid": order_id, "sid": store.id, "keys": phone_keys(customer.profile.phone)},
    )).first()
    if o is None:
        raise _NOT_FOUND

    items = (await db.execute(
        text("""
            SELECT id, product_name, variant_sku, unit_price, quantity, line_total
              FROM order_items
             WHERE store_id = :sid AND order_id = :oid
             ORDER BY id
        """),
        {"sid": store.id, "oid": order_id},
    )).all()

    return {
        "id": str(o.id),
        "order_number": o.order_number,
        "status": o.status,
        "payment_status": o.payment_status,
        "payment_method": o.payment_method,
        "subtotal": float(o.subtotal),
        "shipping_cost": float(o.shipping_cost),
        "discount_amount": float(o.discount_amount),
        "tax_amount": float(o.tax_amount),
        "total": float(o.total),
        "currency": o.currency,
        "confirmed_at": o.confirmed_at,
        "shipped_at": o.shipped_at,
        "delivered_at": o.delivered_at,
        "cancelled_at": o.cancelled_at,
        "created_at": o.created_at,
        "customer_name": o.customer_name,
        "items": [
            {
                "id": str(i.id),
                "product_name": i.product_name,
                "variant_sku": i.variant_sku,
                "unit_price": float(i.unit_price),
                "quantity": i.quantity,
                "line_total": float(i.line_total),
            }
            for i in items
        ],
    }
