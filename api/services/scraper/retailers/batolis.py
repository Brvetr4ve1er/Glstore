"""
Batolis.com adapter — Phase 9 (extractor migration).

Migrated from api/services/scraper/extractors/batolis.py to the RetailerAdapter
framework so the engine has one unified extraction path for all DZ retailers.

Batolis runs a standard WooCommerce theme. The generic extractor catches most
fields via JSON-LD; this adapter adds WooCommerce-specific improvements:
  - Price: reads .woocommerce-Price-amount (more reliable than generic selectors)
  - Spec table: reads .woocommerce-product-attributes / .shop_attributes
  - Confidence bump after domain-specific extraction

requires_stealth = False: WooCommerce serves clean static HTML on tier 1.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.services.scraper.retailers.base import AdapterResult, RetailerAdapter
from api.services.scraper.retailers.images import extract_images

_DOMAIN_PATTERNS = [
    re.compile(r"https?://(?:www\.)?batolis\.com/", re.IGNORECASE),
]


class BatolisAdapter(RetailerAdapter):
    name             = "batolis_com"
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

        result = AdapterResult(confidence=0.70)

        # ── Title ─────────────────────────────────────────────
        h1 = soup.find("h1")
        if isinstance(h1, Tag):
            t = h1.get_text(strip=True)
            if t:
                result.name = t

        # ── Price: WooCommerce selectors ───────────────────────
        from api.services.scraper.validators.normalization import parse_price
        for sel in (
            ".woocommerce-Price-amount bdi",
            ".woocommerce-Price-amount",
            "p.price ins",                   # sale price (shown with strikethrough)
            "p.price",
            "span.price",
        ):
            el = soup.select_one(sel)
            if isinstance(el, Tag):
                p, c = parse_price(el.get_text(" ", strip=True))
                if p and p > 0:
                    result.price_dzd = p
                    result.currency  = c or "DZD"
                    break

        # ── WooCommerce attribute / spec table ─────────────────
        for tr in soup.select(
            ".woocommerce-product-attributes tr, "
            ".shop_attributes tr"
        ):
            if not isinstance(tr, Tag):
                continue
            label = tr.find("th")
            value = tr.find("td")
            if isinstance(label, Tag) and isinstance(value, Tag):
                k = label.get_text(strip=True)[:60]
                v = value.get_text(strip=True)[:200]
                if k and v:
                    result.raw_specs.setdefault(k, v)

        # ── Stock ──────────────────────────────────────────────
        oos = soup.select_one(".out-of-stock, .stock.out-of-stock")
        in_s = soup.select_one(".in-stock, .stock.in-stock")
        if oos:
            result.in_stock = False
        elif in_s or result.price_dzd:
            result.in_stock = True

        # ── Description ────────────────────────────────────────
        for sel in ("[itemprop=description]", ".woocommerce-product-details__short-description",
                    "#tab-description", ".product-description"):
            tag = soup.select_one(sel)
            if isinstance(tag, Tag):
                txt = tag.get_text(" ", strip=True)
                if 30 < len(txt) < 4000:
                    result.description = txt
                    break

        result.confidence = 0.88 if result.raw_specs else (0.82 if result.price_dzd else 0.65)
        result.images    = extract_images(html, url, limit=15)
        result.currency  = "DZD"
        result.source_metadata["source"]          = "batolis_com"
        result.source_metadata["extraction_tier"] = "woocommerce_css"
        return result
