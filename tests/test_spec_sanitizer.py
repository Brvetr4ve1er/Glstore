"""Tests for the spec sanitizer (Phase 9 Push 7).

Pure module — no DB, no network — exercises the LLM-output-cleanup
gate on real noise observed during the live intel test on
`MS-SM8081 PETRIN`.
"""
from __future__ import annotations

import pytest

from api.services.spec_sanitizer import (
    DroppedSpec, dropped_summary, normalise_key, sanitize_specs,
)


# ── Key normalisation ────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("Power Watts",        "power_watts"),
    ("Puissance (W)",      "puissance"),       # parenthetical units stripped
    ("PUISSANCE",          "puissance"),       # lowercased
    ("Côté gauche",        "cote_gauche"),     # ASCII-folded
    ("Quantité en Stock",  "quantite_en_stock"),
    ("Prix d'Achat",       "prix_d_achat"),
    ("Stock Maximum",      "stock_maximum"),
    ("CUMP",               "cump"),
    ("Power (W)",          "power"),
    ("Power_W",            "power_w"),
    ("color",              "color"),
    ("",                   ""),
    ("   ",                ""),
])
def test_normalise_key(raw, expected):
    assert normalise_key(raw) == expected


def test_normalise_key_handles_unicode_combining_marks():
    """Algerian product pages mix multiple unicode normalisations
    (NFC/NFD). Our normaliser must collapse to ASCII."""
    nfc = "Côté"
    nfd = "Côté"   # same letters, decomposed
    assert normalise_key(nfc) == normalise_key(nfd) == "cote"


# ── Block-list: real noise observed in the live test ──────────────────────

@pytest.mark.parametrize("noise_key", [
    "Stock Maximum",
    "Stock Minimum",
    "Quantité en Stock",
    "Statut Stock",
    "Valeur Stock (CUMP)",
    "Valeur Stock (Prix de Gros)",
    "Valeur Stock (Prix de Vente)",
    "Prix de Gros",
    "Prix de Vente (Détail)",
    "Prix d'Achat",
    "Dernier Prix d'Achat",
    "CUMP (Coût Unitaire Moyen Pondéré)",
    "Code Barre",
    "ID",
    "Marque",                # we have a dedicated brand column
    "Catégorie",             # we have a dedicated category column
    "SKU",
])
def test_block_list_drops_known_inventory_noise(noise_key):
    raw = {noise_key: "12345"}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}, f"expected {noise_key!r} to be dropped"
    assert len(dropped) == 1
    assert dropped[0].reason == "block_listed"
    assert dropped[0].raw_key == noise_key


# ── Allow-list: real specs that should pass ──────────────────────────────

@pytest.mark.parametrize("good_key,good_val,expected_norm", [
    ("Power Watts",         1400,        "power_watts"),
    ("color",               "rouge",     "color"),
    ("bowl_l",              6,           "bowl_l"),
    ("speeds",              6,           "speeds"),
    ("planetary",           True,        "planetary"),
    ("attachments",         ["Fouet", "Crochet", "Batteur"], "attachments"),
    ("warranty_months",     24,          "warranty_months"),
    ("screen_size_inches",  55,          "screen_size_inches"),
    ("noise_db",            42,          "noise_db"),
    ("model",               "MS-SM8081", "model"),
])
def test_allow_list_passes_real_specs(good_key, good_val, expected_norm):
    raw = {good_key: good_val}
    clean, dropped = sanitize_specs(raw)
    assert dropped == [], f"unexpected drops: {dropped}"
    assert expected_norm in clean


def test_unknown_keys_dropped_with_clear_reason():
    raw = {"random_garbage_field": "xyz"}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert len(dropped) == 1
    assert dropped[0].reason == "not_in_allowlist"


# ── Aux keys (always allowed, prefixed with `_`) ──────────────────────────

def test_aux_keys_bypass_allow_list():
    raw = {"_seo_description": "blah", "_pros": ["fast", "cheap"]}
    clean, dropped = sanitize_specs(raw)
    assert clean["_seo_description"] == "blah"
    assert clean["_pros"] == ["fast", "cheap"]
    assert dropped == []


def test_aux_keys_still_drop_empty_values():
    raw = {"_seo_description": ""}
    clean, _ = sanitize_specs(raw)
    assert "_seo_description" not in clean


# ── Numeric range checks ──────────────────────────────────────────────────

def test_numeric_value_within_bounds_is_coerced():
    """LLMs return '1400W' for power; we want the integer 1400."""
    raw = {"power_w": "1400W"}
    clean, dropped = sanitize_specs(raw)
    assert dropped == []
    assert clean["power_w"] == 1400
    assert isinstance(clean["power_w"], int)


def test_numeric_value_with_french_comma():
    """`'21,5L'` is a valid French capacity literal."""
    raw = {"capacity_l": "21,5L"}
    clean, dropped = sanitize_specs(raw)
    assert dropped == []
    assert clean["capacity_l"] == 21.5


def test_numeric_value_out_of_bounds_rejected():
    """The LLM hallucinated `screen_size: '1000″'` in a previous run.
    1000-inch screens don't exist; the bound is 3..120."""
    raw = {"screen_size_inches": 1000}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert len(dropped) == 1
    assert dropped[0].reason == "value_out_of_bounds"


def test_negative_power_rejected():
    raw = {"power_w": -50}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert dropped[0].reason == "value_out_of_bounds"


def test_zero_power_rejected():
    """`power_w=0` is almost always a parsing artifact."""
    raw = {"power_w": 0}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}


# ── String values ────────────────────────────────────────────────────────

def test_string_values_get_trimmed():
    raw = {"color": "  rouge  "}
    clean, _ = sanitize_specs(raw)
    assert clean["color"] == "rouge"


def test_string_value_too_long_is_dropped():
    raw = {"color": "A" * 250}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert dropped[0].reason == "value_too_long"


def test_empty_string_value_dropped_as_empty():
    raw = {"color": "   "}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert dropped[0].reason == "empty_value"


def test_none_value_dropped():
    raw = {"color": None}
    clean, dropped = sanitize_specs(raw)
    assert clean == {}
    assert dropped[0].reason == "empty_value"


# ── Real-world payload from the live MS-SM8081 PETRIN run ────────────────

REAL_PETRIN_PAYLOAD = {
    # Real specs (should survive)
    "color":                "rouge",
    "bowl_l":               6,
    "speeds":               6,
    "power_w":              1000,
    "planetary":            True,
    "power_watts":          "1400W",
    "attachments":          ["Fouet", "Crochet", "Batteur"],
    "bowl_material":        "Inox",
    # Inventory leakage (must be dropped)
    "Stock Maximum":        999999,
    "Stock Minimum":        0,
    "Quantité en Stock":    0,
    "Statut Stock":         "Rupture",
    "Valeur Stock (CUMP)":  0,
    "Valeur Stock (Prix de Gros)":  0,
    "Valeur Stock (Prix de Vente)": 0,
    "Prix de Gros":         18900,
    "Prix de Vente (Détail)": 21900,
    "Prix d'Achat":         "",
    "Dernier Prix d'Achat": "",
    "CUMP (Coût Unitaire Moyen Pondéré)": 0,
    "Code Barre":           "20642439930951",
    "Marque":               "",
    "Catégorie":            "Electromenager",
    "ID":                   "69283a63e4db9309009dfa94",
    "Nom":                  "PETRIN MS 1400W ROUGE",
    "SKU":                  "MS-SM8081",
    "sku":                  "MS-SM8081",
    "price_dzd":            "21900.00 DZD",   # not in allow-list → drop
}


def test_real_petrin_payload_drops_inventory_keeps_specs():
    """The acceptance test for the live observation. The 14-spec dump
    we got from MS-SM8081 should reduce to ~8 real specs after the
    sanitizer pass."""
    clean, dropped = sanitize_specs(REAL_PETRIN_PAYLOAD)

    # Real specs survive
    assert clean.get("color") == "rouge"
    assert clean.get("bowl_l") == 6
    assert clean.get("speeds") == 6
    assert clean.get("power_w") == 1000
    assert clean.get("power_watts") == 1400      # coerced from "1400W"
    assert clean.get("planetary") is True
    assert clean.get("attachments") == ["Fouet", "Crochet", "Batteur"]
    assert clean.get("bowl_material") == "Inox"

    # Every inventory key is gone
    inventory_block_substrings = ("stock", "prix", "cump", "code_barre", "id", "marque", "categorie")
    for k in clean:
        if k.startswith("_"): continue
        assert not any(s in k for s in inventory_block_substrings), \
            f"inventory leak survived: {k}"

    # We expect ~8 real specs survived; everything else got a reason
    assert len(clean) >= 8
    assert len(dropped) >= 10


def test_dropped_summary_groups_by_reason():
    _clean, dropped = sanitize_specs(REAL_PETRIN_PAYLOAD)
    summary = dropped_summary(dropped)
    # Every reason is a non-empty key with a positive count
    assert summary
    assert all(isinstance(k, str) and k for k in summary.keys())
    assert all(v >= 1 for v in summary.values())
    # Real test data should have block_listed as the dominant reason
    assert summary.get("block_listed", 0) >= 5


# ── Edge cases ────────────────────────────────────────────────────────────

def test_non_dict_input_returns_empty_clean_and_empty_dropped():
    """Defensive: LLM might return None or a list for `specs`."""
    for bad in (None, [], "not a dict", 42):
        clean, dropped = sanitize_specs(bad)  # type: ignore[arg-type]
        assert clean == {}
        assert dropped == []


def test_extra_allow_widens_allowlist():
    """Categories that need bespoke specs can pass extra_allow."""
    raw = {"smoke_detector_decibels": 90}
    clean, dropped = sanitize_specs(raw, extra_allow=["smoke_detector_decibels"])
    assert dropped == []
    assert clean["smoke_detector_decibels"] == 90


def test_dropped_value_truncated_in_diagnostics():
    """Dropped diagnostics echo the value, but we cap it so a malicious
    100kB key can't bloat the response."""
    raw = {"stock_maximum": "X" * 1000}
    _, dropped = sanitize_specs(raw)
    assert len(dropped[0].value) <= 60


def test_dropped_dataclass_is_frozen():
    d = DroppedSpec(key="x", raw_key="X", reason="block_listed", value="0")
    with pytest.raises((AttributeError, Exception)):
        d.reason = "value_out_of_bounds"   # type: ignore[misc]
