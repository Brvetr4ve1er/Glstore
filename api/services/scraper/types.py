"""
Shared type definitions for the scraper. Pure data — no logic, no IO.

Every tier and every extractor speaks in these shapes so the orchestrator
can compose them without coupling to any specific backend.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any, Literal


# ── Source tiers (research-aligned) ─────────────────────────────────────────

class SourceTier(str, Enum):
    """Domain tier — drives quota allocation and confidence weighting.

    Mapping is defined by the deep-research report:
      - official  : manufacturer sites (Condor, Brandt, Samsung, LG)         → confidence 90
      - retailer  : DZ retailers + clean WooCommerce (El Hamiz, ExtraStores) → confidence 75-85
      - aggregator: PrixAlgérie, Diardzair                                   → confidence 65-70
      - classified: Ouedkniss                                                → confidence 50, treat as floor
      - review    : lesnumeriques, frandroid, gsmarena                       → no price, but specs
      - general   : everything unrecognised                                  → fallback bucket
    """
    OFFICIAL   = "official"
    RETAILER   = "retailer"
    AGGREGATOR = "aggregator"
    CLASSIFIED = "classified"
    REVIEW     = "review"
    GENERAL    = "general"


# Tier weights used when computing the cross-source consensus.
TIER_TRUST: dict[SourceTier, float] = {
    SourceTier.OFFICIAL:   1.00,
    SourceTier.RETAILER:   0.85,
    SourceTier.AGGREGATOR: 0.70,
    SourceTier.CLASSIFIED: 0.55,
    SourceTier.REVIEW:     0.40,
    SourceTier.GENERAL:    0.50,
}

# Default quota — read from app_settings, but this is the floor.
TIER_QUOTA_DEFAULT: dict[SourceTier, int] = {
    SourceTier.OFFICIAL:   1,
    SourceTier.RETAILER:   3,
    SourceTier.AGGREGATOR: 1,
    SourceTier.CLASSIFIED: 1,
    SourceTier.REVIEW:     1,
    SourceTier.GENERAL:    1,
}


# ── Fetch result ────────────────────────────────────────────────────────────

@dataclass
class FetchResult:
    """Output of a tier's fetch call. Tier escalation reads `ok` + `confidence_hint`."""
    url: str
    ok: bool
    status: int                           # HTTP status (0 if connection failed)
    html: str = ""
    fetch_ms: int = 0
    engine: str = ""                      # "httpx" | "playwright" | "playwright_stealth" | "paid:zyte" | …
    tier: int = 0                         # 1..4
    blocked: bool = False                 # CF challenge / captcha / 403 detected
    error: str | None = None
    # Confidence hint emitted by the tier — orchestrator can short-circuit if low
    # (e.g. tier1 returns ok=True but blocked=True → escalate)
    confidence_hint: float = 1.0


# ── Extracted data ──────────────────────────────────────────────────────────

Availability = Literal["in_stock", "out_of_stock", "unknown"]
ExtractionMethod = Literal[
    "json_ld",       # schema.org JSON-LD — gold standard
    "microdata",     # itemprop / itemtype — strong
    "opengraph",     # og:price:amount + og:title — medium
    "domain_specific", # bespoke per-domain extractor — context-dependent
    "css_heuristic", # generic CSS selectors + currency-symbol regex — weak
    "llm_fallback",  # LLM extraction over raw HTML — last resort
]


@dataclass
class ExtractedData:
    """Result of running an extractor over a fetched HTML page.

    Confidence is the extractor's *own* opinion. The validator may downgrade it
    later (e.g. price outside reasonable bounds → confidence *= 0.5).
    """
    url: str = ""
    title: str | None = None
    price: Decimal | None = None
    currency: str = "DZD"
    availability: Availability = "unknown"
    images: list[str] = field(default_factory=list)
    specs: dict[str, Any] = field(default_factory=dict)
    description: str | None = None
    method: ExtractionMethod = "css_heuristic"
    confidence: float = 0.5
    notes: list[str] = field(default_factory=list)

    def has_price(self) -> bool:
        return self.price is not None and self.price > 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "price": float(self.price) if self.price is not None else None,
            "currency": self.currency,
            "availability": self.availability,
            "images": self.images,
            "specs": self.specs,
            "description": self.description,
            "method": self.method,
            "confidence": round(self.confidence, 3),
            "notes": self.notes,
        }


# ── Search ──────────────────────────────────────────────────────────────────

Intent = Literal["commercial", "technical", "review"]


@dataclass
class SearchResult:
    """One row of search engine output."""
    title: str
    url: str
    snippet: str = ""
    domain: str = ""
    tier: SourceTier = SourceTier.GENERAL
    intent: Intent = "commercial"
    engine: str = ""                       # "searxng" | "duckduckgo" | "brave" | …


@dataclass
class ProductTarget:
    """The product we're scraping for. Built from a DB row."""
    id: str
    sku: str
    name: str
    brand: str | None
    model: str | None
    category: str | None
    expected_price: Decimal | None         # our retail — used as sanity-check anchor
    currency: str = "DZD"


# ── Job orchestration ───────────────────────────────────────────────────────

@dataclass
class ScrapedSourceRecord:
    """What gets persisted to scrape_sources for one URL fetch."""
    url: str
    domain: str
    tier: SourceTier
    intent: Intent | None
    fetch_tier: int                        # 1..4 (which tier ultimately succeeded)
    fetch_engine: str
    fetch_ms: int
    http_status: int
    title: str | None
    snippet: str | None
    extracted: ExtractedData
    confidence: float
    error_message: str | None = None


@dataclass
class ScrapeOutcome:
    """End-to-end result of a single scrape job."""
    job_id: str
    product_id: str
    sources_attempted: int
    sources_succeeded: int
    sources_blocked: int
    prices_found: int
    median_price: Decimal | None
    lowest_price: Decimal | None
    highest_price: Decimal | None
    our_price: Decimal | None
    vs_market_pct: float | None            # (our - median) / median; positive = above market
    margin_alert: bool                     # vs_market_pct > threshold
    by_tier: dict[str, int]                # how many sources per source-tier
    fetch_engines_used: dict[str, int]     # how many requests per fetch engine
    duration_ms: int
    sources: list[ScrapedSourceRecord] = field(default_factory=list)

    def to_summary_dict(self) -> dict[str, Any]:
        """Compact JSON for the scrape_jobs.summary column (no per-source detail)."""
        return {
            "sources_attempted": self.sources_attempted,
            "sources_succeeded": self.sources_succeeded,
            "sources_blocked": self.sources_blocked,
            "prices_found": self.prices_found,
            "median_price": float(self.median_price) if self.median_price is not None else None,
            "lowest_price": float(self.lowest_price) if self.lowest_price is not None else None,
            "highest_price": float(self.highest_price) if self.highest_price is not None else None,
            "our_price":     float(self.our_price)     if self.our_price     is not None else None,
            "vs_market_pct": self.vs_market_pct,
            "margin_alert": self.margin_alert,
            "by_tier": self.by_tier,
            "fetch_engines_used": self.fetch_engines_used,
            "duration_ms": self.duration_ms,
        }
