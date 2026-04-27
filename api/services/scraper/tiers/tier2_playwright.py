"""
Tier 2 — Headless Chromium via Playwright.

Per research: covers JS-rendered storefronts (Magento storefronts that
defer pricing, modern SPAs, infinite-scroll classified listings).
Latency: 5-15s per page. Memory: ~200 MB extra per browser instance.

We keep a single persistent browser per worker process — new browser per
request would be 1-2s of overhead each time. New `BrowserContext` per
request gives us cookie isolation cheaply.

Returns gracefully (FetchResult with ok=False) if Playwright isn't
installed — the worker can still operate at Tier 1.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from api.services.scraper.types import FetchResult

log = logging.getLogger("glstore.scraper.tier2")


# Module-level singletons for the worker lifetime.
_pw: Any = None              # playwright instance
_browser: Any = None         # browser
_init_lock = asyncio.Lock()
_unavailable_reason: str | None = None


async def _get_browser(stealth: bool = False) -> Any:
    """Lazy-init a persistent Chromium browser. Returns None if Playwright is
    unavailable (not installed, or process killed)."""
    global _pw, _browser, _unavailable_reason
    if _browser is not None:
        return _browser
    if _unavailable_reason is not None:
        return None

    async with _init_lock:
        if _browser is not None:
            return _browser
        if _unavailable_reason is not None:
            return None
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            _unavailable_reason = f"playwright not installed: {e}"
            log.warning(_unavailable_reason)
            return None

        try:
            _pw = await async_playwright().start()
            args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ]
            _browser = await _pw.chromium.launch(headless=True, args=args)
            log.info("Playwright Chromium launched (stealth=%s)", stealth)
        except Exception as e:                                       # noqa: BLE001
            _unavailable_reason = f"chromium launch failed: {e}"
            log.warning(_unavailable_reason)
            _pw = None
            _browser = None
            return None
    return _browser


async def shutdown() -> None:
    """Called from worker shutdown signal."""
    global _pw, _browser
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None
    if _pw is not None:
        try:
            await _pw.stop()
        except Exception:
            pass
        _pw = None


# A small set of stealth tweaks applied to every context.
# We're deliberately not pulling in `playwright-stealth` as a hard dep —
# the most impactful evasions are doable inline.
_STEALTH_INIT_SCRIPT = """
// Hide WebDriver
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
// Plugins length (bot-detection signal)
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'languages', { get: () => ['fr-DZ', 'fr', 'en-US', 'en'] });
// Canvas fingerprint noise
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type) {
  const ctx = this.getContext('2d');
  if (ctx) { ctx.fillStyle = 'rgb(255,255,255)'; ctx.fillRect(0,0,1,1); }
  return origToDataURL.apply(this, arguments);
};
"""


_BLOCK_MARKERS = (
    "just a moment",
    "checking your browser",
    "cf-error",
    "captcha",
    "verify you are human",
    "px-captcha",
    "datadome",
)


def _is_blocked(html: str) -> bool:
    if not html or len(html) < 500:
        return True
    low = html[:6000].lower()
    return any(m in low for m in _BLOCK_MARKERS)


async def _fetch_inner(url: str, *, stealth: bool, user_agent: str,
                       timeout_s: float, wait_until: str) -> FetchResult:
    started = time.monotonic()
    browser = await _get_browser(stealth=stealth)
    if browser is None:
        return FetchResult(
            url=url, ok=False, status=0, fetch_ms=int((time.monotonic() - started) * 1000),
            engine="playwright_unavailable", tier=2 if not stealth else 3,
            blocked=False, confidence_hint=0.0,
            error=_unavailable_reason or "playwright unavailable",
        )

    ctx = None
    page = None
    try:
        context_kwargs = dict(
            user_agent=user_agent,
            locale="fr-DZ",
            viewport={"width": 1366, "height": 768},
            extra_http_headers={
                "Accept-Language": "fr-DZ,fr;q=0.9,en;q=0.8,ar;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            ignore_https_errors=True,
        )

        ctx = await browser.new_context(**context_kwargs)
        if stealth:
            await ctx.add_init_script(_STEALTH_INIT_SCRIPT)

        page = await ctx.new_page()
        # Block heavy resources we don't need (images already extracted from
        # HTML; videos/fonts are dead weight). Saves bandwidth + time.
        await page.route("**/*", _route_filter)

        response = await page.goto(url, wait_until=wait_until, timeout=int(timeout_s * 1000))
        # Small jitter for stealth tier
        if stealth:
            await asyncio.sleep(0.6 + 0.4 * (hash(url) % 100) / 100)
        html = await page.content()
        status = response.status if response else 0
        blocked = _is_blocked(html) or status in (403, 429)
        ok = (200 <= status < 400) and not blocked and bool(html)
        elapsed = int((time.monotonic() - started) * 1000)
        return FetchResult(
            url=page.url, ok=ok, status=status, html=html, fetch_ms=elapsed,
            engine="playwright_stealth" if stealth else "playwright",
            tier=3 if stealth else 2,
            blocked=blocked,
            confidence_hint=0.92 if ok else (0.25 if blocked else 0.45),
            error=None if ok else f"status={status}, blocked={blocked}",
        )
    except Exception as e:                                           # noqa: BLE001
        return FetchResult(
            url=url, ok=False, status=0, fetch_ms=int((time.monotonic() - started) * 1000),
            engine="playwright_stealth" if stealth else "playwright",
            tier=3 if stealth else 2, blocked=False, confidence_hint=0.0,
            error=f"{type(e).__name__}: {e!s}",
        )
    finally:
        try:
            if page is not None:
                await page.close()
        except Exception:
            pass
        try:
            if ctx is not None:
                await ctx.close()
        except Exception:
            pass


async def _route_filter(route: Any) -> None:
    """Block heavy resources (images/media/fonts) to speed up Playwright fetches."""
    if route.request.resource_type in ("image", "media", "font", "stylesheet"):
        try:
            await route.abort()
            return
        except Exception:
            pass
    try:
        await route.continue_()
    except Exception:
        pass


async def fetch(url: str, *, user_agent: str, timeout_s: float = 25.0) -> FetchResult:
    return await _fetch_inner(url, stealth=False, user_agent=user_agent,
                              timeout_s=timeout_s, wait_until="domcontentloaded")
