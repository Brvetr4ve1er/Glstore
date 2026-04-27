"""
Batolis extractor — research confidence 75-80 (DZ retailer, structured HTML).

Standard WooCommerce theme. Generic extractor catches it, but we override to
respect their specific spec table format and stronger price selectors.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from api.services.scraper.extractors import generic
from api.services.scraper.types import ExtractedData
from api.services.scraper.validators.normalization import parse_price


def extract(html: str, url: str) -> ExtractedData:
    base = generic.extract(html, url)
    soup = BeautifulSoup(html, "lxml")

    # WooCommerce price selectors — robust if the theme changes header markup
    if not base.has_price():
        for sel in (
            ".woocommerce-Price-amount bdi",
            ".woocommerce-Price-amount",
            "p.price ins",                   # discounted price
            "p.price",
        ):
            el = soup.select_one(sel)
            if el:
                p, c = parse_price(el.get_text(" ", strip=True))
                if p:
                    base.price = p
                    base.currency = c
                    base.method = "domain_specific"
                    break

    # WooCommerce attribute table
    for tr in soup.select(".woocommerce-product-attributes tr, .shop_attributes tr"):
        label = tr.find("th")
        value = tr.find("td")
        if label and value:
            k = label.get_text(strip=True).lower().replace(" ", "_")[:50]
            v = value.get_text(strip=True)[:200]
            if k and v and k not in base.specs:
                base.specs[k] = v

    if base.has_price():
        base.confidence = max(base.confidence, 0.85)
        base.notes.append("source:batolis_woocommerce")
    return base
