"""
Jumia DZ extractor — research confidence 75-80.

Magento storefront. Server-side renders prices most of the time. Has clean
JSON-LD on PDPs that the generic extractor would already catch — we still
override to:
  - tighten the title (trim "| Jumia Algerie" suffix)
  - normalize the image URL (remove ?_v=1 query that breaks caching)
  - read the structured spec table that JSON-LD doesn't include
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from api.services.scraper.extractors import generic
from api.services.scraper.types import ExtractedData


_TITLE_SUFFIX_RE = re.compile(r"\s*[\|–-]\s*Jumia\s*Alg[eé]rie?\s*$", re.I)


def _strip_suffix(t: str | None) -> str | None:
    if not t:
        return t
    return _TITLE_SUFFIX_RE.sub("", t).strip()


def extract(html: str, url: str) -> ExtractedData:
    base = generic.extract(html, url)

    soup = BeautifulSoup(html, "lxml")
    base.title = _strip_suffix(base.title)

    # Spec table (Jumia uses .-pvxs.-mvs in product specs section)
    specs_added = 0
    for table in soup.select("table.-spec, .product-features table, .product-specs table"):
        for tr in table.select("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) == 2:
                key = cells[0].get_text(strip=True).lower().replace(" ", "_")[:50]
                val = cells[1].get_text(strip=True)[:200]
                if key and val and key not in base.specs:
                    base.specs[key] = val
                    specs_added += 1

    # Bullet specs are often in a list under .markup--list
    if not specs_added:
        for li in soup.select(".markup--list li, .features li"):
            text = li.get_text(strip=True)
            if 4 < len(text) < 200 and ":" in text:
                k, _, v = text.partition(":")
                key = k.strip().lower().replace(" ", "_")[:50]
                if key and v and key not in base.specs:
                    base.specs[key] = v.strip()[:200]

    if specs_added:
        base.notes.append(f"jumia_specs_table:+{specs_added}")
        base.method = "domain_specific"
        base.confidence = max(base.confidence, 0.88)
    elif base.has_price():
        base.method = "domain_specific" if base.method == "json_ld" else base.method
        base.confidence = max(base.confidence, 0.85)

    return base
