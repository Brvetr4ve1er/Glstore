"""
Jumia.dz adapter — Phase 9 (extractor migration).

Migrated from api/services/scraper/extractors/jumia.py to the RetailerAdapter
framework so the engine has one unified extraction path for all DZ retailers.

Jumia Algeria uses a Magento storefront with reliable server-side rendering.
The generic extractor already catches JSON-LD + OpenGraph — this adapter adds:
  - Title cleaning: strips "| Jumia Algérie" branding suffix
  - Spec-table extraction: reads the structured product-features table that
    JSON-LD omits (screen size, battery, RAM, etc.)
  - Bullet-spec extraction: fallback for stores that list specs as <li> items

Confidence: 0.88 if specs table found, 0.85 otherwise.
requires_stealth = False: Jumia DZ's Magento SSR-s cleanly on tier 1 httpx.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.services.scraper.retailers.base import AdapterResult, RetailerAdapter
from api.services.scraper.retailers.images import extract_images

_TITLE_SUFFIX_RE = re.compile(r"\s*[\|–\-]\s*Jumia\s*Alg[eé]rie?\s*$", re.I)

_DOMAIN_PATTERNS = [
    re.compile(r"https?://(?:www\.)?jumia\.dz/", re.IGNORECASE),
]


def _strip_title_suffix(title: str | None) -> str | None:
    if not title:
        return title
    return _TITLE_SUFFIX_RE.sub("", title).strip() or None


class JumiaAdapter(RetailerAdapter):
    name             = "jumia_dz"
    domain_patterns  = _DOMAIN_PATTERNS
    requires_stealth = False
    min_html_size    = 1024

    async def extract(self, html: str, url: str) -> AdapterResult:
        if not html or len(html) < self.min_html_size:
            return AdapterResult()

        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:                                       # noqa: BLE001
            soup = BeautifulSoup(html, "html.parser")

        result = AdapterResult(confidence=0.75)

        # ── Title ─────────────────────────────────────────────
        h1 = soup.find("h1")
        if isinstance(h1, Tag):
            result.name = _strip_title_suffix(h1.get_text(strip=True))

        # ── Price ──────────────────────────────────────────────
        from api.services.scraper.validators.normalization import parse_price
        for sel in (
            ".prc",                                    # Jumia React app
            ".-b.-ltr.-tal.-fs24.-prxs",               # Jumia CSS system
            "[data-price]",
            ".price-box .price",
        ):
            for el in soup.select(sel):
                if not isinstance(el, Tag):
                    continue
                # data-price attr takes priority over text
                raw = el.get("data-price") or el.get_text(" ", strip=True)
                if isinstance(raw, list):
                    raw = raw[0] if raw else ""
                p, c = parse_price(str(raw))
                if p and p > 0:
                    from decimal import Decimal
                    result.price_dzd = p
                    result.currency  = c or "DZD"
                    break
            if result.price_dzd:
                break

        # ── Specs table ────────────────────────────────────────
        specs_added = 0
        for table in soup.select(
            "table.-spec, .product-features table, "
            ".product-specs table, .-pvxs table"
        ):
            if not isinstance(table, Tag):
                continue
            for tr in table.select("tr"):
                cells = tr.find_all(["th", "td"])
                if len(cells) == 2:
                    k = cells[0].get_text(strip=True)[:60]
                    v = cells[1].get_text(strip=True)[:200]
                    if k and v:
                        result.raw_specs[k] = v
                        specs_added += 1

        # ── Bullet specs fallback ──────────────────────────────
        if not specs_added:
            for li in soup.select(".markup--list li, .features li"):
                if not isinstance(li, Tag):
                    continue
                text = li.get_text(strip=True)
                if 4 < len(text) < 200 and ":" in text:
                    k, _, v = text.partition(":")
                    k = k.strip()[:60]
                    v = v.strip()[:200]
                    if k and v:
                        result.raw_specs.setdefault(k, v)

        # ── Description ────────────────────────────────────────
        for sel in ("[itemprop=description]", ".product-description",
                    "#description", ".about-product"):
            tag = soup.select_one(sel)
            if isinstance(tag, Tag):
                txt = tag.get_text(" ", strip=True)
                if 30 < len(txt) < 4000:
                    result.description = txt
                    break

        # ── Stock ──────────────────────────────────────────────
        oos = soup.select_one(".-ofs-d > .-ofs, [class*=out-of-stock]")
        if oos:
            result.in_stock = False
        elif result.price_dzd:
            result.in_stock = True

        result.confidence = 0.88 if result.raw_specs else (0.85 if result.price_dzd else 0.65)
        result.images    = extract_images(html, url, limit=15)
        result.currency  = "DZD"
        result.source_metadata["source"]           = "jumia_dz"
        result.source_metadata["extraction_tier"]  = "css"
        return result
