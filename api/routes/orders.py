from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for, require_store
from api.models.schemas import OrderCreate
from api.services import orders as order_svc

router = APIRouter(prefix="/orders", tags=["orders"])

ADMIN_WRITE = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
ADMIN_READ  = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")


@router.post("/create", status_code=201)
async def create(
    dto: OrderCreate,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """Public endpoint — storefront submits orders (no account needed).

    The store is resolved from the request Host (or the single-store fallback),
    so the order, its customer, line items and stock reservations are all
    created against the right brand."""
    out = await order_svc.create_order(db, dto, store)
    await db.commit()
    return out


@router.post("/{order_id}/confirm")
async def confirm(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*ADMIN_WRITE))),
) -> dict[str, Any]:
    out = await order_svc.confirm_order(db, order_id, store.id)
    await db.commit()
    return out


@router.post("/{order_id}/cancel")
async def cancel(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    reason: str | None = Body(None, embed=True),
    store: Store = Depends(require_admin_store_for(require_role(*ADMIN_WRITE))),
) -> dict[str, Any]:
    out = await order_svc.cancel_order(db, order_id, reason, store.id)
    await db.commit()
    return out


@router.get("/{order_id}")
async def get_one(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*ADMIN_READ))),
) -> dict[str, Any]:
    return await order_svc.fetch_order(db, order_id, store.id)


@router.get("")
async def list_orders(
    db: AsyncSession = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    store: Store = Depends(require_admin_store_for(require_role(*ADMIN_READ))),
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    where = ["store_id = :store_id"]
    params: dict[str, Any] = {"limit": page_size, "offset": offset, "store_id": store.id}
    if status_filter:
        where.append("status = :s")
        params["s"] = status_filter
    where_sql = " AND ".join(where)

    rows = await db.execute(
        text(
            f"""
            SELECT id, order_number, status, payment_status, total, currency,
                   customer_id, created_at
              FROM orders
             WHERE {where_sql}
             ORDER BY created_at DESC
             LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    items = [
        {
            "id": r[0], "order_number": r[1], "status": r[2],
            "payment_status": r[3], "total": r[4], "currency": r[5],
            "customer_id": r[6], "created_at": r[7],
        }
        for r in rows.all()
    ]
    total_row = await db.execute(
        text(f"SELECT COUNT(*) FROM orders WHERE {where_sql}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    return {"items": items, "page": page, "page_size": page_size,
            "total": total_row.scalar_one()}
