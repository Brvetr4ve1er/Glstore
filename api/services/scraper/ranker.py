"""
Rank + diversify search results.

Inputs: raw `SearchResult[]` from one or more search backends/intents.
Output: a curated list capped at `max_total`, with quota-balanced tiers.

Decisions:
    - dedupe by registrable host (so we never hit the same domain twice)
    - skip URLs flagged by `should_skip()`
    - allocate by tier quota: 1 official + 3 retailer + 1 review + 1 general
      (tunable via app_settings)
    - within a tier, prefer commercial-intent hits over technical/review
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from api.services.scraper.types import SearchResult, SourceTier, TIER_QUOTA_DEFAULT
from api.services.scraper.utils.domain import host_of, should_skip


_INTENT_PRIORITY = {"commercial": 0, "technical": 1, "review": 2}


def rank_and_diversify(
    results: Iterable[SearchResult],
    *,
    max_total: int = 6,
    quota: dict[SourceTier, int] | None = None,
) -> list[SearchResult]:
    quota = dict(quota or TIER_QUOTA_DEFAULT)

    seen_hosts: set[str] = set()
    by_tier: dict[SourceTier, list[SearchResult]] = defaultdict(list)

    for r in results:
        if not r.url:
            continue
        if should_skip(r.url):
            continue
        host = host_of(r.url)
        if not host or host in seen_hosts:
            continue
        seen_hosts.add(host)
        by_tier[r.tier].append(r)

    # Sort each bucket by intent priority then by host string (stable)
    for tier in by_tier:
        by_tier[tier].sort(key=lambda r: (
            _INTENT_PRIORITY.get(r.intent, 99),
            r.domain or "",
        ))

    selected: list[SearchResult] = []

    # Pass 1: respect quotas in priority order
    for tier in (
        SourceTier.OFFICIAL,
        SourceTier.RETAILER,
        SourceTier.AGGREGATOR,
        SourceTier.CLASSIFIED,
        SourceTier.REVIEW,
        SourceTier.GENERAL,
    ):
        n = quota.get(tier, 0)
        for r in by_tier.get(tier, [])[:n]:
            selected.append(r)
            if len(selected) >= max_total:
                return selected

    # Pass 2: fill remaining slots with leftovers (any tier)
    if len(selected) < max_total:
        chosen_urls = {r.url for r in selected}
        leftovers: list[SearchResult] = []
        for tier in (SourceTier.RETAILER, SourceTier.OFFICIAL, SourceTier.AGGREGATOR,
                     SourceTier.GENERAL, SourceTier.CLASSIFIED, SourceTier.REVIEW):
            for r in by_tier.get(tier, []):
                if r.url in chosen_urls:
                    continue
                leftovers.append(r)
        # Dedupe leftovers by host (already deduped in by_tier, so just trim)
        for r in leftovers:
            selected.append(r)
            chosen_urls.add(r.url)
            if len(selected) >= max_total:
                break

    return selected[:max_total]
