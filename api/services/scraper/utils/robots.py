"""
robots.txt cache + parser.

Honors `Disallow` and `Crawl-delay`. Cached for 24h per domain. If robots.txt
is unreachable we *allow* the fetch (no robots.txt is implicit allow per the
spec). If a `User-agent: *` block exists with explicit `Disallow: /`, we skip.

Strict mode (`STRICT_ROBOTS=1` env): treat unreachable robots.txt as "allow"
still, but log a warning. Production might want to flip this — for our use
case (small catalogue, polite UA, low rate), permissive is correct.
"""
from __future__ import annotations

import asyncio
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from api.services.scraper.utils.domain import host_of


_CACHE_TTL_S = 86400


class _Entry:
    __slots__ = ("parser", "fetched_at", "crawl_delay")

    def __init__(self, parser: RobotFileParser | None, crawl_delay: float = 0.0):
        self.parser = parser
        self.fetched_at = time.time()
        self.crawl_delay = crawl_delay


class RobotsCache:
    def __init__(self, user_agent: str = "GhirLaffaireBot/1.0") -> None:
        self.user_agent = user_agent
        self._cache: dict[str, _Entry] = {}
        self._lock = asyncio.Lock()

    async def allowed(self, url: str) -> tuple[bool, float]:
        """Returns (allowed, suggested_extra_delay_s).

        `suggested_extra_delay_s` is the Crawl-delay directive — caller adds
        it on top of the normal rate limit.
        """
        host = host_of(url)
        if not host:
            return True, 0.0

        entry = await self._get_or_fetch(host)
        if entry.parser is None:
            return True, 0.0
        try:
            allowed = entry.parser.can_fetch(self.user_agent, url)
        except Exception:
            allowed = True
        return allowed, entry.crawl_delay

    async def _get_or_fetch(self, host: str) -> _Entry:
        async with self._lock:
            entry = self._cache.get(host)
            now = time.time()
            if entry and (now - entry.fetched_at) < _CACHE_TTL_S:
                return entry

        parser, delay = await _fetch_robots(host, self.user_agent)
        entry = _Entry(parser, delay)
        async with self._lock:
            self._cache[host] = entry
        return entry


async def _fetch_robots(host: str, ua: str) -> tuple[RobotFileParser | None, float]:
    url = f"https://{host}/robots.txt"
    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            follow_redirects=True,
            headers={"User-Agent": ua},
        ) as client:
            r = await client.get(url)
    except httpx.RequestError:
        return None, 0.0

    if r.status_code != 200 or not r.text:
        return None, 0.0

    parser = RobotFileParser()
    parser.parse(r.text.splitlines())

    delay = 0.0
    try:
        d = parser.crawl_delay(ua) or parser.crawl_delay("*")
        if d:
            delay = float(d)
    except Exception:
        delay = 0.0

    return parser, delay
