import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for
from api.models.schemas import EventIn

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", status_code=202)
async def ingest_event(
    dto: EventIn,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role("SUPER_ADMIN", "ADMIN", "OPERATOR"))),
) -> dict[str, Any]:
    """
    Accept events from trusted upstream (n8n, admin dashboard). Idempotent via event_id.

    events.store_id is NOT NULL (migration 005). Resolved the same way every
    other admin/trusted route resolves its store — via `require_admin_store_for`
    (store-scoped operator's own store, or platform operator's `x-store-id`) —
    rather than inventing a separate mechanism for this one route.
    """
    await db.execute(
        text(
            """
            INSERT INTO events (
                event_id, store_id, correlation_id, causation_id,
                entity_type, entity_id, event_type, payload, status
            ) VALUES (
                :event_id, :store_id, :corr, :caus, :etype, :eid, :type,
                CAST(:payload AS JSONB), 'PENDING'
            )
            ON CONFLICT (event_id) DO NOTHING
            """
        ),
        {
            "event_id": dto.event_id,
            "store_id": store.id,
            "corr": dto.correlation_id,
            "caus": dto.causation_id,
            "etype": dto.entity_type,
            "eid": dto.entity_id,
            "type": dto.event_type,
            "payload": json.dumps(dto.payload),
        },
    )
    await db.commit()
    return {"accepted": True, "event_id": dto.event_id}


@router.get("/{event_id}", dependencies=[Depends(require_role("SUPER_ADMIN", "ADMIN"))])
async def get_event(event_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    row = await db.execute(
        text(
            """
            SELECT event_id, event_type, entity_type, entity_id, status,
                   retry_count, last_error, created_at, processed_at
              FROM events WHERE event_id = :id
            """
        ),
        {"id": event_id},
    )
    r = row.first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return {
        "event_id": r[0], "event_type": r[1], "entity_type": r[2],
        "entity_id": r[3], "status": r[4], "retry_count": r[5],
        "last_error": r[6], "created_at": r[7], "processed_at": r[8],
    }
