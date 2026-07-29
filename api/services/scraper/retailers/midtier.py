"""
Mid-tier DZ retailer bundle — Phase 9 Push 9-E.

Several smaller Algerian retailers share a common Magento/PrestaShop/
WooCommerce-flavoured layout: standard JSON-LD `Product`, predictable
CSS selectors, occasional anti-bot but rarely Cloudflare Enterprise.
Building one adapter per retailer is overkill — the per-retailer wins
are marginal, but losing the brand/category dimension matters.

Strategy: ONE adapter, multiple domain patterns. The adapter detects
which retailer the URL belongs to via a regex prefix table and uses
that to:
    · Set `source_metadata.retailer` so audit can group results
    · Apply per-retailer CSS-selector overrides where their sites
      diverge from the standard layout

Retailers in scope:
    · carrefour.dz       — DZ branch of the French hypermarket
    · yassirmall.com     — Yassir's marketplace storefront
    · cosmos.dz          — DZ electronics chain
    · numidis.com        — DZ retail group + Tighri marketplace

Confidence:
    · JSON-LD path:  0.88
    · CSS path:      0.62
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

log = logging.getLogger("glstore.scraper.midtier")


# ── Domain matchers ──────────────────────────────────────────────────────
#
# `_RETAILER_TABLE` maps short slug → compiled regex. The same regexes
# get exposed via `domain_patterns` for the classifier; the slug lets us
# tag `source_metadata.retailer` per match.

_RETAILER_TABLE: list[tuple[str, re.Pattern[str]]] = [
    ("carrefour_dz", re.compile(r"https?://(?:www\.)?carrefour\.dz/",   re.IGNORECASE)),
    ("yassir_mall",  re.compile(r"https?://(?:www\.)?yassirmall\.com/", re.IGNORECASE)),
    ("cosmos_dz",    re.compile(r"https?://(?:www\.)?cosmos\.dz/",      re.IGNORECASE)),
    ("numidis",      re.compile(r"https?://(?:www\.)?numidis\.com/",    re.IGNORECASE)),
]

_DOMAIN_PATTERNS = [pattern for _, pattern in _RETAILER_TABLE]


def _which_retailer(url: str) -> str | None:
    """Returns the slug of the matching retailer, or None. Used to tag
    every result so the audit trail can filter by source."""
    for slug, pattern in _RETAILER_TABLE:
        if pattern.search(url):
            return slug
    return None


# ── Price parsing ────────────────────────────────────────────────────────

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
    mpn = node.get("mpn") if isinstance(node.get("mpn"), str) else None

    brand: str | None = None
    b = node.get("brand")
    if isinstance(b, dict):
        brand = b.get("name") or b.get("@id")
    elif isinstance(b, str):
        brand = b

    category: str | None = None
    cat = node.get("category")
    if isinstance(cat, str):
        category = cat
    elif isinstance(cat, dict):
        category = cat.get("name")

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

    return AdapterResult(
        name=name,
        brand=brand,
        model=mpn,
        category=category,
        description=desc,
        price_dzd=price_dzd,
        in_stock=in_stock,
        confidence=0.88,
    )


# ── CSS heuristic pass ───────────────────────────────────────────────────

# Common selectors across PrestaShop / Magento / WooCommerce stores.
# Listed in order of preference within each category.
_PRICE_SELECTORS = (
    "[itemprop=price]",
    "span.current-price",
    "span.price-amount",
    ".product-price .price",
    ".price-current",
    ".price",
    "span[data-price]",
)
_BRAND_SELECTORS = (
    "[itemprop=brand]",
    ".product-manufacturer",
    "a.product-brand",
    ".brand-name",
)
_DESC_SELECTORS = (
    "[itemprop=description]",
    ".product-description",
    "#description",
    "div.tab-content #description",
)


def _from_css(soup: BeautifulSoup) -> AdapterResult:
    out = AdapterResult(confidence=0.62)

    h1 = soup.find("h1")
    if isinstance(h1, Tag):
        title = h1.get_text(strip=True)
        if title and len(title) > 2:
            out.name = title

    for sel in _PRICE_SELECTORS:
        for tag in soup.select(sel):
            if not isinstance(tag, Tag):
                continue
            # `[itemprop=price]` typically carries the value in the
            # `content=` attribute (Schema.org microdata convention).
            # Prefer that — concatenating with text would double-count
            # ("content=155000" + visible "155 000 DA" → 155000155000).
            attr_price = tag.get("content")
            if isinstance(attr_price, list):
                attr_price = attr_price[0] if attr_price else ""
            candidate_text = attr_price if (attr_price and isinstance(attr_price, str) and attr_price.strip())\
                else tag.get_text(" ", strip=True)
            price = _parse_dzd(candidate_text)
            if price is not None and price > 0:
                out.price_dzd = price
                break
        if out.price_dzd is not None:
            break

    for sel in _BRAND_SELECTORS:
        for tag in soup.select(sel):
            if not isinstance(tag, Tag):
                continue
            attr = tag.get("content")
            if isinstance(attr, list):
                attr = attr[0] if attr else ""
            txt = (attr or "") or tag.get_text(strip=True)
            if txt and len(txt) < 60:
                out.brand = txt
                break
        if out.brand:
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

    # Spec tables — same heuristic as Condor adapter.
    for table in soup.select(
        "table.product-features, table.specifications, table.spec-table, "
        "dl.product-features, ul.product-features"
    ):
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
                    k, v = dt.get_text(strip=True), dd.get_text(strip=True)
                    if k and v:
                        out.raw_specs[k] = v
        elif table.name == "ul":
            for li in table.find_all("li"):
                if not isinstance(li, Tag):
                    continue
                # PrestaShop pattern: <li><span class=name>K</span><span class=value>V</span>
                spans = li.find_all("span")
                if len(spans) >= 2:
                    k = spans[0].get_text(strip=True)
                    v = spans[-1].get_text(strip=True)
                    if k and v and k != v:
                        out.raw_specs[k] = v

    return out


# ── Adapter ──────────────────────────────────────────────────────────────

class MidTierDZAdapter(RetailerAdapter):
    name             = "midtier_dz"
    domain_patterns  = _DOMAIN_PATTERNS
    # Some mid-tier DZ retailers have light Cloudflare; not blanket
    # required, but the engine's auto-escalation kicks in if T1 fails.
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

        ld = _extract_product_json_ld(soup)
        if ld is not None:
            result = _from_json_ld(ld)
            won_by = "json-ld"

        css = _from_css(soup)
        result.merge_from(css)
        if won_by is None and not css.is_empty():
            result.confidence = css.confidence
            won_by = "css"

        result.images = extract_images(html, url, limit=15)
        result.currency = "DZD"

        retailer_slug = _which_retailer(url) or "midtier_unknown"
        result.source_metadata["source"] = retailer_slug
        if won_by:
            result.source_metadata["extraction_tier"] = won_by

        return result
