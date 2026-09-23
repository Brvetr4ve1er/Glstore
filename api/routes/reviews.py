"""
Product reviews — public submission, moderated display, admin queue.

Public (store resolved from the **Host** header — a shopper never sends
`x-store-id`, and Host is the only thing a browser on glaive.example.dz can
be trusted to present):
  POST /products/{product_id}/reviews   submit  -> lands PENDING, never visible
  GET  /products/{product_id}/reviews   read    -> APPROVED only

Admin (store resolved from the authenticated `x-store-id` header):
  GET   /reviews?status=PENDING         moderation queue for the acting store
  PATCH /reviews/{review_id}            approve / reject

Two independent guards keep a review inside its brand:

  1. `_assert_product_in_store` — application-level, gives a clean 404 when
     the product belongs to another store. Without it, a shopper on brand A's
     domain could file a review against brand B's product by passing its id.
  2. The composite foreign key `(store_id, product_id) -> products (store_id,
     id)` from migration 008 — schema-level, makes the mismatch impossible to
     insert through ANY code path, including one written later by someone who
     never read this file.

The first produces a good error. The second is what actually holds.

Moderation is not optional. Everything lands PENDING and is invisible until an
operator approves it: a cash-on-delivery shop with a public write endpoint is a
spam target from the first day it has a URL. POST is also covered by the
global rate limiter in api/main.py, which throttles every non-GET request.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import (
    Store,
    _assert_product_in_store,
    require_admin_store_for,
    require_store,
)

router = APIRouter(tags=["reviews"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")


# ─────────────────────────────────────────────────────────────────────────
# DTOs
# ─────────────────────────────────────────────────────────────────────────

class ReviewCreate(BaseModel):
    # No customer accounts exist, so the shopper types a display name. It is
    # shown publicly only after moderation.
    customer_name: str = Field(min_length=1, max_length=120)
    rating: int = Field(ge=1, le=5)
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=4000)


class ReviewModerate(BaseModel):
    status: Literal["APPROVED", "REJECTED"]


# ─────────────────────────────────────────────────────────────────────────
# Public
# ─────────────────────────────────────────────────────────────────────────

@router.post("/products/{product_id}/reviews", status_code=http.HTTP_201_CREATED)
async def submit_review(
    product_id: UUID,
    dto: ReviewCreate,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """Submit a review. Always lands PENDING — never immediately visible."""
    # 404 (not 403) when the product belongs to another brand: a shopper must
    # not be able to tell "wrong store" apart from "no such product".
    await _assert_product_in_store(db, product_id, store.id)

    row = await db.execute(
        text(
            """
            INSERT INTO reviews (store_id, product_id, customer_name, rating, title, body)
            VALUES (:sid, :pid, :name, :rating, :title, :body)
            RETURNING id, created_at
            """
        ),
        {
            "sid": store.id,
            "pid": product_id,
            "name": dto.customer_name.strip(),
            "rating": dto.rating,
            "title": (dto.title or "").strip() or None,
            "body": (dto.body or "").strip() or None,
        },
    )
    rec = row.first()
    await db.commit()
    return {
        "id": str(rec[0]),
        "status": "PENDING",
        "created_at": rec[1],
        "message": "Merci — votre avis sera publié après vérification.",
    }


@router.get("/products/{product_id}/reviews")
async def list_reviews(
    product_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    """APPROVED reviews for one product, newest first."""
    await _assert_product_in_store(db, product_id, store.id)

    total = await db.execute(
        text(
            "SELECT COUNT(*), COALESCE(AVG(rating), 0) FROM reviews "
            " WHERE product_id = :pid AND store_id = :sid AND status = 'APPROVED'"
        ),
        {"pid": product_id, "sid": store.id},
    )
    count, avg = total.first()

    rows = await db.execute(
        text(
            """
            SELECT id, customer_name, rating, title, body, created_at
              FROM reviews
             WHERE product_id = :pid AND store_id = :sid AND status = 'APPROVED'
             ORDER BY created_at DESC
             LIMIT :limit OFFSET :offset
            """
        ),
        {"pid": product_id, "sid": store.id, "limit": page_size, "offset": (page - 1) * page_size},
    )
    return {
        "items": [
            {
                "id": str(r[0]),
                "customer_name": r[1],
                "rating": r[2],
                "title": r[3],
                "body": r[4],
                "created_at": r[5],
            }
            for r in rows.all()
        ],
        "page": page,
        "page_size": page_size,
        "total": count,
        "avg_rating": round(float(avg), 2) if count else None,
    }


# ─────────────────────────────────────────────────────────────────────────
# Admin moderation
# ─────────────────────────────────────────────────────────────────────────

@router.get("/reviews")
async def moderation_queue(
    status: Literal["PENDING", "APPROVED", "REJECTED"] = Query("PENDING"),
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    """Reviews awaiting (or past) moderation, for the acting store only."""
    total = await db.execute(
        text("SELECT COUNT(*) FROM reviews WHERE store_id = :sid AND status = :st"),
        {"sid": store.id, "st": status},
    )
    rows = await db.execute(
        text(
            """
            SELECT r.id, r.product_id, p.name, p.slug, r.customer_name,
                   r.rating, r.title, r.body, r.status, r.created_at
              FROM reviews r
              JOIN products p ON p.id = r.product_id AND p.store_id = r.store_id
             WHERE r.store_id = :sid AND r.status = :st
             ORDER BY r.created_at DESC
             LIMIT :limit OFFSET :offset
            """
        ),
        {"sid": store.id, "st": status, "limit": page_size, "offset": (page - 1) * page_size},
    )
    return {
        "items": [
            {
                "id": str(r[0]),
                "product_id": str(r[1]),
                "product_name": r[2],
                "product_slug": r[3],
                "customer_name": r[4],
                "rating": r[5],
                "title": r[6],
                "body": r[7],
                "status": r[8],
                "created_at": r[9],
            }
            for r in rows.all()
        ],
        "page": page,
        "page_size": page_size,
        "total": total.scalar_one(),
    }


@router.patch("/reviews/{review_id}")
async def moderate_review(
    review_id: UUID,
    dto: ReviewModerate,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    """Approve or reject. A review in another store reads as absent (404)."""
    exists = await db.execute(
        text("SELECT 1 FROM reviews WHERE id = :id AND store_id = :sid"),
        {"id": review_id, "sid": store.id},
    )
    if not exists.first():
        raise HTTPException(http.HTTP_404_NOT_FOUND, "review not found")

    await db.execute(
        text(
            "UPDATE reviews SET status = :st, updated_at = NOW() "
            " WHERE id = :id AND store_id = :sid"
        ),
        {"st": dto.status, "id": review_id, "sid": store.id},
    )
    await db.commit()
    return {"id": str(review_id), "status": dto.status}
