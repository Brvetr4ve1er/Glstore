"""
Tier 1 — Cheap HTTP fetch with realistic headers.

Per research: covers ~60-70% of static / WordPress / WooCommerce / Magento
sites (Condor, Brandt, El Hamiz, ExtraStores, PrixAlgérie, Diardzair).
Latency: 0.5-2s per page.

Block detection: status >= 400, response < 500 bytes, or response contains
known anti-bot markers ("Just a moment", "checking your browser",
"cf-error", reCAPTCHA bootstrap). On detection we set `blocked=True` and
the orchestrator escalates to Tier 2.
"""
from __future__ import annotations

import logging
import time

import httpx

from api.services.scraper.types import FetchResult

log = logging.getLogger("glstore.scraper.tier1")


# Anti-bot challenge markers — very high signal-to-noise.
_BLOCK_MARKERS = (
    "just a moment",
    "checking your browser",
    "cf-error",
    "cloudflare",
    "captcha",
    "are you a human",
    "verify you are human",
    "px-captcha",
    "datadome",
    "<!-- challenge-platform/scripts/",
)


def _is_blocked(html: str, status: int) -> bool:
    if status in (403, 429):
        return True
    if status == 503 and len(html) < 4000:
        # CF challenge pages are tiny; real 503s usually have full content.
        return True
    if not html:
        return True
    if len(html) < 500:
        return True
    low = html[:6000].lower()
    return any(m in low for m in _BLOCK_MARKERS)


async def fetch(
    url: str,
    *,
    user_agent: str,
    timeout_s: float = 12.0,
    proxy: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> FetchResult:
    headers = {
        "User-Agent": user_agent,
        # Realistic browser-like header set so we're not trivially blocked.
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-DZ,fr;q=0.9,en;q=0.8,ar;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
    }
    if extra_headers:
        headers.update(extra_headers)

    started = time.monotonic()
    proxies = proxy or None

    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            proxy=proxies,
            headers=headers,
            http2=True,
        ) as client:
            r = await client.get(url)
        elapsed = int((time.monotonic() - started) * 1000)
        text = r.text or ""
        blocked = _is_blocked(text, r.status_code)
        ok = (200 <= r.status_code < 400) and not blocked and bool(text)
        return FetchResult(
            url=str(r.url),
            ok=ok,
            status=r.status_code,
            html=text,
            fetch_ms=elapsed,
            engine="httpx",
            tier=1,
            blocked=blocked,
            confidence_hint=0.95 if ok else (0.20 if blocked else 0.40),
            error=None if ok else f"http {r.status_code}, blocked={blocked}",
        )
    except httpx.TimeoutException:
        return FetchResult(
            url=url, ok=False, status=0, fetch_ms=int((time.monotonic() - started) * 1000),
            engine="httpx", tier=1, blocked=False,
            confidence_hint=0.0, error="timeout",
        )
    except httpx.RequestError as e:
        return FetchResult(
            url=url, ok=False, status=0, fetch_ms=int((time.monotonic() - started) * 1000),
            engine="httpx", tier=1, blocked=False,
            confidence_hint=0.0, error=f"connection: {e!s}",
        )
    except Exception as e:                                           # noqa: BLE001
        return FetchResult(
            url=url, ok=False, status=0, fetch_ms=int((time.monotonic() - started) * 1000),
            engine="httpx", tier=1, blocked=False,
            confidence_hint=0.0, error=f"unexpected: {type(e).__name__}: {e}",
        )
