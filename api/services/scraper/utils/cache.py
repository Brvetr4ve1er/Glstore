"""
Tier-aware in-memory fetch cache.

Cache TTL depends on the source tier (per research):
    - OFFICIAL    → 24h  (Condor / Brandt / Samsung — prices change rarely)
    - RETAILER    →  6h  (Jumia / Batolis — promos move daily)
    - AGGREGATOR  →  6h  (PrixAlgérie)
    - CLASSIFIED  →  2h  (Ouedkniss — listings churn fast)
    - REVIEW      → 24h  (specs don't change)
    - GENERAL     →  6h

Cache is process-local. Re-runs within the TTL return the same FetchResult.
This is what lets impatient admins click "Refresh scrape" without burning
through anti-bot quotas.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Optional

from api.services.scraper.types import FetchResult, SourceTier


_TIER_TTL_S: dict[SourceTier, int] = {
    SourceTier.OFFICIAL:   24 * 3600,
    SourceTier.RETAILER:    6 * 3600,
    SourceTier.AGGREGATOR:  6 * 3600,
    SourceTier.CLASSIFIED:  2 * 3600,
    SourceTier.REVIEW:     24 * 3600,
    SourceTier.GENERAL:     6 * 3600,
}

# Failed (non-200, blocked) results cache shorter so transient blocks don't
# permanently lock us out.
_FAILURE_TTL_S = 1 * 3600


@dataclass
class _Entry:
    result: FetchResult
    expires_at: float


class FetchCache:
    def __init__(self) -> None:
        self._store: dict[str, _Entry] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _ttl_for(tier: SourceTier, ok: bool) -> int:
        if not ok:
            return _FAILURE_TTL_S
        return _TIER_TTL_S.get(tier, 6 * 3600)

    async def get(self, url: str) -> Optional[FetchResult]:
        async with self._lock:
            e = self._store.get(url)
            if not e:
                return None
            if e.expires_at < time.time():
                self._store.pop(url, None)
                return None
            return e.result

    async def put(self, url: str, result: FetchResult, tier: SourceTier) -> None:
        ttl = self._ttl_for(tier, result.ok and not result.blocked)
        async with self._lock:
            self._store[url] = _Entry(result=result, expires_at=time.time() + ttl)

    def size(self) -> int:
        return len(self._store)
