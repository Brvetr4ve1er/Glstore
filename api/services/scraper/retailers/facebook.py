"""
Facebook Marketplace adapter — Phase 9 Push 9-C.

⚠️ TOS CAVEAT — read this first
─────────────────────────────────
Facebook's Terms of Service prohibit scraping their pages. This adapter
DOES NOT autonomously discover or harvest FB Marketplace listings. It is
a passive helper for the case where:

    1. An admin manually copies a PUBLIC FB Marketplace URL
    2. Pastes it into the GLstore admin's product-import flow
    3. We extract whatever's available from PUBLIC OpenGraph + Twitter
       Card meta tags ONLY — no auth, no DOM walks, no API calls

This is roughly equivalent to what an unauthenticated `curl` of the
URL returns, which Facebook itself serves to social-media-preview
scrapers (Slack, WhatsApp link previews, etc.). Pages that require
auth — most marketplace listings — return only the generic "Log in
to Facebook" page; this adapter then returns an empty result and
the engine falls through to the generic cascade (which will also
fail), and the admin sees "couldn't extract — please add manually."

What we DON'T do:
    · Stealth or anti-bot evasion against FB
    · Headless browser DOM walks of authenticated views
    · Any FB Graph API / business API integration
    · Scheduled crawls

What we DO do:
    · Parse `<meta property="og:title|description|image|price:amount">`
    · Parse `<meta name="twitter:title|description|image">`
    · Detect "log-in wall" pages and return is_empty() so the engine
      knows we got nothing useful
    · Surface `source_metadata.note` so the admin sees this is a
      best-effort extraction

Confidence: 0.55 — never higher, because we can't verify the data
without auth. The LLM merge step + admin Image Review queue act as
the human-in-the-loop quality gate.
"""
from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.services.scraper.retailers.base import AdapterResult, RetailerAdapter
from api.services.scraper.retailers.images import extract_images

log = logging.getLogger("glstore.scraper.facebook")


# ── Domain matchers ──────────────────────────────────────────────────────
#
# Marketplace listings live under multiple host variants:
#   www.facebook.com/marketplace/item/<id>
#   m.facebook.com/marketplace/item/<id>
#   web.facebook.com/marketplace/item/<id>
#   facebook.com/share/<short-id>     (mobile share links resolve here)

_DOMAIN_PATTERNS = [
    re.compile(
        r"https?://(?:www\.|m\.|web\.|mbasic\.)?facebook\.com/marketplace/",
        re.IGNORECASE,
    ),
    # Short share URLs that redirect to marketplace items
    re.compile(
        r"https?://(?:www\.)?facebook\.com/share/[A-Za-z0-9]{8,}/?",
        re.IGNORECASE,
    ),
]


# ── Login-wall detection ─────────────────────────────────────────────────
#
# Facebook serves a wide-open log-in page to unauthenticated requests
# for most marketplace items. Detect the giveaway markers and return
# empty rather than waste downstream LLM tokens trying to extract a
# product from "Log into Facebook to start sharing and connecting…"

_LOGIN_WALL_MARKERS = (
    "log into facebook",
    "se connecter à facebook",
    "facebook helps you connect",
    "you must log in",
    "you must log in to continue",
    "you need to log in or sign up",
)


def _is_login_wall(html: str, soup: BeautifulSoup) -> bool:
    """True if the fetched HTML is FB's generic auth-required page."""
    # The marketplace item content lives inside <meta property="og:type"
    # content="product"> when public. The login wall serves a generic
    # og:type or no og:type at all, plus a giant <noscript> with login
    # copy.
    og_type_tag = soup.find("meta", attrs={"property": "og:type"})
    if isinstance(og_type_tag, Tag):
        content = og_type_tag.get("content") or ""
        if isinstance(content, list):
            content = " ".join(content)
        if isinstance(content, str) and content.strip() in ("product", "product.item"):
            return False    # legit public marketplace item

    body_lower = (html[:8000] or "").lower()
    return any(marker in body_lower for marker in _LOGIN_WALL_MARKERS)


# ── Price parsing ────────────────────────────────────────────────────────
#
# FB serves price in <meta property="og:price:amount" content="21900">
# and <meta property="og:price:currency" content="DZD">. We accept any
# 3-letter currency code; if it's not DZD we still capture and convert
# downstream (the LLM merge can normalise).

_NUMERIC_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def _parse_meta_price(amount: str | None) -> Decimal | None:
    if not amount:
        return None
    m = _NUMERIC_RE.search(amount)
    if not m:
        return None
    raw = m.group(0).replace(",", ".")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


# ── Adapter ──────────────────────────────────────────────────────────────

class FacebookMarketplaceAdapter(RetailerAdapter):
    name             = "facebook_marketplace"
    domain_patterns  = _DOMAIN_PATTERNS
    requires_login   = True       # documents the constraint; engine doesn't auto-handle
    requires_stealth = False      # no point — FB blocks bot signals at TLS+behavioural level
    min_html_size    = 1024

    async def extract(self, html: str, url: str) -> AdapterResult:
        if not html or len(html) < self.min_html_size:
            return AdapterResult()

        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:                                       # noqa: BLE001
            soup = BeautifulSoup(html, "html.parser")

        # Reject the login wall up front — saves the engine from feeding
        # generic-FB-copy into the LLM extraction pass.
        if _is_login_wall(html, soup):
            log.info(
                "FB Marketplace returned login wall — needs manual entry",
                extra={"url": url[:120], "event": "scraper.facebook.login_wall"},
            )
            r = AdapterResult()
            r.source_metadata["note"] = "facebook_login_wall"
            r.source_metadata["source"] = "facebook_marketplace"
            return r

        # OpenGraph is the canonical public surface FB exposes for social
        # sharing. Helper to fetch a property by name.
        def _og(prop: str) -> str | None:
            tag = soup.find("meta", attrs={"property": prop})
            if not isinstance(tag, Tag):
                tag = soup.find("meta", attrs={"name": prop})    # fallback
            if not isinstance(tag, Tag):
                return None
            content = tag.get("content")
            if isinstance(content, list):
                content = content[0] if content else None
            if isinstance(content, str):
                content = content.strip()
                return content or None
            return None

        # Title preference: og:title > twitter:title > <title>
        title = _og("og:title") or _og("twitter:title")
        if not title:
            t = soup.find("title")
            if isinstance(t, Tag):
                title = t.get_text(strip=True)

        description = _og("og:description") or _og("twitter:description")

        # Price — only present on actual marketplace items, not ads.
        price = _parse_meta_price(_og("og:price:amount") or _og("product:price:amount"))
        currency = (_og("og:price:currency") or _og("product:price:currency") or "DZD").upper()

        # FB regional sites give us a hint about the listing's locale —
        # not directly useful for the catalog, but we surface for audit.
        locale = _og("og:locale") or "unknown"

        result = AdapterResult(
            name=title,
            description=description,
            price_dzd=price if currency == "DZD" else None,
            price_label=f"{price} {currency}" if price else None,
            currency=currency,
            confidence=0.55,        # capped — we can't verify without auth
        )

        # Multi-source image extractor handles og:image, twitter:image,
        # any inline <img> the unauth response leaks, etc.
        result.images = extract_images(html, url, limit=10)

        result.source_metadata["source"] = "facebook_marketplace"
        result.source_metadata["locale"] = locale
        result.source_metadata["extraction_tier"] = "og_meta_only"
        result.source_metadata["note"] = (
            "best-effort extraction from public OpenGraph tags — "
            "FB ToS forbids deeper scraping; verify manually before publish"
        )

        if currency != "DZD":
            result.source_metadata["price_currency_unconverted"] = currency

        return result
