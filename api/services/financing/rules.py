"""The financing rules engine — pure: `(cart, rule, profile) -> Decision`.

No database, no I/O, no settings. This is the one part of the financing layer
that can be tested exhaustively without Postgres, so everything that decides a
number or a refusal lives here and nowhere else.

Pricing model: a flat markup on the financed amount, fixed per duration
("vente à tempérament"). A markup of 0 is an instalment plan with no added
cost. The rule's numbers — durations, markups, bounds, down payment, debt
ratio — are OPERATOR-SUPPLIED business terms; this module ships none of them.

Money is computed in whole centimes. The markup is rounded once (half-up), and
the schedule spreads leftover centimes over the first instalments, so the
instalments always add up to exactly the total repayable.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Any

CENT = Decimal("0.01")
HUNDRED = Decimal(100)

# Sanity bounds for rule validation — they catch typos (120 entered for 12),
# they are not business policy.
MAX_TERM_MONTHS = 120
MAX_MARKUP_PCT = Decimal(1000)

# Refusal reasons. Stable codes: the API maps them to French, the storefront
# may key UI hints on them.
NO_ITEMS = "NO_ITEMS"
NOTHING_TO_FINANCE = "NOTHING_TO_FINANCE"
DOWN_PAYMENT_BELOW_MINIMUM = "DOWN_PAYMENT_BELOW_MINIMUM"
BELOW_MIN_FINANCED = "BELOW_MIN_FINANCED"
ABOVE_MAX_FINANCED = "ABOVE_MAX_FINANCED"
DURATION_NOT_OFFERED = "DURATION_NOT_OFFERED"
DEBT_RATIO_EXCEEDED = "DEBT_RATIO_EXCEEDED"


@dataclass(frozen=True, slots=True)
class Term:
    months: int
    markup_pct: Decimal


@dataclass(frozen=True, slots=True)
class Rule:
    version: int
    min_financed: Decimal
    max_financed: Decimal
    min_down_payment_pct: Decimal
    max_debt_ratio_pct: Decimal | None
    terms: tuple[Term, ...]

    def term_for(self, months: int) -> Term | None:
        return next((t for t in self.terms if t.months == months), None)

    @property
    def durations(self) -> tuple[int, ...]:
        return tuple(sorted(t.months for t in self.terms))


@dataclass(frozen=True, slots=True)
class Line:
    unit_price: Decimal
    quantity: int


@dataclass(frozen=True, slots=True)
class Profile:
    monthly_income: Decimal
    monthly_obligations: Decimal = Decimal(0)


@dataclass(frozen=True, slots=True)
class Decision:
    eligible: bool
    reasons: tuple[str, ...]
    rule_version: int
    cash_total: Decimal
    down_payment: Decimal
    minimum_down_payment: Decimal
    financed_amount: Decimal
    duration_months: int
    # None when there is nothing to price: no such duration, or nothing financed.
    markup_pct: Decimal | None
    markup_amount: Decimal | None
    total_repayable: Decimal | None
    monthly_instalment: Decimal | None
    schedule: tuple[Decimal, ...]
    # False when no profile was given or the rule sets no debt-ratio cap: the
    # decision is then silent on affordability, and must be presented as such.
    debt_ratio_assessed: bool

    def as_dict(self) -> dict[str, Any]:
        def money(v: Decimal | None) -> str | None:
            return None if v is None else str(v)

        return {
            "eligible": self.eligible,
            "reasons": list(self.reasons),
            "rule_version": self.rule_version,
            "cash_total": money(self.cash_total),
            "down_payment": money(self.down_payment),
            "minimum_down_payment": money(self.minimum_down_payment),
            "financed_amount": money(self.financed_amount),
            "duration_months": self.duration_months,
            "markup_pct": money(self.markup_pct),
            "markup_amount": money(self.markup_amount),
            "total_repayable": money(self.total_repayable),
            "monthly_instalment": money(self.monthly_instalment),
            "schedule": [str(v) for v in self.schedule],
            "debt_ratio_assessed": self.debt_ratio_assessed,
        }


# ── Arithmetic ────────────────────────────────────────────────────────────

def _cents(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def cash_total(lines: Sequence[Line]) -> Decimal:
    return _cents(sum((l.unit_price * l.quantity for l in lines), Decimal(0)))


def minimum_down_payment(total: Decimal, rule: Rule) -> Decimal:
    """Rounded UP to the centime: rounding down would accept an apport a
    fraction of a centime below the rule's own floor."""
    return (total * rule.min_down_payment_pct / HUNDRED).quantize(CENT, rounding=ROUND_CEILING)


def split_evenly(total: Decimal, months: int) -> tuple[Decimal, ...]:
    """`months` instalments summing to exactly `total`, larger ones first,
    differing by at most one centime."""
    cents = int((total * 100).to_integral_value())
    base, rem = divmod(cents, months)
    return tuple(Decimal(base + (1 if i < rem else 0)).scaleb(-2) for i in range(months))


# ── Validation ────────────────────────────────────────────────────────────

def validate_rule(rule: Rule) -> list[str]:
    """What stops a rule from being activated. Empty means it may go live."""
    errors: list[str] = []
    if not rule.terms:
        errors.append("au moins une durée est requise")
    months = [t.months for t in rule.terms]
    if len(set(months)) != len(months):
        errors.append("chaque durée ne peut apparaître qu'une fois")
    for t in rule.terms:
        if not 1 <= t.months <= MAX_TERM_MONTHS:
            errors.append(f"durée hors bornes : {t.months} mois (1 à {MAX_TERM_MONTHS})")
        if not Decimal(0) <= t.markup_pct < MAX_MARKUP_PCT:
            errors.append(f"marge invalide pour {t.months} mois : {t.markup_pct} %")
    if rule.min_financed <= 0:
        errors.append("le montant financé minimum doit être positif")
    if rule.max_financed < rule.min_financed:
        errors.append("le montant financé maximum est inférieur au minimum")
    if not Decimal(0) <= rule.min_down_payment_pct < HUNDRED:
        errors.append("l'apport minimum doit être compris entre 0 et 100 % (exclu)")
    if rule.max_debt_ratio_pct is not None and not Decimal(0) < rule.max_debt_ratio_pct <= HUNDRED:
        errors.append("le taux d'endettement maximum doit être compris entre 0 (exclu) et 100 %")
    return errors


# ── Evaluation ────────────────────────────────────────────────────────────

def evaluate(
    lines: Sequence[Line],
    *,
    down_payment: Decimal,
    duration_months: int,
    rule: Rule,
    profile: Profile | None = None,
) -> Decision:
    """Price a cart under `rule` and say whether it may be financed.

    Every applicable refusal is reported, not just the first, so a simulator
    can tell the shopper everything that needs changing at once. Figures are
    still computed for an ineligible cart whenever they can be — "raise your
    down payment to X" needs them.
    """
    if down_payment < 0:
        raise ValueError("down_payment must not be negative")
    if any(l.quantity <= 0 or l.unit_price < 0 for l in lines):
        raise ValueError("lines need a positive quantity and a non-negative price")

    reasons: list[str] = []
    down_payment = _cents(down_payment)
    total = cash_total(lines)
    min_down = minimum_down_payment(total, rule)

    if not lines:
        reasons.append(NO_ITEMS)
    if down_payment < min_down:
        reasons.append(DOWN_PAYMENT_BELOW_MINIMUM)

    financed = max(total - down_payment, Decimal("0.00"))
    if lines and financed == 0:
        reasons.append(NOTHING_TO_FINANCE)
    elif financed > 0:
        if financed < rule.min_financed:
            reasons.append(BELOW_MIN_FINANCED)
        if financed > rule.max_financed:
            reasons.append(ABOVE_MAX_FINANCED)

    term = rule.term_for(duration_months)
    if term is None:
        reasons.append(DURATION_NOT_OFFERED)

    markup = total_repayable = monthly = None
    schedule: tuple[Decimal, ...] = ()
    if term is not None and financed > 0:
        markup = _cents(financed * term.markup_pct / HUNDRED)
        total_repayable = financed + markup
        schedule = split_evenly(total_repayable, term.months)
        monthly = schedule[0]

    assessed = profile is not None and rule.max_debt_ratio_pct is not None and monthly is not None
    if assessed:
        ceiling = profile.monthly_income * rule.max_debt_ratio_pct / HUNDRED
        if profile.monthly_obligations + monthly > ceiling:
            reasons.append(DEBT_RATIO_EXCEEDED)

    return Decision(
        eligible=not reasons,
        reasons=tuple(reasons),
        rule_version=rule.version,
        cash_total=total,
        down_payment=down_payment,
        minimum_down_payment=min_down,
        financed_amount=financed,
        duration_months=duration_months,
        markup_pct=term.markup_pct if term is not None else None,
        markup_amount=markup,
        total_repayable=total_repayable,
        monthly_instalment=monthly,
        schedule=schedule,
        debt_ratio_assessed=assessed,
    )
