"""
In-memory sliding-window rate limiter keyed by client IP.
For production with multiple API replicas, swap to Redis — same interface.
"""
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self, limit_per_minute: int):
        self.limit = limit_per_minute
        self.window = 60.0
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded"
                )
            q.append(now)


def client_key(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
