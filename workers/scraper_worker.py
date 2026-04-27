"""
Scraper worker — claims `scrape_jobs` rows and runs them.

Run: python -m workers.scraper_worker

Mirrors the event_worker patterns:
    - FOR UPDATE SKIP LOCKED claim
    - claimed_by = host:pid
    - graceful SIGINT/SIGTERM
    - stale-claim sweeper releases CLAIMED jobs older than 5 min back to PENDING

Concurrency: this worker processes ONE job at a time. Within a job, the
engine fans out fetches with semaphore=3. To scale: run multiple workers.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text

from api.core.db import SessionLocal
from api.core.logging import bind_request_id, setup_logging
from api.services.scraper.engine import (
    ScrapeJobInput, ScraperEngine, load_config,
)
from api.services.scraper.tiers import tier2_playwright

setup_logging(component="scraper-worker")
log = logging.getLogger("scraper-worker")

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
_shutdown = asyncio.Event()
POLL_INTERVAL_S = 3
HEARTBEAT_INTERVAL_S = 60
STALE_CLAIM_AFTER_MIN = 3   # was 5; reduced because heartbeats keep live workers fresh


# ── Job claiming ────────────────────────────────────────────────────────────

async def _claim_one(db) -> dict | None:
    rows = await db.execute(text("""
        UPDATE scrape_jobs SET
            status      = 'CLAIMED',
            claimed_by  = :worker,
            claimed_at  = NOW(),
            started_at  = NOW()
        WHERE id IN (
            SELECT id FROM scrape_jobs
             WHERE status = 'PENDING'
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
        )
        RETURNING id, product_id, intents, max_sources, expected_price, retry_count
    """), {"worker": WORKER_ID})
    r = rows.first()
    if not r:
        return None
    return {
        "id": r[0],
        "product_id": r[1],
        "intents": list(r[2] or []),
        "max_sources": int(r[3] or 6),
        "expected_price": r[4],
        "retry_count": int(r[5] or 0),
    }


async def _release_stale(db) -> int:
    """Return CLAIMED jobs idle for too long back to PENDING."""
    threshold = datetime.now(timezone.utc) - timedelta(minutes=STALE_CLAIM_AFTER_MIN)
    rows = await db.execute(text("""
        UPDATE scrape_jobs SET
            status      = 'PENDING',
            claimed_by  = NULL,
            claimed_at  = NULL,
            error_message = COALESCE(error_message, '') || ' [stale claim released]'
        WHERE status = 'CLAIMED'
          AND claimed_at < :t
        RETURNING id
    """), {"t": threshold})
    n = len(rows.all())
    if n:
        log.warning("released %d stale CLAIMED jobs", n)
    return n


async def _mark_running(db, job_id: UUID) -> None:
    await db.execute(text("""
        UPDATE scrape_jobs SET status = 'RUNNING' WHERE id = :id
    """), {"id": job_id})


async def _mark_complete(db, job_id: UUID, summary: dict) -> None:
    import json as _json
    await db.execute(text("""
        UPDATE scrape_jobs SET
            status        = 'COMPLETED',
            completed_at  = NOW(),
            summary       = CAST(:s AS JSONB),
            error_message = NULL
        WHERE id = :id
    """), {"id": job_id, "s": _json.dumps(summary, default=str)})


async def _mark_failed(db, job_id: UUID, err: str) -> None:
    await db.execute(text("""
        UPDATE scrape_jobs SET
            status        = 'FAILED',
            completed_at  = NOW(),
            error_message = :e,
            retry_count   = retry_count + 1
        WHERE id = :id
    """), {"id": job_id, "e": err[:500]})


async def _heartbeat_loop(job_id: UUID, stop: asyncio.Event) -> None:
    """While a job is running, refresh claimed_at every HEARTBEAT_INTERVAL_S so
    the stale-claim sweeper doesn't poach a job we're actively working on.

    Fires its own short-lived sessions — does not share the engine's session.
    """
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL_S)
            return  # stop was set while waiting
        except asyncio.TimeoutError:
            pass
        try:
            async with SessionLocal() as db:
                await db.execute(text("""
                    UPDATE scrape_jobs
                       SET claimed_at = NOW()
                     WHERE id = :id AND status IN ('CLAIMED','RUNNING')
                """), {"id": job_id})
                await db.commit()
        except Exception:
            log.exception("heartbeat tick failed")


# ── Main loop ───────────────────────────────────────────────────────────────

async def _process_one(engine: ScraperEngine, job_dict: dict) -> None:
    job_input = ScrapeJobInput(
        job_id=job_dict["id"],
        product_id=job_dict["product_id"],
        intents=job_dict["intents"] or ["commercial", "technical", "review"],
        max_sources=job_dict["max_sources"],
        expected_price=job_dict["expected_price"],
    )
    # Tag every log line during this job with a stable correlation ID
    # so admins can grep through the JSON logs by job_id.
    bind_request_id(f"scrape:{str(job_input.job_id)[:8]}")

    async with SessionLocal() as db:
        try:
            await _mark_running(db, job_input.job_id)
            await db.commit()
        except Exception:
            await db.rollback()

    # Start heartbeat in parallel — refreshes claimed_at every HEARTBEAT_INTERVAL_S
    # so the stale-claim sweeper doesn't poach this job mid-flight.
    stop_heartbeat = asyncio.Event()
    hb_task = asyncio.create_task(_heartbeat_loop(job_input.job_id, stop_heartbeat))

    async with SessionLocal() as db:
        try:
            outcome = await engine.run_job(db, job_input)
            await _mark_complete(db, job_input.job_id, outcome.to_summary_dict())
            await db.commit()
            log.info(
                "job %s COMPLETED: %d prices, median=%s",
                job_input.job_id,
                outcome.prices_found,
                outcome.median_price,
            )
        except Exception as e:                                       # noqa: BLE001
            log.exception("job %s failed", job_input.job_id)
            await db.rollback()
            async with SessionLocal() as db2:
                await _mark_failed(db2, job_input.job_id,
                                   f"{type(e).__name__}: {e}")
                await db2.commit()
        finally:
            # Always tear down the heartbeat — even on exceptions or cancellation.
            stop_heartbeat.set()
            try:
                await asyncio.wait_for(hb_task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                hb_task.cancel()
            bind_request_id(None)


async def run() -> None:
    log.info("starting scraper worker %s", WORKER_ID)

    # Load config & build engine once
    async with SessionLocal() as db:
        cfg = await load_config(db)
    engine = ScraperEngine(cfg)
    log.info(
        "engine ready: searxng=%s tier4=%s ua=%s",
        cfg.searxng_url, cfg.tier4_enabled, cfg.user_agent,
    )

    last_sweep = 0.0
    while not _shutdown.is_set():
        # Periodic stale-claim sweep
        import time
        if time.monotonic() - last_sweep > 60:
            try:
                async with SessionLocal() as db:
                    await _release_stale(db)
                    await db.commit()
            except Exception:
                log.exception("stale sweep failed")
            last_sweep = time.monotonic()

        # Claim a job
        try:
            async with SessionLocal() as db:
                job = await _claim_one(db)
                await db.commit()
        except Exception:
            log.exception("claim failed")
            await asyncio.sleep(POLL_INTERVAL_S)
            continue

        if not job:
            try:
                await asyncio.wait_for(_shutdown.wait(), timeout=POLL_INTERVAL_S)
            except asyncio.TimeoutError:
                pass
            continue

        await _process_one(engine, job)

    # Shutdown
    log.info("shutting down playwright…")
    await tier2_playwright.shutdown()
    log.info("scraper worker stopped")


def _handle_signal(*_a):
    log.info("shutdown signal received")
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
