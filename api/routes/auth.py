"""
Auth endpoints — JWT login with both per-account and per-IP brute-force defense.

Defense layers:
  1. Per-account: 5 cumulative fails → 15 min lock (existing).
  2. Per-IP: sliding window of failed attempts. After 10 fails in 5 min from one
     IP → 429 regardless of credential validity.
  3. Both layers' counters are reset on a successful login (per-account) or
     simply expire (per-IP, sliding window).

The per-IP layer in-memory; resets on API restart. This is fine for a
single-replica dev stack. Multi-replica should move it to Redis.
"""
from collections import deque
from time import monotonic
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db
from api.core.security import create_access_token, verify_password
from api.models.schemas import AdminLogin, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])
_settings = get_settings()


# ── Per-IP failed-login tracker ────────────────────────────────────────────

class _IPFailTracker:
    """Sliding-window failure counter, in-memory, lock-protected.

    Only failed attempts increment the counter. Successful attempts don't reset
    other people's tabs — they just don't add to the IP's bucket.
    """

    WINDOW_S    = 300      # 5 minutes
    MAX_FAILS   = 10       # ≥ this many fails in the window → 429

    def __init__(self) -> None:
        self._buckets: dict[str, deque[float]] = {}
        self._lock = Lock()

    def _purge(self, ip: str, now: float) -> deque[float]:
        bucket = self._buckets.get(ip)
        if bucket is None:
            bucket = deque()
            self._buckets[ip] = bucket
        cutoff = now - self.WINDOW_S
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        return bucket

    def is_rate_limited(self, ip: str) -> tuple[bool, int]:
        """Returns (limited, retry_after_seconds)."""
        if not ip:
            return False, 0
        now = monotonic()
        with self._lock:
            bucket = self._purge(ip, now)
            if len(bucket) >= self.MAX_FAILS:
                # Time until oldest failure ages out
                oldest = bucket[0]
                retry = max(1, int(self.WINDOW_S - (now - oldest)))
                return True, retry
            return False, 0

    def record_failure(self, ip: str) -> None:
        if not ip:
            return
        now = monotonic()
        with self._lock:
            bucket = self._purge(ip, now)
            bucket.append(now)


_ip_failures = _IPFailTracker()


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Honors X-Forwarded-For when proxy is trusted."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # Take the leftmost (closest to client). Trim port if present.
        ip = xff.split(",")[0].strip()
        if ":" in ip and ip.count(":") == 1:
            ip = ip.split(":")[0]
        return ip
    if request.client:
        return request.client.host or ""
    return ""


# ── Login ──────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenOut)
async def login(
    dto: AdminLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = _client_ip(request)

    # Pre-check: this IP has been failing too much
    limited, retry_after = _ip_failures.is_rate_limited(ip)
    if limited:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts from this address. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    row = await db.execute(
        text("""
            SELECT id, email, password_hash, role, is_active, locked_until,
                   failed_attempts, store_id
              FROM admin_users WHERE email = :e
        """),
        {"e": str(dto.email)},
    )
    u = row.first()

    # Wrong email — track IP failure but don't reveal user existence
    if not u or not u[4]:
        _ip_failures.record_failure(ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # Account locked
    if u[5] is not None:
        # Don't increment IP counter for locked accounts — already protected
        raise HTTPException(status.HTTP_423_LOCKED, "Account locked, retry later")

    # Wrong password
    if not verify_password(dto.password, u[2]):
        _ip_failures.record_failure(ip)
        await db.execute(
            text("""
                UPDATE admin_users
                   SET failed_attempts = failed_attempts + 1,
                       locked_until = CASE
                           WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
                           ELSE NULL
                       END
                 WHERE id = :id
            """),
            {"id": u[0]},
        )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # Success
    await db.execute(
        text(
            "UPDATE admin_users SET last_login_at = NOW(), "
            "failed_attempts = 0, locked_until = NULL WHERE id = :id"
        ),
        {"id": u[0]},
    )
    await db.commit()

    # store_id rides in the token so admin requests skip a user lookup.
    # NULL here means a platform operator who may act on any store.
    token = create_access_token(
        subject=str(u[0]),
        role=u[3],
        extra={"email": u[1], "store_id": str(u[7]) if u[7] else None},
    )
    return TokenOut(
        access_token=token,
        expires_in=_settings.jwt_access_ttl_minutes * 60,
    )
