"""
Extractor registry — maps a domain (or a substring of) to the extractor.

Resolution:
    pick_extractor(url) → callable(html, url) -> ExtractedData

Order of priority:
    1. Exact domain match in DOMAIN_REGISTRY
    2. Substring match in DOMAIN_REGISTRY  (so 'jumia.dz' wins for 'jumia.dz/foo')
    3. Generic fallback (JSON-LD → microdata → OpenGraph → CSS heuristic)

Adding a new extractor: implement `extract(html, url) -> ExtractedData` in a
new module under this package and register the mapping below.
"""
from __future__ import annotations

from typing import Callable

from api.services.scraper.extractors import generic
from api.services.scraper.extractors import jumia
from api.services.scraper.extractors import ouedkniss
from api.services.scraper.extractors import condor
from api.services.scraper.extractors import batolis
from api.services.scraper.types import ExtractedData
from api.services.scraper.utils.domain import host_of

ExtractFn = Callable[[str, str], ExtractedData]


DOMAIN_REGISTRY: dict[str, ExtractFn] = {
    "jumia.dz":          jumia.extract,
    "ouedkniss.com":     ouedkniss.extract,
    "condor.dz":         condor.extract,
    "batolis.com":       batolis.extract,
}


def pick_extractor(url: str) -> ExtractFn:
    host = host_of(url)
    if host in DOMAIN_REGISTRY:
        return DOMAIN_REGISTRY[host]
    for pattern, fn in DOMAIN_REGISTRY.items():
        if pattern in host:
            return fn
    return generic.extract


def extract(html: str, url: str) -> ExtractedData:
    """Single entry point used by the engine. Catches extractor errors so a
    broken parser never breaks the whole job."""
    extractor = pick_extractor(url)
    try:
        result = extractor(html, url)
    except Exception as e:                                           # noqa: BLE001
        # Fallback to generic if the domain extractor crashed.
        try:
            result = generic.extract(html, url)
            result.notes.append(f"domain extractor failed: {type(e).__name__}: {e}")
        except Exception as e2:                                      # noqa: BLE001
            result = ExtractedData(
                url=url, method="css_heuristic", confidence=0.0,
                notes=[f"all extractors failed: {type(e).__name__} / {type(e2).__name__}"],
            )
    if not result.url:
        result.url = url
    return result
