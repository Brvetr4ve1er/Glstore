"""
Tier 3 — Playwright + stealth init script + slower wait policy.

Same browser instance as Tier 2 but:
  - injects stealth init script (hide webdriver, plugins length, canvas noise)
  - waits for `networkidle` instead of `domcontentloaded` so Cloudflare
    challenge JS has time to resolve
  - longer timeout (45s vs 25s)
  - small randomised delay before extraction
  - optional proxy support if pool is configured

For our research-priority sites (Ouedkniss specifically) this is the best
free-tier we have. Real success on Ouedkniss is ~70-80%; the remaining 20%
goes to Tier 4 if enabled, otherwise we accept the failure.
"""
from __future__ import annotations

from api.services.scraper.tiers.tier2_playwright import _fetch_inner
from api.services.scraper.types import FetchResult


async def fetch(url: str, *, user_agent: str, timeout_s: float = 45.0) -> FetchResult:
    return await _fetch_inner(
        url,
        stealth=True,
        user_agent=user_agent,
        timeout_s=timeout_s,
        # networkidle is more expensive but lets CF challenge JS run.
        wait_until="networkidle",
    )
