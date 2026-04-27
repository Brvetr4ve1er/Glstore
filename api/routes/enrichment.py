"""
Enrichment endpoints — Phase 2 (rule-based) + Phase 4 (LLM).

POST /products/{id}/enrich          single product, rule engine
POST /products/enrich-all           bulk rule-based pass
GET  /products/enrichment/stats     status histogram + average completeness

POST /products/{id}/enrich-llm      single product, LLM (Phase 4)
POST /products/enrich-llm-bulk      bulk LLM pass (Phase 4)
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.services import enrichment_runner, llm, llm_enrichment

router = APIRouter(prefix="/products", tags=["enrichment"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")


@router.post("/{product_id}/enrich", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def enrich_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    applied = await enrichment_runner.enrich_one(db, product_id)
    if not applied:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
    await db.commit()
    return applied.to_dict()


@router.post("/enrich-all", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def enrich_all(
    db: AsyncSession = Depends(get_db),
    only_status: list[str] | None = Query(default=None, description="Statuses to enrich. Default: RAW,NORMALIZED,NEEDS_FIX"),
    limit: int = Query(5000, ge=1, le=20000),
) -> dict[str, Any]:
    statuses = tuple(only_status) if only_status else ("RAW", "NORMALIZED", "NEEDS_FIX")
    report = await enrichment_runner.enrich_many(db, only_status=statuses, limit=limit)
    await db.commit()
    return report.to_dict()


@router.get("/enrichment/stats")
async def enrichment_stats(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Status histogram + average completeness — for dashboard chips."""
    rows = await db.execute(text("""
        SELECT status, COUNT(*), AVG(completeness_score)
          FROM products
         GROUP BY status
         ORDER BY status
    """))
    by_status: dict[str, dict[str, float]] = {}
    total = 0
    weighted = 0.0
    for r in rows.all():
        cnt = int(r[1])
        avg = float(r[2] or 0)
        by_status[r[0]] = {"count": cnt, "avg_completeness": round(avg, 3)}
        total += cnt
        weighted += cnt * avg

    return {
        "total": total,
        "average_completeness": round(weighted / total, 3) if total else 0.0,
        "by_status": by_status,
    }


# ── Phase 4 — LLM enrichment ─────────────────────────────────────────────

@router.post("/{product_id}/enrich-llm", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def enrich_one_llm(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = await llm_enrichment.enrich_one(db, product_id)
    except llm.LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"LLM call failed: {e}")
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    await db.commit()
    return result.to_dict()


@router.post("/enrich-llm-bulk", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def enrich_llm_bulk(
    db: AsyncSession = Depends(get_db),
    only_status: list[str] | None = Query(
        default=None,
        description="Statuses to enrich. Default: NEEDS_FIX,CLASSIFIED",
    ),
    limit: int = Query(50, ge=1, le=500, description="Hard cap — LLM calls are expensive."),
) -> dict[str, Any]:
    """Bulk LLM enrichment. Sequential, fail-soft. Stops at first config-level
    error so a misconfigured endpoint doesn't burn through the catalog."""
    statuses = tuple(only_status) if only_status else ("NEEDS_FIX", "CLASSIFIED")
    cfg = await llm.load_config(db)

    rows = await db.execute(text("""
        SELECT id FROM products
         WHERE status = ANY(:statuses)
         ORDER BY completeness_score ASC, updated_at ASC
         LIMIT :lim
    """), {"statuses": list(statuses), "lim": limit})
    ids = [r[0] for r in rows.all()]

    enriched = 0
    failed = 0
    failure_samples: list[str] = []
    sum_before, sum_after = 0.0, 0.0

    for pid in ids:
        try:
            r = await llm_enrichment.enrich_one(db, pid, cfg=cfg)
            await db.commit()
            enriched += 1
            sum_before += r.completeness_before
            sum_after  += r.completeness_after
        except llm.LLMError as e:
            await db.rollback()
            failed += 1
            if len(failure_samples) < 3:
                failure_samples.append(str(e)[:200])
            # Configuration-level errors trip the breaker so we don't hammer the LLM
            if "connection" in str(e).lower() or "Unknown LLM kind" in str(e):
                break
        except Exception as e:  # noqa: BLE001
            await db.rollback()
            failed += 1
            if len(failure_samples) < 3:
                failure_samples.append(f"{type(e).__name__}: {e}"[:200])

    return {
        "total_attempted": len(ids),
        "enriched": enriched,
        "failed": failed,
        "avg_completeness_before": round(sum_before / enriched, 3) if enriched else 0.0,
        "avg_completeness_after":  round(sum_after  / enriched, 3) if enriched else 0.0,
        "backend": cfg.kind,
        "model": cfg.model,
        "failure_samples": failure_samples,
    }
