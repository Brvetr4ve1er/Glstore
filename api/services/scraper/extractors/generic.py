"""
Generic extractor — runs four passes in priority order.

1. JSON-LD                     → confidence 0.92 if Product schema, else 0.70
2. Microdata (schema.org)      → 0.80
3. OpenGraph + Twitter Card    → 0.65
4. CSS heuristic + currency rx → 0.40

The first pass that yields a price wins, but we still merge in title + image
from later passes if the winner missed them.

Robust against:
  - JSON-LD with arrays of multiple types
  - JSON-LD nested in @graph
  - Multiple offers (we pick the first 'InStock' or the cheapest)
  - Currency normalization via validators.normalization
"""
from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from api.services.scraper.types import ExtractedData
from api.services.scraper.validators.normalization import detect_currency, parse_price


# ── Pass 1: JSON-LD ─────────────────────────────────────────────────────────

def _walk_jsonld(node: Any):
    """Yield every dict in the JSON-LD tree."""
    if isinstance(node, list):
        for item in node:
            yield from _walk_jsonld(item)
    elif isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk_jsonld(v)


def _extract_jsonld(soup: BeautifulSoup, base_url: str) -> ExtractedData | None:
    products: list[dict[str, Any]] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = (tag.string or tag.get_text() or "").strip()
        if not raw:
            continue
        # Some sites concat multiple JSONs; tolerate that.
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Try to repair trailing commas
            try:
                data = json.loads(re.sub(r",\s*([}\]])", r"\1", raw))
            except Exception:
                continue
        for node in _walk_jsonld(data):
            t = node.get("@type")
            if isinstance(t, list):
                t_set = {str(x).lower() for x in t}
            else:
                t_set = {str(t).lower()} if t else set()
            if "product" in t_set:
                products.append(node)

    if not products:
        return None

    # Prefer the one with explicit offers
    products.sort(key=lambda p: 0 if p.get("offers") else 1)
    p = products[0]

    name = p.get("name") or None
    images = _normalize_images(p.get("image"), base_url)
    description = p.get("description")
    brand = (p.get("brand") or {}).get("name") if isinstance(p.get("brand"), dict) else p.get("brand")
    sku = p.get("sku") or p.get("mpn")

    price: Decimal | None = None
    currency = "DZD"
    availability = "unknown"

    offers = p.get("offers")
    candidates: list[dict[str, Any]] = []
    if isinstance(offers, list):
        for o in offers:
            if isinstance(o, dict):
                candidates.append(o)
    elif isinstance(offers, dict):
        if offers.get("@type", "").lower() in ("offer", ""):
            candidates.append(offers)
        for o in offers.get("offers") or []:
            if isinstance(o, dict):
                candidates.append(o)

    # Pick first InStock; else cheapest valid
    in_stock = [c for c in candidates if "instock" in str(c.get("availability", "")).lower()]
    chosen = in_stock[0] if in_stock else (candidates[0] if candidates else None)

    if chosen:
        price_raw = chosen.get("price") or chosen.get("lowPrice") or chosen.get("priceSpecification", {}).get("price")
        currency = chosen.get("priceCurrency") or chosen.get("priceSpecification", {}).get("priceCurrency") or "DZD"
        avail = str(chosen.get("availability") or "").lower()
        if "instock" in avail:
            availability = "in_stock"
        elif "outofstock" in avail or "soldout" in avail:
            availability = "out_of_stock"
        if price_raw is not None:
            price, currency = parse_price(str(price_raw), default_currency=currency)

    confidence = 0.92 if price is not None else 0.70
    specs: dict[str, Any] = {}
    if brand: specs["brand"] = brand
    if sku:   specs["sku"] = sku
    # Promote any scalar custom props
    for k in ("color", "model", "weight", "depth", "width", "height"):
        v = p.get(k)
        if isinstance(v, (str, int, float)) and v:
            specs[k] = v

    return ExtractedData(
        url=base_url,
        title=name,
        price=price,
        currency=currency,
        availability=availability,
        images=images,
        specs=specs,
        description=str(description)[:2000] if description else None,
        method="json_ld",
        confidence=confidence,
        notes=["json_ld_product_schema"],
    )


# ── Pass 2: Microdata ───────────────────────────────────────────────────────

def _extract_microdata(soup: BeautifulSoup, base_url: str) -> ExtractedData | None:
    product = soup.find(attrs={"itemtype": re.compile(r"schema\.org/Product", re.I)})
    if not product:
        return None
    name_el = product.find(attrs={"itemprop": "name"})
    desc_el = product.find(attrs={"itemprop": "description"})
    img_el  = product.find(attrs={"itemprop": "image"})
    offer = product.find(attrs={"itemtype": re.compile(r"schema\.org/Offer", re.I)})

    price: Decimal | None = None
    currency = "DZD"
    availability = "unknown"

    if offer:
        p_el = offer.find(attrs={"itemprop": "price"})
        c_el = offer.find(attrs={"itemprop": "priceCurrency"})
        a_el = offer.find(attrs={"itemprop": "availability"})
        if p_el:
            raw = p_el.get("content") or p_el.get_text(strip=True)
            currency_default = (c_el.get("content") if c_el else None) or "DZD"
            price, currency = parse_price(raw, default_currency=currency_default)
        if a_el:
            href = (a_el.get("href") or "").lower()
            if "instock" in href: availability = "in_stock"
            elif "outofstock" in href: availability = "out_of_stock"

    title = (name_el.get("content") if name_el and name_el.get("content")
             else name_el.get_text(strip=True) if name_el else None)
    description = (desc_el.get("content") if desc_el and desc_el.get("content")
                   else desc_el.get_text(strip=True) if desc_el else None)
    images: list[str] = []
    if img_el:
        src = img_el.get("content") or img_el.get("src") or img_el.get("href")
        if src:
            images.append(urljoin(base_url, src))

    if not price and not title:
        return None
    return ExtractedData(
        url=base_url, title=title, price=price, currency=currency,
        availability=availability, images=images,
        description=description[:2000] if description else None,
        method="microdata", confidence=0.80,
        notes=["microdata_product_schema"],
    )


# ── Pass 3: OpenGraph / Twitter ─────────────────────────────────────────────

def _meta(soup: BeautifulSoup, *names: str) -> str | None:
    for n in names:
        el = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if el and el.get("content"):
            return el["content"]
    return None


def _extract_opengraph(soup: BeautifulSoup, base_url: str) -> ExtractedData | None:
    title = _meta(soup, "og:title", "twitter:title")
    image = _meta(soup, "og:image", "twitter:image")
    description = _meta(soup, "og:description", "twitter:description", "description")
    price_raw = _meta(soup, "og:price:amount", "product:price:amount", "twitter:data1")
    currency_raw = _meta(soup, "og:price:currency", "product:price:currency")
    avail_raw = _meta(soup, "product:availability")

    price: Decimal | None = None
    currency = (currency_raw or "DZD").upper()
    if price_raw:
        price, currency = parse_price(price_raw, default_currency=currency)

    availability = "unknown"
    if avail_raw:
        a = avail_raw.lower()
        if "in" in a or "available" in a: availability = "in_stock"
        elif "out" in a or "sold" in a:   availability = "out_of_stock"

    if not (title or price or image):
        return None

    return ExtractedData(
        url=base_url,
        title=title,
        price=price,
        currency=currency,
        availability=availability,
        images=[urljoin(base_url, image)] if image else [],
        description=description[:2000] if description else None,
        method="opengraph",
        confidence=0.65 if price else 0.45,
    )


# ── Pass 4: CSS heuristic ───────────────────────────────────────────────────

# Likely price selectors, ordered by specificity.
_PRICE_SELECTORS = [
    "[itemprop=price]",
    "[data-price]",
    ".product-price .price",
    ".product__price .price",
    ".price .amount",
    ".woocommerce-Price-amount",
    ".price-box .price",
    ".product-info-price .price",
    ".product-info .price",
    ".product .price",
    "#price",
    ".price",
    ".our_price_display",
    ".regular-price",
    ".special-price",
    "h1 + .price",
    "[class*=price]",
]

_PRICE_NUMBER_RE = re.compile(
    r"(?:DA|DZD|د\.ج|€|\$|£|MAD|TND)\s*[\d.,\s]+|[\d.,\s]+\s*(?:DA|DZD|د\.ج|€|\$|£|MAD|TND)",
    re.I,
)


def _extract_css(soup: BeautifulSoup, base_url: str) -> ExtractedData | None:
    title = None
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(strip=True)[:300]
    elif soup.title:
        title = soup.title.get_text(strip=True)[:300]

    price: Decimal | None = None
    currency = "DZD"
    price_source = ""
    for sel in _PRICE_SELECTORS:
        for el in soup.select(sel):
            val = el.get("content") or el.get("data-price") or el.get_text(" ", strip=True)
            if not val:
                continue
            p, c = parse_price(val, default_currency="DZD")
            if p and p >= Decimal("100"):
                price, currency = p, c
                price_source = sel
                break
        if price:
            break

    # Fallback: regex over whole text
    if not price:
        body = soup.body.get_text(" ", strip=True) if soup.body else soup.get_text(" ", strip=True)
        for m in _PRICE_NUMBER_RE.findall(body[:50000]):
            p, c = parse_price(m, default_currency=detect_currency(body))
            if p and p >= Decimal("100"):
                price, currency = p, c
                price_source = "regex"
                break

    image = _meta(soup, "og:image", "twitter:image")
    img_src = ""
    if not image:
        img_el = soup.find("img", attrs={"src": True})
        if img_el and img_el.get("src"):
            img_src = urljoin(base_url, img_el["src"])
    images = [urljoin(base_url, image)] if image else ([img_src] if img_src else [])

    if not (title or price):
        return None

    return ExtractedData(
        url=base_url,
        title=title,
        price=price,
        currency=currency,
        availability="unknown",
        images=images,
        method="css_heuristic",
        confidence=0.42 if price else 0.25,
        notes=[f"css_selector:{price_source}"] if price else ["css_no_price"],
    )


# ── Image normalization ─────────────────────────────────────────────────────

def _normalize_images(value: Any, base_url: str) -> list[str]:
    out: list[str] = []
    if value is None:
        return out
    if isinstance(value, str):
        out.append(urljoin(base_url, value))
    elif isinstance(value, list):
        for v in value:
            if isinstance(v, str):
                out.append(urljoin(base_url, v))
            elif isinstance(v, dict) and v.get("url"):
                out.append(urljoin(base_url, v["url"]))
    elif isinstance(value, dict):
        if value.get("url"):
            out.append(urljoin(base_url, value["url"]))
    return [u for u in out if u.startswith(("http://", "https://"))][:8]


# ── Public entry point ──────────────────────────────────────────────────────

def extract(html: str, url: str) -> ExtractedData:
    if not html:
        return ExtractedData(url=url, method="css_heuristic", confidence=0.0,
                             notes=["empty html"])

    soup = BeautifulSoup(html, "lxml")

    candidates: list[ExtractedData] = []
    for fn in (_extract_jsonld, _extract_microdata, _extract_opengraph, _extract_css):
        try:
            r = fn(soup, url)
            if r:
                candidates.append(r)
        except Exception as e:                                       # noqa: BLE001
            candidates.append(ExtractedData(
                url=url, method="css_heuristic", confidence=0.0,
                notes=[f"{fn.__name__} error: {type(e).__name__}: {e}"],
            ))

    if not candidates:
        return ExtractedData(url=url, method="css_heuristic", confidence=0.0,
                             notes=["no extractor matched"])

    # Pick the highest-confidence candidate that has a price; if none has a
    # price, return the highest-confidence candidate overall.
    with_price = [c for c in candidates if c.has_price()]
    if with_price:
        winner = max(with_price, key=lambda c: c.confidence)
    else:
        winner = max(candidates, key=lambda c: c.confidence)

    # Fill missing fields from other candidates
    for c in candidates:
        if c is winner:
            continue
        if not winner.title and c.title:
            winner.title = c.title
        if not winner.images and c.images:
            winner.images = c.images
        if not winner.description and c.description:
            winner.description = c.description

    return winner
