"""Outbound SMS — a seam, not an integration.

No provider is wired. Choosing one is a procurement decision (contract, sender
ID registration, per-message cost), the same shape as the Neon DSN: the
operator supplies the thing, and this module only defines where it plugs in.

Adding a provider means one class with an async `send(to_e164, body)` and one
branch in `get_sms_sender()`. Nothing else in the codebase changes.

FAIL CLOSED. The console sender prints codes, so it is refused everywhere but
local development — and on any serverless deployment even if that deployment
claims to be development, because "print" there means "write to a hosted log".
With no usable sender, OTP endpoints answer 503; they never fall back to a
fixed code or a printed one.
"""
from __future__ import annotations

from typing import Protocol

from api.core.config import get_settings


class SmsUnavailable(RuntimeError):
    """No sender may be used in this environment."""


class SmsSender(Protocol):
    async def send(self, to_e164: str, body: str) -> None: ...


def get_sms_sender() -> SmsSender:
    settings = get_settings()
    provider = settings.sms_provider.strip().lower()

    if provider == "console":
        if settings.environment != "development" or settings.db_serverless:
            raise SmsUnavailable(
                "the console SMS sender is development-only; configure a real "
                "provider (SMS_PROVIDER) before enabling phone login here"
            )
        from api.services.sms.console import ConsoleSender

        return ConsoleSender()

    raise SmsUnavailable(f"unknown SMS provider {provider!r}")
