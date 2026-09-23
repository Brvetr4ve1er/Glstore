"""
Contact messages — public submission, admin inbox.

  POST /contact               public, store from Host, lands NEW
  GET  /contact-messages      admin, store from x-store-id
  PATCH /contact-messages/{id}  admin, mark READ / ARCHIVED

Same shape as reviews and newsletter_subscribers (migration 008): stores the
message for real rather than promising a reply channel that does not exist.
No mail/SMS infrastructure exists in this platform, so nothing here sends a
confirmation or a reply — the admin reads the inbox.

SECURITY NOTE FOR ANY UI THAT RENDERS THESE MESSAGES: `name` and `message` are
free text from an anonymous, unauthenticated visitor. React/JSX escapes text
content by default, which is sufficient — but this data must never be passed
to `dangerouslySetInnerHTML`, used to build a URL/`href`, or otherwise
interpreted as anything but plain text. It is a stored-XSS vector the moment
that rule is broken.

POST is covered by the global rate limiter in api/main.py; no second limiter
is needed here.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for, require_store

router = APIRouter(tags=["storefront-public"])

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")
WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")


class ContactMessageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    message: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _at_least_one_channel(self) -> "ContactMessageCreate":
        if not (self.phone or self.email):
            raise ValueError("provide a phone number or an email address")
        return self


class ContactMessageModerate(BaseModel):
    status: Literal["READ", "ARCHIVED"]


@router.post("/contact", status_code=http.HTTP_201_CREATED)
async def submit_contact_message(
    dto: ContactMessageCreate,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    row = await db.execute(
        text(
            """
            INSERT INTO contact_messages (store_id, name, phone, email, message)
            VALUES (:sid, :name, :phone, :email, :message)
            RETURNING id, created_at
            """
        ),
        {
            "sid": store.id,
            "name": dto.name.strip(),
            "phone": (dto.phone or "").strip() or None,
            "email": str(dto.email) if dto.email else None,
            "message": dto.message.strip(),
        },
    )
    rec = row.first()
    await db.commit()
    return {
        "id": str(rec[0]),
        "created_at": rec[1],
        "message": "Merci — votre message a été transmis.",
    }


@router.get("/contact-messages")
async def contact_inbox(
    status_filter: Literal["NEW", "READ", "ARCHIVED"] = Query("NEW", alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    total = await db.execute(
        text("SELECT COUNT(*) FROM contact_messages WHERE store_id = :sid AND status = :st"),
        {"sid": store.id, "st": status_filter},
    )
    rows = await db.execute(
        text(
            """
            SELECT id, name, phone, email, message, status, created_at
              FROM contact_messages
             WHERE store_id = :sid AND status = :st
             ORDER BY created_at DESC
             LIMIT :limit OFFSET :offset
            """
        ),
        {"sid": store.id, "st": status_filter, "limit": page_size, "offset": (page - 1) * page_size},
    )
    return {
        "items": [
            {
                "id": str(r[0]),
                "name": r[1],
                "phone": r[2],
                "email": r[3],
                "message": r[4],
                "status": r[5],
                "created_at": r[6],
            }
            for r in rows.all()
        ],
        "page": page,
        "page_size": page_size,
        "total": total.scalar_one(),
    }


@router.patch("/contact-messages/{message_id}")
async def moderate_contact_message(
    message_id: UUID,
    dto: ContactMessageModerate,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    exists = await db.execute(
        text("SELECT 1 FROM contact_messages WHERE id = :id AND store_id = :sid"),
        {"id": message_id, "sid": store.id},
    )
    if not exists.first():
        raise HTTPException(http.HTTP_404_NOT_FOUND, "message not found")

    await db.execute(
        text(
            "UPDATE contact_messages SET status = :st, updated_at = NOW() "
            " WHERE id = :id AND store_id = :sid"
        ),
        {"st": dto.status, "id": message_id, "sid": store.id},
    )
    await db.commit()
    return {"id": str(message_id), "status": dto.status}
