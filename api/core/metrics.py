"""
Prometheus metrics — Phase 10.

Two layers:

1. HTTP-layer metrics (auto-wired):
   - prometheus-fastapi-instrumentator handles request count, latency
     histograms, and status-code breakdowns for every FastAPI endpoint.
   - Exposed at GET /metrics (public — rate-limit the endpoint in prod
     with nginx/Caddy if the stack is internet-facing).

2. Business metrics (custom Gauges/Counters):
   - Updated by the API lifespan and by a background Prometheus-scrape
     hook that reads from the DB every 60 s.
   - Metrics cover: catalog quality, worker queue depths, intel/scrape
     job timings.

All of this is optional — if `prometheus-fastapi-instrumentator` isn't
installed the module loads without raising and the `/metrics` endpoint
simply returns 503. Workers and the API continue to function normally.

Public API:
    setup_metrics(app: FastAPI) -> None
        Call once in api/main.py lifespan; idempotent.

    async refresh_db_metrics(db: AsyncSession) -> None
        Call from a periodic background task or from the /metrics scrape
        handler to keep Gauge values fresh.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger("glstore.metrics")

# ── Optional import guard ─────────────────────────────────────────────────
try:
    from prometheus_client import Counter, Gauge, Histogram, REGISTRY    # noqa: F401
    from prometheus_fastapi_instrumentator import Instrumentator
    _PROM_AVAILABLE = True
except ImportError:
    _PROM_AVAILABLE = False
    Instrumentator = None  # type: ignore[assignment,misc]
    log.debug("prometheus-fastapi-instrumentator not installed — /metrics disabled")


# ── Metric definitions ────────────────────────────────────────────────────
# All metrics are created lazily (inside setup_metrics) so importing this
# module in test environments that don't have prometheus_client installed
# doesn't blow up.

_metrics_initialized = False
_gauges: dict[str, Any] = {}
_counters: dict[str, Any] = {}
_histograms: dict[str, Any] = {}


def _init_metrics() -> None:
    """Create all Prometheus metric objects. Idempotent."""
    global _metrics_initialized
    if _metrics_initialized or not _PROM_AVAILABLE:
        return

    from prometheus_client import Counter, Gauge, Histogram

    # ── Catalog ────────────────────────────────────────────────────────
    _gauges["products_total"] = Gauge(
        "glstore_products_total",
        "Total non-archived products in the catalog",
    )
    _gauges["products_by_status"] = Gauge(
        "glstore_products_by_status",
        "Products grouped by enrichment status",
        labelnames=["status"],
    )
    _gauges["avg_completeness"] = Gauge(
        "glstore_catalog_avg_completeness",
        "Average completeness score across all non-archived products (0-1)",
    )
    _gauges["images_pending"] = Gauge(
        "glstore_images_pending_review",
        "Scraped images awaiting admin approve/reject",
    )

    # ── Worker queue depths ────────────────────────────────────────────
    _gauges["intel_jobs_pending"] = Gauge(
        "glstore_intel_jobs_pending",
        "Intel jobs in PENDING or RUNNING state",
    )
    _gauges["intel_jobs_failed"] = Gauge(
        "glstore_intel_jobs_failed_24h",
        "Intel jobs that failed in the last 24 hours",
    )
    _gauges["scrape_jobs_pending"] = Gauge(
        "glstore_scrape_jobs_pending",
        "Scrape jobs in PENDING or RUNNING state",
    )

    # ── Orders ────────────────────────────────────────────────────────
    _gauges["orders_pending"] = Gauge(
        "glstore_orders_pending",
        "Orders in PENDING or RESERVED state (need attention)",
    )

    # ── Full Intel timings (histogram) ────────────────────────────────
    _histograms["intel_duration_ms"] = Histogram(
        "glstore_intel_job_duration_ms",
        "Full Intel job duration in milliseconds",
        buckets=[5_000, 15_000, 30_000, 60_000, 90_000, 120_000, 180_000],
    )

    # ── Scraper tier usage ────────────────────────────────────────────
    _counters["scrape_tier_total"] = Counter(
        "glstore_scrape_tier_total",
        "Number of fetches per tier and outcome",
        labelnames=["tier", "outcome"],
    )

    _metrics_initialized = True
    log.info("Prometheus metrics initialised", extra={"event": "metrics.init"})


# ── Public helpers called from other modules ──────────────────────────────

def record_scrape_tier(tier: int | str, *, ok: bool) -> None:
    """Called by the engine after each tier fetch to update the counter."""
    if not _PROM_AVAILABLE or not _metrics_initialized:
        return
    try:
        _counters["scrape_tier_total"].labels(
            tier=str(tier),
            outcome="ok" if ok else "fail",
        ).inc()
    except Exception:  # noqa: BLE001
        pass


def observe_intel_duration(duration_ms: int) -> None:
    """Called by intel_worker after a completed job."""
    if not _PROM_AVAILABLE or not _metrics_initialized:
        return
    try:
        _histograms["intel_duration_ms"].observe(duration_ms)
    except Exception:  # noqa: BLE001
        pass


async def refresh_db_metrics(db: "AsyncSession") -> None:
    """Update Gauge values from the database. Called from the /metrics
    route so values are always fresh when Prometheus scrapes."""
    if not _PROM_AVAILABLE or not _metrics_initialized:
        return

    from sqlalchemy import text

    try:
        # Product counts by status
        rows = await db.execute(text("""
            SELECT status::text, COUNT(*) FROM products
            WHERE status <> 'ARCHIVED'
            GROUP BY status
        """))
        total = 0
        for status, count in rows.all():
            n = int(count)
            _gauges["products_by_status"].labels(status=status).set(n)
            total += n
        _gauges["products_total"].set(total)

        # Average completeness
        row = await db.execute(text(
            "SELECT AVG(completeness_score) FROM products WHERE status <> 'ARCHIVED'"
        ))
        avg = row.scalar() or 0.0
        _gauges["avg_completeness"].set(float(avg))

        # Images pending review
        row = await db.execute(text(
            "SELECT COUNT(*) FROM product_media WHERE status = 'PENDING' AND kind = 'image'"
        ))
        _gauges["images_pending"].set(int(row.scalar() or 0))

        # Intel queue
        row = await db.execute(text(
            "SELECT COUNT(*) FROM intel_jobs WHERE status IN ('PENDING','RUNNING')"
        ))
        _gauges["intel_jobs_pending"].set(int(row.scalar() or 0))

        row = await db.execute(text(
            "SELECT COUNT(*) FROM intel_jobs WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '24h'"
        ))
        _gauges["intel_jobs_failed"].set(int(row.scalar() or 0))

        # Scrape queue
        row = await db.execute(text(
            "SELECT COUNT(*) FROM scrape_jobs WHERE status IN ('PENDING','RUNNING')"
        ))
        _gauges["scrape_jobs_pending"].set(int(row.scalar() or 0))

        # Orders needing attention
        row = await db.execute(text(
            "SELECT COUNT(*) FROM orders WHERE status IN ('PENDING','RESERVED')"
        ))
        _gauges["orders_pending"].set(int(row.scalar() or 0))

    except Exception as e:                                           # noqa: BLE001
        log.debug("metrics refresh failed: %s", e)


# ── FastAPI integration ───────────────────────────────────────────────────

def setup_metrics(app: "FastAPI") -> None:
    """Wire prometheus-fastapi-instrumentator into the app.
    Call once from api/main.py during app startup.

    After this call:
      - GET /metrics returns Prometheus text exposition format.
      - Every FastAPI request is automatically instrumented (latency,
        status codes, request counts) per endpoint.
    """
    if not _PROM_AVAILABLE:
        log.warning(
            "prometheus-fastapi-instrumentator not installed — /metrics disabled. "
            "Install with: pip install prometheus-fastapi-instrumentator",
            extra={"event": "metrics.unavailable"},
        )
        return

    _init_metrics()

    Instrumentator(
        # Exclude noisy endpoints from per-endpoint latency tracking
        excluded_handlers=["/metrics", "/healthz", "/readyz"],
        # Keep the full path so we can see which product IDs are slow
        group_paths=False,
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

    log.info(
        "Prometheus instrumentation active — scrape at GET /metrics",
        extra={"event": "metrics.setup_complete"},
    )
