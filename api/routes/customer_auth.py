"""
Customer sign-in by phone — one-time code by SMS, then an opaque session token.

POST /auth/customer/request-otp   send a code to an Algerian mobile
POST /auth/customer/verify        trade phone + code for a session token
GET  /auth/customer/me            the signed-in customer
POST /auth/customer/logout        revoke the current session

Every route resolves the store from Host (`require_store`). A shopper's browser
never sends x-store-id, and a session minted on one brand's domain is not a
session on another's: the lookup filters by the Host store, so it simply isn't
found there.

There is no password and no "account exists?" question. Any mobile can ask for
a code; verifying one IS signing up. `request-otp` answers identically whether
or not the phone has ever ordered, so it cannot be used to probe who shops here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.core.config import get_settings
from api.core.db import get_db
from api.core.phone import dz_mobile_e164, dz_mobile_national, legacy_phone_keys
from api.core.ratelimit import client_key
from api.core.security import hash_password, verify_password
from api.core.store_context import Store, require_store
from api.services.identity import (
    ChallengeState,
    OtpLimits,
    attempts_left,
    challenge_status,
    generate_code,
    hash_requester,
    hash_session_token,
    new_session_token,
    otp_message,
    send_throttle,
)
from api.services.sms import SmsUnavailable, get_sms_sender

router = APIRouter(prefix="/auth/customer", tags=["customer-auth"])
log = logging.getLogger("glstore.customer_auth")
_settings = get_settings()


# ── Schemas ───────────────────────────────────────────────────────────────

def _national_mobile(v: str) -> str:
    national = dz_mobile_national(v)
    if national is None:
        raise ValueError("Numéro de mobile algérien invalide (ex. 0555123456).")
    return national


# Arrives however the shopper typed it; leaves as the canonical `0XXXXXXXXX`.
DzMobile = Annotated[str, Field(min_length=9, max_length=30), AfterValidator(_national_mobile)]


class OtpRequestIn(BaseModel):
    phone: DzMobile


class OtpVerifyIn(BaseModel):
    phone: DzMobile
    code: str = Field(pattern=r"^\d{6}$")


class CustomerOut(BaseModel):
    id: UUID
    phone: str
    full_name: str | None
    email: str | None
    phone_verified_at: datetime | None


class SessionOut(BaseModel):
    token: str
    token_type: str = "bearer"
    expires_in: int
    customer: CustomerOut


# ── Failure shapes (French, stable) ───────────────────────────────────────

_SMS_UNAVAILABLE = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE,
    "La connexion par SMS n'est pas encore disponible.",
)
_CODE_EXPIRED = HTTPException(
    status.HTTP_400_BAD_REQUEST,
    "Ce code n'est plus valide. Demandez un nouveau code.",
)
_TOO_MANY_ATTEMPTS = HTTPException(
    status.HTTP_429_TOO_MANY_REQUESTS,
    "Trop de tentatives. Demandez un nouveau code.",
)
# Wrong store, expired, revoked, unknown, or an admin JWT — all the same answer.
_SESSION_INVALID = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    "Session invalide ou expirée.",
    headers={"WWW-Authenticate": "Bearer"},
)


# ── Request a code ────────────────────────────────────────────────────────

@router.post("/request-otp", status_code=status.HTTP_202_ACCEPTED)
async def request_otp(
    body: OtpRequestIn,
    request: Request,
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
):
    # Before any DB work: with no usable sender there is nothing to do.
    try:
        sender = get_sms_sender()
    except SmsUnavailable as exc:
        log.error("otp requested but no SMS sender is usable", extra={"reason": str(exc)})
        raise _SMS_UNAVAILABLE

    limits = OtpLimits.from_settings(_settings)
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=1)
    ip_hash = hash_requester(client_key(request), _settings.jwt_secret)

    # Serialise concurrent requests for one phone, or two parallel calls could
    # both read "no recent send" and both send. Held until commit/rollback.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
        {"k": f"otp:{store.id}:{body.phone}"},
    )

    phone_sends = [
        r[0] for r in (await db.execute(
            text("""
                SELECT created_at FROM otp_challenges
                 WHERE store_id = :sid AND phone_normalized = :p AND created_at > :since
                 ORDER BY created_at DESC
            """),
            {"sid": store.id, "p": body.phone, "since": since},
        )).all()
    ]
    ip_sends = 0
    if ip_hash is not None:
        ip_sends = (await db.execute(
            text("""
                SELECT COUNT(*) FROM otp_challenges
                 WHERE store_id = :sid AND requester_ip_hash = :ih AND created_at > :since
            """),
            {"sid": store.id, "ih": ip_hash, "since": since},
        )).scalar_one()
    store_sends = (await db.execute(
        text("SELECT COUNT(*) FROM otp_challenges WHERE store_id = :sid AND created_at > :since"),
        {"sid": store.id, "since": since},
    )).scalar_one()

    wait = send_throttle(
        now=now,
        phone_sends=phone_sends,
        ip_sends=ip_sends,
        store_sends=store_sends,
        limits=limits,
    )
    if wait is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Trop de demandes de code. Réessayez un peu plus tard.",
            headers={"Retry-After": str(max(1, int(wait)))},
        )

    code = generate_code()
    code_hash = await run_in_threadpool(hash_password, code)
    await db.execute(
        text("""
            INSERT INTO otp_challenges
                (store_id, phone_normalized, code_hash, requester_ip_hash, expires_at)
            VALUES (:sid, :p, :h, :ih, :exp)
        """),
        {
            "sid": store.id,
            "p": body.phone,
            "h": code_hash,
            "ih": ip_hash,
            "exp": now + timedelta(seconds=limits.ttl_seconds),
        },
    )

    try:
        await sender.send(dz_mobile_e164(body.phone), otp_message(store.name, code, limits.ttl_seconds))
    except Exception:
        # No row for a code nobody received: it would count against the
        # shopper's hourly allowance for nothing.
        await db.rollback()
        log.exception("sms send failed", extra={"store_slug": store.slug})
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Impossible d'envoyer le SMS pour le moment. Réessayez plus tard.",
        )

    await db.commit()
    return {
        "sent": True,
        "expires_in": limits.ttl_seconds,
        "resend_after": limits.resend_cooldown_seconds,
    }


# ── Verify a code ─────────────────────────────────────────────────────────

async def _verified_customer_id(db: AsyncSession, store_id: UUID, national: str) -> UUID:
    """Find the customer this phone already is in this store, or create one.

    Checkout keyed customers by whatever format the shopper typed, so the same
    phone may sit under `0555…`, `213555…` or `555…`. Looking across all of them
    is what makes "a guest who verifies becomes the holder of the orders they
    already placed" true. Oldest row wins: it is the one with the history.
    """
    existing = (await db.execute(
        text("""
            SELECT id FROM customers
             WHERE store_id = :sid AND phone_normalized = ANY(:keys)
             ORDER BY created_at ASC
             LIMIT 1
        """),
        {"sid": store_id, "keys": legacy_phone_keys(national)},
    )).first()
    if existing is not None:
        await db.execute(
            text("""
                UPDATE customers SET phone_verified_at = NOW(), updated_at = NOW()
                 WHERE id = :id AND store_id = :sid
            """),
            {"id": existing[0], "sid": store_id},
        )
        return existing[0]

    created = (await db.execute(
        text("""
            INSERT INTO customers (store_id, phone, phone_normalized, phone_verified_at)
            VALUES (:sid, :phone, :norm, NOW())
            ON CONFLICT (store_id, phone_normalized)
            DO UPDATE SET phone_verified_at = NOW(), updated_at = NOW()
            RETURNING id
        """),
        {"sid": store_id, "phone": dz_mobile_e164(national), "norm": national},
    )).first()
    return created[0]


async def _load_customer(db: AsyncSession, store_id: UUID, customer_id: UUID) -> CustomerOut:
    row = (await db.execute(
        text("""
            SELECT id, phone, full_name, email, phone_verified_at
              FROM customers
             WHERE id = :id AND store_id = :sid
        """),
        {"id": customer_id, "sid": store_id},
    )).first()
    return CustomerOut(
        id=row.id,
        phone=row.phone,
        full_name=row.full_name,
        email=row.email,
        phone_verified_at=row.phone_verified_at,
    )


@router.post("/verify", response_model=SessionOut)
async def verify_otp(
    body: OtpVerifyIn,
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
):
    limits = OtpLimits.from_settings(_settings)

    # Only the newest challenge for this phone is ever live; asking for a new
    # code silently retires the old one. The attempt is counted in the same
    # statement that reads the row, then committed on its own, so a guess
    # counts even if everything after this line fails.
    row = (await db.execute(
        text("""
            UPDATE otp_challenges
               SET attempts = attempts + 1
             WHERE store_id = :sid
               AND id = (
                   SELECT id FROM otp_challenges
                    WHERE store_id = :sid AND phone_normalized = :p
                    ORDER BY created_at DESC
                    LIMIT 1
               )
            RETURNING id, code_hash, attempts, expires_at, consumed_at
        """),
        {"sid": store.id, "p": body.phone},
    )).first()
    await db.commit()

    if row is None:
        raise _CODE_EXPIRED

    state = ChallengeState(attempts=row.attempts, expires_at=row.expires_at, consumed_at=row.consumed_at)
    verdict = challenge_status(state, now=datetime.now(timezone.utc), max_attempts=limits.max_attempts)
    if verdict == "locked":
        raise _TOO_MANY_ATTEMPTS
    if verdict != "open":
        raise _CODE_EXPIRED

    if not await run_in_threadpool(verify_password, body.code, row.code_hash):
        left = attempts_left(state, limits.max_attempts)
        detail = (
            f"Code incorrect. Il vous reste {left} tentative(s)."
            if left else "Code incorrect. Demandez un nouveau code."
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail)

    # Single use, even under concurrency: of two correct submissions racing
    # here, exactly one UPDATE matches `consumed_at IS NULL`.
    claimed = (await db.execute(
        text("""
            UPDATE otp_challenges SET consumed_at = NOW()
             WHERE id = :id AND store_id = :sid AND consumed_at IS NULL
            RETURNING id
        """),
        {"id": row.id, "sid": store.id},
    )).first()
    if claimed is None:
        await db.rollback()
        raise _CODE_EXPIRED

    customer_id = await _verified_customer_id(db, store.id, body.phone)

    token = new_session_token()
    ttl = timedelta(days=_settings.customer_session_ttl_days)
    await db.execute(
        text("""
            INSERT INTO customer_sessions (store_id, customer_id, token_hash, expires_at)
            VALUES (:sid, :cid, :th, :exp)
        """),
        {
            "sid": store.id,
            "cid": customer_id,
            "th": hash_session_token(token),
            "exp": datetime.now(timezone.utc) + ttl,
        },
    )
    await db.commit()

    return SessionOut(
        token=token,
        expires_in=int(ttl.total_seconds()),
        customer=await _load_customer(db, store.id, customer_id),
    )


# ── The signed-in customer ────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class CurrentCustomer:
    session_id: UUID
    store_id: UUID
    profile: CustomerOut


def _bearer_token(request: Request) -> str | None:
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token or len(token) > 256:
        return None
    return token


async def get_current_customer(
    request: Request,
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
) -> CurrentCustomer:
    """The customer behind this request's bearer token, on THIS store's domain."""
    token = _bearer_token(request)
    if token is None:
        raise _SESSION_INVALID

    row = (await db.execute(
        text("""
            SELECT s.id AS session_id,
                   c.id, c.phone, c.full_name, c.email, c.phone_verified_at
              FROM customer_sessions s
              JOIN customers c ON c.id = s.customer_id AND c.store_id = s.store_id
             WHERE s.token_hash = :th
               AND s.store_id = :sid
               AND s.revoked_at IS NULL
               AND s.expires_at > NOW()
        """),
        {"th": hash_session_token(token), "sid": store.id},
    )).first()
    if row is None:
        raise _SESSION_INVALID

    return CurrentCustomer(
        session_id=row.session_id,
        store_id=store.id,
        profile=CustomerOut(
            id=row.id,
            phone=row.phone,
            full_name=row.full_name,
            email=row.email,
            phone_verified_at=row.phone_verified_at,
        ),
    )


@router.get("/me", response_model=CustomerOut)
async def me(customer: CurrentCustomer = Depends(get_current_customer)):
    return customer.profile


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""
            UPDATE customer_sessions SET revoked_at = NOW()
             WHERE id = :id AND store_id = :sid AND revoked_at IS NULL
        """),
        {"id": customer.session_id, "sid": customer.store_id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
