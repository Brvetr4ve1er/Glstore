"""
Price validation — bounds, outlier rejection, cross-source agreement.

Implements the master-prompt rules:
    - reject if price < 0.3 * expected_price
    - reject if price > 2.5 * expected_price
    - reject if price < ABSOLUTE_FLOOR (e.g. < 100 DZD)
    - reject if price > ABSOLUTE_CEILING (e.g. > 100M DZD)
    - tag as low-confidence if it disagrees with the cross-source median by > 20%

Returns a `PriceVerdict` so the caller can persist confidence + notes
verbatim — we never silently downgrade.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from statistics import median
from typing import Iterable

from api.services.scraper.types import ExtractedData, SourceTier, TIER_TRUST


# Hard floor / ceiling that no electronics product price should ever cross.
# Anything outside is a parser error, not a real listing.
ABS_FLOOR_DZD   = Decimal("100")
ABS_CEILING_DZD = Decimal("100_000_000")

# Default tolerance when comparing against expected_price. Configurable via
# scraper.config.{price_outlier_low_factor, price_outlier_high_factor}.
DEFAULT_LOW_FACTOR  = Decimal("0.3")
DEFAULT_HIGH_FACTOR = Decimal("2.5")

# Cross-source agreement: a price that's within ±20% of the consensus median
# is "agreeing" and gets a confidence boost. Outside that → confidence drop.
AGREEMENT_TOLERANCE = Decimal("0.20")


@dataclass
class PriceVerdict:
    accepted: bool
    confidence: float
    reason: str = ""
    notes: list[str] = field(default_factory=list)


def validate_one(
    extracted: ExtractedData,
    *,
    tier: SourceTier,
    expected_price: Decimal | None,
    low_factor: Decimal = DEFAULT_LOW_FACTOR,
    high_factor: Decimal = DEFAULT_HIGH_FACTOR,
) -> PriceVerdict:
    """Hard-bound check on a single extracted price."""
    notes: list[str] = []

    if extracted.price is None or extracted.price <= 0:
        return PriceVerdict(accepted=False, confidence=0.0, reason="no price")

    p = extracted.price

    # Currency normalisation: only DZD goes to competitor_prices.
    # Foreign-currency listings are kept on the source row (for spec
    # discovery) but excluded from price aggregation.
    if extracted.currency != "DZD":
        return PriceVerdict(
            accepted=False,
            confidence=max(0.0, extracted.confidence * 0.5),
            reason=f"currency {extracted.currency} excluded from DZD aggregation",
            notes=[f"foreign_currency:{extracted.currency}"],
        )

    if p < ABS_FLOOR_DZD:
        return PriceVerdict(accepted=False, confidence=0.0,
                            reason=f"price {p} below absolute floor {ABS_FLOOR_DZD}")
    if p > ABS_CEILING_DZD:
        return PriceVerdict(accepted=False, confidence=0.0,
                            reason=f"price {p} above absolute ceiling {ABS_CEILING_DZD}")

    confidence = float(extracted.confidence)
    # Tier-trust weighting (research-aligned)
    confidence *= TIER_TRUST.get(tier, 0.5)

    # Bound check vs our retail
    if expected_price and expected_price > 0:
        low  = expected_price * low_factor
        high = expected_price * high_factor
        if p < low:
            return PriceVerdict(
                accepted=False, confidence=0.0,
                reason=f"price {p} < {low_factor}× expected ({expected_price})",
                notes=[f"outlier_low:expected={expected_price}"],
            )
        if p > high:
            return PriceVerdict(
                accepted=False, confidence=0.0,
                reason=f"price {p} > {high_factor}× expected ({expected_price})",
                notes=[f"outlier_high:expected={expected_price}"],
            )
        # Inside bounds → bump confidence proportional to closeness
        delta_pct = abs(p - expected_price) / expected_price
        if delta_pct < Decimal("0.10"):
            confidence = min(1.0, confidence + 0.05)
            notes.append("price_close_to_expected")

    return PriceVerdict(
        accepted=True,
        confidence=round(min(max(confidence, 0.0), 1.0), 3),
        reason="ok",
        notes=notes,
    )


# ── Cross-source consensus ──────────────────────────────────────────────────

@dataclass
class CrossSourceConsensus:
    median_price: Decimal | None
    lowest_price: Decimal | None
    highest_price: Decimal | None
    agreeing_count: int                       # within ±20% of median
    disagreeing_count: int
    accepted_prices: list[Decimal]


def consensus_of(prices: Iterable[Decimal]) -> CrossSourceConsensus:
    accepted = [p for p in prices if p is not None and p > 0]
    if not accepted:
        return CrossSourceConsensus(None, None, None, 0, 0, [])
    accepted_sorted = sorted(accepted)
    med = Decimal(str(median(accepted_sorted)))
    low = accepted_sorted[0]
    high = accepted_sorted[-1]
    agreeing = sum(
        1 for p in accepted
        if med > 0 and abs(p - med) / med <= AGREEMENT_TOLERANCE
    )
    return CrossSourceConsensus(
        median_price=med,
        lowest_price=low,
        highest_price=high,
        agreeing_count=agreeing,
        disagreeing_count=len(accepted) - agreeing,
        accepted_prices=accepted_sorted,
    )


def adjust_confidence_post_consensus(
    extracted: ExtractedData,
    consensus: CrossSourceConsensus,
) -> float:
    """After we've seen all sources, adjust each one's confidence based on whether
    it agrees with the consensus median."""
    if not extracted.price or not consensus.median_price or consensus.median_price <= 0:
        return extracted.confidence
    delta = abs(extracted.price - consensus.median_price) / consensus.median_price
    if delta <= AGREEMENT_TOLERANCE:
        # In agreement → bump
        return round(min(extracted.confidence + 0.10, 1.0), 3)
    # Outlier → drop
    return round(max(extracted.confidence - 0.20, 0.0), 3)
