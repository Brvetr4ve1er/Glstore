"""Tests for price validator + cross-source consensus."""
from decimal import Decimal

from api.services.scraper.types import ExtractedData, SourceTier
from api.services.scraper.validators.price_validator import (
    AGREEMENT_TOLERANCE, adjust_confidence_post_consensus, consensus_of,
    validate_one,
)


def _ed(price, currency="DZD", confidence=0.9, method="json_ld"):
    return ExtractedData(
        url="https://example.com",
        price=price, currency=currency,
        confidence=confidence, method=method,
    )


# ── validate_one ──────────────────────────────────────────────────────────

def test_validate_accepts_in_bounds_dzd():
    v = validate_one(_ed(Decimal("90000")), tier=SourceTier.RETAILER,
                     expected_price=Decimal("100000"))
    assert v.accepted
    assert 0.7 < v.confidence <= 1.0


def test_validate_rejects_too_low():
    v = validate_one(_ed(Decimal("100")), tier=SourceTier.RETAILER,
                     expected_price=Decimal("100000"))
    assert not v.accepted
    assert "below absolute floor" in v.reason or "outlier_low" in (v.notes or [""])[0]


def test_validate_rejects_too_high():
    v = validate_one(_ed(Decimal("500000")), tier=SourceTier.RETAILER,
                     expected_price=Decimal("100000"))
    assert not v.accepted


def test_validate_rejects_foreign_currency():
    v = validate_one(_ed(Decimal("100"), currency="EUR"),
                     tier=SourceTier.RETAILER, expected_price=Decimal("100000"))
    assert not v.accepted
    assert "EUR" in v.reason


def test_validate_tier_trust_weights():
    """Same price, different tiers — trust must scale confidence."""
    p = Decimal("90000")
    expected = Decimal("100000")
    official = validate_one(_ed(p), tier=SourceTier.OFFICIAL, expected_price=expected)
    classified = validate_one(_ed(p), tier=SourceTier.CLASSIFIED, expected_price=expected)
    assert official.confidence > classified.confidence


def test_validate_no_expected_still_works():
    v = validate_one(_ed(Decimal("89000")), tier=SourceTier.RETAILER, expected_price=None)
    assert v.accepted


def test_validate_zero_price_rejected():
    v = validate_one(_ed(Decimal("0")), tier=SourceTier.RETAILER, expected_price=None)
    assert not v.accepted


# ── consensus_of ──────────────────────────────────────────────────────────

def test_consensus_median_low_high():
    c = consensus_of([Decimal("89000"), Decimal("91000"),
                      Decimal("90000"), Decimal("92000")])
    assert c.lowest_price  == Decimal("89000")
    assert c.highest_price == Decimal("92000")
    assert c.median_price  == Decimal("90500")
    assert c.agreeing_count == 4   # all within 20% of each other


def test_consensus_outlier_disagrees():
    c = consensus_of([Decimal("89000"), Decimal("91000"),
                      Decimal("90000"), Decimal("45000")])
    assert c.disagreeing_count >= 1
    assert c.median_price == Decimal("89500")


def test_consensus_empty_returns_nones():
    c = consensus_of([])
    assert c.median_price is None
    assert c.lowest_price is None


# ── adjust_confidence_post_consensus ────────────────────────────────────

def test_adjust_boosts_when_in_agreement():
    ed = _ed(Decimal("90000"), confidence=0.7)
    c = consensus_of([Decimal("89000"), Decimal("91000"), Decimal("90000")])
    boosted = adjust_confidence_post_consensus(ed, c)
    assert boosted >= 0.79


def test_adjust_drops_when_outlier():
    ed = _ed(Decimal("45000"), confidence=0.7)
    c = consensus_of([Decimal("89000"), Decimal("91000"),
                      Decimal("90000"), Decimal("45000")])
    dropped = adjust_confidence_post_consensus(ed, c)
    # Outlier (50% off) should drop by 0.20
    assert dropped <= 0.51


def test_agreement_tolerance_is_sane():
    assert Decimal("0.10") < AGREEMENT_TOLERANCE < Decimal("0.30")
