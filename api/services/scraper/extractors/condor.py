"""
Condor extractor — research confidence 90 (manufacturer official).

Condor.dz is a static HTML vitrine with very stable selectors. They publish
official MSRP rather than retail, but it's the most reliable anchor in the
Algerian market. Cache aggressively (24h).
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from api.services.scraper.extractors import generic
from api.services.scraper.types import ExtractedData


def extract(html: str, url: str) -> ExtractedData:
    base = generic.extract(html, url)
    soup = BeautifulSoup(html, "lxml")

    # Condor-specific spec table — they use "fiche-technique" sections
    for spec_block in soup.select(".fiche-technique tr, .product-specs tr, .specs tr"):
        cells = spec_block.find_all(["th", "td"])
        if len(cells) == 2:
            k = cells[0].get_text(strip=True).lower().replace(" ", "_")[:50]
            v = cells[1].get_text(strip=True)[:200]
            if k and v and k not in base.specs:
                base.specs[k] = v

    if base.has_price():
        base.method = "domain_specific" if base.method != "json_ld" else base.method
        base.confidence = max(base.confidence, 0.95)  # official source
        base.notes.append("source:condor_official")
    elif base.title:
        # No price published is normal for Condor — they're a manufacturer page.
        base.notes.append("condor_no_msrp_published")
    return base
