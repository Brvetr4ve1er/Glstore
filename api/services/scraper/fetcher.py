"""
Fetch orchestrator — implements the multi-tier escalation defined in the
master prompt and validated by the deep-research report.

Decision rules (per URL):
    1. Check process-local cache (hit → return immediately)
    2. Robots.txt → skip if disallowed
    3. Rate limiter → wait or skip if cooled down
    4. Domain hints:
         - PROTECTED_DOMAINS  → start at Tier 3 (Ouedkniss)
         - JS_HEAVY_DOMAINS   → start at Tier 2
         - else               → start at Tier 1
    5. After each tier, if `result.ok` and `confidence_hint >= confidence_threshold`,
       stop. Else escalate up to Tier 4 (paid, opt-in).

Reports rate-limiter feedback (success/failure, blocked) so the breaker stays
sharp.
"""
from __future__ import annotations

import asyncio
import logging

from api.services.scraper.tiers import tier1_http, tier2_playwright, tier3_stealth, tier4_paid
from api.services.scraper.types import FetchResult, SourceTier
from api.services.scraper.utils.cache import FetchCache
from api.services.scraper.utils.domain import (
    host_of, needs_browser, needs_stealth, should_skip,
)
from api.services.scraper.utils.proxy_manager import ProxyPool
from api.services.scraper.utils.rate_limiter import RateLimiter
from api.services.scraper.utils.robots import RobotsCache

log = logging.getLogger("glstore.scraper.fetcher")


class TieredFetcher:
    """Stateful fetcher — owns the rate-limiter, robots cache, and fetch cache.
    One instance per worker process is enough."""

    def __init__(
        self,
        *,
        user_agent: str,
        per_domain_rate_limit_s: float,
        proxy_pool: ProxyPool,
        confidence_threshold: float = 0.6,
        tier4_enabled: bool = False,
        tier4_provider: str = "",
        tier4_api_key: str = "",
    ) -> None:
        self.user_agent = user_agent
        self.confidence_threshold = confidence_threshold
        self.tier4_enabled = tier4_enabled
        self.tier4_provider = tier4_provider
        self.tier4_api_key = tier4_api_key
        self.rate_limiter = RateLimiter(per_domain_rate_limit_s)
        self.robots = RobotsCache(user_agent)
        self.cache = FetchCache()
        self.proxy_pool = proxy_pool

    async def fetch(self, url: str, *, tier: SourceTier) -> FetchResult:
        skip_reason = should_skip(url)
        if skip_reason:
            return FetchResult(
                url=url, ok=False, status=0, fetch_ms=0,
                engine="skipped", tier=0, blocked=False,
                confidence_hint=0.0, error=skip_reason,
            )

        # Cache hit
        cached = await self.cache.get(url)
        if cached:
            cached.engine = (cached.engine or "") + "+cache_hit"
            return cached

        # Robots
        allowed, extra_delay = await self.robots.allowed(url)
        if not allowed:
            return FetchResult(
                url=url, ok=False, status=0, fetch_ms=0,
                engine="robots_disallow", tier=0, blocked=False,
                confidence_hint=0.0, error="robots.txt disallow",
            )
        if extra_delay > 0:
            await asyncio.sleep(min(extra_delay, 5.0))

        # Rate limit
        ok, reason = await self.rate_limiter.acquire(url)
        if not ok:
            return FetchResult(
                url=url, ok=False, status=0, fetch_ms=0,
                engine="rate_limited", tier=0, blocked=True,
                confidence_hint=0.0, error=reason or "rate limited",
            )

        # Tier escalation start point
        start_tier = self._start_tier_for(url)
        result = await self._escalate(url, start_tier=start_tier)

        await self.cache.put(url, result, tier=tier)

        if result.ok:
            self.rate_limiter.report_success(url)
        else:
            self.rate_limiter.report_failure(url)
            if result.blocked or (result.status in (403, 429, 503)):
                self.rate_limiter.mark_blocked(
                    url, retry_after_s=300,
                    reason=f"tier{result.tier} status={result.status}",
                )
        return result

    def _start_tier_for(self, url: str) -> int:
        if needs_stealth(url):
            return 3
        if needs_browser(url):
            return 2
        return 1

    async def _escalate(self, url: str, *, start_tier: int) -> FetchResult:
        domain = host_of(url)
        proxy = self.proxy_pool.pick(domain) if self.proxy_pool else None
        last: FetchResult | None = None

        for t in range(start_tier, 5):
            if t == 1:
                r = await tier1_http.fetch(url, user_agent=self.user_agent, proxy=proxy)
            elif t == 2:
                r = await tier2_playwright.fetch(url, user_agent=self.user_agent)
            elif t == 3:
                r = await tier3_stealth.fetch(url, user_agent=self.user_agent)
            elif t == 4:
                r = await tier4_paid.fetch(
                    url,
                    enabled=self.tier4_enabled,
                    provider=self.tier4_provider,
                    api_key=self.tier4_api_key,
                    user_agent=self.user_agent,
                )
            else:
                break

            last = r
            log.debug("fetch %s tier=%d engine=%s ok=%s status=%d hint=%.2f",
                      url, t, r.engine, r.ok, r.status, r.confidence_hint)

            # Stop conditions
            if r.ok and r.confidence_hint >= self.confidence_threshold:
                return r

            # Smart short-circuits to avoid wasting expensive tiers
            if r.ok and not r.blocked and r.html and r.confidence_hint >= 0.4 and t >= 2:
                # We got *something* renderable from a browser tier;
                # extractor may still pull a price from it. Don't escalate.
                return r

            # Mark dead proxy if applicable
            if proxy and not r.ok and t == 1:
                self.proxy_pool.mark_dead(proxy)
                proxy = self.proxy_pool.pick(domain) if self.proxy_pool else None

            # If tier 4 disabled, stop here
            if t == 3 and not self.tier4_enabled:
                return r

        return last or FetchResult(
            url=url, ok=False, status=0, fetch_ms=0,
            engine="all_tiers_exhausted", tier=4, blocked=False,
            confidence_hint=0.0, error="all tiers exhausted",
        )
