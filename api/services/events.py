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
) -> UUID:
    """Insert an event for async processing. Idempotent via event_id UNIQUE."""
    eid = event_id or uuid4()
    await db.execute(
        text(
            """
            INSERT INTO events (
                event_id, correlation_id, causation_id,
                entity_type, entity_id, event_type, payload, status
            ) VALUES (
                :event_id, :correlation_id, :causation_id,
                :entity_type, :entity_id, :event_type,
                CAST(:payload AS JSONB), 'PENDING'
            )
            ON CONFLICT (event_id) DO NOTHING
            """
        ),
        {
            "event_id": eid,
            "correlation_id": correlation_id,
            "causation_id": causation_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "event_type": event_type,
            "payload": __import__("json").dumps(payload or {}),
        },
    )
    return eid
