"""
Image review queue — Phase 9.

The full-intel pipeline (api/services/full_intel.py) appends scraped image URLs
to product_media as `status='PENDING'`. The admin then reviews them here:
approve → flips to STORED (and optionally promotes to primary), reject →
status='DELETED'.

Endpoints (all admin-only):
  GET    /products/{product_id}/images?status=PENDING   list images for a product
  POST   /products/{product_id}/images/{image_id}/approve   { is_primary?: bool, alt_text?: str }
  POST   /products/{product_id}/images/{image_id}/reject
  GET    /images/pending                                queue across all products
  GET    /images/pending/summary                        { total, by_product[] }
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for
from api.services.full_intel import _recompute_status_and_completeness

router = APIRouter(tags=["images"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
READ_ROLES  = ("SUPER_ADMIN", "ADMIN", "OPERATOR")

# Valid media_status_enum values for the `status` filter
_ALLOWED_STATUS = {"PENDING", "UPLOADING", "STORED", "FAILED", "DELETED"}


# ── Models ──────────────────────────────────────────────────────────────────

class ApproveImage(BaseModel):
    is_primary: bool = False
    alt_text:   str | None = Field(default=None, max_length=300)


# ── Per-product list ────────────────────────────────────────────────────────

@router.get("/products/{product_id}/images")
async def list_product_images(
    product_id: UUID,
    status:     str | None = Query(None, description="Filter by media_status_enum (default: all)"),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """List all images for a product. By default returns every status so the
    UI can show a 'Confirmed' tab next to the 'Pending' queue."""
    where = "product_id = :pid AND store_id = :sid AND kind = 'image'"
    params: dict[str, Any] = {"pid": product_id, "sid": store.id}
    if status:
        norm = status.upper()
        if norm not in _ALLOWED_STATUS:
            raise HTTPException(http.HTTP_400_BAD_REQUEST, f"unknown status '{status}'")
        where += " AND status = :st"
        params["st"] = norm

    rows = await db.execute(text(f"""
        SELECT id, url, status::text, source::text, is_primary, position,
               alt_text, width, height, bytes, created_at
          FROM product_media
         WHERE {where}
         ORDER BY status = 'PENDING' DESC,  -- show pending first
                  is_primary DESC,
                  position ASC,
                  created_at DESC
    """), params)
    items = [{
        "id":         r[0],
        "url":        r[1],
        "status":     r[2],
        "source":     r[3],
        "is_primary": r[4],
        "position":   r[5],
        "alt_text":   r[6],
        "width":      r[7],
        "height":     r[8],
        "bytes":      r[9],
        "created_at": r[10],
    } for r in rows.all()]
    return {
        "product_id": str(product_id),
        "items":      items,
        "counts": {
            "pending":  sum(1 for i in items if i["status"] == "PENDING"),
            "stored":   sum(1 for i in items if i["status"] == "STORED"),
            "deleted":  sum(1 for i in items if i["status"] == "DELETED"),
            "failed":   sum(1 for i in items if i["status"] == "FAILED"),
            "total":    len(items),
        },
    }


# ── Approve ─────────────────────────────────────────────────────────────────

@router.post("/products/{product_id}/images/{image_id}/approve")
async def approve_image(
    product_id: UUID,
    image_id:   UUID,
    dto:        ApproveImage,
    db:         AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    """Promote a PENDING image to STORED. Optionally mark it as the primary
    image (in which case the previous primary is demoted)."""
    row = await db.execute(text("""
        SELECT id, status::text, is_primary FROM product_media
         WHERE id = :id AND product_id = :pid AND store_id = :sid AND kind = 'image'
    """), {"id": image_id, "pid": product_id, "sid": store.id})
    r = row.first()
    if not r:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "image not found")

    if r[1] not in ("PENDING", "FAILED"):
        # Idempotent: STORED → still allow setting primary; DELETED → reject
        if r[1] == "DELETED":
            raise HTTPException(http.HTTP_409_CONFLICT, "cannot approve a deleted image")

    # Demote any current primary if requested
    if dto.is_primary:
        await db.execute(text("""
            UPDATE product_media
               SET is_primary = false, updated_at = NOW()
             WHERE product_id = :pid AND store_id = :sid AND is_primary = true AND id <> :id
        """), {"pid": product_id, "sid": store.id, "id": image_id})

    await db.execute(text("""
        UPDATE product_media
           SET status     = 'STORED',
               is_primary = COALESCE(:is_primary, is_primary),
               alt_text   = COALESCE(:alt, alt_text),
               updated_at = NOW()
         WHERE id = :id AND product_id = :pid AND store_id = :sid
    """), {
        "id":         image_id,
        "pid":        product_id,
        "sid":        store.id,
        "is_primary": dto.is_primary,
        "alt":        dto.alt_text,
    })

    # Recompute completeness using the canonical formula
    # (weights mirror api/services/enrichment.compute_completeness)
    await _recompute_status_and_completeness(db, product_id)

    # Audit (observations.store_id is NOT NULL after migration 005)
    await db.execute(text("""
        INSERT INTO observations (store_id, entity_type, entity_id, field, value, source, confidence)
        VALUES (:sid, 'product', :pid, 'image_approved', CAST(:v AS JSONB), 'admin_review', 1.0)
    """), {
        "sid": store.id,
        "pid": product_id,
        "v": f'{{"image_id":"{image_id}","is_primary":{str(bool(dto.is_primary)).lower()}}}',
    })

    await db.commit()
    return {"ok": True, "id": str(image_id), "status": "STORED", "is_primary": bool(dto.is_primary)}


# ── Reject ──────────────────────────────────────────────────────────────────

@router.post("/products/{product_id}/images/{image_id}/reject")
async def reject_image(
    product_id: UUID,
    image_id:   UUID,
    db:         AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    """Mark a PENDING image as DELETED. Idempotent. The row is kept for audit
    so the same URL won't be re-suggested by the next intel run (full_intel
    dedupes on `existing_urls`)."""
    row = await db.execute(text("""
        SELECT id, status::text FROM product_media
         WHERE id = :id AND product_id = :pid AND store_id = :sid AND kind = 'image'
    """), {"id": image_id, "pid": product_id, "sid": store.id})
    r = row.first()
    if not r:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "image not found")

    await db.execute(text("""
        UPDATE product_media
           SET status = 'DELETED', is_primary = false, updated_at = NOW()
         WHERE id = :id AND product_id = :pid AND store_id = :sid
    """), {"id": image_id, "pid": product_id, "sid": store.id})

    # Recompute since rejecting the primary image drops the 10pt media credit
    await _recompute_status_and_completeness(db, product_id)

    await db.execute(text("""
        INSERT INTO observations (store_id, entity_type, entity_id, field, value, source, confidence)
        VALUES (:sid, 'product', :pid, 'image_rejected', CAST(:v AS JSONB), 'admin_review', 1.0)
    """), {
        "sid": store.id,
        "pid": product_id,
        "v": f'{{"image_id":"{image_id}"}}',
    })

    await db.commit()
    return {"ok": True, "id": str(image_id), "status": "DELETED"}


# ── Global queue (cross-product) ────────────────────────────────────────────

@router.get("/images/pending")
async def pending_queue(
    page:      int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Cross-catalog queue of images awaiting human review (this store only)."""
    total_row = await db.execute(text(
        "SELECT COUNT(*) FROM product_media "
        "WHERE status = 'PENDING' AND kind = 'image' AND store_id = :sid"
    ), {"sid": store.id})
    total = int(total_row.scalar() or 0)

    rows = await db.execute(text("""
        SELECT m.id, m.product_id, m.url, m.source::text, m.alt_text, m.created_at,
               p.sku, p.name, p.brand, p.category
          FROM product_media m
          JOIN products p ON p.id = m.product_id
         WHERE m.status = 'PENDING' AND m.kind = 'image' AND m.store_id = :sid
         ORDER BY m.created_at DESC
         LIMIT :lim OFFSET :off
    """), {"sid": store.id, "lim": page_size, "off": (page - 1) * page_size})

    items = [{
        "id":         r[0],
        "product_id": r[1],
        "url":        r[2],
        "source":     r[3],
        "alt_text":   r[4],
        "created_at": r[5],
        "sku":        r[6],
        "product_name": r[7],
        "brand":      r[8],
        "category":   r[9],
    } for r in rows.all()]

    return {
        "items":     items,
        "page":      page,
        "page_size": page_size,
        "total":     total,
    }


@router.get("/images/pending/summary")
async def pending_summary(
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    row = await db.execute(text("""
        SELECT COUNT(*) FILTER (WHERE m.status = 'PENDING') AS pending,
               COUNT(*) FILTER (WHERE m.status = 'STORED' AND m.created_at > NOW() - INTERVAL '24 hours') AS approved_24h,
               COUNT(*) FILTER (WHERE m.status = 'DELETED' AND m.updated_at > NOW() - INTERVAL '24 hours') AS rejected_24h
          FROM product_media m
         WHERE m.kind = 'image' AND m.store_id = :sid
    """), {"sid": store.id})
    r = row.first()
    by_product_rows = await db.execute(text("""
        SELECT p.id, p.sku, p.name, COUNT(*) AS n
          FROM product_media m
          JOIN products p ON p.id = m.product_id
         WHERE m.status = 'PENDING' AND m.kind = 'image' AND m.store_id = :sid
         GROUP BY p.id, p.sku, p.name
         ORDER BY n DESC
         LIMIT 20
    """), {"sid": store.id})
    return {
        "pending":      int(r[0] or 0) if r else 0,
        "approved_24h": int(r[1] or 0) if r else 0,
        "rejected_24h": int(r[2] or 0) if r else 0,
        "top_products": [
            {"id": pr[0], "sku": pr[1], "name": pr[2], "pending": int(pr[3])}
            for pr in by_product_rows.all()
        ],
    }
