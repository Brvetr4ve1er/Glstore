"""Phone numbers — the one place that decides how a phone becomes a key.

Two different jobs live here and must not be confused:

`normalize_phone` is the LEGACY key. COD checkout and order tracking have
always keyed customers by "digits only", so `0555123456`, `+213555123456` and
`555123456` are three different keys for one phone. Its behaviour is frozen:
changing it would silently stop existing customers matching their own orders.

`dz_mobile_national` is the CANONICAL form, used by everything identity-shaped
(OTP challenges, verified customers). One phone, one key, whatever was typed —
otherwise throttling per phone could be multiplied just by varying the prefix.

`legacy_phone_keys` bridges the two: every legacy key checkout could have
produced for a given canonical number, so a verified phone finds the customer
row its COD orders were filed under.
"""
from __future__ import annotations

import re


def normalize_phone(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())


# Algerian mobiles: 05/06/07 + 8 digits nationally, 213 + 9 digits internationally.
_DZ_MOBILE = re.compile(r"^(?:\+213|00213|213|0)?([5-7]\d{8})$")
_SEPARATORS = re.compile(r"[\s.\-()/]")


def dz_mobile_national(raw: str) -> str | None:
    """`+213 555 12-34-56` -> `0555123456`. None if it is not an Algerian mobile.

    Landlines are refused on purpose: a one-time code sent by SMS cannot reach
    them, and accepting one would just burn a send on a number that can't
    receive it.
    """
    m = _DZ_MOBILE.match(_SEPARATORS.sub("", raw or ""))
    return f"0{m.group(1)}" if m else None


def dz_mobile_e164(national: str) -> str:
    """`0555123456` -> `+213555123456` — the address an SMS provider wants."""
    return f"+213{national[1:]}"


def legacy_phone_keys(national: str) -> list[str]:
    """Every `normalize_phone()` output checkout could have stored for this number."""
    subscriber = national[1:]
    return [national, f"213{subscriber}", subscriber, f"00213{subscriber}"]
