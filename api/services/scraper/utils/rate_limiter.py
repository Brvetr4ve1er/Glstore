"""
Per-domain rate limiter + circuit breaker.

Lives in worker memory (process-local). For multi-worker deployments each
worker has its own state — that's intentional, the per-domain budget is
per-worker. If we ever scale to >5 workers we'll move this to Redis.

Also tracks `blocked_until` for domains that have rate-limited us — we honor
Retry-After headers and back off automatically.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from api.services.scraper.utils.domain import host_of


@dataclass
class _DomainState:
    last_request_at: float = 0.0
    blocked_until: float = 0.0
    block_reason: str = ""
    success_count: int = 0
    failure_count: int = 0


class RateLimiter:
    """In-memory domain throttle + circuit breaker.

    Usage:
        rl = RateLimiter(min_interval_s=2.0)
        await rl.acquire(url)            # blocks if domain was hit recently
        # ... fetch ...
        rl.report_success(url)           # OR
        rl.mark_blocked(url, retry_after_s=300, reason="429")
    """

    def __init__(self, min_interval_s: float = 2.0) -> None:
        self.min_interval_s = float(min_interval_s)
        self._states: dict[str, _DomainState] = {}
        self._lock = asyncio.Lock()

    def _state(self, host: str) -> _DomainState:
        s = self._states.get(host)
        if s is None:
            s = _DomainState()
            self._states[host] = s
        return s

    async def acquire(self, url: str) -> tuple[bool, str | None]:
        """Wait until the domain is callable. Returns (allowed, reason_if_blocked).

        If the domain is currently in a blocked window, returns (False, reason)
        immediately — the caller should skip rather than wait.
        """
        host = host_of(url)
        if not host:
            return True, None

        async with self._lock:
            s = self._state(host)
            now = time.time()

            # Circuit-breaker check
            if s.blocked_until > now:
                wait = int(s.blocked_until - now)
                return False, f"domain cooling down for {wait}s ({s.block_reason})"

            # Rate-limit wait
            elapsed = now - s.last_request_at
            wait = self.min_interval_s - elapsed
            if wait > 0:
                # Sleep OUTSIDE the lock so other domains aren't blocked.
                pass
            s.last_request_at = max(now, now + max(wait, 0.0))

        if wait > 0:
            await asyncio.sleep(wait)
        return True, None

    def report_success(self, url: str) -> None:
        host = host_of(url)
        if not host:
            return
        s = self._state(host)
        s.success_count += 1

    def report_failure(self, url: str) -> None:
        host = host_of(url)
        if not host:
            return
        s = self._state(host)
        s.failure_count += 1

    def mark_blocked(self, url: str, retry_after_s: int = 300, reason: str = "blocked") -> None:
        """Trip the breaker: future requests to this domain will return (False, ...)
        for `retry_after_s` seconds."""
        host = host_of(url)
        if not host:
            return
        s = self._state(host)
        s.blocked_until = time.time() + max(retry_after_s, 30)
        s.block_reason = reason[:100]
        s.failure_count += 1

    def is_blocked(self, url: str) -> bool:
        host = host_of(url)
        return self._state(host).blocked_until > time.time()

    def stats(self) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        now = time.time()
        for host, s in self._states.items():
            out[host] = {
                "success": s.success_count,
                "failure": s.failure_count,
                "blocked_for_s": max(0, int(s.blocked_until - now)),
                "block_reason": s.block_reason,
                "last_request_age_s": int(now - s.last_request_at) if s.last_request_at else -1,
            }
        return out
