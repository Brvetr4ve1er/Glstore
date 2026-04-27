"""
Health endpoints — Phase 9 Push 6.

Three layers:
    GET /healthz           liveness  — process is alive (no deps)
    GET /readyz            readiness — DB + SearXNG reachable
    GET /healthz/details   admin     — DB + SearXNG + LLM + worker depths

The split mirrors the k8s convention: liveness probes restart the pod,
readiness probes pull it out of the load balancer. We don't run on k8s
yet, but writing to the convention now means we can later.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.health import (
    ProbeResult, details_checks, overall_ok, readyz_checks,
)  # noqa: F401  (ProbeResult is part of the public type surface)
from api.core.security import require_role

router = APIRouter(tags=["meta"])

log = logging.getLogger("glstore.health")

ADMIN_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")

# Default SearXNG URL — must match the value the scraper engine uses
# (api/services/scraper/engine.py: load_config). We avoid importing the
# scraper module here because it pulls in bs4 + playwright, which aren't
# in the api container's image.
_DEFAULT_SEARXNG_URL = "http://searxng:8080"


async def _read_searxng_url(db: AsyncSession) -> str:
    """Read the SearXNG URL from app_settings without importing the
    scraper engine. Falls back to the docker-compose default if the
    setting hasn't been customised."""
    try:
        row = await db.execute(text(
            "SELECT value FROM app_settings WHERE key = 'scraper.config'"
        ))
        r = row.first()
        if r and r[0]:
            cfg = r[0] if isinstance(r[0], dict) else json.loads(r[0])
            return str(cfg.get("searxng_url") or _DEFAULT_SEARXNG_URL)
    except Exception:
        # If app_settings doesn't exist yet (e.g. very fresh DB before
        # migration 001 ran), fall back to the default. The migrations
        # lifespan hook will fix this on the next boot.
        pass
    return _DEFAULT_SEARXNG_URL


def _envelope(results: list[ProbeResult]) -> dict[str, Any]:
    """Shape every health response the same way for client convenience."""
    ok = overall_ok(results)
    return {
        "status":  "ok" if ok else "degraded",
        "checks":  [r.to_dict() for r in results],
    }


# ── /healthz ──────────────────────────────────────────────────────────────
#
# Liveness: returns 200 OK as long as the FastAPI process is responding.
# NO database query — this is what Docker / k8s polls every few seconds
# to decide whether to restart the container, and we don't want a slow
# DB to cause a restart loop.

@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


# ── /readyz ───────────────────────────────────────────────────────────────
#
# Readiness: returns 200 OK iff every REQUIRED dependency is reachable.
# A load balancer / orchestrator polls this to decide whether to send
# traffic to this instance. Tight budgets so it stays cheap.

@router.get("/readyz")
async def readyz(
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    searxng_url = await _read_searxng_url(db)
    results = await readyz_checks(db, searxng_url=searxng_url)
    body = _envelope(results)
    if body["status"] != "ok":
        response.status_code = 503
        log.warning(
            "readiness check failed",
            extra={
                "failing": [r.name for r in results if not r.ok and r.required],
                "event":   "health.readyz.degraded",
            },
        )
    return body


# ── /healthz/details ──────────────────────────────────────────────────────
#
# Comprehensive: every probe + DB-table-count diagnostics + LLM ping.
# Admin-only so the LLM ping can't be used as a liveness oracle by
# random callers (it costs money for hosted backends).

@router.get(
    "/healthz/details",
    dependencies=[Depends(require_role(*ADMIN_ROLES))],
)
async def healthz_details(
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    searxng_url = await _read_searxng_url(db)
    results = await details_checks(db, searxng_url=searxng_url)
    body = _envelope(results)
    if body["status"] != "ok":
        response.status_code = 503
    return body
