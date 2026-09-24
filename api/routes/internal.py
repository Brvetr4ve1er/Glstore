"""
Scheduled maintenance, for deployments that have no workers.

  GET /internal/cron/maintenance[?prune=true]

WHY THIS EXISTS

`workers/reservation_worker.py` is a long-running process that calls
`fn_expire_stale_reservations()` every 30 seconds and `fn_prune_observations(180)`
once a day. On Docker it runs forever and this endpoint is unnecessary.

On Vercel there are no workers at all. Nothing calls those functions, which
means:

  · `inventory_reservations` never expire. Every abandoned cart holds its
    stock permanently. `offers.reserved_quantity` climbs, available stock
    falls, and eventually a product that is physically in the warehouse
    cannot be sold. This is a slow, silent inventory leak.
  · `observations` grows without bound.

So the same two calls are exposed as an endpoint that Vercel Cron can hit.
`vercel.json` carries the schedule.

SECURITY

This releases stock, so it is not open. It requires
`Authorization: Bearer <CRON_SECRET>`, matching Vercel's documented pattern —
Vercel sends that header on cron invocations using the `CRON_SECRET`
environment variable.

If `CRON_SECRET` is unset the endpoint refuses every request rather than
running unauthenticated. An unset secret is a misconfiguration, and the safe
failure is "maintenance does not run" (a slow leak you can detect) rather than
"anyone on the internet can release your reserved stock" (a fast one you
cannot).

The comparison is constant-time: `secrets.compare_digest`. This is a
bearer token, and a timing oracle on a token is worth closing even when the
attack is impractical over a network.

NOT STORE-SCOPED, DELIBERATELY. Both SQL functions operate platform-wide
across every brand, the same way `scrape_jobs` and `intel_jobs` are
platform-level (see migration 005's "deliberately NOT scoped" list). A cron
has no Host and no `x-store-id`; expiry is a housekeeping concern of the
platform, not of any one shop.
"""
from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db

router = APIRouter(prefix="/internal", tags=["internal"])
log = logging.getLogger("glstore")


def _require_cron_auth(authorization: str | None) -> None:
    """Bearer check against CRON_SECRET. Refuses when the secret is unset."""
    expected = (get_settings().cron_secret or "").strip()
    if not expected:
        log.error(
            "cron endpoint called but CRON_SECRET is not configured; refusing",
            extra={"event": "cron.misconfigured"},
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "maintenance endpoint is not configured",
        )

    presented = (authorization or "")
    if not presented.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")

    if not secrets.compare_digest(presented[len("Bearer "):], expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


@router.get("/cron/maintenance")
async def run_maintenance(
    prune: bool = Query(
        False,
        description="Also prune observations older than the retention window. "
                    "Cheap to skip; intended for a daily schedule.",
    ),
    retain_days: int = Query(180, ge=30, le=3650),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Release stale stock reservations. Optionally prune old observations.

    Mirrors workers/reservation_worker.py exactly, so a deployment running
    both does not behave differently from one running either. Both SQL
    functions are idempotent, so overlapping invocations are harmless.
    """
    _require_cron_auth(authorization)

    released = (await db.execute(text("SELECT fn_expire_stale_reservations()"))).scalar_one()

    pruned: int | None = None
    pruned_identity: int | None = None
    if prune:
        pruned = (
            await db.execute(
                text("SELECT fn_prune_observations(:days)"), {"days": retain_days}
            )
        ).scalar_one()
        # Spent OTP challenges and dead customer sessions (migration 010).
        pruned_identity = (await db.execute(text("SELECT fn_prune_identity()"))).scalar_one()

    await db.commit()

    log.info(
        "cron maintenance complete",
        extra={
            "released": released,
            "pruned": pruned,
            "pruned_identity": pruned_identity,
            "event": "cron.maintenance",
        },
    )
    return {
        "released_reservations": released,
        "pruned_observations": pruned,
        "pruned_identity": pruned_identity,
    }
