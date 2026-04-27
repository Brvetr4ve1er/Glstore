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
    def __init__(self, id: UUID, email: str, role: str):
        self.id = id
        self.email = email
        self.role = role


async def get_current_admin(token: str = Depends(_oauth)) -> CurrentAdmin:
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    try:
        return CurrentAdmin(
            id=UUID(payload["sub"]),
            email=payload.get("email", ""),
            role=payload["role"],
        )
    except (KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")


def require_role(*allowed: str):
    async def _dep(admin: CurrentAdmin = Depends(get_current_admin)) -> CurrentAdmin:
        if admin.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return admin
    return _dep
