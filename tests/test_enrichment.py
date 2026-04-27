"""Tests for the rule-based enrichment engine."""
from api.services.enrichment import (
    detect_brand, detect_category, enrich, extract_specs, parse_flags,
    compute_completeness,
)


# ── brand detection ──────────────────────────────────────────────────────

def test_detect_brand_known():
    assert detect_brand("TV SAMSUNG 55 4K UHD") == "SAMSUNG"
    assert detect_brand("FRIGO HISENSE 350L") == "HISENSE"
    assert detect_brand("Frigo Beko 280L") == "BEKO"


def test_detect_brand_local_dz():
    assert detect_brand("AIR COOLER GEANT") == "GEANT"
    assert detect_brand("FOUR CONDOR 4F") == "CONDOR"
    assert detect_brand("MICRO-ONDES IRIS 28L") == "IRIS"


def test_detect_brand_unknown_returns_none():
    assert detect_brand("PRODUIT GENERIQUE XYZ") is None


def test_detect_brand_empty_safe():
    assert detect_brand("") is None
    assert detect_brand(None) is None  # type: ignore[arg-type]


def test_detect_brand_longest_match_wins():
    """'CONTI GLOBAL' should win over 'CONTIGLOBAL' fragment matches."""
    assert detect_brand("WASHING MACHINE CONTI GLOBAL 8 KG") == "CONTI GLOBAL"


# ── category detection ──────────────────────────────────────────────────

def test_detect_category_tv():
    cat = detect_category("TV SAMSUNG 55 4K UHD")
    assert cat is not None and cat.id == "tv" and cat.en_label == "TV"


def test_detect_category_microwave():
    cat = detect_category("MICRO-ONDES SAMSUNG 28L GRILL")
    assert cat is not None and cat.id == "microwave"


def test_detect_category_washing_machine():
    cat = detect_category("MACHINE A LAVER LG 8KG INVERTER")
    assert cat is not None and cat.id == "washing_machine"
    cat2 = detect_category("LAVE LINGE BEKO 9KG")
    assert cat2 is not None and cat2.id == "washing_machine"


def test_detect_category_refrigerator():
    cat = detect_category("REFRIGERATEUR HISENSE 350L NO FROST")
    assert cat is not None and cat.id == "refrigerator"


def test_detect_category_unknown_returns_none():
    cat = detect_category("ARTICLE DIVERS")
    assert cat is None


# ── spec extraction ──────────────────────────────────────────────────────

def test_extract_screen_size():
    specs = extract_specs("TV SAMSUNG 55 POUCES")
    assert specs.get("size_or_feux") == 55


def test_extract_screen_with_quote():
    specs = extract_specs('TV LG 65" UHD')
    assert specs.get("size_or_feux") == 65


def test_extract_capacity_kg():
    specs = extract_specs("MACHINE A LAVER LG 8 KG INVERTER")
    assert specs.get("capacity_kg") == 8.0


def test_extract_capacity_l():
    specs = extract_specs("REFRIGERATEUR HISENSE 350L")
    assert specs.get("capacity_l") == 350


def test_extract_filters_out_small_l_false_positives():
    """'LG' has an L in it — must not be extracted as 'capacity_l': L."""
    specs = extract_specs("FRIGO LG GR-N7000")
    assert "capacity_l" not in specs or specs["capacity_l"] >= 10


def test_extract_watts():
    specs = extract_specs("MICRO-ONDES SAMSUNG 800W")
    assert specs.get("watts") == 800


def test_extract_btu():
    specs = extract_specs("CLIMATISEUR LG 18000 BTU INVERTER")
    assert specs.get("btu") == 18000


# ── flags ─────────────────────────────────────────────────────────────────

def test_parse_flags_smart_tv():
    f = parse_flags("TV SAMSUNG 55 SMART GOOGLE TV")
    assert f["smart"]


def test_parse_flags_qled():
    f = parse_flags("TV SAMSUNG 65 QLED")
    assert f["qled"]


def test_parse_flags_inox():
    f = parse_flags("FRIGO BEKO INOX 350L")
    assert f["inox"]


def test_parse_flags_inverter():
    f = parse_flags("MACHINE A LAVER LG INVERTER 8 KG")
    assert f["inverter"]


# ── completeness scoring ─────────────────────────────────────────────────

def test_completeness_full_house():
    score = compute_completeness(
        has_brand=True, has_category=True, has_retail_price=True,
        has_stock=True, has_barcode_or_mpn=True, has_description=True,
        has_primary_image=True, spec_count=5,
    )
    assert score >= 0.95


def test_completeness_minimal():
    score = compute_completeness(
        has_brand=False, has_category=False, has_retail_price=False,
        has_stock=False, has_barcode_or_mpn=False, has_description=False,
        has_primary_image=False, spec_count=0,
    )
    assert score == 0.0


def test_completeness_partial():
    # Brand + category + price + stock = 0.18+0.18+0.18+0.10 = 0.64
    score = compute_completeness(
        has_brand=True, has_category=True, has_retail_price=True,
        has_stock=True, has_barcode_or_mpn=False, has_description=False,
        has_primary_image=False, spec_count=0,
    )
    assert 0.60 < score < 0.70


def test_completeness_caps_at_1():
    score = compute_completeness(
        has_brand=True, has_category=True, has_retail_price=True,
        has_stock=True, has_barcode_or_mpn=True, has_description=True,
        has_primary_image=True, spec_count=99,
    )
    assert score == 1.0


# ── enrich() integration ─────────────────────────────────────────────────

def test_enrich_full_pipeline():
    r = enrich(
        "TV SAMSUNG 55 4K SMART",
        explicit_brand=None,
        explicit_category=None,
        has_retail_price=True,
        has_stock=True,
    )
    assert r.detected_brand == "SAMSUNG"
    assert r.brand_source   == "regex"
    assert r.detected_category_id    == "tv"
    assert r.detected_category_label == "TV"
    assert "screen_size" in r.auto_attributes or r.auto_attributes.get("smart_tv")
    assert r.completeness > 0.4
    assert r.new_status in ("CLASSIFIED", "VERIFIED")


def test_enrich_explicit_brand_respected():
    r = enrich(
        "TV samsung-clone 55",
        explicit_brand="HISENSE",   # user manually set
    )
    assert r.detected_brand == "HISENSE"
    assert r.brand_source   == "explicit"


def test_enrich_unknown_brand_yields_needs_fix():
    r = enrich("XYZ THINGY 123")
    assert r.detected_brand is None
    assert r.new_status == "NEEDS_FIX"
