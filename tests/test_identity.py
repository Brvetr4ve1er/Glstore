"""Pure tests for customer identity: phone keys, secrets, challenge verdicts,
and the SMS sender's fail-closed rule.

None of this needs Postgres. The SQL around it is covered by the static guards
in test_identity_scope.py and, behaviourally, by its fake-session HTTP tests.
"""
from __future__ import annotations

import ast
import hashlib
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from api.core.phone import (
    dz_mobile_e164,
    dz_mobile_national,
    legacy_phone_keys,
    normalize_phone,
)

REPO = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


# ── Phone keys ────────────────────────────────────────────────────────────

# Every way checkout's own regex, ^(\+213|0)?[5-7]\d{8}$, lets a shopper type
# one number, plus the separators people actually use.
_SAME_PHONE = [
    "0555123456",
    "+213555123456",
    "555123456",
    "00213555123456",
    "213555123456",
    "0555 12 34 56",
    "+213 555-12-34-56",
    "(0555) 12.34.56",
]


@pytest.mark.parametrize("typed", _SAME_PHONE)
def test_every_typing_of_one_mobile_has_one_canonical_key(typed):
    assert dz_mobile_national(typed) == "0555123456"


@pytest.mark.parametrize("typed", _SAME_PHONE)
def test_verify_can_find_the_customer_checkout_filed_under_any_format(typed):
    """The promise of Phase A: a guest who verifies owns the orders they placed.

    Checkout keys customers with the frozen digits-only `normalize_phone`, so
    whatever the shopper typed there, its key must be among the ones verify
    looks up. If this fails, some past orders silently stop being theirs.
    """
    national = dz_mobile_national(typed)
    assert normalize_phone(typed) in legacy_phone_keys(national)


@pytest.mark.parametrize("raw", [
    "021123456",       # Algiers landline — SMS cannot reach it
    "0455123456",      # not a mobile prefix
    "055512345",       # one digit short
    "05551234567",     # one digit long
    "+33612345678",    # not Algerian
    "",
    "abcdefghij",
])
def test_non_mobiles_are_refused(raw):
    assert dz_mobile_national(raw) is None


def test_e164_is_what_an_sms_provider_expects():
    assert dz_mobile_e164("0555123456") == "+213555123456"


def test_legacy_normalizer_behaviour_is_frozen():
    """Changing this would detach existing customers from their orders."""
    assert normalize_phone("+213 555-12-34-56") == "213555123456"
    assert normalize_phone("0555123456") == "0555123456"


# ── Secrets ───────────────────────────────────────────────────────────────

identity = pytest.importorskip(
    "api.services.identity",
    reason="identity imports api.core.config (pydantic-settings); "
           "run `pip install -r requirements.txt`",
)


def test_codes_are_six_digits_and_keep_leading_zeros(monkeypatch):
    monkeypatch.setattr(identity.secrets, "randbelow", lambda n: 42)
    assert identity.generate_code() == "000042"


def test_codes_come_from_the_csprng_not_random():
    src = (REPO / "api" / "services" / "identity.py").read_text(encoding="utf-8")
    assert "import random" not in src and "from random" not in src


def test_real_codes_have_the_right_shape():
    for _ in range(50):
        assert re.fullmatch(r"\d{6}", identity.generate_code())


def test_session_tokens_are_long_and_hashed_deterministically():
    t = identity.new_session_token()
    assert len(t) >= 43
    h = identity.hash_session_token(t)
    assert h == hashlib.sha256(t.encode()).hexdigest()
    assert len(h) == 64
    assert identity.hash_session_token(identity.new_session_token()) != h


def test_requester_hash_is_keyed_so_an_address_cannot_be_recovered_from_it():
    ip = "41.107.3.9"
    a = identity.hash_requester(ip, "key-one")
    assert a != hashlib.sha256(ip.encode()).hexdigest()
    assert a != identity.hash_requester(ip, "key-two")
    assert a == identity.hash_requester(ip, "key-one")
    assert identity.hash_requester("", "key-one") is None


def test_sms_names_the_store_it_came_from():
    msg = identity.otp_message("Brand A", "004217", 300)
    assert "Brand A" in msg and "004217" in msg and "5 min" in msg
    assert "AMANTCOM" not in identity.otp_message("Brand A", "004217", 300)


# ── Challenge verdicts ────────────────────────────────────────────────────

def _state(attempts=1, expires_in=timedelta(minutes=5), consumed=False):
    return identity.ChallengeState(
        attempts=attempts,
        expires_at=NOW + expires_in,
        consumed_at=NOW - timedelta(seconds=1) if consumed else None,
    )


def test_a_fresh_challenge_is_open():
    assert identity.challenge_status(_state(), now=NOW, max_attempts=5) == "open"


def test_the_last_permitted_attempt_is_still_evaluated():
    assert identity.challenge_status(_state(attempts=5), now=NOW, max_attempts=5) == "open"


def test_one_past_the_cap_is_locked_even_if_the_guess_would_be_right():
    assert identity.challenge_status(_state(attempts=6), now=NOW, max_attempts=5) == "locked"


def test_expiry_is_exclusive_at_the_boundary():
    assert identity.challenge_status(_state(expires_in=timedelta(0)), now=NOW, max_attempts=5) == "expired"


def test_a_used_code_reports_used_even_after_it_expires():
    s = _state(consumed=True, expires_in=-timedelta(minutes=1))
    assert identity.challenge_status(s, now=NOW, max_attempts=5) == "consumed"


def test_attempts_left_counts_down_to_zero_and_stops():
    assert identity.attempts_left(_state(attempts=1), 5) == 4
    assert identity.attempts_left(_state(attempts=5), 5) == 0
    assert identity.attempts_left(_state(attempts=9), 5) == 0


# ── Send throttle ─────────────────────────────────────────────────────────
#
# Contract only. What these pin down is when a send must wait and for how
# long where the answer is computable (the phone limits, from timestamps).
# For the address and store caps only counts are known, so they assert just
# "wait, a positive number of seconds" — how long is the policy's call.

_LIMITS = identity.OtpLimits(
    ttl_seconds=300,
    max_attempts=5,
    resend_cooldown_seconds=60,
    per_phone_per_hour=5,
    per_ip_per_hour=10,
    per_store_per_hour=300,
)


def _throttle(phone_sends=(), ip_sends=0, store_sends=0):
    return identity.send_throttle(
        now=NOW,
        phone_sends=list(phone_sends),
        ip_sends=ip_sends,
        store_sends=store_sends,
        limits=_LIMITS,
    )


def _ago(**kw):
    return NOW - timedelta(**kw)


def test_a_first_request_is_sent_now():
    assert _throttle() is None


def test_a_resend_inside_the_cooldown_waits_out_the_remainder():
    assert _throttle([_ago(seconds=30)]) == 30


def test_under_the_hourly_cap_and_past_the_cooldown_is_sent_now():
    sends = [_ago(minutes=5), _ago(minutes=15), _ago(minutes=25), _ago(minutes=35)]
    assert _throttle(sends) is None


def test_at_the_hourly_cap_waits_until_the_oldest_send_ages_out():
    sends = [_ago(minutes=10), _ago(minutes=20), _ago(minutes=30), _ago(minutes=40), _ago(minutes=50)]
    assert 600 <= _throttle(sends) <= 601


def test_over_the_cap_waits_until_enough_sends_age_out_not_just_the_oldest():
    """Six sends in the window against a cap of five (an operator lowered it).
    When the oldest ages out five remain — still at the cap. Two must go."""
    sends = [_ago(minutes=m) for m in (5, 15, 25, 35, 45, 55)]
    assert 900 <= _throttle(sends) <= 901


def test_when_two_phone_limits_bind_the_caller_waits_for_the_later_one():
    """Answering 30 here would send the shopper back at 30s into another 429."""
    sends = [_ago(seconds=30), _ago(minutes=20), _ago(minutes=30), _ago(minutes=40), _ago(minutes=50)]
    assert 600 <= _throttle(sends) <= 601


def test_an_address_at_its_hourly_cap_must_wait():
    wait = _throttle(ip_sends=_LIMITS.per_ip_per_hour)
    assert isinstance(wait, int) and wait > 0


def test_a_store_at_its_hourly_ceiling_must_wait():
    wait = _throttle(store_sends=_LIMITS.per_store_per_hour)
    assert isinstance(wait, int) and wait > 0


def test_just_under_every_cap_is_sent_now():
    assert _throttle(ip_sends=_LIMITS.per_ip_per_hour - 1, store_sends=_LIMITS.per_store_per_hour - 1) is None


# ── SMS sender: fail closed ───────────────────────────────────────────────

sms = pytest.importorskip("api.services.sms")


@pytest.fixture
def settings(monkeypatch):
    from api.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "sms_provider", "console")
    monkeypatch.setattr(s, "environment", "development")
    monkeypatch.setattr(s, "db_serverless", False)
    return s


def test_console_sender_works_in_local_development(settings):
    assert type(sms.get_sms_sender()).__name__ == "ConsoleSender"


@pytest.mark.parametrize("env", ["staging", "production"])
def test_console_sender_is_refused_outside_development(settings, monkeypatch, env):
    monkeypatch.setattr(settings, "environment", env)
    with pytest.raises(sms.SmsUnavailable):
        sms.get_sms_sender()


def test_console_sender_is_refused_on_serverless_even_if_it_claims_development(settings, monkeypatch):
    """On Vercel, stderr is a hosted log. A code there is a credential in a log."""
    monkeypatch.setattr(settings, "db_serverless", True)
    with pytest.raises(sms.SmsUnavailable):
        sms.get_sms_sender()


def test_an_unknown_provider_is_refused_not_ignored(settings, monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "twilio-but-not-wired")
    with pytest.raises(sms.SmsUnavailable):
        sms.get_sms_sender()


# ── No shortcuts ──────────────────────────────────────────────────────────

_IDENTITY_SOURCES = [
    REPO / "api" / "routes" / "customer_auth.py",
    REPO / "api" / "services" / "identity.py",
    REPO / "api" / "services" / "sms" / "__init__.py",
    REPO / "api" / "services" / "sms" / "console.py",
]


@pytest.mark.parametrize("path", _IDENTITY_SOURCES, ids=lambda p: p.name)
def test_no_fixed_code_is_hardcoded_anywhere_in_the_otp_path(path):
    """A `000000` that survives into production is how this goes badly wrong."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    fixed = [
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and re.fullmatch(r"\d{4,8}", n.value)
    ]
    assert not fixed, f"{path.name} contains digit-string literals that look like codes: {fixed}"


def test_the_plaintext_code_is_never_handed_to_a_logger():
    tree = ast.parse((REPO / "api" / "routes" / "customer_auth.py").read_text(encoding="utf-8"))
    for call in ast.walk(tree):
        if (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Attribute)
            and isinstance(call.func.value, ast.Name)
            and call.func.value.id == "log"
        ):
            names = {n.id for n in ast.walk(call) if isinstance(n, ast.Name)}
            assert "code" not in names, f"line {call.lineno}: the OTP code is passed to the logger"
