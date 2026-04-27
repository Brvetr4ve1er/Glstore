"""Pure tests for scraper price normalization. Pins parser behavior."""
from decimal import Decimal

from api.services.scraper.validators.normalization import (
    detect_currency, parse_price,
)


def test_detect_currency_dz_variants():
    assert detect_currency("89 900 DA")     == "DZD"
    assert detect_currency("89,900 DZD")    == "DZD"
    assert detect_currency("89.900 Dinars") == "DZD"


def test_detect_currency_intl():
    assert detect_currency("1,234.56 EUR") == "EUR"
    assert detect_currency("$1,299.00")    == "USD"
    assert detect_currency("£999")         == "GBP"


def test_detect_currency_default():
    assert detect_currency("89900") == "DZD"
    assert detect_currency("")      == "DZD"


def test_parse_dz_space_thousands():
    p, c = parse_price("89 900 DA")
    assert p == Decimal("89900")
    assert c == "DZD"


def test_parse_dz_dot_as_thousands_separator():
    """The KEY DZD edge case: '89.900' with single dot+3-digits = 89900, not 89.9."""
    p, c = parse_price("89.900 DZD")
    assert p == Decimal("89900")
    assert c == "DZD"


def test_parse_us_format():
    p, c = parse_price("$1,299.00")
    assert p == Decimal("1299.00")
    assert c == "USD"


def test_parse_eu_format():
    p, c = parse_price("1.234,56 EUR")
    assert p == Decimal("1234.56")
    assert c == "EUR"


def test_parse_apostrophe_thousands():
    p, _ = parse_price("DA 89'900")
    assert p == Decimal("89900")


def test_parse_plain_int():
    p, c = parse_price("89900")
    assert p == Decimal("89900")
    assert c == "DZD"


def test_parse_decimal_with_two_after_dot():
    # Real prices like "1999.50 DZD" — the .50 is decimal, not thousands.
    p, _ = parse_price("1999.50 DZD")
    assert p == Decimal("1999.50")


def test_parse_decimal_with_one_after_dot():
    p, _ = parse_price("999.5 DZD")
    assert p == Decimal("999.5")


def test_parse_invalid_returns_none():
    p, _ = parse_price("price not present")
    assert p is None


def test_parse_empty_returns_none():
    assert parse_price("")[0] is None
    assert parse_price(None)[0] is None


def test_parse_negative_rejected():
    p, _ = parse_price("-100 DZD")
    assert p is None


def test_parse_none_safe():
    p, c = parse_price(None)
    assert p is None
    assert c == "DZD"
