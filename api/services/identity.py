"""Customer identity — the decisions, with no database and no I/O.

Everything here is pure so it can be tested without Postgres, which this
project has never had in CI. The routes in api/routes/customer_auth.py do the
SQL and hand the results in; the verdicts come back out.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from api.core.config import Settings

OTP_DIGITS = 6


@dataclass(frozen=True, slots=True)
class OtpLimits:
    ttl_seconds: int
    max_attempts: int
    resend_cooldown_seconds: int
    per_phone_per_hour: int
    per_ip_per_hour: int
    per_store_per_hour: int

    @classmethod
    def from_settings(cls, s: Settings) -> "OtpLimits":
        return cls(
            ttl_seconds=s.otp_ttl_seconds,
            max_attempts=s.otp_max_attempts,
            resend_cooldown_seconds=s.otp_resend_cooldown_seconds,
            per_phone_per_hour=s.otp_max_per_phone_per_hour,
            per_ip_per_hour=s.otp_max_per_ip_per_hour,
            per_store_per_hour=s.otp_max_per_store_per_hour,
        )


# ── Secrets ───────────────────────────────────────────────────────────────

def generate_code() -> str:
    """Six digits from the OS CSPRNG. Leading zeros kept: `004217` is valid."""
    return f"{secrets.randbelow(10 ** OTP_DIGITS):0{OTP_DIGITS}d}"


def new_session_token() -> str:
    """256 bits, URL-safe. Returned to the client exactly once, never stored."""
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_requester(ip: str, key: str) -> str | None:
    """Keyed hash of a client address, for per-address counting.

    Plain SHA-256 would not do: the whole IPv4 space is 2^32 guesses, so an
    unkeyed hash of an address is the address. The HMAC key never leaves the
    server, so a database dump alone cannot reverse it.
    """
    if not ip:
        return None
    return hmac.new(key.encode("utf-8"), f"otp-requester:{ip}".encode("utf-8"), hashlib.sha256).hexdigest()


def otp_message(store_name: str, code: str, ttl_seconds: int) -> str:
    minutes = max(1, ttl_seconds // 60)
    return (
        f"{store_name} : votre code de connexion est {code}. "
        f"Il expire dans {minutes} min. Ne le communiquez à personne."
    )


# ── Verifying a code ──────────────────────────────────────────────────────

ChallengeStatus = Literal["open", "expired", "consumed", "locked"]


@dataclass(frozen=True, slots=True)
class ChallengeState:
    # Counted INCLUDING the attempt being evaluated: the route increments
    # atomically in SQL first, so two concurrent guesses can never both see
    # the same count and both slip under the cap.
    attempts: int
    expires_at: datetime
    consumed_at: datetime | None


def challenge_status(state: ChallengeState, *, now: datetime, max_attempts: int) -> ChallengeStatus:
    """Whether a submitted code may even be compared against this challenge.

    Only "open" leads to a comparison. Order matters: a used code is reported
    as used even if it has since expired, and a code past its attempt cap is
    locked even if a later guess would have been right.
    """
    if state.consumed_at is not None:
        return "consumed"
    if state.expires_at <= now:
        return "expired"
    if state.attempts > max_attempts:
        return "locked"
    return "open"


def attempts_left(state: ChallengeState, max_attempts: int) -> int:
    return max(0, max_attempts - state.attempts)


# ── Sending a code ────────────────────────────────────────────────────────

def send_throttle(
    *,
    now: datetime,
    phone_sends: Sequence[datetime],
    ip_sends: int,
    store_sends: int,
    limits: OtpLimits,
) -> int | None:
    """Seconds the caller must wait before another code may be sent, or None to send now.

    Every code costs real money, and this endpoint is anonymous: it is an
    SMS-cost attack surface first and a login second.

    phone_sends  created_at of every code sent to THIS phone in the last hour,
                 newest first (so phone_sends[0] is the most recent send)
    ip_sends     codes requested from this client address in the last hour
    store_sends  codes this store sent to anyone in the last hour
    """
    waits: list[float] = []

    if phone_sends:
        since_last = (now - phone_sends[0]).total_seconds()
        if since_last < limits.resend_cooldown_seconds:
            waits.append(limits.resend_cooldown_seconds - since_last)

        cap = limits.per_phone_per_hour
        if len(phone_sends) >= cap:
            # Back under the cap once every send from index cap-1 onward has
            # left the window; that one is the last of them to age out.
            waits.append((phone_sends[cap - 1] + timedelta(hours=1) - now).total_seconds())

    # Only counts are known here, so the true reset time is not. A short wait
    # tells an attacker nothing about the window, and a refused retry costs a
    # few COUNTs, not an SMS.
    if ip_sends >= limits.per_ip_per_hour or store_sends >= limits.per_store_per_hour:
        waits.append(limits.resend_cooldown_seconds)

    if not waits:
        return None
    return max(1, math.ceil(max(waits)))
