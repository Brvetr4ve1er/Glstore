"""
Spec sanitizer — Phase 9 Push 7.

LLM extraction surfaces noise alongside real product specs. Live test on
`MS-SM8081 PETRIN` showed 14 specs persisted of which roughly half were
inventory-management leakage from a competitor's CSV dump that happened
to be visible in the page text:

    Stock Maximum, CUMP, Statut Stock, Prix de Gros, Valeur Stock,
    Quantité en Stock, Dernier Prix d'Achat, Prix de Vente (Détail), …

These pollute the catalog and confuse the storefront's spec rendering.
This module is the gate — every `(key, value)` pair from LLM payloads
goes through `sanitize_specs()`, which:

    1. **Normalises the key** (lowercase, snake_case, ASCII-fold) so we
       can compare against a stable allow/block list.
    2. **Drops obvious inventory/store-management noise** via a
       block-list of substrings (`stock`, `cump`, `prix de gros`, …).
    3. **Drops anything that's not in the allow-list** of canonical
       product spec keys (per category, plus a base set every product
       can have).
    4. **Sanity-checks the value** — strings under 200 chars, numbers
       in plausible ranges (e.g. `power_w` between 5 and 30000),
       coerces obvious string-numbers to int/float.

The 0-knobs design choice: callers don't have to know about the rules.
They pass a dict in and get a clean dict back, plus a `dropped[]` list
of `(key, reason, value)` triples for audit. The intel_worker writes
the dropped count into `intel_jobs.scrape_summary.specs_dropped` so the
UI can surface "we cleaned 7 noise keys from this product" diagnostics.

Mirrors the design choice from `api/routes/settings.py`'s theme
sanitizer: silent rejection is a bug; surface what got dropped and why.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable

log = logging.getLogger("glstore.spec_sanitizer")


# ── Key normalisation ─────────────────────────────────────────────────────
#
# LLM payloads + scraped HTML produce keys in every imaginable shape:
#   "Power Watts", "puissance_w", "Power (W)", "Puissance(W)", "POWER_W",
#   "Côté", "Statut Stock", "Prix d'Achat"
#
# We normalise to ASCII-folded lowercase snake_case so the block/allow
# lists can be tiny and unambiguous.

_STRIP_PARENS_RE = re.compile(r"[\(\[].*?[\)\]]")
_NON_ALNUM_RE    = re.compile(r"[^a-z0-9]+")


def normalise_key(raw: str) -> str:
    """Lowercase + ASCII-fold + strip parenthetical units + snake_case.

    Examples:
        "Power Watts"            → "power_watts"
        "Puissance (W)"          → "puissance"
        "Côté gauche"            → "cote_gauche"
        "Prix d'Achat"           → "prix_d_achat"
        "Quantité en Stock"      → "quantite_en_stock"
    """
    if not raw:
        return ""
    # Unicode → ASCII (NFD then drop combining marks)
    s = unicodedata.normalize("NFKD", raw)
    s = "".join(c for c in s if not unicodedata.combining(c))
    # Lowercase, drop parenthetical units like "(W)" or "[mm]"
    s = s.lower()
    s = _STRIP_PARENS_RE.sub("", s)
    # Replace anything non-alnum with underscore, collapse repeats, trim
    s = _NON_ALNUM_RE.sub("_", s).strip("_")
    return s


# ── Block-list ────────────────────────────────────────────────────────────
#
# Substrings we KNOW are not product specs. If any matches the normalised
# key, drop the row. Cheaper than maintaining an exhaustive allow-list and
# resilient to spec keys we haven't seen before — only KNOWN-bad gets
# dropped here, KNOWN-good survives, unknowns reach the allow-list pass.

_BLOCK_SUBSTRINGS: tuple[str, ...] = (
    # Inventory management
    "stock", "stok",
    "quantite", "quantity", "qty",
    "valeur",
    # Pricing internals (the LLM keeps wandering into supplier-side data)
    "prix",
    "tarif",
    "achat", "purchase",
    "vente", "sale_price",
    "wholesale", "gros",
    "discount", "remise",
    "cump", "cout_moyen", "cout_unitaire",
    "marge", "margin",
    # Supplier / store-internal
    "fournisseur", "supplier",
    "statut", "status",
    "code_barre", "barcode", "ean",
    "sku",
    # Audit / timestamps
    "date_creation", "created_at", "updated_at",
    "categorie", "category",          # we have a dedicated category column
    "marque", "brand",                # ditto
    "id",                              # generic 'id' column from CSVs
    "_id",
)


# ── Allow-list ────────────────────────────────────────────────────────────
#
# Canonical product-spec keys grouped roughly. We keep a SINGLE flat set
# (rather than per-category) so a key like "weight_kg" is acceptable for
# anything. Categorising would help reduce false positives but the
# product range here is broad (kitchen / TV / fan / mixer / cooker) and
# the gain is marginal vs the maintenance cost.
#
# Keys MUST be in normalised form (lowercase, snake_case, ASCII-only).

_BASE_ALLOWED: frozenset[str] = frozenset({
    # Identity-adjacent
    "model", "model_number", "mpn",
    "color", "couleur", "colour", "finish", "material", "materiau",
    "weight_kg", "weight", "weight_g",
    "dimensions", "dimensions_mm", "dimensions_cm",
    "width", "width_cm", "width_mm",
    "height", "height_cm", "height_mm",
    "depth", "depth_cm", "depth_mm",
    "size",
    "warranty", "warranty_months", "warranty_years", "garantie",
    "made_in", "country_of_origin", "origin",
    "package_includes", "in_the_box", "attachments",

    # Power / electrical
    "power", "power_w", "power_watts", "wattage", "puissance_w",
    "voltage", "voltage_v", "tension",
    "frequency_hz", "frequence", "frequency",
    "amperage", "current_a",
    "energy_class", "energy_rating", "classe_energetique",

    # Capacity / volume
    "capacity", "capacity_l", "capacity_kg", "capacity_ml",
    "bowl_l", "bowl_capacity_l", "bowl_material",
    "tank_l", "reservoir_l",

    # Speed / performance
    "speeds", "speed_settings", "rpm", "max_rpm",
    "modes", "programs",

    # Display / connectivity (TVs, monitors, audio)
    "screen_size", "screen_size_inches", "diagonal", "resolution",
    "refresh_rate_hz", "panel_type", "smart_tv", "hdr",
    "ports", "hdmi", "usb", "bluetooth", "wifi", "ethernet",
    "speaker_w", "audio_w",

    # Cooling / heating
    "btu", "cooling_capacity", "heating_capacity",
    "energy_consumption_kwh", "consumption",
    "noise_db", "noise_level_db",
    "temperature_range",

    # Mixer / kitchen-specific
    "planetary", "tilt_head", "burner_type", "induction",
    "timer", "timer_min",

    # Fan-specific
    "blade_count", "diameter_cm",

    # Generic flags
    "remote_control", "remote",
    "auto_shutoff",
    "removable_bowl",
    "dishwasher_safe",
})


# Aux LLM keys we always allow (they're our own internal annotations,
# already prefixed with `_` so customers never see them):
_AUX_PREFIX = "_"


# ── Value sanity ──────────────────────────────────────────────────────────
#
# Per-key numeric bounds. A stray "screen_size: 1000″" or
# "power_w: 999999" gets rejected before it pollutes the catalog.

_NUMERIC_BOUNDS: dict[str, tuple[float, float]] = {
    "power":               (1, 30_000),
    "power_w":             (1, 30_000),
    "power_watts":         (1, 30_000),
    "puissance_w":         (1, 30_000),
    "wattage":             (1, 30_000),
    "voltage":             (1, 1000),
    "voltage_v":           (1, 1000),
    "frequency_hz":        (1, 1000),
    "amperage":            (0.01, 200),
    "current_a":           (0.01, 200),
    "weight_kg":           (0.001, 500),
    "weight_g":            (1, 500_000),
    "capacity_l":          (0.05, 1000),
    "capacity_kg":         (0.05, 1000),
    "capacity_ml":         (1, 100_000),
    "bowl_l":              (0.5, 100),
    "tank_l":              (0.1, 500),
    "reservoir_l":         (0.1, 500),
    "speeds":              (1, 30),
    "rpm":                 (10, 100_000),
    "max_rpm":             (10, 100_000),
    "screen_size":         (3, 120),
    "screen_size_inches":  (3, 120),
    "refresh_rate_hz":     (24, 480),
    "btu":                 (1000, 200_000),
    "noise_db":            (0, 130),
    "noise_level_db":      (0, 130),
    "diameter_cm":         (1, 300),
    "blade_count":         (1, 12),
    "warranty_months":     (0, 240),
    "warranty_years":      (0, 25),
    "timer_min":           (0, 1440),
    "speaker_w":           (0.1, 1000),
    "audio_w":             (0.1, 1000),
}


_MAX_VALUE_LEN = 200    # Truncate string values; reject if over after trim


# ── Coercion helpers ──────────────────────────────────────────────────────

_NUM_PREFIX_RE = re.compile(r"^\s*([+-]?\d+(?:[.,]\d+)?)\s*")


def _try_number(v: Any) -> float | None:
    """Coerce a string-number to float. Handles `'1400W'`, `'21,5L'`,
    `'1.2 kg'`. Returns None if there's no leading numeric prefix."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if not isinstance(v, str):
        return None
    m = _NUM_PREFIX_RE.match(v)
    if not m:
        return None
    raw = m.group(1).replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


# ── Public API ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DroppedSpec:
    key:    str        # normalised form (what we judged against)
    raw_key: str       # original key from the LLM payload
    reason: str        # 'block_listed' | 'not_in_allowlist' | 'value_too_long'
                       # | 'value_out_of_bounds' | 'empty_value' | 'invalid_type'
    value:  str        # truncated for safe echoing


def sanitize_specs(
    raw_specs: dict[str, Any] | None,
    *,
    extra_allow: Iterable[str] = (),
) -> tuple[dict[str, Any], list[DroppedSpec]]:
    """Run a dict of LLM-extracted specs through the gate.

    Returns ``(clean_specs, dropped)``. ``clean_specs`` is keyed by the
    NORMALISED form (so repeat extractions don't accumulate variant
    spellings of the same field). ``dropped`` is one entry per rejected
    pair with a reason code.

    `extra_allow` lets the caller widen the allow-list temporarily —
    useful in tests and when integrating with category-specific spec
    builders. Pass already-normalised keys.
    """
    clean: dict[str, Any] = {}
    dropped: list[DroppedSpec] = []
    if not isinstance(raw_specs, dict):
        return clean, dropped

    allow = _BASE_ALLOWED | frozenset(extra_allow or ())

    for raw_key, raw_val in raw_specs.items():
        if not isinstance(raw_key, str) or not raw_key:
            dropped.append(DroppedSpec(key="", raw_key=str(raw_key)[:60],
                                        reason="invalid_type", value=""))
            continue

        # Aux keys (our own _seo_description etc.) are always allowed.
        if raw_key.startswith(_AUX_PREFIX):
            if raw_val is None or raw_val == "":
                continue
            clean[raw_key] = raw_val
            continue

        nkey = normalise_key(raw_key)

        if not nkey:
            dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                        reason="invalid_type", value=""))
            continue

        # Block-list pass — substring match on the normalised key.
        if any(b in nkey for b in _BLOCK_SUBSTRINGS):
            dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                        reason="block_listed",
                                        value=str(raw_val)[:60]))
            continue

        # Allow-list pass.
        if nkey not in allow:
            dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                        reason="not_in_allowlist",
                                        value=str(raw_val)[:60]))
            continue

        # Empty / null value rejection
        if raw_val is None:
            dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                        reason="empty_value", value=""))
            continue
        if isinstance(raw_val, str) and not raw_val.strip():
            dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                        reason="empty_value", value=""))
            continue

        # Numeric range check (only if we have bounds for this key)
        bounds = _NUMERIC_BOUNDS.get(nkey)
        if bounds is not None:
            n = _try_number(raw_val)
            if n is None:
                dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                            reason="value_out_of_bounds",
                                            value=str(raw_val)[:60]))
                continue
            lo, hi = bounds
            if not (lo <= n <= hi):
                dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                            reason="value_out_of_bounds",
                                            value=str(raw_val)[:60]))
                continue
            # Coerce to int if the input was an int-shaped string
            clean[nkey] = int(n) if n.is_integer() else n
            continue

        # String value: trim, length-cap.
        if isinstance(raw_val, str):
            v = raw_val.strip()
            if len(v) > _MAX_VALUE_LEN:
                dropped.append(DroppedSpec(key=nkey, raw_key=raw_key,
                                            reason="value_too_long",
                                            value=v[:60]))
                continue
            clean[nkey] = v
            continue

        # Lists / nested dicts pass through if the key is allowed
        # (e.g. attachments=[...] for a mixer).
        clean[nkey] = raw_val

    return clean, dropped


def dropped_summary(dropped: list[DroppedSpec]) -> dict[str, int]:
    """Group dropped specs by reason. Useful for logging without
    blowing up payload size."""
    out: dict[str, int] = {}
    for d in dropped:
        out[d.reason] = out.get(d.reason, 0) + 1
    return out
