"""Domain classification + skip rules."""
from api.services.scraper.types import SourceTier
from api.services.scraper.utils.domain import (
    classify_url, host_of, needs_browser, needs_stealth, should_skip,
)


def test_classify_official_dz():
    assert classify_url("https://condor.dz/p/abc")    == SourceTier.OFFICIAL
    assert classify_url("https://brandt.dz/p/abc")    == SourceTier.OFFICIAL
    assert classify_url("https://samsung.com/levant") == SourceTier.OFFICIAL


def test_classify_retailer():
    assert classify_url("https://www.jumia.dz/p")          == SourceTier.RETAILER
    assert classify_url("https://www.batolis.com/p")       == SourceTier.RETAILER
    assert classify_url("https://elhamizonline.com/p")     == SourceTier.RETAILER


def test_classify_aggregator():
    assert classify_url("https://prixalgerie.com/x")      == SourceTier.AGGREGATOR
    assert classify_url("https://diardzair.com.dz/y")     == SourceTier.AGGREGATOR


def test_classify_classified():
    assert classify_url("https://www.ouedkniss.com/abc")  == SourceTier.CLASSIFIED


def test_classify_review():
    assert classify_url("https://www.lesnumeriques.com/x") == SourceTier.REVIEW
    assert classify_url("https://gsmarena.com/abc")        == SourceTier.REVIEW


def test_classify_unknown_falls_to_general():
    assert classify_url("https://random-shop.example.com/x") == SourceTier.GENERAL


def test_classify_handles_invalid():
    assert classify_url("")          == SourceTier.GENERAL
    assert classify_url("not-a-url") == SourceTier.GENERAL


def test_host_strips_www():
    assert host_of("https://www.jumia.dz/x") == "jumia.dz"
    assert host_of("https://JUMIA.DZ/x")     == "jumia.dz"


def test_needs_browser_for_js_heavy():
    assert needs_browser("https://www.ouedkniss.com/p")
    assert needs_browser("https://www.aliexpress.com/p")


def test_needs_browser_for_static_is_false():
    assert not needs_browser("https://condor.dz/p")
    assert not needs_browser("https://www.jumia.dz/p")


def test_needs_stealth_only_for_protected():
    assert needs_stealth("https://www.ouedkniss.com/p")
    assert not needs_stealth("https://www.jumia.dz/p")


def test_should_skip_login_pages():
    assert should_skip("https://example.com/login")
    assert should_skip("https://example.com/account/profile")
    assert should_skip("https://example.com/cart/checkout")


def test_should_skip_social():
    assert should_skip("https://www.facebook.com/marketplace/x")


def test_should_not_skip_normal_page():
    assert should_skip("https://condor.dz/p/tv-55") is None
