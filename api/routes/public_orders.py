"""
Public storefront endpoints for cart/order operations.

POST /offers/availability   bulk-check live stock + price for cart items
POST /orders/track          public order lookup by (order_number, phone)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.store_context import Store, require_store

router = APIRouter(tags=["storefront-public"])


# ─────────────────────────────────────────────────────────────────────────
# Bulk offer availability — used by storefront cart on visit
# ─────────────────────────────────────────────────────────────────────────

class OfferAvailabilityRequest(BaseModel):
    offer_ids: list[str] = Field(min_length=1, max_length=100)


@router.post("/offers/availability")
async def offers_availability(
    body: OfferAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """Returns live (price, available, is_active) for each offer id, plus the
    parent product's slug + name + primary image so the cart can refresh its
    snapshot in one call.

    Scoped to the current store: an offer id from another brand's catalog is
    treated as unknown (returned as a stub with is_active=false), so a stale
    or cross-brand cart can never resolve to another store's stock/price.

    Unknown / inactive offer ids are returned with `is_active=false` and
    `available=0` — the cart should drop them.
    """
    rows = await db.execute(text("""
        SELECT o.id, o.product_id, o.variant_sku,
               COALESCE(o.sale_price, o.retail_price) AS unit_price,
               o.retail_price, o.sale_price,
               o.currency,
               GREATEST(o.stock_quantity - o.reserved_quantity, 0) AS available,
               o.is_active,
               p.slug, p.name, p.status AS product_status,
               (SELECT url FROM product_media m
                 WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                 LIMIT 1) AS primary_image
          FROM offers o
          JOIN products p ON p.id = o.product_id
         WHERE o.id::text = ANY(:ids) AND o.store_id = :sid
    """), {"ids": body.offer_ids, "sid": store.id})

    by_id: dict[str, dict[str, Any]] = {}
    for r in rows.all():
        by_id[str(r[0])] = {
            "offer_id":      str(r[0]),
            "product_id":    str(r[1]),
            "variant_sku":   r[2],
            "unit_price":    float(r[3]) if r[3] is not None else 0.0,
            "retail_price":  float(r[4]) if r[4] is not None else 0.0,
            "sale_price":    float(r[5]) if r[5] is not None else None,
            "currency":      r[6],
            "available":     int(r[7] or 0),
            "is_active":     bool(r[8]),
            "product_slug":  r[9],
            "product_name":  r[10],
            "product_status": r[11],
            "primary_image": r[12],
            # Computed flag for the storefront's UX:
            "buyable": bool(r[8]) and r[11] == "ACTIVE" and (r[7] or 0) > 0,
        }

    # Always return one entry per requested id — unknown ones get a stub.
    items = []
    for oid in body.offer_ids:
        if oid in by_id:
            items.append(by_id[oid])
        else:
            items.append({
                "offer_id": oid,
                "is_active": False,
                "available": 0,
                "buyable": False,
                "product_slug": None,
                "product_name": None,
                "primary_image": None,
                "variant_sku": None,
                "unit_price": 0.0,
                "retail_price": 0.0,
                "sale_price": None,
                "currency": "DZD",
                "product_id": None,
                "product_status": None,
            })
    return {"items": items}


# ─────────────────────────────────────────────────────────────────────────
# Public order tracking
# ─────────────────────────────────────────────────────────────────────────

class OrderTrackRequest(BaseModel):
    order_number: str = Field(min_length=4, max_length=40)
    phone:        str = Field(min_length=6, max_length=30)


def _normalize_phone(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())


# Stable failure shape so existence/timing don't leak whether the order_number is real.
_NOT_FOUND = HTTPException(
    status.HTTP_404_NOT_FOUND,
    "Aucune commande ne correspond. Vérifiez le numéro et le téléphone.",
)


@router.post("/orders/track")
async def track_order(
    body: OrderTrackRequest,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """Public lookup: returns order details only if both order_number AND
    phone match, WITHIN this store. Same 404 either way to prevent enumeration.

    Store scoping is essential now that order numbers are unique per store —
    GLAIVE-2026-000042 and GHIR-2026-000042 can both exist, and a customer
    must only ever see their own brand's order."""
    norm_phone = _normalize_phone(body.phone)
    if len(norm_phone) < 6:
        raise _NOT_FOUND

    row = await db.execute(text("""
        SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_method,
               o.subtotal, o.shipping_cost, o.discount_amount, o.tax_amount,
               o.total, o.currency,
               o.confirmed_at, o.shipped_at, o.delivered_at, o.cancelled_at,
               o.created_at,
               c.full_name
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.store_id = :sid
           AND o.order_number = :ord
           AND c.phone_normalized = :ph
    """), {"sid": store.id, "ord": body.order_number.strip(), "ph": norm_phone})
    o = row.first()
    if not o:
        raise _NOT_FOUND

    items_rows = await db.execute(text("""
        SELECT id, product_name, variant_sku, unit_price, quantity, line_total
          FROM order_items
         WHERE order_id = :id
         ORDER BY id
    """), {"id": o[0]})
    items = [{
        "id": str(r[0]),
        "product_name": r[1],
        "variant_sku":  r[2],
        "unit_price":   float(r[3]),
        "quantity":     r[4],
        "line_total":   float(r[5]),
    } for r in items_rows.all()]

    return {
        "id": str(o[0]),
        "order_number":   o[1],
        "status":         o[2],
        "payment_status": o[3],
        "payment_method": o[4],
        "subtotal":       float(o[5]),
        "shipping_cost":  float(o[6]),
        "discount_amount": float(o[7]),
        "tax_amount":     float(o[8]),
        "total":          float(o[9]),
        "currency":       o[10],
        "confirmed_at":   o[11],
        "shipped_at":     o[12],
        "delivered_at":   o[13],
        "cancelled_at":   o[14],
        "created_at":     o[15],
        "customer_name":  o[16],
        "items":          items,
    }
