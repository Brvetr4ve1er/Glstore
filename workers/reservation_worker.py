"""
Reservation worker — does two unrelated maintenance jobs.

1. Every 30s: calls fn_expire_stale_reservations() to release stock held by
   orders that were never confirmed.

2. Once per day (drift-tolerant): calls fn_prune_observations(180) to delete
   stale observation rows EXCEPT the latest per (entity, field, source).

Both functions are idempotent and safe to call from any worker. We piggyback
the prune onto this singleton worker because it's already a singleton (we do
NOT scale this worker — see SYSTEM_AUDIT.md for why).
"""
import asyncio
import logging
import signal
from time import monotonic

from sqlalchemy import text

from api.core.db import SessionLocal
from api.core.logging import setup_logging

setup_logging(component="reservation-worker")
log = logging.getLogger("reservation-worker")

POLL_INTERVAL_S    = 30
PRUNE_INTERVAL_S   = 24 * 3600           # daily
PRUNE_RETAIN_DAYS  = 180

_shutdown = asyncio.Event()


async def _expire_pass() -> None:
    try:
        async with SessionLocal() as db:
            row = await db.execute(text("SELECT fn_expire_stale_reservations()"))
            n = row.scalar_one() or 0
            await db.commit()
            if n:
                log.info("expired %d stale reservation(s)", n)
    except Exception:
        log.exception("expiry pass failed")


async def _prune_pass() -> None:
    try:
        async with SessionLocal() as db:
            row = await db.execute(
                text("SELECT fn_prune_observations(:days)"),
                {"days": PRUNE_RETAIN_DAYS},
            )
            deleted = row.scalar_one() or 0
            await db.commit()
            log.info("prune_observations: deleted %d rows older than %d days",
                     deleted, PRUNE_RETAIN_DAYS)
    except Exception:
        log.exception("prune pass failed")


async def run() -> None:
    log.info("starting reservation+prune worker (expire=%ds, prune=%ds)",
             POLL_INTERVAL_S, PRUNE_INTERVAL_S)

    last_prune = monotonic()
    # Run prune at startup if the function exists — fail-soft if it doesn't yet
    # (fresh DB before migration 003 applied).
    try:
        await _prune_pass()
    except Exception:
        log.warning("initial prune skipped (function may not exist yet)")

    while not _shutdown.is_set():
        await _expire_pass()

        if monotonic() - last_prune >= PRUNE_INTERVAL_S:
            await _prune_pass()
            last_prune = monotonic()

        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=POLL_INTERVAL_S)
        except asyncio.TimeoutError:
            pass

    log.info("reservation worker stopped")


def _handle_signal(*_a):
    _shutdown.set()


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, _handle_signal)
    loop.run_until_complete(run())


if __name__ == "__main__":
    main()
