"""Tests for the issue-derivation validator (Phase 3)."""
from api.services.validator import (
    CODE_LOW_COMPLETENESS, CODE_LOW_SPECS, CODE_MISSING_BARCODE_MPN,
    CODE_MISSING_BRAND, CODE_MISSING_CATEGORY, CODE_MISSING_DESCRIPTION,
    CODE_MISSING_IMAGE, CODE_MISSING_PRICE, CODE_NO_STOCK,
    ProductFacts, derive_issues, severity_summary,
)


def _facts(**overrides):
    base = dict(
        name="TV SAMSUNG 55 4K", brand="SAMSUNG", category="TV",
        description="Smart TV 55 pouces 4K UHD avec Tizen.", barcode="1234567890",
        mpn=None, spec_count=5, has_retail_price=True, has_stock=True,
        has_primary_image=True, completeness_score=0.85,
    )
    base.update(overrides)
    return ProductFacts(**base)


def test_clean_product_no_issues():
    issues = derive_issues(_facts())
    assert issues == []


def test_missing_brand_flagged():
    issues = derive_issues(_facts(brand=None))
    codes = [i.code for i in issues]
    assert CODE_MISSING_BRAND in codes


def test_unknown_brand_flagged():
    issues = derive_issues(_facts(brand="INCONNU"))
    codes = [i.code for i in issues]
    assert CODE_MISSING_BRAND in codes


def test_missing_category_flagged():
    issues = derive_issues(_facts(category=None))
    codes = [i.code for i in issues]
    assert CODE_MISSING_CATEGORY in codes


def test_generic_category_flagged():
    issues = derive_issues(_facts(category="other"))
    codes = [i.code for i in issues]
    assert CODE_MISSING_CATEGORY in codes
    issues = derive_issues(_facts(category="electromenager"))
    codes = [i.code for i in issues]
    assert CODE_MISSING_CATEGORY in codes


def test_missing_price_flagged():
    issues = derive_issues(_facts(has_retail_price=False))
    codes = [i.code for i in issues]
    assert CODE_MISSING_PRICE in codes


def test_no_stock_warning():
    issues = derive_issues(_facts(has_stock=False))
    codes = [i.code for i in issues]
    assert CODE_NO_STOCK in codes


def test_missing_barcode_and_mpn_flagged():
    issues = derive_issues(_facts(barcode=None, mpn=None))
    codes = [i.code for i in issues]
    assert CODE_MISSING_BARCODE_MPN in codes


def test_having_one_of_barcode_or_mpn_is_fine():
    issues = derive_issues(_facts(barcode=None, mpn="UE55AU7100"))
    codes = [i.code for i in issues]
    assert CODE_MISSING_BARCODE_MPN not in codes


def test_short_description_flagged():
    issues = derive_issues(_facts(description="Petit"))
    codes = [i.code for i in issues]
    assert CODE_MISSING_DESCRIPTION in codes


def test_missing_image_flagged():
    issues = derive_issues(_facts(has_primary_image=False))
    codes = [i.code for i in issues]
    assert CODE_MISSING_IMAGE in codes


def test_low_specs_flagged():
    issues = derive_issues(_facts(spec_count=1))
    codes = [i.code for i in issues]
    assert CODE_LOW_SPECS in codes


def test_low_completeness_flagged():
    issues = derive_issues(_facts(completeness_score=0.30))
    codes = [i.code for i in issues]
    assert CODE_LOW_COMPLETENESS in codes


def test_severity_ordering():
    """Errors come before warnings, warnings before info."""
    issues = derive_issues(_facts(
        brand=None, category=None,        # → 2 errors
        barcode=None, mpn=None,           # → 1 warning
        spec_count=1,                     # → 1 info
        has_retail_price=False,           # → 1 error
    ))
    severities = [i.severity for i in issues]
    # Once errors run out, no error should appear after a warning
    seen_warning = False
    seen_info = False
    for s in severities:
        if s == "info": seen_info = True
        elif s == "warning":
            seen_warning = True
            assert not seen_info, "warning after info"
        elif s == "error":
            assert not seen_warning, "error after warning"


def test_severity_summary_counts():
    issues = derive_issues(_facts(brand=None, has_stock=False, completeness_score=0.30))
    summary = severity_summary(issues)
    assert summary["error"]   >= 1
    assert summary["warning"] >= 1
    assert summary["info"]    >= 1


def test_fix_hint_includes_brand_suggestion():
    """When brand is missing, the validator re-runs detect_brand for a hint."""
    issues = derive_issues(_facts(brand=None, name="TV SAMSUNG 55"))
    brand_issue = next(i for i in issues if i.code == CODE_MISSING_BRAND)
    assert brand_issue.fix_hint.get("suggested_value") == "SAMSUNG"
    assert isinstance(brand_issue.fix_hint.get("options"), list)
