from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from api.core.config import get_settings

_settings = get_settings()
_oauth = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=True)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(
        plain.encode("utf-8"),
        bcrypt.gensalt(rounds=_settings.bcrypt_rounds),
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, role: str, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_settings.jwt_access_ttl_minutes)).timestamp()),
        "type": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _settings.jwt_secret, algorithms=[_settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


class CurrentAdmin:
    # store_id None => platform operator, may act on any store but must name
    # which one per request. Set => permanently scoped to that one store.
    def __init__(self, id: UUID, email: str, role: str, store_id: UUID | None = None):
        self.id = id
        self.email = email
        self.role = role
        self.store_id = store_id

    @property
    def is_platform_operator(self) -> bool:
        return self.store_id is None


async def get_current_admin(token: str = Depends(_oauth)) -> CurrentAdmin:
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    try:
        # Carried in the token so admin requests don't need a user lookup.
        # Trade-off: reassigning a user to a different store takes effect on
        # their next login, not immediately.
        raw_store = payload.get("store_id")
        return CurrentAdmin(
            id=UUID(payload["sub"]),
            email=payload.get("email", ""),
            role=payload["role"],
            store_id=UUID(raw_store) if raw_store else None,
        )
    except (KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")


def require_role(*allowed: str):
    async def _dep(admin: CurrentAdmin = Depends(get_current_admin)) -> CurrentAdmin:
        if admin.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return admin
    return _dep


def require_platform_operator(*allowed: str):
    """Guard for endpoints that read or write PLATFORM-GLOBAL configuration.

    A handful of settings live in `app_settings` with no store_id and cannot
    get one without a schema change — `scraper.config` and `llm.config` govern
    how EVERY brand scrapes and enriches. Role alone is the wrong gate there:
    the ADMIN of one brand is a full admin *of that brand*, not of the
    platform, and must not be able to repoint a shared outbound URL or move
    the price-outlier bounds that decide what lands against another brand's
    products.

    Composes on top of `require_role`, so an insufficient role still fails
    first with exactly the 403 it always did; a correctly-roled but
    store-scoped admin now fails on the second check instead of succeeding.
    """
    role_dep = require_role(*allowed)

    async def _dep(admin: CurrentAdmin = Depends(role_dep)) -> CurrentAdmin:
        if not admin.is_platform_operator:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This setting is platform-wide; only a platform operator may change it.",
            )
        return admin
    return _dep
