"""
Scraper endpoints — Phase 5.

POST /products/{id}/scrape                  enqueue a job
GET  /scrape-jobs/{id}                      job status + sources
GET  /products/{id}/scrape-jobs             last N jobs for a product
GET  /products/{id}/competitor-prices       time series
GET  /products/{id}/market-summary          latest median + delta + sources
GET  /products/market/alerts                catalog-wide list of priced-above-market products
GET  /settings/scraper                      current scraper config (api keys masked)
PUT  /settings/scraper                      update scraper config
POST /settings/scraper/probe                health-check SearXNG + Playwright
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db, SessionLocal
from api.core.security import (
    CurrentAdmin,
    get_current_admin,
    require_platform_operator,
    require_role,
)
from api.core.store_context import (
    Store,
    _assert_product_in_store,
    require_admin_store_for,
)

router = APIRouter(tags=["scraper"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")


# ════════════════════════════════════════════════════════════════════════════
# 0. Store scoping
#
# scrape_jobs / scrape_sources / competitor_prices carry no store_id — they
# are platform-level by design (migration 005: "the scraper researches the
# *market*, not one store's catalog"). The owning store is therefore derived
# through product_id on every guard below.
#
# Cross-store access is a 404, never a 403: confirming that a row exists in
# another brand's catalog is itself a leak.
#
# That product→store check is shared with the intel and enrichment routers,
# so it lives in api/core/store_context.py and is imported above.
# ════════════════════════════════════════════════════════════════════════════


# ════════════════════════════════════════════════════════════════════════════
# 1. Enqueue + status
# ════════════════════════════════════════════════════════════════════════════

class ScrapeRequest(BaseModel):
    intents: list[Literal["commercial", "technical", "review"]] = Field(
        default_factory=lambda: ["commercial", "technical", "review"]
    )
    max_sources: int = Field(default=6, ge=1, le=20)


@router.post(
    "/products/{product_id}/scrape",
    status_code=202,
)
async def enqueue_scrape(
    product_id: UUID,
    body: ScrapeRequest = ScrapeRequest(),
    wait: bool = Query(False, description="Block up to 90s and return inline result"),
    db: AsyncSession = Depends(get_db),
    admin: CurrentAdmin = Depends(get_current_admin),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    # A scrape writes competitor_prices and observations against this product.
    # Check the product belongs to the acting store before enqueueing anything.
    await _assert_product_in_store(db, product_id, store.id)

    # If a PENDING/RUNNING/CLAIMED job already exists for this product, reuse it
    existing = await db.execute(text("""
        SELECT id, status FROM scrape_jobs
         WHERE product_id = :pid
           AND status IN ('PENDING', 'CLAIMED', 'RUNNING')
         ORDER BY created_at DESC LIMIT 1
    """), {"pid": product_id})
    e = existing.first()
    if e:
        job_id = e[0]
    else:
        job_id = uuid4()
        await db.execute(text("""
            INSERT INTO scrape_jobs (
                id, product_id, status, max_sources, intents, requested_by,
                expected_price
            ) VALUES (
                :id, :pid, 'PENDING', :max, :intents, :uid,
                (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
                   FROM offers o
                  WHERE o.product_id = :pid AND o.is_active AND o.retail_price > 0)
            )
        """), {
            "id": job_id, "pid": product_id,
            "max": body.max_sources,
            "intents": body.intents,
            "uid": admin.id,
        })
        await db.commit()

    if not wait:
        return {"job_id": str(job_id), "status": "PENDING"}

    # Inline mode: poll for completion (dev / debugging)
    for _ in range(90):
        async with SessionLocal() as ldb:
            row = await ldb.execute(
                text("SELECT status, summary, error_message FROM scrape_jobs WHERE id = :id"),
                {"id": job_id},
            )
            r = row.first()
            if r and r[0] in ("COMPLETED", "FAILED", "CANCELLED"):
                summary = r[1] if isinstance(r[1], dict) else (json.loads(r[1]) if r[1] else None)
                return {
                    "job_id": str(job_id),
                    "status": r[0],
                    "summary": summary,
                    "error": r[2],
                }
        await asyncio.sleep(1)
    return {"job_id": str(job_id), "status": "TIMEOUT"}


@router.get(
    "/scrape-jobs/{job_id}",
)
async def get_scrape_job(
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")

    s = await db.execute(text("""
        SELECT id, url, domain, tier, intent, fetch_tier, fetch_engine,
               fetch_ms, http_status, title, snippet, extracted, confidence,
               error_message, fetched_at
          FROM scrape_sources
         WHERE job_id = :id
         ORDER BY fetched_at ASC
    """), {"id": job_id})
    sources = [{
        "id": str(rr[0]),
        "url": rr[1], "domain": rr[2], "tier": rr[3], "intent": rr[4],
        "fetch_tier": rr[5], "fetch_engine": rr[6],
        "fetch_ms": rr[7], "http_status": rr[8],
        "title": rr[9], "snippet": rr[10],
        "extracted": rr[11] if isinstance(rr[11], dict) else (json.loads(rr[11]) if rr[11] else {}),
        "confidence": float(rr[12] or 0),
        "error_message": rr[13],
        "fetched_at": rr[14],
    } for rr in s.all()]

    summary = r[11] if isinstance(r[11], dict) else (json.loads(r[11]) if r[11] else None)
    return {
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


@router.get(
    "/products/{product_id}/scrape-jobs",
)
async def list_product_scrape_jobs(
    product_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    await _assert_product_in_store(db, product_id, store.id)
    rows = await db.execute(text("""
        SELECT id, status, started_at, completed_at, error_message, summary, created_at
          FROM scrape_jobs
         WHERE product_id = :pid
         ORDER BY created_at DESC
         LIMIT :lim
    """), {"pid": product_id, "lim": limit})
    items = [{
        "id": str(r[0]), "status": r[1],
        "started_at": r[2], "completed_at": r[3],
        "error_message": r[4],
        "summary": r[5] if isinstance(r[5], dict) else (json.loads(r[5]) if r[5] else None),
        "created_at": r[6],
    } for r in rows.all()]
    return {"items": items}


# ════════════════════════════════════════════════════════════════════════════
# 2. Market data
# ════════════════════════════════════════════════════════════════════════════

@router.get(
    "/products/{product_id}/competitor-prices",
)
async def get_competitor_prices(
    product_id: UUID,
    domain: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    await _assert_product_in_store(db, product_id, store.id)
    where = ["product_id = :pid"]
    params: dict[str, Any] = {"pid": product_id, "lim": limit}
    if domain:
        where.append("source_domain = :d")
        params["d"] = domain
    where_sql = " AND ".join(where)

    rows = await db.execute(text(f"""
        SELECT id, source_domain, source_url, price, currency,
               availability, confidence, observed_at, scrape_job_id
          FROM competitor_prices
         WHERE {where_sql}
         ORDER BY observed_at DESC
         LIMIT :lim
    """), params)
    items = [{
        "id": str(r[0]),
        "source_domain": r[1], "source_url": r[2],
        "price": float(r[3]),
        "currency": r[4],
        "availability": r[5],
        "confidence": float(r[6] or 0),
        "observed_at": r[7],
        "scrape_job_id": str(r[8]) if r[8] else None,
    } for r in rows.all()]
    return {"items": items, "total": len(items)}


@router.get(
    "/products/{product_id}/market-summary",
)
async def get_market_summary(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Latest aggregated picture: median, low, high, delta vs our price, sources."""
    await _assert_product_in_store(db, product_id, store.id)
    # Latest competitor_prices per domain (1 per domain, most recent)
    rows = await db.execute(text("""
        WITH latest AS (
            SELECT DISTINCT ON (source_domain)
                   id, source_domain, source_url, price, currency,
                   availability, confidence, observed_at
              FROM competitor_prices
             WHERE product_id = :pid
             ORDER BY source_domain, observed_at DESC
        )
        SELECT * FROM latest ORDER BY price ASC
    """), {"pid": product_id})
    sources = [{
        "id": str(r[0]),
        "source_domain": r[1], "source_url": r[2],
        "price": float(r[3]), "currency": r[4],
        "availability": r[5],
        "confidence": float(r[6] or 0),
        "observed_at": r[7],
    } for r in rows.all()]

    our_row = await db.execute(text("""
        SELECT MIN(COALESCE(o.sale_price, o.retail_price))
          FROM offers o
         WHERE o.product_id = :pid
           AND o.is_active
           AND o.retail_price > 0
    """), {"pid": product_id})
    our_price = our_row.scalar_one_or_none()
    our_price = float(our_price) if our_price is not None else None

    if not sources:
        return {
            "our_price": our_price, "sources": [],
            "median_price": None, "lowest_price": None, "highest_price": None,
            "vs_market_pct": None, "margin_alert": False,
            "last_scraped_at": None,
        }

    prices = [s["price"] for s in sources]
    prices_sorted = sorted(prices)
    median_price = prices_sorted[len(prices_sorted) // 2]
    if len(prices_sorted) % 2 == 0:
        median_price = (prices_sorted[len(prices_sorted) // 2 - 1] + prices_sorted[len(prices_sorted) // 2]) / 2
    vs_market_pct: float | None = None
    margin_alert = False
    if our_price and median_price > 0:
        vs_market_pct = round((our_price - median_price) / median_price, 4)
        margin_alert = vs_market_pct > 0.10
    last_scraped_at = max(s["observed_at"] for s in sources)
    return {
        "our_price": our_price,
        "sources": sources,
        "median_price": float(median_price),
        "lowest_price": float(prices_sorted[0]),
        "highest_price": float(prices_sorted[-1]),
        "vs_market_pct": vs_market_pct,
        "margin_alert": margin_alert,
        "last_scraped_at": last_scraped_at,
    }


@router.get(
    "/products/market/alerts",
)
async def market_alerts(
    threshold_pct: float = Query(0.10, ge=0, le=2.0,
                                 description="Alert when our price is N% above market median"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Catalog-wide alert list — restricted to the acting store's catalog so
    one brand cannot enumerate another brand's SKUs, names and pricing."""
    offset = (page - 1) * page_size
    rows = await db.execute(text("""
        WITH latest AS (
            SELECT DISTINCT ON (cp.product_id, cp.source_domain)
                   cp.product_id, cp.source_domain, cp.price
              FROM competitor_prices cp
             ORDER BY cp.product_id, cp.source_domain, cp.observed_at DESC
        ),
        median AS (
            SELECT product_id,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
                   COUNT(*) AS source_count
              FROM latest
             GROUP BY product_id
        ),
        ours AS (
            SELECT p.id AS product_id, p.sku, p.name, p.brand, p.category,
                   p.completeness_score,
                   (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
                      FROM offers o
                     WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0
                   ) AS our_price,
                   (SELECT url FROM product_media m
                     WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                     LIMIT 1) AS primary_image
              FROM products p
             WHERE p.status <> 'ARCHIVED'
               AND p.store_id = :sid
        )
        SELECT o.product_id, o.sku, o.name, o.brand, o.category, o.completeness_score,
               o.our_price, m.median_price, m.source_count, o.primary_image,
               (o.our_price - m.median_price) / NULLIF(m.median_price, 0) AS vs_pct
          FROM ours o
          JOIN median m USING (product_id)
         WHERE o.our_price IS NOT NULL
           AND m.median_price > 0
           AND ((o.our_price - m.median_price) / m.median_price) >= :th
         ORDER BY vs_pct DESC
         LIMIT :lim OFFSET :off
    """), {"th": threshold_pct, "lim": page_size, "off": offset, "sid": store.id})
    items = [{
        "product_id": str(r[0]), "sku": r[1], "name": r[2],
        "brand": r[3], "category": r[4],
        "completeness_score": float(r[5] or 0),
        "our_price": float(r[6]),
        "median_price": float(r[7]),
        "source_count": int(r[8]),
        "primary_image": r[9],
        "vs_market_pct": float(r[10]),
    } for r in rows.all()]
    return {"items": items, "total": len(items), "threshold_pct": threshold_pct}


# ════════════════════════════════════════════════════════════════════════════
# 3. Settings
#
# `app_settings['scraper.config']` is PLATFORM-GLOBAL — one row, no store_id,
# governing how every brand scrapes. Two things in it reach past the brand
# that edits it:
#
#   · `searxng_url` is fetched server-side by the probe below and by every
#     worker, so whoever sets it chooses an outbound destination for the whole
#     platform (an SSRF surface).
#   · `price_outlier_*` / `min_confidence_for_price` decide which observations
#     survive into `competitor_prices` — rows attached to OTHER brands'
#     products.
#
# Reading it is not the risk, so GET keeps its existing roles. Writing it, and
# making the server fetch a URL out of it, are restricted to platform
# operators (`admin_users.store_id IS NULL`). Scoping the row itself would
# need a schema change; this closes the hole without one.
# ════════════════════════════════════════════════════════════════════════════

class ScraperConfigIn(BaseModel):
    searxng_url: str = Field(default="http://searxng:8080", min_length=4, max_length=500)
    ddg_fallback_enabled: bool = True
    brave_api_key: str | None = None       # null clears, "" keeps, else overwrite
    max_sources_per_product: int = Field(default=6, ge=1, le=20)
    max_concurrent_fetches: int = Field(default=3, ge=1, le=10)
    per_domain_rate_limit_seconds: float = Field(default=2.0, ge=0.5, le=60)
    per_job_timeout_seconds: int = Field(default=90, ge=15, le=600)
    cache_ttl_hours_official: int = Field(default=24, ge=1, le=168)
    cache_ttl_hours_retailer: int = Field(default=6, ge=1, le=72)
    cache_ttl_hours_classified: int = Field(default=2, ge=1, le=24)
    user_agent: str = Field(default="GhirLaffaireBot/1.0")
    tier4_enabled: bool = False
    tier4_provider: Literal["", "scraperapi", "scrapingbee", "zyte", "brightdata"] = ""
    tier4_api_key: str | None = None
    min_confidence_for_price: float = Field(default=0.6, ge=0.0, le=1.0)
    price_outlier_low_factor: float = Field(default=0.3, ge=0.05, le=1.0)
    price_outlier_high_factor: float = Field(default=2.5, ge=1.0, le=10.0)
    margin_alert_threshold_pct: float = Field(default=0.10, ge=0.0, le=2.0)


def _mask_keys(cfg: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg)
    for k in ("brave_api_key", "tier4_api_key"):
        v = out.get(k)
        if v:
            out[k] = "•" * 8
            out[k + "_set"] = True
        else:
            out[k + "_set"] = False
    return out


async def _load_scraper_config(db: AsyncSession) -> dict[str, Any]:
    row = await db.execute(text("SELECT value FROM app_settings WHERE key = 'scraper.config'"))
    r = row.first()
    if not r:
        return {}
    return r[0] if isinstance(r[0], dict) else json.loads(r[0])


@router.get("/settings/scraper", dependencies=[Depends(require_role(*READ_ROLES))])
async def get_scraper_settings(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cfg = await _load_scraper_config(db)
    return _mask_keys(cfg)


@router.put(
    "/settings/scraper",
    dependencies=[Depends(require_platform_operator("SUPER_ADMIN", "ADMIN"))],
)
async def put_scraper_settings(
    dto: ScraperConfigIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    current = await _load_scraper_config(db)
    new = current.copy()
    payload = dto.model_dump()

    # Special-case the api keys: null=clear, ""=keep, else overwrite
    for k in ("brave_api_key", "tier4_api_key"):
        v = payload.pop(k, None)
        if v is None:
            new[k] = ""
        elif v == "":
            new[k] = current.get(k, "")
        else:
            new[k] = v

    new.update(payload)

    await db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
             VALUES ('scraper.config', CAST(:v AS JSONB), NOW())
        ON CONFLICT (key) DO UPDATE
                  SET value      = EXCLUDED.value,
                      updated_at = NOW()
    """), {"v": json.dumps(new)})
    await db.commit()
    return _mask_keys(new)


@router.post(
    "/settings/scraper/probe",
    dependencies=[Depends(require_platform_operator(*READ_ROLES))],
)
async def probe_scraper(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    # Platform-operator only even though it writes nothing: it makes the server
    # issue a request to whatever `searxng_url` currently holds, which is the
    # second half of the same SSRF surface the PUT above closes.
    cfg = await _load_scraper_config(db)
    out: dict[str, Any] = {
        "searxng": {"online": False, "error": None},
        "ddg_html": {"online": False, "error": None},
        "playwright": {"available": False, "error": None},
    }

    # SearXNG
    sx_url = cfg.get("searxng_url") or ""
    if sx_url:
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(sx_url.rstrip("/") + "/search",
                                params={"q": "test", "format": "json"},
                                headers={"User-Agent": cfg.get("user_agent", "GhirLaffaireBot/1.0")})
            out["searxng"]["online"] = r.status_code == 200
            if r.status_code != 200:
                out["searxng"]["error"] = f"http {r.status_code}"
        except Exception as e:                                       # noqa: BLE001
            out["searxng"]["error"] = str(e)[:200]

    # DDG HTML
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get("https://html.duckduckgo.com/html/?q=test",
                            headers={"User-Agent": "Mozilla/5.0"})
        out["ddg_html"]["online"] = r.status_code == 200
        if r.status_code != 200:
            out["ddg_html"]["error"] = f"http {r.status_code}"
    except Exception as e:                                           # noqa: BLE001
        out["ddg_html"]["error"] = str(e)[:200]

    # Playwright
    try:
        from api.services.scraper.tiers import tier2_playwright
        b = await tier2_playwright._get_browser()
        out["playwright"]["available"] = b is not None
        if b is None:
            out["playwright"]["error"] = tier2_playwright._unavailable_reason or "unknown"
    except Exception as e:                                           # noqa: BLE001
        out["playwright"]["error"] = str(e)[:200]

    return out
