"""
Unified Jobs Console — Phase 7.

Aggregates three async work streams into one admin surface:

  - scrape_jobs   (Phase 5: market scraping)
  - events        (foundation: domain events, processed by event_worker)
  - sync_queue    (foundation: outbound sync to n8n / accounting / shipping)

Endpoints:

  GET  /jobs/stats                    counts by (type, status)
  GET  /jobs                          paginated unified list with filters
  GET  /jobs/{type}/{id}              per-type detail
  POST /jobs/{type}/{id}/retry        reset to PENDING / RETRYING
  POST /jobs/{type}/{id}/cancel       mark CANCELLED / FAILED (where supported)

`type` ∈ { scrape, event, sync }.
"""
from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for

router = APIRouter(prefix="/jobs", tags=["jobs-console"])

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")
WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")

JobType = Literal["scrape", "event", "sync"]


# ─────────────────────────────────────────────────────────────────────────
# Store scoping
#
# The console is per-brand: an operator sees the work belonging to the store
# they are acting on, and nothing else. The three tables reach their store
# by different routes, and no schema changes here:
#
#   scrape_jobs  platform-level (migration 005) — owner derived through
#                product_id, which is NOT NULL with an FK to products, so an
#                inner JOIN never drops a legitimate row.
#   events       carries store_id (NOT NULL since migration 005).
#   sync_queue   carries store_id (NOT NULL since migration 005).
#
# Cross-store access is a 404, never a 403: confirming a row exists in
# another brand's console is itself a leak.
# ─────────────────────────────────────────────────────────────────────────

async def _assert_scrape_job_in_store(db: AsyncSession, job_id: UUID, store_id) -> None:
    row = await db.execute(
        text("""
            SELECT 1
              FROM scrape_jobs j
              JOIN products p ON p.id = j.product_id
             WHERE j.id = :id AND p.store_id = :sid
        """),
        {"id": job_id, "sid": store_id},
    )
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "scrape job not found")


# Fixed statements rather than an interpolated table name — the table is
# never taken from request data.
_OWNERSHIP_SQL = {
    "event": ("SELECT 1 FROM events WHERE id = :id AND store_id = :sid", "event not found"),
    "sync":  ("SELECT 1 FROM sync_queue WHERE id = :id AND store_id = :sid", "sync row not found"),
}


async def _assert_row_in_store(
    db: AsyncSession, kind: Literal["event", "sync"], row_id: UUID, store_id,
) -> None:
    sql, missing = _OWNERSHIP_SQL[kind]
    row = await db.execute(text(sql), {"id": row_id, "sid": store_id})
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, missing)


# ─────────────────────────────────────────────────────────────────────────
# Stats — for the dashboard tiles
# ─────────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def jobs_stats(
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Counts grouped by (type, normalized status), for this store only."""
    rows_scrape = await db.execute(text("""
        SELECT j.status, COUNT(*)
          FROM scrape_jobs j
          JOIN products p ON p.id = j.product_id
         WHERE p.store_id = :sid
         GROUP BY j.status
    """), {"sid": store.id})
    rows_event = await db.execute(text("""
        SELECT status, COUNT(*) FROM events WHERE store_id = :sid GROUP BY status
    """), {"sid": store.id})
    rows_sync = await db.execute(text("""
        SELECT status, COUNT(*) FROM sync_queue WHERE store_id = :sid GROUP BY status
    """), {"sid": store.id})

    def _to_dict(rows) -> dict[str, int]:
        return {r[0]: int(r[1]) for r in rows.all()}

    by_type = {
        "scrape": _to_dict(rows_scrape),
        "event":  _to_dict(rows_event),
        "sync":   _to_dict(rows_sync),
    }

    # Aggregate active (PENDING+CLAIMED+RUNNING+RETRYING) and failed counts
    active_keys = {"PENDING", "CLAIMED", "RUNNING", "RETRYING"}
    failed_keys = {"FAILED", "CANCELLED"}
    completed_keys = {"COMPLETED", "SYNCED"}

    totals = {"active": 0, "failed": 0, "completed": 0, "total": 0}
    for type_counts in by_type.values():
        for s, n in type_counts.items():
            totals["total"] += n
            if s in active_keys: totals["active"]    += n
            elif s in failed_keys: totals["failed"]  += n
            elif s in completed_keys: totals["completed"] += n

    return {"by_type": by_type, "totals": totals}


# ─────────────────────────────────────────────────────────────────────────
# Unified list — UNION ALL across the three tables, normalized
# ─────────────────────────────────────────────────────────────────────────

@router.get("")
async def list_jobs(
    type_filter: str | None = Query(None, alias="type",
                                    description="scrape | event | sync (omit = all)"),
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, max_length=120,
                          description="Substring search on job_type/event_type/target/error"),
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Returns a normalized job-list across all three tables. The shape is:

        {
          "id":          str,         # row id (UUID)
          "type":        "scrape"|"event"|"sync",
          "status":      str,         # raw enum value from the source table
          "label":       str,         # human-friendly type+target
          "subtype":     str | None,  # event_type / target_system / 'product:UUID'
          "claimed_by":  str | None,
          "started_at":  ISO timestamp | None,
          "completed_at":ISO timestamp | None,
          "error":       str | None,
          "retry_count": int,
          "created_at":  ISO,
        }
    """
    offset = (page - 1) * page_size
    parts: list[str] = []
    params: dict[str, Any] = {"limit": page_size, "offset": offset, "sid": store.id}

    # SCRAPE — the label exposes the product SKU, so the join to products is
    # both how the label is built and how the row is scoped to this store.
    if not type_filter or type_filter == "scrape":
        parts.append("""
            SELECT j.id::text              AS id,
                   'scrape'                AS type,
                   j.status::text          AS status,
                   ('scrape · ' || COALESCE(p.sku, 'product?')) AS label,
                   j.product_id::text      AS subtype,
                   j.claimed_by            AS claimed_by,
                   j.started_at            AS started_at,
                   j.completed_at          AS completed_at,
                   j.error_message         AS error,
                   j.retry_count           AS retry_count,
                   j.created_at            AS created_at
              FROM scrape_jobs j
              JOIN products p ON p.id = j.product_id
             WHERE p.store_id = :sid
        """)

    # EVENT
    if not type_filter or type_filter == "event":
        parts.append("""
            SELECT id::text                AS id,
                   'event'                 AS type,
                   status::text            AS status,
                   ('event · ' || event_type) AS label,
                   event_type              AS subtype,
                   locked_by               AS claimed_by,
                   locked_at               AS started_at,
                   processed_at            AS completed_at,
                   last_error              AS error,
                   retry_count             AS retry_count,
                   created_at              AS created_at
              FROM events
             WHERE store_id = :sid
        """)

    # SYNC
    if not type_filter or type_filter == "sync":
        parts.append("""
            SELECT id::text                AS id,
                   'sync'                  AS type,
                   status::text            AS status,
                   ('sync · ' || target_system || ' · ' || action) AS label,
                   (target_system || ':' || action) AS subtype,
                   NULL                    AS claimed_by,
                   NULL                    AS started_at,
                   synced_at               AS completed_at,
                   last_error              AS error,
                   retry_count             AS retry_count,
                   created_at              AS created_at
              FROM sync_queue
             WHERE store_id = :sid
        """)

    if not parts:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    union_sql = "\nUNION ALL\n".join(parts)

    # Outer filtering
    where: list[str] = []
    if status_filter:
        where.append("u.status = :st")
        params["st"] = status_filter
    if q:
        where.append("(u.label ILIKE :q OR COALESCE(u.error, '') ILIKE :q OR COALESCE(u.subtype, '') ILIKE :q)")
        params["q"] = f"%{q}%"
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    rows = await db.execute(text(f"""
        WITH u AS (
            {union_sql}
        )
        SELECT u.id, u.type, u.status, u.label, u.subtype, u.claimed_by,
               u.started_at, u.completed_at, u.error, u.retry_count, u.created_at
          FROM u
          {where_sql}
         ORDER BY u.created_at DESC
         LIMIT :limit OFFSET :offset
    """), params)

    items = [{
        "id": r[0],
        "type": r[1],
        "status": r[2],
        "label": r[3],
        "subtype": r[4],
        "claimed_by": r[5],
        "started_at": r[6],
        "completed_at": r[7],
        "error": r[8],
        "retry_count": int(r[9] or 0),
        "created_at": r[10],
    } for r in rows.all()]

    total_row = await db.execute(text(f"""
        WITH u AS (
            {union_sql}
        )
        SELECT COUNT(*) FROM u {where_sql}
    """), {k: v for k, v in params.items() if k not in ("limit", "offset")})
    total = int(total_row.scalar_one())

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ─────────────────────────────────────────────────────────────────────────
# Per-type detail
# ─────────────────────────────────────────────────────────────────────────

@router.get("/scrape/{job_id}")
async def detail_scrape(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    j = await db.execute(text("""
        SELECT j.id, j.product_id, j.status, j.max_sources, j.intents, j.expected_price,
               j.claimed_by, j.claimed_at, j.started_at, j.completed_at,
               j.error_message, j.summary, j.retry_count, j.created_at
          FROM scrape_jobs j
          JOIN products p ON p.id = j.product_id
         WHERE j.id = :id AND p.store_id = :sid
    """), {"id": job_id, "sid": store.id})
    r = j.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "scrape job not found")

    summary = r[11] if isinstance(r[11], dict) else (json.loads(r[11]) if r[11] else None)

    s = await db.execute(text("""
        SELECT id, url, domain, tier, intent, fetch_tier, fetch_engine,
               fetch_ms, http_status, title, snippet, extracted, confidence,
               error_message, fetched_at
          FROM scrape_sources
         WHERE job_id = :id
         ORDER BY fetched_at ASC
    """), {"id": job_id})
    sources = [{
        "id": str(rr[0]), "url": rr[1], "domain": rr[2], "tier": rr[3],
        "intent": rr[4], "fetch_tier": rr[5], "fetch_engine": rr[6],
        "fetch_ms": rr[7], "http_status": rr[8],
        "title": rr[9], "snippet": rr[10],
        "extracted": rr[11] if isinstance(rr[11], dict) else (json.loads(rr[11]) if rr[11] else {}),
        "confidence": float(rr[12] or 0),
        "error_message": rr[13],
        "fetched_at": rr[14],
    } for rr in s.all()]

    return {
        "type": "scrape",
        "id": str(r[0]),
        "product_id": str(r[1]),
        "status": r[2],
        "max_sources": r[3],
        "intents": list(r[4] or []),
        "expected_price": float(r[5]) if r[5] is not None else None,
        "claimed_by": r[6],
        "claimed_at": r[7],
        "started_at": r[8],
        "completed_at": r[9],
        "error_message": r[10],
        "summary": summary,
        "retry_count": r[12],
        "created_at": r[13],
        "sources": sources,
    }


@router.get("/event/{job_id}")
async def detail_event(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    e = await db.execute(text("""
        SELECT id, event_id, correlation_id, causation_id,
               entity_type, entity_id, event_type, payload,
               status, retry_count, max_retries, last_error,
               next_retry_at, locked_by, locked_at, processed_at, created_at
          FROM events WHERE id = :id AND store_id = :sid
    """), {"id": job_id, "sid": store.id})
    r = e.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    payload = r[7] if isinstance(r[7], dict) else (json.loads(r[7]) if r[7] else {})
    return {
        "type": "event",
        "id": str(r[0]),
        "event_id": str(r[1]),
        "correlation_id": str(r[2]) if r[2] else None,
        "causation_id":   str(r[3]) if r[3] else None,
        "entity_type": r[4],
        "entity_id":   str(r[5]) if r[5] else None,
        "event_type": r[6],
        "payload": payload,
        "status": r[8],
        "retry_count": r[9],
        "max_retries": r[10],
        "last_error": r[11],
        "next_retry_at": r[12],
        "locked_by": r[13],
        "locked_at": r[14],
        "processed_at": r[15],
        "created_at": r[16],
    }


@router.get("/sync/{job_id}")
async def detail_sync(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    e = await db.execute(text("""
        SELECT id, target_system, entity_type, entity_id, action,
               payload, status, retry_count, max_retries, last_error,
               next_retry_at, synced_at, created_at
          FROM sync_queue WHERE id = :id AND store_id = :sid
    """), {"id": job_id, "sid": store.id})
    r = e.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sync row not found")
    payload = r[5] if isinstance(r[5], dict) else (json.loads(r[5]) if r[5] else {})
    return {
        "type": "sync",
        "id": str(r[0]),
        "target_system": r[1],
        "entity_type":   r[2],
        "entity_id":     str(r[3]) if r[3] else None,
        "action":        r[4],
        "payload":       payload,
        "status":        r[6],
        "retry_count":   r[7],
        "max_retries":   r[8],
        "last_error":    r[9],
        "next_retry_at": r[10],
        "synced_at":     r[11],
        "created_at":    r[12],
    }


# ─────────────────────────────────────────────────────────────────────────
# Retry / Cancel
# ─────────────────────────────────────────────────────────────────────────

@router.post("/scrape/{job_id}/retry")
async def retry_scrape(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    # A retry re-runs the scraper against the job's product. 404 first
    # (unknown or another brand's job), 409 only for a real state conflict.
    await _assert_scrape_job_in_store(db, job_id, store.id)
    res = await db.execute(text("""
        UPDATE scrape_jobs SET
            status        = 'PENDING',
            claimed_by    = NULL,
            claimed_at    = NULL,
            started_at    = NULL,
            completed_at  = NULL,
            error_message = NULL
         WHERE id = :id
           AND status IN ('FAILED','CANCELLED','COMPLETED')
        RETURNING id
    """), {"id": job_id})
    if not res.first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot retry: job is not in a re-runnable state (must be FAILED/CANCELLED/COMPLETED).",
        )
    await db.commit()
    return {"ok": True, "id": str(job_id), "status": "PENDING"}


@router.post("/scrape/{job_id}/cancel")
async def cancel_scrape(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    await _assert_scrape_job_in_store(db, job_id, store.id)
    res = await db.execute(text("""
        UPDATE scrape_jobs SET
            status        = 'CANCELLED',
            completed_at  = NOW(),
            error_message = COALESCE(error_message, '') || ' [cancelled by admin]'
         WHERE id = :id
           AND status IN ('PENDING','CLAIMED','RUNNING')
        RETURNING id
    """), {"id": job_id})
    if not res.first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot cancel: job is already terminal or not found.",
        )
    await db.commit()
    return {"ok": True, "id": str(job_id), "status": "CANCELLED"}


@router.post("/event/{job_id}/retry")
async def retry_event(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    await _assert_row_in_store(db, "event", job_id, store.id)
    res = await db.execute(text("""
        UPDATE events SET
            status        = 'PENDING',
            locked_by     = NULL,
            locked_at     = NULL,
            next_retry_at = NULL,
            last_error    = NULL
         WHERE id = :id
           AND status IN ('FAILED','RETRYING','COMPLETED')
        RETURNING id
    """), {"id": job_id})
    if not res.first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot retry this event in current state.")
    await db.commit()
    return {"ok": True, "id": str(job_id), "status": "PENDING"}


@router.post("/sync/{job_id}/retry")
async def retry_sync(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    await _assert_row_in_store(db, "sync", job_id, store.id)
    res = await db.execute(text("""
        UPDATE sync_queue SET
            status        = 'PENDING',
            next_retry_at = NULL,
            last_error    = NULL
         WHERE id = :id
           AND status IN ('FAILED','RETRYING','SYNCED')
        RETURNING id
    """), {"id": job_id})
    if not res.first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot retry this sync row in current state.")
    await db.commit()
    return {"ok": True, "id": str(job_id), "status": "PENDING"}
