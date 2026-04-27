"""
Tier 4 — Paid scraping API.

Off by default. Enabled via `scraper.config.tier4_enabled = true` and an
API key in `scraper.config.tier4_api_key`. Provider selectable via
`scraper.config.tier4_provider`:

    "scraperapi"   → http://api.scraperapi.com/?api_key=...&url=...
    "scrapingbee"  → https://app.scrapingbee.com/api/v1/?api_key=...&url=...
    "zyte"         → https://api.zyte.com/v1/extract  (requires `extract_from`)
    "brightdata"   → https://brightdata.com/...        (left as TODO — needs a real account)

Per research these average ~$0.001-0.01 per request and ~91% success against
heavily-protected targets. We hit them only when Tier 3 returns blocked or
empty, so cost stays bounded.

Returning ok=False with `engine='paid_disabled'` is a normal degraded mode —
the orchestrator just skips this tier.
"""
from __future__ import annotations

import logging
import time
from typing import Literal
from urllib.parse import quote_plus, urlencode

import httpx

from api.services.scraper.types import FetchResult

log = logging.getLogger("glstore.scraper.tier4")


PaidProvider = Literal["scraperapi", "scrapingbee", "zyte", "brightdata", ""]


def _is_blocked(html: str) -> bool:
    if not html or len(html) < 500:
        return True
    low = html[:6000].lower()
    return "captcha" in low or "just a moment" in low


async def fetch(
    url: str,
    *,
    enabled: bool,
    provider: PaidProvider,
    api_key: str,
    user_agent: str,
    timeout_s: float = 60.0,
) -> FetchResult:
    started = time.monotonic()

    if not enabled or not provider or not api_key:
        return FetchResult(
            url=url, ok=False, status=0,
            fetch_ms=int((time.monotonic() - started) * 1000),
            engine="paid_disabled", tier=4, blocked=False,
            confidence_hint=0.0,
            error="tier4 disabled (set scraper.config.tier4_enabled=true and provide tier4_api_key)",
        )

    try:
        if provider == "scraperapi":
            api_url = (
                "http://api.scraperapi.com/"
                f"?api_key={quote_plus(api_key)}"
                f"&url={quote_plus(url)}"
                "&render=true"
                "&country_code=dz"
            )
            return await _passthrough_get(api_url, ua=user_agent, timeout_s=timeout_s,
                                          original_url=url, engine="paid:scraperapi", started=started)

        if provider == "scrapingbee":
            api_url = (
                "https://app.scrapingbee.com/api/v1/?"
                + urlencode({
                    "api_key": api_key,
                    "url": url,
                    "render_js": "true",
                    "premium_proxy": "true",
                    "country_code": "dz",
                })
            )
            return await _passthrough_get(api_url, ua=user_agent, timeout_s=timeout_s,
                                          original_url=url, engine="paid:scrapingbee", started=started)

        if provider == "zyte":
            return await _zyte_fetch(url, api_key=api_key, ua=user_agent,
                                     timeout_s=timeout_s, started=started)

        return FetchResult(
            url=url, ok=False, status=0,
            fetch_ms=int((time.monotonic() - started) * 1000),
            engine=f"paid:{provider}", tier=4, blocked=False,
            confidence_hint=0.0,
            error=f"provider {provider!r} not yet wired",
        )
    except Exception as e:                                           # noqa: BLE001
        return FetchResult(
            url=url, ok=False, status=0,
            fetch_ms=int((time.monotonic() - started) * 1000),
            engine=f"paid:{provider}", tier=4, blocked=False,
            confidence_hint=0.0,
            error=f"{type(e).__name__}: {e!s}",
        )


async def _passthrough_get(api_url: str, *, ua: str, timeout_s: float,
                           original_url: str, engine: str, started: float) -> FetchResult:
    async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=True) as client:
        r = await client.get(api_url, headers={"User-Agent": ua})
    elapsed = int((time.monotonic() - started) * 1000)
    text = r.text or ""
    blocked = _is_blocked(text)
    ok = (200 <= r.status_code < 400) and not blocked and bool(text)
    return FetchResult(
        url=original_url, ok=ok, status=r.status_code, html=text,
        fetch_ms=elapsed, engine=engine, tier=4, blocked=blocked,
        confidence_hint=0.95 if ok else 0.20,
        error=None if ok else f"http {r.status_code}, blocked={blocked}",
    )


async def _zyte_fetch(url: str, *, api_key: str, ua: str, timeout_s: float,
                      started: float) -> FetchResult:
    """Zyte API — POST {browserHtml: true}."""
    async with httpx.AsyncClient(
        timeout=timeout_s,
        auth=(api_key, ""),
    ) as client:
        r = await client.post(
            "https://api.zyte.com/v1/extract",
            json={"url": url, "browserHtml": True, "geolocation": "DZ"},
            headers={"User-Agent": ua},
        )
    elapsed = int((time.monotonic() - started) * 1000)
    if r.status_code != 200:
        return FetchResult(
            url=url, ok=False, status=r.status_code, fetch_ms=elapsed,
            engine="paid:zyte", tier=4, blocked=False,
            confidence_hint=0.10, error=f"zyte http {r.status_code}: {r.text[:200]}",
        )
    data = r.json()
    html = data.get("browserHtml") or ""
    blocked = _is_blocked(html)
    ok = bool(html) and not blocked
    return FetchResult(
        url=url, ok=ok, status=200, html=html, fetch_ms=elapsed,
        engine="paid:zyte", tier=4, blocked=blocked,
        confidence_hint=0.95 if ok else 0.20,
        error=None if ok else "zyte returned empty/blocked",
    )
