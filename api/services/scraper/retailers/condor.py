"""
Condor.dz adapter — Phase 9 Push 9-D.

Condor is the largest Algerian electronics manufacturer (TVs, fridges,
ACs, mobiles, kitchen). Their .dz storefront is the canonical source
for own-brand products — so an adapter here unlocks high-fidelity data
for every Condor SKU we sell.

Why this is the simplest adapter:
    · Single-tenant brand store → every product IS Condor-branded
      (we can autoset `brand="Condor"` on every result)
    · Standard PHP/Magento-style PDP layout → reliable CSS selectors
    · Clean JSON-LD `Product` schema on most product pages
    · No anti-bot, no Cloudflare → no stealth needed
    · Static HTML → fetcher tier 1 (httpx) is enough

Two-tier cascade (no NUXT layer because Condor isn't a SPA):

    1. JSON-LD `Product` schema (~0.92)
    2. CSS heuristic — h1, .price, .product-description, .specifications
       table (~0.65)

Confidence is calibrated higher than Ouedkniss-CSS because Condor's
HTML is far more stable + less user-generated noise.

Image extraction reuses the shared multi-source utility — Condor's
PDPs use `<picture><source srcset>` for AVIF/WebP fallbacks plus
plain `<img srcset>` for the gallery thumbs.
"""
from __future__ import annotations

import json
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.services.scraper.retailers.base import AdapterResult, RetailerAdapter
from api.services.scraper.retailers.images import extract_images

log = logging.getLogger("glstore.scraper.condor")


_DOMAIN_PATTERNS = [
    re.compile(
        r"https?://(?:www\.)?condor\.dz/",
        re.IGNORECASE,
    ),
]


# ── Price parsing — Condor uses "21,900.00 DA" or "21 900 DA" ────────────

_PRICE_RE = re.compile(r"(\d[\d\s .,]*)")


def _parse_dzd(text: str | None) -> Decimal | None:
    if not text:
        return None
    label = text.replace(" ", " ").replace(" ", " ")
    m = _PRICE_RE.search(label)
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(1))
    if not digits:
        return None
    try:
        return Decimal(digits)
    except InvalidOperation:
        return None


# ── JSON-LD pass ─────────────────────────────────────────────────────────

def _extract_product_json_ld(soup: BeautifulSoup) -> dict[str, Any] | None:
    for script in soup.find_all("script", type="application/ld+json"):
        if not isinstance(script, Tag):
            continue
        try:
            txt = script.string or script.get_text(strip=True)
            payload = json.loads(txt) if txt else None
        except (json.JSONDecodeError, TypeError):
            continue
        if not payload:
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        for c in candidates:
            if not isinstance(c, dict):
                continue
            graph = c.get("@graph") if "@graph" in c else [c]
            if not isinstance(graph, list):
                graph = [c]
            for node in graph:
                if not isinstance(node, dict):
                    continue
                t = node.get("@type", "")
                types = t if isinstance(t, list) else [t]
                if any(s == "Product" for s in types):
                    return node
    return None


def _from_json_ld(node: dict[str, Any]) -> AdapterResult:
    name = node.get("name") if isinstance(node.get("name"), str) else None
    desc = node.get("description") if isinstance(node.get("description"), str) else None
    sku = node.get("sku") if isinstance(node.get("sku"), str) else None
    mpn = node.get("mpn") if isinstance(node.get("mpn"), str) else None

    price_dzd: Decimal | None = None
    in_stock: bool | None = None
    offers = node.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if isinstance(offers, dict):
        p = offers.get("price")
        if p is not None:
            try:
                price_dzd = Decimal(str(p))
            except (InvalidOperation, ValueError):
                pass
        avail = offers.get("availability") or ""
        if isinstance(avail, str):
            if "InStock" in avail:
                in_stock = True
            elif "OutOfStock" in avail or "SoldOut" in avail:
                in_stock = False

    raw_specs: dict[str, Any] = {}
    if mpn:
        raw_specs["model"] = mpn
    if sku:
        raw_specs["sku"] = sku

    return AdapterResult(
        name=name,
        brand="Condor",      # single-tenant brand store
        model=mpn,
        description=desc,
        price_dzd=price_dzd,
        in_stock=in_stock,
        raw_specs=raw_specs,
        confidence=0.92,
    )


# ── CSS heuristic pass ───────────────────────────────────────────────────

_PRICE_SELECTORS = (
    ".price-current", ".product-price", ".price",
    "[itemprop=price]", "span[data-price]",
)
_DESC_SELECTORS = (
    "[itemprop=description]", ".product-description",
    ".description", "#description",
)


def _from_css(soup: BeautifulSoup) -> AdapterResult:
    out = AdapterResult(brand="Condor", confidence=0.65)

    h1 = soup.find("h1")
    if isinstance(h1, Tag):
        title = h1.get_text(strip=True)
        if title and len(title) > 2:
            out.name = title

    for sel in _PRICE_SELECTORS:
        for tag in soup.select(sel):
            if not isinstance(tag, Tag):
                continue
            txt = tag.get_text(" ", strip=True)
            price = _parse_dzd(txt)
            if price is not None and price > 0:
                out.price_dzd = price
                break
        if out.price_dzd is not None:
            break

    for sel in _DESC_SELECTORS:
        for tag in soup.select(sel):
            if not isinstance(tag, Tag):
                continue
            txt = tag.get_text(" ", strip=True)
            if 30 < len(txt) < 4000:
                out.description = txt
                break
        if out.description:
            break

    # Spec tables — Condor PDPs commonly have <table class="specifications">
    # or <dl class="product-attributes"> dt/dd pairs. Both flatten cleanly.
    for table in soup.select("table.specifications, table.product-attributes, dl.product-attributes"):
        if not isinstance(table, Tag):
            continue
        if table.name == "table":
            for row in table.find_all("tr"):
                if not isinstance(row, Tag):
                    continue
                cells = [c.get_text(strip=True) for c in row.find_all(["th", "td"]) if isinstance(c, Tag)]
                if len(cells) == 2 and cells[0] and cells[1]:
                    out.raw_specs[cells[0]] = cells[1]
        elif table.name == "dl":
            dts = table.find_all("dt")
            dds = table.find_all("dd")
            for dt, dd in zip(dts, dds):
                if isinstance(dt, Tag) and isinstance(dd, Tag):
                    k = dt.get_text(strip=True)
                    v = dd.get_text(strip=True)
                    if k and v:
                        out.raw_specs[k] = v

    return out


# ── Adapter ──────────────────────────────────────────────────────────────

class CondorAdapter(RetailerAdapter):
    name             = "condor_dz"
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

        result = AdapterResult()
        won_by: str | None = None

        # Tier 1: JSON-LD
        ld = _extract_product_json_ld(soup)
        if ld is not None:
            result = _from_json_ld(ld)
            won_by = "json-ld"

        # Tier 2: CSS — fill gaps
        css = _from_css(soup)
        result.merge_from(css)
        if won_by is None and not css.is_empty():
            result.confidence = css.confidence
            won_by = "css"

        # Brand is always Condor for this store — overwrite even if
        # JSON-LD set it to something else, because vendor stores
        # sometimes ship with template-default brand strings.
        result.brand = "Condor"

        result.images = extract_images(html, url, limit=15)
        result.currency = "DZD"
        result.source_metadata["source"] = "condor_dz"
        if won_by:
            result.source_metadata["extraction_tier"] = won_by

        return result
