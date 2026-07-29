"""
Stores — the admin's store picker + per-store settings (Phase: multi-store admin).

GET  /stores            list the stores this operator may act on
GET  /stores/{id}       one store's details

Access model (mirrors store_context.require_admin_store_for):
  · Platform operator (admin.store_id IS NULL) → sees every store; the admin UI
    must then send `x-store-id` on store-scoped calls to say which one it's
    working on.
  · Store-scoped operator (admin.store_id set) → sees only their own store.

This is deliberately its own router (not under store_context) so the admin app
has one obvious endpoint to populate its store switcher on boot.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import CurrentAdmin, require_role

router = APIRouter(prefix="/stores", tags=["stores"])

ADMIN_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")

_STORE_COLS = """
    id, slug, name, status::text AS status, order_prefix, currency,
    support_email, support_phone, theme
"""


def _row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id":            str(r[0]),
        "slug":          r[1],
        "name":          r[2],
        "status":        r[3],
        "order_prefix":  r[4],
        "currency":      r[5],
        "support_email": r[6],
        "support_phone": r[7],
        "theme":         r[8] or {},
    }


@router.get("")
async def list_stores(
    db: AsyncSession = Depends(get_db),
    admin: CurrentAdmin = Depends(require_role(*ADMIN_ROLES)),
) -> dict[str, Any]:
    """Stores this operator may switch between. A platform operator sees all;
    a store-scoped operator sees only theirs."""
    if admin.store_id is None:
        rows = await db.execute(text(f"""
            SELECT {_STORE_COLS} FROM stores
             ORDER BY (status = 'ACTIVE') DESC, name ASC
        """))
    else:
        rows = await db.execute(
            text(f"SELECT {_STORE_COLS} FROM stores WHERE id = :sid"),
            {"sid": admin.store_id},
        )
    items = [_row_to_dict(r) for r in rows.all()]
    return {
        "items":                items,
        "is_platform_operator": admin.store_id is None,
        # The UI uses this to decide whether a store MUST be selected (platform
        # operator) or is fixed (scoped operator).
        "scoped_store_id":      str(admin.store_id) if admin.store_id else None,
    }


@router.get("/{store_id}")
async def get_store(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: CurrentAdmin = Depends(require_role(*ADMIN_ROLES)),
) -> dict[str, Any]:
    # A scoped operator may only read their own store.
    if admin.store_id is not None and admin.store_id != store_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to that store.")
    row = await db.execute(
        text(f"SELECT {_STORE_COLS} FROM stores WHERE id = :sid"),
        {"sid": store_id},
    )
    r = row.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "store not found")
    return _row_to_dict(r)
