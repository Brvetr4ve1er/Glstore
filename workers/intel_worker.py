"""
Intel worker — claims `intel_jobs` rows and runs the unified scrape + LLM
pipeline on each.

Run:  python -m workers.intel_worker

Mirrors scraper_worker patterns:
    - FOR UPDATE SKIP LOCKED claim
    - claimed_by = host:pid
    - heartbeat refreshes claimed_at every 60s during a job (the pipeline can
      take 30-90s per product because it scrapes 6 URLs + calls the LLM)
    - graceful SIGINT/SIGTERM
    - stale-claim sweeper releases CLAIMED jobs older than 5 min back to PENDING
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import UUID

from sqlalchemy import text

from api.core.db import SessionLocal
from api.core.logging import bind_request_id, setup_logging
from api.services import full_intel, llm
from api.services.scraper.tiers import tier2_playwright

setup_logging(component="intel-worker")
log = logging.getLogger("intel-worker")

WORKER_ID            = f"{socket.gethostname()}:{os.getpid()}"
POLL_INTERVAL_S      = 3
HEARTBEAT_INTERVAL_S = 60
STALE_CLAIM_AFTER_MIN = 5

_shutdown = asyncio.Event()


# ── Claim / release ────────────────────────────────────────────────────────

async def _claim_one(db) -> dict | None:
    rows = await db.execute(text("""
        UPDATE intel_jobs SET
            status      = 'CLAIMED',
            claimed_by  = :worker,
            claimed_at  = NOW(),
            started_at  = NOW()
        WHERE id IN (
            SELECT id FROM intel_jobs
             WHERE status = 'PENDING'
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
        )
        RETURNING id, product_id, batch_id, retry_count
    """), {"worker": WORKER_ID})
    r = rows.first()
    if not r:
        return None
    return {
        "id":          r[0],
        "product_id":  r[1],
        "batch_id":    r[2],
        "retry_count": int(r[3] or 0),
    }


async def _release_stale(db) -> int:
    threshold = datetime.now(timezone.utc) - timedelta(minutes=STALE_CLAIM_AFTER_MIN)
    rows = await db.execute(text("""
        UPDATE intel_jobs SET
            status = 'PENDING',
            claimed_by = NULL,
            claimed_at = NULL,
            error_message = COALESCE(error_message, '') || ' [stale claim released]'
        WHERE status IN ('CLAIMED','RUNNING')
          AND claimed_at < :t
        RETURNING id
    """), {"t": threshold})
    n = len(rows.all())
    if n:
        log.warning("released %d stale CLAIMED intel jobs", n)
    return n


async def _mark_running(db, job_id: UUID, llm_kind: str, llm_model: str) -> None:
    await db.execute(text("""
        UPDATE intel_jobs SET
            status     = 'RUNNING',
            llm_kind   = :k,
            llm_model  = :m
         WHERE id = :id
    """), {"id": job_id, "k": llm_kind, "m": llm_model})


async def _mark_complete(db, job_id: UUID, result: full_intel.FullIntelResult) -> None:
    await db.execute(text("""
        UPDATE intel_jobs SET
            status              = 'COMPLETED',
            completed_at        = NOW(),
            fields_filled       = :ff,
            images_added        = :ia,
            completeness_before = :cb,
            completeness_after  = :ca,
            status_after        = :sa,
            duration_ms         = :dur,
            raw_payload         = CAST(:raw AS JSONB),
            scrape_summary      = CAST(:scr AS JSONB),
            error_message       = NULL
         WHERE id = :id
    """), {
        "id":  job_id,
        "ff":  result.fields_filled,
        "ia":  result.images_added,
        "cb":  result.completeness_before,
        "ca":  result.completeness_after,
        "sa":  result.status_after,
        "dur": result.duration_ms,
        "raw": json.dumps(result.raw_payload, default=str),
        "scr": json.dumps(result.scrape_summary, default=str),
    })


async def _mark_failed(db, job_id: UUID, err: str) -> None:
    await db.execute(text("""
        UPDATE intel_jobs SET
            status        = 'FAILED',
            completed_at  = NOW(),
            error_message = :e,
            retry_count   = retry_count + 1
         WHERE id = :id
    """), {"id": job_id, "e": err[:1000]})


# ── Heartbeat ──────────────────────────────────────────────────────────────

async def _heartbeat_loop(job_id: UUID, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL_S)
            return
        except asyncio.TimeoutError:
            pass
        try:
            async with SessionLocal() as db:
                await db.execute(text("""
                    UPDATE intel_jobs SET claimed_at = NOW()
                     WHERE id = :id AND status IN ('CLAIMED','RUNNING')
                """), {"id": job_id})
                await db.commit()
        except Exception:
            log.exception("heartbeat tick failed")


# ── Main loop ──────────────────────────────────────────────────────────────

async def _process_one(job: dict) -> None:
    job_id = job["id"]
    product_id = job["product_id"]
    # Bind the job_id as the request_id for this task so every log line
    # downstream (full_intel, scraper, llm) is correlatable.
    bind_request_id(f"intel:{str(job_id)[:8]}")

    # Load LLM config once for this job (and stamp it onto the row).
    async with SessionLocal() as db:
        cfg = await llm.load_config(db)
        try:
            await _mark_running(db, job_id, cfg.kind, cfg.model)
            await db.commit()
        except Exception:
            await db.rollback()

    stop_hb = asyncio.Event()
    hb = asyncio.create_task(_heartbeat_loop(job_id, stop_hb))

    async with SessionLocal() as db:
        try:
            result = await full_intel.enrich_full_intel(
                db, product_id, cfg=cfg, job_id=job_id,
            )
            await _mark_complete(db, job_id, result)
            await db.commit()
            log.info(
                "intel job completed",
                extra={
                    "job_id":               str(job_id),
                    "product_id":           str(product_id),
                    "fields_filled":        result.fields_filled,
                    "completeness_before":  result.completeness_before,
                    "completeness_after":   result.completeness_after,
                    "images_added":         result.images_added,
                    "duration_ms":          result.duration_ms,
                    "event":                "intel.completed",
                },
            )
        except Exception as e:                                       # noqa: BLE001
            log.exception(
                "intel job failed",
                extra={"job_id": str(job_id), "product_id": str(product_id), "event": "intel.failed"},
            )
            await db.rollback()
            async with SessionLocal() as db2:
                await _mark_failed(db2, job_id, f"{type(e).__name__}: {e}")
                await db2.commit()
        finally:
            stop_hb.set()
            try:
                await asyncio.wait_for(hb, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                hb.cancel()
            # Clear the bound request_id so the next loop iteration
            # starts clean.
            bind_request_id(None)


async def run() -> None:
    log.info("starting intel worker %s", WORKER_ID)

    last_sweep = 0.0
    while not _shutdown.is_set():
        if monotonic() - last_sweep > 60:
            try:
                async with SessionLocal() as db:
                    await _release_stale(db)
                    await db.commit()
            except Exception:
                log.exception("stale sweep failed")
            last_sweep = monotonic()

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

        await _process_one(job)

    log.info("shutting down playwright…")
    await tier2_playwright.shutdown()
    log.info("intel worker stopped")


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
