"""
Retailer-adapter base — Phase 9 Push 9-A.

Spine for per-retailer specialised extractors. Each adapter knows the
exact CSS structure / JSON-LD shape / pre-loaded JS state of ONE target
retailer (Ouedkniss, Condor.dz, etc.) and pulls out clean structured
data with way higher fidelity than the generic CSS-cascade extractor.

Why this exists:
    Live-test on MS-SM8081 PETRIN showed the generic extractor pulled
    only ~40% of fields cleanly from ouedkniss.com — and 0 images.
    A 200-line per-retailer adapter can hit 90%+ on its target site
    because it knows where everything actually lives.

Architecture:
    classifier.py    → which adapter handles this URL?
    images.py        → robust image extraction shared by ALL adapters
    base.py (this)   → ABC + AdapterResult + structured outputs
    {retailer}.py    → one file per retailer, subclass RetailerAdapter

The classifier is regex-based and fast (< 1 ms per URL). It runs
BEFORE the generic extractor cascade in scraper/engine.py — adapters
get first crack; if no adapter matches, the engine falls back to the
existing generic CSS/JSON-LD/OG cascade so we never regress.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

log = logging.getLogger("glstore.scraper.retailers")


# ── Result shape ──────────────────────────────────────────────────────────

@dataclass
class AdapterResult:
    """What a retailer adapter returns. Mirrors the generic extractor's
    output shape so the engine can merge results indistinguishably,
    plus a few adapter-only fields (`source_metadata`, `raw_specs`).

    Field-completeness rule: every adapter SHOULD attempt to fill
    `name`, `price_dzd`, `images`. Everything else is best-effort.
    `confidence` is the adapter's self-rating — used by the validator
    to weight cross-source consensus."""

    name:        str | None = None
    brand:       str | None = None
    model:       str | None = None
    description: str | None = None
    category:    str | None = None
    price_dzd:   Decimal | None = None
    price_label: str | None = None     # raw price string before normalisation
    currency:    str = "DZD"
    in_stock:    bool | None = None    # None = unknown, True = in stock, False = out
    images:      list[str] = field(default_factory=list)
    raw_specs:   dict[str, Any] = field(default_factory=dict)

    # Adapter-specific extras the LLM merge step can use as context but
    # which don't directly map to a product column — seller info, condition
    # (new/used for FB Marketplace + Ouedkniss), publication date, etc.
    source_metadata: dict[str, Any] = field(default_factory=dict)

    # Self-rated extraction confidence (0..1). Adapters with full JSON-LD
    # should report 0.95+; ones relying on CSS heuristics 0.5-0.7.
    confidence:  float = 0.7

    # Set by the engine after the classifier dispatched. Not for adapters
    # to fill themselves — it's an audit field.
    adapter_name: str | None = None

    def is_empty(self) -> bool:
        """True iff the adapter returned essentially nothing — used by
        the engine to decide whether to fall back to the generic
        extractor cascade."""
        return (
            not self.name
            and not self.price_dzd
            and not self.images
            and not self.raw_specs
        )

    def merge_from(self, other: "AdapterResult") -> None:
        """Fill missing fields from another result (e.g. generic
        extractor as fallback for what the adapter missed)."""
        for f in ("name", "brand", "model", "description", "category",
                  "price_dzd", "price_label", "in_stock"):
            if getattr(self, f) in (None, "") and getattr(other, f) not in (None, ""):
                setattr(self, f, getattr(other, f))
        # Images: union, dedupe preserving order
        seen = set(self.images)
        for img in other.images:
            if img not in seen:
                self.images.append(img)
                seen.add(img)
        # Specs: keep ours, fill gaps from theirs
        for k, v in other.raw_specs.items():
            self.raw_specs.setdefault(k, v)
        # source_metadata: same gap-fill semantics. Used by adapters
        # to surface non-product context (wilaya, condition, seller
        # type) that the cascade layers progressively enrich.
        for k, v in other.source_metadata.items():
            self.source_metadata.setdefault(k, v)

    def to_extracted(self, url: str) -> "object":
        """Convert to the engine's ExtractedData shape so the rest of
        the scraper pipeline can consume an adapter's output without
        knowing which path it came from. Lazy import to avoid circular
        dependency: engine.types → AdapterResult.to_extracted →
        ExtractedData → engine.types."""
        from api.services.scraper.types import ExtractedData
        notes: list[str] = []
        if self.adapter_name:
            notes.append(f"adapter={self.adapter_name}")
        if self.source_metadata:
            notes.append(f"source_meta={list(self.source_metadata.keys())}")
        # Title preference: name > brand+model
        title = self.name or (
            f"{self.brand} {self.model}".strip() if (self.brand or self.model) else None
        )
        return ExtractedData(
            url=url,
            title=title,
            price=self.price_dzd,
            currency=self.currency,
            availability=(
                "in_stock" if self.in_stock is True
                else "out_of_stock" if self.in_stock is False
                else "unknown"
            ),
            images=list(self.images),
            specs=dict(self.raw_specs),
            description=self.description,
            method="css_heuristic",   # ExtractedData literal — adapters are still CSS-based
            confidence=self.confidence,
            notes=notes,
        )


# ── Adapter ABC ───────────────────────────────────────────────────────────

class RetailerAdapter(ABC):
    """Subclass per retailer. Three things to define:

    1. `name`         — short slug, e.g. "ouedkniss"
    2. `domain_match` — list of compiled regex patterns. The classifier
                        picks the FIRST adapter whose pattern matches.
    3. `extract()`    — the actual work: parse `html`, return AdapterResult.

    Optional knobs:
        `requires_stealth = True`  — engine will escalate to Tier 2+
                                     stealth-Playwright before fetching.
        `requires_login   = True`  — like FB Marketplace; we won't even
                                     attempt without the URL pasted via
                                     the admin manual-entry flow.
        `min_html_size`            — abort if fetched HTML is < N bytes
                                     (CAPTCHA pages are usually tiny).
    """
    # ── Subclass MUST set these ───────────────────────────────
    name: str
    domain_patterns: list[Any]   # list[re.Pattern[str]] — using Any to avoid Python<3.11 generics

    # ── Optional overrides ────────────────────────────────────
    requires_stealth: bool = False
    requires_login:   bool = False
    min_html_size:    int  = 1024     # arbitrarily small, but anti-CAPTCHA

    @abstractmethod
    async def extract(self, html: str, url: str) -> AdapterResult:
        """Parse `html` (already fetched by the scraper engine; we don't
        do network I/O here) and return a structured AdapterResult.

        On parse failure the adapter SHOULD return AdapterResult() with
        is_empty()==True rather than raising, so the engine can fall
        back to the generic extractor without crashing the whole scrape.
        """
        ...

    # ── Default helpers (subclasses can override) ─────────────

    def matches(self, url: str) -> bool:
        """Cheap regex check: does this URL belong to my retailer?"""
        return any(p.search(url) for p in self.domain_patterns)

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name!r}>"
