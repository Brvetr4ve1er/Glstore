"""
Price + currency normalization.

Algerian listings come in many shapes:
    "89 900 DA"           → 89900
    "89.900 DZD"          → 89900
    "89,900.00 DZD"       → 89900
    "DA 89'900"           → 89900
    "1.234,56 €"          → 1234.56  (currency='EUR')
    "$1,299.00"           → 1299.00  (currency='USD')
    "89900"               → 89900    (currency assumed DZD)

Goal: produce (Decimal, currency_str) reliably, no ValueError on weird input.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Tuple

# Order matters: pick the longest match first ("DZD" before "DA")
_CURRENCY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bDZD\b",  re.I),                            "DZD"),
    (re.compile(r"\bDinars?\b",   re.I),                       "DZD"),
    (re.compile(r"\bDA\b",   re.I),                            "DZD"),
    (re.compile(r"\bدج"),                                       "DZD"),
    (re.compile(r"\bEUR\b",  re.I),                            "EUR"),
    (re.compile(r"€"),                                          "EUR"),
    (re.compile(r"\bUSD\b",  re.I),                            "USD"),
    (re.compile(r"\$"),                                         "USD"),
    (re.compile(r"\bGBP\b",  re.I),                            "GBP"),
    (re.compile(r"£"),                                          "GBP"),
    (re.compile(r"\bMAD\b",  re.I),                            "MAD"),
    (re.compile(r"\bTND\b",  re.I),                            "TND"),
]

_DIGIT_GROUP_RE = re.compile(r"[^\d.,\-]")


def detect_currency(text: str, default: str = "DZD") -> str:
    if not text:
        return default
    for rx, cur in _CURRENCY_PATTERNS:
        if rx.search(text):
            return cur
    return default


def parse_price(raw: str | None, *, default_currency: str = "DZD") -> Tuple[Decimal | None, str]:
    """Parse a free-form price string. Returns (Decimal, currency).

    Number rules:
      - Strip currency symbols and letters first.
      - If both '.' and ',' present, the LAST one wins as decimal separator.
      - If only ',' and trailing run is exactly 3 digits, ',' is a thousands
        separator. Otherwise it's a decimal.
      - Spaces and apostrophes inside numbers are thousands separators.
    """
    if raw is None:
        return None, default_currency
    text = str(raw).strip()
    if not text:
        return None, default_currency

    currency = detect_currency(text, default=default_currency)

    # Strip everything that isn't a digit / separator / minus
    cleaned = _DIGIT_GROUP_RE.sub("", text)
    cleaned = cleaned.replace("'", "").replace(" ", "")
    if not cleaned:
        return None, currency

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    if last_comma != -1 and last_dot != -1:
        if last_comma > last_dot:
            # European: 1.234,56 → 1234.56
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            # US: 1,234.56 → 1234.56
            cleaned = cleaned.replace(",", "")
    elif last_comma != -1:
        # Only commas
        after = cleaned[last_comma + 1:]
        if len(after) == 3 and "," not in after:
            # 1,234 → thousands separator
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
    elif cleaned.count(".") >= 1:
        # Only dots — could be decimal (1234.56), thousands (89.900),
        # or both (1.234.567). Heuristics:
        #  - more than one dot → all are thousands separators
        #  - single dot followed by exactly 3 digits → thousands separator
        #    (DZD prices are integers; 89.9 DZD doesn't exist in this market)
        #  - single dot followed by 1, 2, 4+ digits → decimal point
        if cleaned.count(".") > 1:
            cleaned = cleaned.replace(".", "")
        else:
            after = cleaned[last_dot + 1:]
            if len(after) == 3 and after.isdigit():
                cleaned = cleaned.replace(".", "")

    try:
        value = Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None, currency

    if value < 0:
        return None, currency

    # Algerian price floor: anything < 100 DZD on an electronics listing is
    # almost certainly a parse error (e.g. "Garantie 24" picked up as "24").
    # We let the price validator decide the absolute floor — here we only
    # trim absurd negatives.
    return value, currency
