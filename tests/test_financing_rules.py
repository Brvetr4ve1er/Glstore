"""The financing rules engine (api/services/financing/rules.py).

The plan names this as the one part of the financing layer that must have
genuine, high-coverage tests, because it needs no Postgres: every number and
every refusal a shopper or an admin ever sees is decided here.

All rule values below are TEST FIXTURES, not business terms. The platform ships
no rule; the operator supplies them.
"""
from __future__ import annotations

import json
from decimal import Decimal as D

import pytest

from api.services.financing import rules as r

RULE = r.Rule(
    version=3,
    min_financed=D("10000.00"),
    max_financed=D("500000.00"),
    min_down_payment_pct=D("10"),
    max_debt_ratio_pct=D("30"),
    terms=(r.Term(6, D("0")), r.Term(12, D("5")), r.Term(24, D("12"))),
)


def _eval(lines, down, months=12, rule=RULE, profile=None):
    return r.evaluate(lines, down_payment=D(down), duration_months=months, rule=rule, profile=profile)


def _cart(*prices_and_qty):
    return [r.Line(unit_price=D(p), quantity=q) for p, q in prices_and_qty]


# ── The instalment schedule ───────────────────────────────────────────────

@pytest.mark.parametrize("total", ["0.01", "1.00", "99.99", "100000.00", "113400.00", "33333.35", "987654.32"])
@pytest.mark.parametrize("months", [1, 2, 3, 6, 7, 12, 24, 36, 120])
def test_the_schedule_sums_to_exactly_the_total(total, months):
    s = r.split_evenly(D(total), months)
    assert len(s) == months
    assert sum(s) == D(total)


@pytest.mark.parametrize("total,months", [("100000.00", 3), ("33333.35", 7), ("987654.32", 36)])
def test_instalments_differ_by_at_most_a_centime_and_the_larger_come_first(total, months):
    s = r.split_evenly(D(total), months)
    assert max(s) - min(s) <= D("0.01")
    assert list(s) == sorted(s, reverse=True)


def test_an_uneven_split_puts_the_extra_centime_up_front():
    assert r.split_evenly(D("100000.00"), 3) == (D("33333.34"), D("33333.33"), D("33333.33"))


# ── A worked example ──────────────────────────────────────────────────────

def test_a_straightforward_cart_is_priced_exactly():
    d = _eval(_cart(("120000.00", 1)), "12000.00", months=12)
    assert d.eligible, d.reasons
    assert d.cash_total == D("120000.00")
    assert d.minimum_down_payment == D("12000.00")
    assert d.financed_amount == D("108000.00")
    assert d.markup_pct == D("5")
    assert d.markup_amount == D("5400.00")
    assert d.total_repayable == D("113400.00")
    assert d.monthly_instalment == D("9450.00")
    assert d.schedule == (D("9450.00"),) * 12
    assert d.rule_version == 3


def test_several_lines_and_quantities_add_up():
    assert r.cash_total(_cart(("45000.00", 2), ("1999.50", 3))) == D("95998.50")


def test_a_zero_markup_term_repays_exactly_what_was_financed():
    d = _eval(_cart(("60000.00", 1)), "6000.00", months=6)
    assert d.markup_amount == D("0.00")
    assert d.total_repayable == d.financed_amount == D("54000.00")
    assert d.monthly_instalment == D("9000.00")


def test_the_displayed_instalment_is_the_largest_one_so_it_never_understates():
    rule = r.Rule(1, D("1"), D("1000000"), D("0"), None, (r.Term(3, D("0")),))
    d = _eval(_cart(("100000.00", 1)), "0", months=3, rule=rule)
    assert d.monthly_instalment == max(d.schedule) == D("33333.34")


# ── Rounding ──────────────────────────────────────────────────────────────

def test_the_markup_rounds_half_up_to_the_centime():
    rule = r.Rule(1, D("0.01"), D("1000000"), D("0"), None, (r.Term(2, D("0.5")),))
    d = _eval(_cart(("1.00", 1)), "0", months=2, rule=rule)
    assert d.markup_amount == D("0.01")          # 0.005 -> 0.01


def test_the_minimum_down_payment_rounds_up_never_down():
    """Rounding down would accept an apport below the rule's own floor."""
    assert r.minimum_down_payment(D("999.99"), RULE) == D("100.00")   # 99.999 -> 100.00


def test_a_down_payment_given_with_sub_centime_precision_is_normalised():
    d = _eval(_cart(("120000.00", 1)), "12000.004")
    assert d.down_payment == D("12000.00")


# ── Refusals ──────────────────────────────────────────────────────────────

def test_a_down_payment_under_the_floor_is_refused_but_still_priced():
    d = _eval(_cart(("120000.00", 1)), "11999.99")
    assert r.DOWN_PAYMENT_BELOW_MINIMUM in d.reasons and not d.eligible
    assert d.monthly_instalment is not None, "the simulator needs the figures to say what to change"


def test_paying_everything_up_front_leaves_nothing_to_finance():
    d = _eval(_cart(("50000.00", 1)), "50000.00")
    assert d.reasons == (r.NOTHING_TO_FINANCE,)
    assert d.markup_amount is None and d.schedule == ()


def test_an_overpayment_is_nothing_to_finance_not_a_negative_loan():
    d = _eval(_cart(("50000.00", 1)), "60000.00")
    assert d.financed_amount == D("0")
    assert r.NOTHING_TO_FINANCE in d.reasons


def test_a_duration_the_rule_does_not_offer_is_refused_and_unpriced():
    d = _eval(_cart(("120000.00", 1)), "12000.00", months=18)
    assert r.DURATION_NOT_OFFERED in d.reasons
    assert d.markup_pct is None and d.monthly_instalment is None


def test_too_small_and_too_large_amounts_are_refused():
    assert r.BELOW_MIN_FINANCED in _eval(_cart(("10000.00", 1)), "1000.00").reasons   # 9 000 financed
    assert r.ABOVE_MAX_FINANCED in _eval(_cart(("600000.00", 1)), "60000.00").reasons  # 540 000 financed


def test_the_bounds_are_inclusive():
    assert _eval(_cart(("11111.12", 1)), "1111.12").financed_amount == D("10000.00")
    assert _eval(_cart(("11111.12", 1)), "1111.12").eligible
    assert _eval(_cart(("555555.56", 1)), "55555.56").eligible          # exactly 500 000


def test_every_applicable_reason_is_reported_not_just_the_first():
    d = _eval(_cart(("600000.00", 1)), "0", months=18)
    assert set(d.reasons) == {r.DOWN_PAYMENT_BELOW_MINIMUM, r.ABOVE_MAX_FINANCED, r.DURATION_NOT_OFFERED}


def test_an_empty_cart_is_refused():
    d = _eval([], "0")
    assert r.NO_ITEMS in d.reasons and not d.eligible
    assert r.NOTHING_TO_FINANCE not in d.reasons


# ── Affordability ─────────────────────────────────────────────────────────

def test_without_a_profile_affordability_is_explicitly_not_assessed():
    d = _eval(_cart(("120000.00", 1)), "12000.00")
    assert d.eligible and d.debt_ratio_assessed is False


def test_an_instalment_that_breaks_the_debt_ratio_is_refused():
    # ceiling 30% of 60 000 = 18 000; 10 000 existing + 9 450 new = 19 450
    d = _eval(_cart(("120000.00", 1)), "12000.00",
              profile=r.Profile(monthly_income=D("60000"), monthly_obligations=D("10000")))
    assert d.debt_ratio_assessed
    assert d.reasons == (r.DEBT_RATIO_EXCEEDED,)


def test_an_affordable_instalment_passes_the_debt_ratio():
    d = _eval(_cart(("120000.00", 1)), "12000.00",
              profile=r.Profile(monthly_income=D("60000"), monthly_obligations=D("5000")))
    assert d.eligible and d.debt_ratio_assessed


def test_exactly_at_the_ceiling_is_allowed():
    d = _eval(_cart(("120000.00", 1)), "12000.00",
              profile=r.Profile(monthly_income=D("60000"), monthly_obligations=D("8550")))
    assert d.eligible        # 8 550 + 9 450 = 18 000 = ceiling


def test_no_income_cannot_carry_any_instalment():
    d = _eval(_cart(("120000.00", 1)), "12000.00", profile=r.Profile(monthly_income=D("0")))
    assert r.DEBT_RATIO_EXCEEDED in d.reasons


def test_a_rule_with_no_debt_ratio_cap_does_not_assess_even_with_a_profile():
    rule = r.Rule(1, RULE.min_financed, RULE.max_financed, RULE.min_down_payment_pct, None, RULE.terms)
    d = _eval(_cart(("120000.00", 1)), "12000.00", rule=rule, profile=r.Profile(D("1")))
    assert d.eligible and d.debt_ratio_assessed is False


# ── Inputs the API layer must never pass ──────────────────────────────────

def test_a_negative_down_payment_is_a_programming_error():
    with pytest.raises(ValueError):
        _eval(_cart(("1000.00", 1)), "-1")


@pytest.mark.parametrize("line", [r.Line(D("1000.00"), 0), r.Line(D("-1.00"), 1)])
def test_a_nonsensical_line_is_a_programming_error(line):
    with pytest.raises(ValueError):
        r.evaluate([line], down_payment=D("0"), duration_months=12, rule=RULE)


# ── Serialisation ─────────────────────────────────────────────────────────

def test_a_decision_serialises_to_json_with_money_as_exact_strings():
    payload = _eval(_cart(("120000.00", 1)), "12000.00").as_dict()
    json.dumps(payload)
    assert payload["monthly_instalment"] == "9450.00"
    assert payload["schedule"][0] == "9450.00" and len(payload["schedule"]) == 12


# ── Rule validation (gates activation) ────────────────────────────────────

def test_a_well_formed_rule_validates():
    assert r.validate_rule(RULE) == []


@pytest.mark.parametrize("mutate,fragment", [
    (dict(terms=()), "au moins une durée"),
    (dict(terms=(r.Term(12, D("5")), r.Term(12, D("6")))), "qu'une fois"),
    (dict(terms=(r.Term(0, D("5")),)), "hors bornes"),
    (dict(terms=(r.Term(121, D("5")),)), "hors bornes"),
    (dict(terms=(r.Term(12, D("-1")),)), "marge invalide"),
    (dict(min_financed=D("0")), "minimum doit être positif"),
    (dict(max_financed=D("5000")), "inférieur au minimum"),
    (dict(min_down_payment_pct=D("100")), "apport minimum"),
    (dict(max_debt_ratio_pct=D("0")), "endettement"),
    (dict(max_debt_ratio_pct=D("101")), "endettement"),
])
def test_a_malformed_rule_cannot_be_activated(mutate, fragment):
    fields = dict(
        version=RULE.version, min_financed=RULE.min_financed, max_financed=RULE.max_financed,
        min_down_payment_pct=RULE.min_down_payment_pct, max_debt_ratio_pct=RULE.max_debt_ratio_pct,
        terms=RULE.terms,
    )
    fields.update(mutate)
    errors = r.validate_rule(r.Rule(**fields))
    assert any(fragment in e for e in errors), errors


def test_durations_are_listed_in_order():
    assert RULE.durations == (6, 12, 24)
