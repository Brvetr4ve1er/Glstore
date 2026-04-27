"""
Proxy pool manager.

Reads proxy URLs from `app_settings → scraper.config.proxies` (a list of
http(s):// URLs). Implements per-domain sticky rotation: one IP per
(domain, session) so cookies don't get split across IPs.

If the pool is empty, all calls return None and the caller does a direct
connection — exactly the desired no-proxy fallback.
"""
from __future__ import annotations

import itertools
from threading import Lock
from typing import Optional


class ProxyPool:
    def __init__(self, proxies: list[str] | None = None) -> None:
        self._proxies = list(proxies or [])
        self._cycle = itertools.cycle(self._proxies) if self._proxies else None
        self._sticky: dict[str, str] = {}
        self._dead: set[str] = set()
        self._lock = Lock()

    def __bool__(self) -> bool:
        return bool(self._proxies)

    def pick(self, domain: str | None = None, sticky: bool = True) -> Optional[str]:
        if not self._proxies:
            return None
        with self._lock:
            if sticky and domain:
                proxy = self._sticky.get(domain)
                if proxy and proxy not in self._dead:
                    return proxy
            # Round-robin, skipping dead ones
            tried = 0
            while tried < len(self._proxies):
                if self._cycle is None:
                    return None
                candidate = next(self._cycle)
                tried += 1
                if candidate in self._dead:
                    continue
                if sticky and domain:
                    self._sticky[domain] = candidate
                return candidate
        return None

    def mark_dead(self, proxy: str) -> None:
        with self._lock:
            self._dead.add(proxy)

    def revive_all(self) -> None:
        with self._lock:
            self._dead.clear()

    def stats(self) -> dict[str, int]:
        return {
            "total": len(self._proxies),
            "dead": len(self._dead),
            "alive": len(self._proxies) - len(self._dead),
            "sticky_assignments": len(self._sticky),
        }
