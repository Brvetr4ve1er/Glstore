"""
Newsletter capture — public, one list per brand.

  POST /newsletter   { email }   store resolved from the Host header

Exists so the storefront's signup form has somewhere real to land. A form that
accepts an address and discards it is worse than no form at all.

Scope boundary: this STORES the capture. It does not send anything. There is no
mail infrastructure in this platform, and adding one carries its own consent
and unsubscribe obligations — a separate decision, deliberately not made here.

Two things this endpoint refuses to leak:

  · Whether an address is already subscribed. `ON CONFLICT DO NOTHING` plus an
    identical response either way means the form cannot be used to test whether
    a given person is on a brand's list.
  · One brand's list to another. The unique constraint is (store_id, email),
    not email, so the same person on GLAIVE and on Ghir Laffaire is two
    independent rows and neither brand can probe for the other by watching for
    a conflict.

POST is covered by the global rate limiter in api/main.py.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.store_context import Store, require_store

router = APIRouter(tags=["storefront-public"])


class NewsletterSignup(BaseModel):
    email: EmailStr


@router.post("/newsletter")
async def subscribe(
    dto: NewsletterSignup,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """Idempotent subscribe. Same answer whether or not the address was new."""
    await db.execute(
        text(
            """
            INSERT INTO newsletter_subscribers (store_id, email)
            VALUES (:sid, :email)
            ON CONFLICT (store_id, email) DO NOTHING
            """
        ),
        {"sid": store.id, "email": str(dto.email)},
    )
    await db.commit()
    # Deliberately does not report whether a row was inserted — see module docstring.
    return {"subscribed": True, "message": "Merci — vous êtes inscrit."}
