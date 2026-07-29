"""
Event worker: polls the `events` table, claims rows with row-level locking
(FOR UPDATE SKIP LOCKED), dispatches to handlers, retries with exponential
backoff on failure. Idempotent by event_id.

Run: python -m workers.event_worker
"""
import asyncio
import json
import logging
import os
import signal
import socket
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import SessionLocal
from api.core.logging import bind_request_id, setup_logging

setup_logging(component="event-worker")
log = logging.getLogger("event-worker")

_settings = get_settings()
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
_shutdown = asyncio.Event()


# ----------------- Handlers -----------------

EventHandler = Callable[[AsyncSession, dict], Awaitable[None]]


async def handle_order_created(db: AsyncSession, event: dict) -> None:
    """Queue downstream sync (n8n → shipping, accounting)."""
    await db.execute(
        text(
            """
            INSERT INTO sync_queue (
                store_id, target_system, entity_type, entity_id, action, payload, status
            ) VALUES (:store_id, 'n8n', 'order', :eid, 'create', CAST(:p AS JSONB), 'PENDING')
            """
        ),
        {
            "store_id": event["store_id"],
            "eid": event["entity_id"],
            "p": json.dumps(event.get("payload") or {}),
        },
    )


async def handle_order_confirmed(db: AsyncSession, event: dict) -> None:
    await db.execute(
        text(
            """
            INSERT INTO sync_queue (
                store_id, target_system, entity_type, entity_id, action, payload, status
            ) VALUES (:store_id, 'n8n', 'order', :eid, 'update', CAST(:p AS JSONB), 'PENDING')
            """
        ),
        {
            "store_id": event["store_id"],
            "eid": event["entity_id"],
            "p": json.dumps({"status": "CONFIRMED", **(event.get("payload") or {})}),
        },
    )


async def handle_order_cancelled(db: AsyncSession, event: dict) -> None:
    await db.execute(
        text(
            """
            INSERT INTO sync_queue (
                store_id, target_system, entity_type, entity_id, action, payload, status
            ) VALUES (:store_id, 'n8n', 'order', :eid, 'update', CAST(:p AS JSONB), 'PENDING')
            """
        ),
        {
            "store_id": event["store_id"],
            "eid": event["entity_id"],
            "p": json.dumps({"status": "CANCELLED", **(event.get("payload") or {})}),
        },
    )


async def handle_noop(db: AsyncSession, event: dict) -> None:
    log.info("noop handler for event_type=%s", event["event_type"])


HANDLERS: dict[str, EventHandler] = {
    "order.created": handle_order_created,
    "order.confirmed": handle_order_confirmed,
    "order.cancelled": handle_order_cancelled,
}


# ----------------- Worker loop -----------------

def _backoff(retry_count: int) -> datetime:
    delay = min(60 * (2 ** retry_count), 3600)  # cap at 1h
    return datetime.now(timezone.utc) + timedelta(seconds=delay)


async def _claim_batch(db: AsyncSession, batch_size: int) -> list[dict]:
    rows = await db.execute(
        text(
            """
            UPDATE events SET
                status = 'PROCESSING',
                locked_by = :worker,
                locked_at = NOW()
            WHERE id IN (
                SELECT id FROM events
                 WHERE status IN ('PENDING','RETRYING')
                   AND (next_retry_at IS NULL OR next_retry_at <= NOW())
                   AND retry_count < max_retries
                 ORDER BY created_at ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT :n
            )
            RETURNING id, event_id, event_type, entity_type, entity_id,
                      payload, retry_count, max_retries, store_id
            """
        ),
        {"worker": WORKER_ID, "n": batch_size},
    )
    return [
        {
            "id": r[0], "event_id": r[1], "event_type": r[2],
            "entity_type": r[3], "entity_id": r[4], "payload": r[5],
            "retry_count": r[6], "max_retries": r[7], "store_id": r[8],
        }
        for r in rows.all()
    ]


async def _process_one(event: dict) -> None:
    handler = HANDLERS.get(event["event_type"], handle_noop)
    # event_id is opaque; correlate with `event:<short>` so admins can grep.
    bind_request_id(f"event:{str(event['event_id'])[:8]}")
    async with SessionLocal() as db:
        try:
            await handler(db, event)
            await db.execute(
                text(
                    "UPDATE events SET status='COMPLETED', processed_at=NOW(), "
                    "locked_by=NULL, last_error=NULL WHERE id = :id"
                ),
                {"id": event["id"]},
            )
            await db.commit()
            log.info(
                "event completed",
                extra={
                    "event_id":   str(event["event_id"]),
                    "event_type": event["event_type"],
                    "event":      "event_worker.completed",
                },
            )
        except Exception as exc:
            await db.rollback()
            log.exception(
                "event failed",
                extra={
                    "event_id":   str(event["event_id"]),
                    "event_type": event["event_type"],
                    "event":      "event_worker.failed",
                },
            )
            new_retry = event["retry_count"] + 1
            terminal = new_retry >= event["max_retries"]
            async with SessionLocal() as db2:
                await db2.execute(
                    text(
                        """
                        UPDATE events SET
                            status = :status,
                            retry_count = :rc,
                            next_retry_at = :nra,
                            last_error = :err,
                            locked_by = NULL
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": event["id"],
                        "status": "FAILED" if terminal else "RETRYING",
                        "rc": new_retry,
                        "nra": None if terminal else _backoff(new_retry),
                        "err": f"{type(exc).__name__}: {exc}"[:2000],
                    },
                )
                await db2.commit()
        finally:
            bind_request_id(None)


async def run() -> None:
    log.info("starting event worker %s", WORKER_ID)
    while not _shutdown.is_set():
        try:
            async with SessionLocal() as db:
                batch = await _claim_batch(db, _settings.event_worker_batch_size)
                await db.commit()
        except Exception:
            log.exception("claim failed")
            await asyncio.sleep(5)
            continue

        if not batch:
            try:
                await asyncio.wait_for(
                    _shutdown.wait(), timeout=_settings.event_worker_poll_interval_s
                )
            except asyncio.TimeoutError:
                pass
            continue

        await asyncio.gather(*(_process_one(e) for e in batch), return_exceptions=True)

    log.info("event worker stopped")


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
            signal.signal(sig, _handle_signal)  # Windows
    loop.run_until_complete(run())


if __name__ == "__main__":
    main()
