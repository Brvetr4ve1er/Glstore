"""
Full Intel pipeline endpoints (Phase 4+5 fused).

  POST /products/{id}/intel          enqueue ONE intel job (returns job_id)
                                     ?wait=true blocks up to 120s for result
  POST /products/intel-bulk          enqueue many (filter by status / missing brand etc.)
                                     returns {batch_id, queued}
  GET  /intel-jobs/{id}              full detail of one intel job
  GET  /intel-batches/{batch_id}     aggregate progress for a batch
  POST /intel-jobs/{id}/cancel       cancel a PENDING/CLAIMED/RUNNING job
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import SessionLocal, get_db
from api.core.security import CurrentAdmin, get_current_admin, require_role
from api.core.store_context import Store, require_admin_store_for

router = APIRouter(tags=["intel"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
READ_ROLES  = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")


# ─────────────────────────────────────────────────────────────────────────
# Store scoping
#
# intel_jobs is platform-level by design (migration 005) — it has no
# store_id of its own. The owning store is derived through product_id, so
# every guard here goes job → product → store.
#
# Cross-store access is a 404, never a 403: telling an operator that a row
# exists in another brand's catalog is itself a leak.
# ─────────────────────────────────────────────────────────────────────────

async def _assert_product_in_store(db: AsyncSession, product_id: UUID, store_id) -> None:
    row = await db.execute(
        text("SELECT 1 FROM products WHERE id = :id AND store_id = :sid"),
        {"id": product_id, "sid": store_id},
    )
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")


async def _assert_intel_job_in_store(db: AsyncSession, job_id: UUID, store_id) -> None:
    row = await db.execute(
        text("""
            SELECT 1
              FROM intel_jobs j
              JOIN products p ON p.id = j.product_id
             WHERE j.id = :id AND p.store_id = :sid
        """),
        {"id": job_id, "sid": store_id},
    )
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "intel job not found")


# ─────────────────────────────────────────────────────────────────────────
# Single-product enqueue
# ─────────────────────────────────────────────────────────────────────────

@router.post(
    "/products/{product_id}/intel",
    status_code=202,
)
async def enqueue_intel(
    product_id: UUID,
    wait: bool = Query(False, description="Block up to 120s and return inline result"),
    db: AsyncSession = Depends(get_db),
    admin: CurrentAdmin = Depends(get_current_admin),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    # The intel pipeline overwrites description, specs, images and
    # observations — running it on another brand's product corrupts that
    # brand's catalog. Ownership is checked before anything is enqueued.
    await _assert_product_in_store(db, product_id, store.id)

    # Reuse any in-flight job for this product
    existing = await db.execute(text("""
        SELECT id, status FROM intel_jobs
         WHERE product_id = :pid
           AND status IN ('PENDING','CLAIMED','RUNNING')
         ORDER BY created_at DESC LIMIT 1
    """), {"pid": product_id})
    e = existing.first()
    if e:
        job_id = e[0]
    else:
        job_id = uuid4()
        await db.execute(text("""
            INSERT INTO intel_jobs (id, product_id, status, requested_by)
            VALUES (:id, :pid, 'PENDING', :uid)
        """), {"id": job_id, "pid": product_id, "uid": admin.id})
        await db.commit()

    if not wait:
        return {"job_id": str(job_id), "status": "PENDING"}

    # Inline polling
    for _ in range(120):
        async with SessionLocal() as ldb:
            row = await ldb.execute(text("""
                SELECT status, fields_filled, images_added, completeness_before,
                       completeness_after, status_after, duration_ms, error_message,
                       raw_payload
                  FROM intel_jobs WHERE id = :id
            """), {"id": job_id})
            r = row.first()
            if r and r[0] in ("COMPLETED", "FAILED", "CANCELLED"):
                return {
                    "job_id": str(job_id),
                    "status": r[0],
                    "fields_filled": list(r[1] or []),
                    "images_added": int(r[2] or 0),
                    "completeness_before": float(r[3] or 0),
                    "completeness_after":  float(r[4] or 0),
                    "status_after": r[5],
                    "duration_ms": r[6],
                    "error":     r[7],
                    "raw_payload": r[8] if isinstance(r[8], dict) else (json.loads(r[8]) if r[8] else None),
                }
        await asyncio.sleep(1)
    return {"job_id": str(job_id), "status": "TIMEOUT"}


# ─────────────────────────────────────────────────────────────────────────
# Bulk enqueue
# ─────────────────────────────────────────────────────────────────────────

class IntelBulkRequest(BaseModel):
    """At least one of `product_ids` or filter fields must be provided."""
    product_ids: list[UUID] | None = None
    only_status: list[Literal["RAW", "NORMALIZED", "CLASSIFIED", "VERIFIED", "NEEDS_FIX"]] | None = None
    missing_brand:    bool = False
    missing_category: bool = False
    missing_image:    bool = False
    limit: int = Field(default=200, ge=1, le=2000)


@router.post(
    "/products/intel-bulk",
    status_code=202,
)
async def enqueue_intel_bulk(
    body: IntelBulkRequest,
    db: AsyncSession = Depends(get_db),
    admin: CurrentAdmin = Depends(get_current_admin),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    """Returns {batch_id, queued} — track progress via /intel-batches/{batch_id}."""
    where: list[str] = ["p.status <> 'ARCHIVED'"]
    params: dict[str, Any] = {"lim": body.limit, "sid": store.id}

    if body.product_ids:
        where.append("p.id = ANY(:ids)")
        params["ids"] = [str(x) for x in body.product_ids]
    if body.only_status:
        where.append("p.status = ANY(:statuses)")
        params["statuses"] = list(body.only_status)
    if body.missing_brand:
        where.append("(p.brand IS NULL OR UPPER(p.brand) IN ('INCONNU','UNKNOWN',''))")
    if body.missing_category:
        where.append("(p.category IS NULL OR LOWER(p.category) IN ('other','autre','electromenager',''))")
    if body.missing_image:
        where.append("""NOT EXISTS (
            SELECT 1 FROM product_media m
            WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
        )""")

    if len(where) == 1 and not body.product_ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide product_ids or at least one filter (only_status, missing_brand, …).",
        )

    # Applied after the "at least one filter" check so the store predicate is
    # never mistaken for a caller-supplied filter. Explicit product_ids that
    # belong to another brand simply do not match — they are never enqueued.
    where.append("p.store_id = :sid")
    where_sql = " AND ".join(where)
    rows = await db.execute(
        text(f"SELECT p.id FROM products p WHERE {where_sql} ORDER BY p.completeness_score ASC LIMIT :lim"),
        params,
    )
    ids = [r[0] for r in rows.all()]
    if not ids:
        return {"batch_id": None, "queued": 0, "skipped_in_flight": 0}

    batch_id = uuid4()

    # Skip products that already have an in-flight job
    in_flight = await db.execute(text("""
        SELECT product_id FROM intel_jobs
         WHERE status IN ('PENDING','CLAIMED','RUNNING')
           AND product_id = ANY(:ids)
    """), {"ids": [str(x) for x in ids]})
    in_flight_set = {r[0] for r in in_flight.all()}
    queued_ids = [pid for pid in ids if pid not in in_flight_set]

    # Batch insert
    if queued_ids:
        await db.execute(text("""
            INSERT INTO intel_jobs (id, product_id, batch_id, status, requested_by)
                 SELECT gen_random_uuid(), x, :batch, 'PENDING', :uid
                   FROM unnest(CAST(:ids AS UUID[])) AS x
        """), {
            "batch": batch_id,
            "uid": admin.id,
            "ids": [str(x) for x in queued_ids],
        })
        await db.commit()

    return {
        "batch_id": str(batch_id),
        "queued":   len(queued_ids),
        "skipped_in_flight": len(in_flight_set),
        "matched":  len(ids),
    }


# ─────────────────────────────────────────────────────────────────────────
# Job + batch detail
# ─────────────────────────────────────────────────────────────────────────

@router.get(
    "/intel-jobs/{job_id}",
)
async def get_intel_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    row = await db.execute(text("""
        SELECT j.id, j.product_id, j.batch_id, j.status, j.llm_kind, j.llm_model,
               j.fields_filled, j.images_added,
               j.completeness_before, j.completeness_after, j.status_after,
               j.duration_ms, j.claimed_by, j.claimed_at, j.started_at, j.completed_at,
               j.error_message, j.raw_payload, j.scrape_summary, j.retry_count, j.created_at
          FROM intel_jobs j
          JOIN products p ON p.id = j.product_id
         WHERE j.id = :id AND p.store_id = :sid
    """), {"id": job_id, "sid": store.id})
    r = row.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "intel job not found")

    return {
        "id":             str(r[0]),
        "product_id":     str(r[1]),
        "batch_id":       str(r[2]) if r[2] else None,
        "status":         r[3],
        "llm_kind":       r[4],
        "llm_model":      r[5],
        "fields_filled":  list(r[6] or []),
        "images_added":   int(r[7] or 0),
        "completeness_before": float(r[8]) if r[8] is not None else None,
        "completeness_after":  float(r[9]) if r[9] is not None else None,
        "status_after":   r[10],
        "duration_ms":    r[11],
        "claimed_by":     r[12],
        "claimed_at":     r[13],
        "started_at":     r[14],
        "completed_at":   r[15],
        "error_message":  r[16],
        "raw_payload":    r[17] if isinstance(r[17], dict) else (json.loads(r[17]) if r[17] else None),
        "scrape_summary": r[18] if isinstance(r[18], dict) else (json.loads(r[18]) if r[18] else None),
        "retry_count":    int(r[19] or 0),
        "created_at":     r[20],
    }


@router.get(
    "/intel-batches/{batch_id}",
)
async def get_intel_batch(
    batch_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Aggregate progress for the batch — used by the bulk progress UI.

    Scoped to this store's products, so another brand's batch reads as empty
    rather than reporting its progress."""
    rows = await db.execute(text("""
        SELECT j.status, COUNT(*),
               AVG(j.completeness_after - j.completeness_before)::real AS avg_delta,
               SUM(j.images_added)::int AS images_added
          FROM intel_jobs j
          JOIN products p ON p.id = j.product_id
         WHERE j.batch_id = :id AND p.store_id = :sid
         GROUP BY j.status
    """), {"id": batch_id, "sid": store.id})
    by_status: dict[str, int] = {}
    delta_sum = 0.0
    delta_cnt = 0
    images_added = 0
    for r in rows.all():
        by_status[r[0]] = int(r[1])
        if r[2] is not None:
            delta_sum += float(r[2]) * int(r[1])
            delta_cnt += int(r[1])
        if r[3]:
            images_added += int(r[3] or 0)

    total = sum(by_status.values())
    completed = by_status.get("COMPLETED", 0)
    failed    = by_status.get("FAILED", 0)
    cancelled = by_status.get("CANCELLED", 0)
    pending   = by_status.get("PENDING", 0)
    running   = by_status.get("RUNNING", 0) + by_status.get("CLAIMED", 0)

    pct = (completed + failed + cancelled) / total * 100 if total else 0.0
    avg_delta = delta_sum / delta_cnt if delta_cnt else 0.0

    return {
        "batch_id":  str(batch_id),
        "total":     total,
        "by_status": by_status,
        "completed": completed,
        "failed":    failed,
        "cancelled": cancelled,
        "pending":   pending,
        "running":   running,
        "percent_done":     round(pct, 2),
        "avg_completeness_delta": round(avg_delta, 3),
        "images_added": images_added,
        "is_terminal": pending == 0 and running == 0,
    }


@router.post(
    "/intel-jobs/{job_id}/cancel",
)
async def cancel_intel_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    # 404 first (unknown or another brand's job), 409 only for a real
    # state conflict on a job this store owns.
    await _assert_intel_job_in_store(db, job_id, store.id)
    res = await db.execute(text("""
        UPDATE intel_jobs SET
            status = 'CANCELLED',
            completed_at = NOW(),
            error_message = COALESCE(error_message, '') || ' [cancelled by admin]'
         WHERE id = :id
           AND status IN ('PENDING','CLAIMED','RUNNING')
        RETURNING id
    """), {"id": job_id})
    if not res.first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot cancel: already terminal or not found.",
        )
    await db.commit()
    return {"ok": True, "id": str(job_id), "status": "CANCELLED"}
