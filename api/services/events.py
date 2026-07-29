from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def emit_event(
    db: AsyncSession,
    *,
    event_type: str,
    entity_type: str,
    entity_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
    correlation_id: UUID | None = None,
    causation_id: UUID | None = None,
    event_id: UUID | None = None,
    store_id: UUID | None = None,
) -> UUID:
    """Insert an event for async processing. Idempotent via event_id UNIQUE.

    `store_id` is REQUIRED once the multi-store migration (005) has run —
    the `events` table's `store_id` column is NOT NULL. If a caller omits it
    we fall back to whatever store is bound to the current request context
    (set by `require_store`), so any request-scoped emitter works with no
    extra plumbing. Callers outside a request (e.g. admin confirm/cancel)
    must pass it explicitly.
    """
    if store_id is None:
        # Lazy import to avoid a hard dependency / import cycle for callers
        # that never touch the store layer.
        try:
            from api.core.store_context import bound_store
            bound = bound_store()
            if bound is not None:
                store_id = bound.id
        except Exception:  # noqa: BLE001 — never let event bookkeeping crash the caller
            pass

    eid = event_id or uuid4()
    await db.execute(
        text(
            """
            INSERT INTO events (
                event_id, store_id, correlation_id, causation_id,
                entity_type, entity_id, event_type, payload, status
            ) VALUES (
                :event_id, :store_id, :correlation_id, :causation_id,
                :entity_type, :entity_id, :event_type,
                CAST(:payload AS JSONB), 'PENDING'
            )
            ON CONFLICT (event_id) DO NOTHING
            """
        ),
        {
            "event_id": eid,
            "store_id": store_id,
            "correlation_id": correlation_id,
            "causation_id": causation_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "event_type": event_type,
            "payload": __import__("json").dumps(payload or {}),
        },
    )
    return eid
