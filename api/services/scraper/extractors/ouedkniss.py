"""
Ouedkniss extractor — research confidence 50, treat results as floor signal.

Ouedkniss is JS-heavy (Vue + GraphQL). When we hit it via Tier 3
(Playwright + stealth + networkidle), the rendered HTML usually has:
  - a price in `.price` or `[class*="price"]` with format "89.900 DA"
  - listing title in `<h1>` or `[class*="announcement-title"]`
  - main image as the first `<img>` inside the gallery

We dampen the confidence further (×0.85) because individual classified
listings can be promos / typos / stale — this is intentional per research.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from api.services.scraper.extractors import generic
from api.services.scraper.types import ExtractedData
from api.services.scraper.validators.normalization import parse_price


_PRICE_OK_RE = re.compile(r"\d{2,}[\s.,]\d{3}")  # rough sanity: looks like a real price


def extract(html: str, url: str) -> ExtractedData:
    base = generic.extract(html, url)
    soup = BeautifulSoup(html, "lxml")

    # Ouedkniss-specific hooks (subject to drift — wrap in best-effort try)
    if not base.title:
        h = soup.find("h1")
        if h:
            base.title = h.get_text(strip=True)[:300]

    # Price refinement — trust DOM over generic CSS heuristics
    for sel in (
        '[class*="o-announ-price"]',
        '[class*="price"]',
        ".price",
    ):
        for el in soup.select(sel):
            text = el.get_text(" ", strip=True)
            if not _PRICE_OK_RE.search(text):
                continue
            p, c = parse_price(text)
            if p:
                base.price = p
                base.currency = c
                base.method = "domain_specific"
                break
        if base.price:
            break

    # Always damp confidence on classifieds — research-flagged
    base.confidence = round(base.confidence * 0.85, 3)
    base.notes.append("source:ouedkniss_classified_dampened")

    # Availability is rarely meaningful on classifieds; mark unknown unless we
    # see explicit "vendu" / "sold" text.
    body = soup.body.get_text(" ", strip=True).lower() if soup.body else ""
    if "vendu" in body or "sold" in body:
        base.availability = "out_of_stock"

    return base
