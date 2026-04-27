"""
Health probes — Phase 9 Push 6.

Three layers, mapped to the canonical k8s / Cloud Run / ALB conventions:

    /healthz   liveness   ── "the process is alive". Cheap, no dependencies,
                              never blocks. Used by Docker compose's
                              healthcheck so dependents can start in order.
    /readyz    readiness  ── "ready to serve traffic". Probes critical
                              deps (DB, SearXNG) with tight timeouts.
                              Returns 503 if anything required is down.
    /healthz/details        deep diagnostic — admin-only — probes everything
                              (DB, SearXNG, LLM, migrations applied count,
                              queue depths). Used from the Jobs Console
                              or for SRE on-call.

This module is the "what to check" + "how to check it" layer. The route
layer in api/routes/health.py is the "expose it over HTTP" layer.

Each probe:
  · runs with its own timeout (so one slow dep can't make the whole
    health check hang)
  · returns a structured result dataclass, never raises out
  · exposes a stable `name` so dashboards can colour by component
  · records its own duration_ms so latency regressions are visible
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable

# httpx + sqlalchemy are runtime-only deps for the actual probes. The
# pure logic (ProbeResult, _run_with_timeout, overall_ok) is testable
# without them — mirror the lazy-import pattern from api/core/migrations.py.
if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger("glstore.health")


# ── Result types ──────────────────────────────────────────────────────────

@dataclass
class ProbeResult:
    """Outcome of a single probe. JSON-serialisable as-is via asdict()."""
    name:        str
    ok:          bool
    duration_ms: int
    detail:      dict[str, Any] = field(default_factory=dict)
    error:       str | None = None
    # `required` answers: does THIS probe failing mean we should return
    # 503 from /readyz? DB and SearXNG are required (we can't operate
    # without them); LLM is optional (admin can fall back to rule engine).
    required:    bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── Probe runner ──────────────────────────────────────────────────────────

ProbeFn = Callable[[], Awaitable[ProbeResult]]


async def _run_with_timeout(
    name: str, fn: ProbeFn, *, timeout_s: float, required: bool = True,
) -> ProbeResult:
    """Wrap a probe so it can never hang the request. On timeout or any
    exception, returns ok=False with a reason in `error`."""
    started = time.monotonic()
    try:
        result = await asyncio.wait_for(fn(), timeout=timeout_s)
        # Probe might already have set `required` itself (see _llm_probe)
        if result.required is True and required is False:
            result.required = required
        return result
    except asyncio.TimeoutError:
        return ProbeResult(
            name=name, ok=False, required=required,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"timeout after {timeout_s}s",
        )
    except Exception as exc:                                        # noqa: BLE001
        return ProbeResult(
            name=name, ok=False, required=required,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )


# ── Individual probes ─────────────────────────────────────────────────────

async def db_probe(db: "AsyncSession") -> ProbeResult:
    """Round-trip a SELECT 1 against Postgres. Verifies connectivity AND
    that the API's connection pool can hand out a session."""
    from sqlalchemy import text
    started = time.monotonic()
    res = await db.execute(text("SELECT 1"))
    val = res.scalar()
    return ProbeResult(
        name="db",
        ok=(val == 1),
        duration_ms=int((time.monotonic() - started) * 1000),
        detail={"select_1": val},
        required=True,
    )


async def db_extended_probe(db: "AsyncSession") -> ProbeResult:
    """Deeper probe used by /healthz/details. Reports table counts that
    the rest of the system cares about. Cheap (all indexed counts), but
    not appropriate for a 1-second budget readyz."""
    from sqlalchemy import text
    started = time.monotonic()
    rows = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM products WHERE status <> 'ARCHIVED') AS products_active,
            (SELECT COUNT(*) FROM intel_jobs   WHERE status IN ('PENDING','CLAIMED','RUNNING')) AS intel_in_flight,
            (SELECT COUNT(*) FROM scrape_jobs  WHERE status IN ('PENDING','CLAIMED','RUNNING')) AS scrape_in_flight,
            (SELECT COUNT(*) FROM events       WHERE status IN ('PENDING','RETRYING'))           AS events_pending,
            (SELECT COUNT(*) FROM product_media WHERE status = 'PENDING' AND kind = 'image')     AS images_pending,
            (SELECT COUNT(*) FROM _migrations) AS migrations_applied
    """))
    r = rows.first()
    return ProbeResult(
        name="db_extended",
        ok=True,
        duration_ms=int((time.monotonic() - started) * 1000),
        detail={
            "products_active":       int(r[0] or 0) if r else 0,
            "intel_in_flight":       int(r[1] or 0) if r else 0,
            "scrape_in_flight":      int(r[2] or 0) if r else 0,
            "events_pending":        int(r[3] or 0) if r else 0,
            "images_pending":        int(r[4] or 0) if r else 0,
            "migrations_applied":    int(r[5] or 0) if r else 0,
        },
        required=False,   # informational; if it fails we don't 503
    )


async def searxng_probe(url: str) -> ProbeResult:
    """HEAD the SearXNG search endpoint to verify it's reachable. SearXNG
    rejects HEAD with 405 on / but accepts on /search; both are fine for
    "is the server up?" — we treat any 2xx/3xx/405 as healthy."""
    import httpx
    started = time.monotonic()
    target = url.rstrip("/") + "/"
    async with httpx.AsyncClient(timeout=2.5, follow_redirects=False) as client:
        resp = await client.get(target)
    duration_ms = int((time.monotonic() - started) * 1000)
    ok = 200 <= resp.status_code < 400 or resp.status_code == 405
    return ProbeResult(
        name="searxng",
        ok=ok,
        duration_ms=duration_ms,
        detail={"url": target, "status_code": resp.status_code},
        error=None if ok else f"HTTP {resp.status_code}",
        required=True,
    )


async def llm_probe(db: "AsyncSession") -> ProbeResult:
    """Reuse the existing llm.ping() machinery so we don't duplicate the
    backend dispatch logic. The configured backend (ollama / openai-compat
    / anthropic) decides what "online" means.

    LLM is `required=False` for /readyz: bulk Full Intel won't work
    without it, but the storefront and admin can serve traffic just
    fine while the LLM is down. Rule-engine enrichment + scraper still
    work."""
    from api.services import llm   # local import — avoids circular load order
    started = time.monotonic()
    cfg = await llm.load_config(db)
    result = await llm.ping(cfg)   # already has its own timeout
    duration_ms = int((time.monotonic() - started) * 1000)
    return ProbeResult(
        name="llm",
        ok=bool(result.get("online")),
        duration_ms=duration_ms,
        detail={
            "backend":     cfg.kind,
            "endpoint":    cfg.endpoint,
            "model":       cfg.model,
            "models_seen": len(result.get("models") or []),
        },
        error=result.get("error"),
        required=False,
    )


# ── Composite checks ──────────────────────────────────────────────────────

async def readyz_checks(db: "AsyncSession", *, searxng_url: str) -> list[ProbeResult]:
    """Tight-budget probes used by the /readyz endpoint. ~1.5s total
    budget so a load balancer can poll every 5-10s without strain.

    Returns a list (not a dict) so the order is stable for clients
    rendering progress bars or status grids."""
    return await asyncio.gather(
        _run_with_timeout("db",      lambda: db_probe(db),                      timeout_s=1.0),
        _run_with_timeout("searxng", lambda: searxng_probe(searxng_url),        timeout_s=2.5),
    )


async def details_checks(db: "AsyncSession", *, searxng_url: str) -> list[ProbeResult]:
    """Comprehensive probes for /healthz/details. Wider budgets, includes
    LLM ping, returns DB-table-count diagnostics. Only admins should hit
    this — LLM ping in particular can take seconds with a cold model."""
    return await asyncio.gather(
        _run_with_timeout("db",          lambda: db_probe(db),                  timeout_s=1.5),
        _run_with_timeout("db_extended", lambda: db_extended_probe(db),         timeout_s=3.0, required=False),
        _run_with_timeout("searxng",     lambda: searxng_probe(searxng_url),    timeout_s=3.0),
        _run_with_timeout("llm",         lambda: llm_probe(db),                 timeout_s=10.0, required=False),
    )


def overall_ok(results: list[ProbeResult]) -> bool:
    """Aggregate health: all REQUIRED probes must be ok. Optional ones
    (LLM, db_extended) being down is informational, not a 503."""
    return all(r.ok for r in results if r.required)
