"""
Rule-based enrichment service — Python port of orbital-perihelion's
src/services/enrichment.ts + product-enrichments.js attribute builders.

Pure functions — no DB, no IO. Operates on dict-shaped products and
returns a dict of derived facts: detected brand, category, parsed specs,
auto-attributes, and a recomputed completeness score.

This is Tier-1 enrichment: free, instant, deterministic. Tier-2 LLM
enrichment (Phase 4) consumes the output of this layer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

# ── Brands ──────────────────────────────────────────────────────────────────

KNOWN_BRANDS: tuple[str, ...] = (
    "SAMSUNG", "HISENSE", "MIDEA", "TCL", "IRIS", "CONDOR", "GEANT",
    "MULTISMART", "SCHALLENGE", "ARCODYM", "CONTIGLOBAL", "CONTI GLOBAL",
    "SONIFER", "MOULINEX", "TEFAL", "BRANDT", "ARTCOOL", "BRENT",
    "CRISTOR", "ELECTROGAS", "GENERAL", "WINOR", "RAYLAN", "HYUNDAI",
    "BEKO", "HOOVER", "ARISTON", "HOTPOINT", "THOMSON", "BOOMAX",
    "MEGATRONICS", "KENWOOD", "BERGHAM", "BERGMANN", "FIRAX",
    "DIGITECH", "CRRAFT", "CRAFT", "MOSER", "MOZER", "STARMAN",
    "WESTCROWN", "BOMANN", "CAMRY", "LUXINOX", "MESKO", "NOVACEL",
    "KRUPS", "ROYALTYLINE", "NEWSTAR", "COBRA", "EAGLFLY", "TOYOTA",
    "LG", "SONY", "PANASONIC", "PHILIPS", "WHIRLPOOL", "BOSCH", "SIEMENS",
)

BRAND_DESCRIPTIONS: dict[str, str] = {
    "SAMSUNG": "Marque premium mondiale reconnue pour l'innovation et la qualité durable.",
    "HISENSE": "Marque chinoise offrant un excellent rapport qualité/prix sur le marché algérien.",
    "MIDEA":   "Leader mondial de l'électroménager, connu pour la fiabilité et les prix compétitifs.",
    "TCL":     "Marque technologique en forte croissance, spécialisée dans les écrans.",
    "IRIS":    "Marque algérienne populaire avec une gamme complète d'électroménager.",
    "CONDOR":  "Fabricant algérien de référence, réseau SAV étendu à travers le pays.",
    "GEANT":   "Marque algérienne très populaire, large gamme et prix accessibles.",
    "BEKO":    "Marque turque incontournable, gamme large et SAV solide.",
    "LG":      "Marque sud-coréenne premium, leader sur l'innovation OLED et inverter.",
    "BOSCH":   "Marque allemande haut de gamme, fiabilité et durabilité reconnues.",
    "DEFAULT": "Marque d'électroménager disponible sur le marché algérien.",
}


def detect_brand(name: str) -> str | None:
    """Return canonical brand or None if no match."""
    if not name:
        return None
    upper = name.upper()
    # Longest match first so 'CONTI GLOBAL' wins over 'CONTI'
    for brand in sorted(KNOWN_BRANDS, key=len, reverse=True):
        if brand in upper:
            return brand
    return None


def get_brand_description(brand: str | None) -> str:
    if not brand:
        return BRAND_DESCRIPTIONS["DEFAULT"]
    return BRAND_DESCRIPTIONS.get(brand.upper(), BRAND_DESCRIPTIONS["DEFAULT"])


# ── Categories ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CategoryMatch:
    id: str           # canonical: 'tv', 'washing_machine'
    label: str        # display (FR): 'Télévision', 'Machine à Laver'
    en_label: str     # display (EN, used in GLstore.products.category): 'TV'


# Order matters: more specific patterns first, generic last.
CATEGORY_PATTERNS: tuple[tuple[re.Pattern[str], CategoryMatch], ...] = (
    (re.compile(r"\bMICRO[- ]?ONDE",           re.I), CategoryMatch("microwave",       "Micro-Ondes",         "Microwave")),
    (re.compile(r"\bMACHINE\s+A\s+LAVER",      re.I), CategoryMatch("washing_machine", "Machine à Laver",     "Washing Machine")),
    (re.compile(r"\bLAVE\s+LINGE",             re.I), CategoryMatch("washing_machine", "Machine à Laver",     "Washing Machine")),
    (re.compile(r"\bMACHINE\s+A\s+VAISSELLE",  re.I), CategoryMatch("dishwasher",      "Lave-Vaisselle",      "Dishwasher")),
    (re.compile(r"\bFOUR[- ]?ENCASTRABL",      re.I), CategoryMatch("builtin_oven",    "Four Encastrable",    "Oven")),
    (re.compile(r"\bFOUR[- ]?ELECTRIQUE",      re.I), CategoryMatch("electric_oven",   "Four Électrique",     "Oven")),
    (re.compile(r"\bFOUR\s+ELECTRIC",          re.I), CategoryMatch("electric_oven",   "Four Électrique",     "Oven")),
    (re.compile(r"\bPLAQUE[- ]?CHAUFFANT",     re.I), CategoryMatch("cooktop",         "Plaque Chauffante",   "Cooktop")),
    (re.compile(r"\bCLIMATISEUR",              re.I), CategoryMatch("ac",              "Climatiseur",         "AC")),
    (re.compile(r"\bCONGELATEUR",              re.I), CategoryMatch("freezer",         "Congélateur",         "Refrigerator")),
    (re.compile(r"\bREFRIGE?RATEUR",           re.I), CategoryMatch("refrigerator",    "Réfrigérateur",       "Refrigerator")),
    (re.compile(r"\bREFRIGRATEUR",             re.I), CategoryMatch("refrigerator",    "Réfrigérateur",       "Refrigerator")),
    (re.compile(r"\bCUIS(?:INIERE|\b[- ])",    re.I), CategoryMatch("cooker",          "Cuisinière",          "Oven")),
    (re.compile(r"\bAIR\s+FRYER",              re.I), CategoryMatch("fryer",           "Air Fryer",           "Fryer")),
    (re.compile(r"\bFRITEUSE",                 re.I), CategoryMatch("fryer",           "Friteuse",            "Fryer")),
    (re.compile(r"\bASPIRATEUR",               re.I), CategoryMatch("vacuum",          "Aspirateur",          "Vacuum")),
    (re.compile(r"\bBAIN\s+D\s*'?\s*HUILE",    re.I), CategoryMatch("oil_heater",      "Bain d'Huile",        "Accessory")),
    (re.compile(r"\bCHAUFFAGE",                re.I), CategoryMatch("gas_heater",      "Chauffage",           "Accessory")),
    (re.compile(r"\bCHAUFF\s*BAIN",            re.I), CategoryMatch("water_dispenser", "Chauffe-Bain",        "Accessory")),
    (re.compile(r"\bBATTEUR",                  re.I), CategoryMatch("mixer",           "Pétrin/Batteur",      "Mixer")),
    (re.compile(r"\bPETRIN",                   re.I), CategoryMatch("mixer",           "Pétrin/Batteur",      "Mixer")),
    (re.compile(r"\bBLENDER",                  re.I), CategoryMatch("blender",         "Blender",             "Blender")),
    (re.compile(r"\bCAFE?TIER",                re.I), CategoryMatch("coffee_machine",  "Cafetière",           "Coffee Machine")),
    (re.compile(r"\bCAFITIER",                 re.I), CategoryMatch("coffee_machine",  "Cafetière",           "Coffee Machine")),
    (re.compile(r"\bMACHINE\s+A\s+CAFE",       re.I), CategoryMatch("coffee_machine",  "Cafetière",           "Coffee Machine")),
    (re.compile(r"\bESPRESSO",                 re.I), CategoryMatch("coffee_machine",  "Cafetière Espresso",  "Coffee Machine")),
    (re.compile(r"\bCOCOTTE",                  re.I), CategoryMatch("pressure_cooker", "Cocotte",             "Accessory")),
    (re.compile(r"\bFER\s+(?:A|À)",            re.I), CategoryMatch("iron",            "Fer à Repasser",      "Iron")),
    (re.compile(r"\bFER\b",                    re.I), CategoryMatch("iron",            "Fer à Repasser",      "Iron")),
    (re.compile(r"\bFONTAIN",                  re.I), CategoryMatch("water_dispenser", "Fontaine",            "Accessory")),
    (re.compile(r"\bHACHOIR",                  re.I), CategoryMatch("blender",         "Hachoir",             "Blender")),
    (re.compile(r"\bMOULINETTE",               re.I), CategoryMatch("blender",         "Moulinette",          "Blender")),
    (re.compile(r"\bHOTTE",                    re.I), CategoryMatch("range_hood",      "Hotte",               "Accessory")),
    (re.compile(r"\bJUICER",                   re.I), CategoryMatch("blender",         "Centrifugeuse",       "Blender")),
    (re.compile(r"\bPRESSE\s+AGRUME",          re.I), CategoryMatch("blender",         "Presse-Agrume",       "Blender")),
    (re.compile(r"\bPANINEUSE",                re.I), CategoryMatch("toaster",         "Panineuse",           "Toaster")),
    (re.compile(r"\bGRILL",                    re.I), CategoryMatch("toaster",         "Panineuse/Grill",     "Toaster")),
    (re.compile(r"\bSECHE[- ]?CHEVEUX",        re.I), CategoryMatch("hair_dryer",      "Sèche-Cheveux",       "Hair Dryer")),
    (re.compile(r"\bTOASTER",                  re.I), CategoryMatch("toaster",         "Toaster",             "Toaster")),
    (re.compile(r"\bVENTILATEUR",              re.I), CategoryMatch("fan",             "Ventilateur",         "Fan")),
    (re.compile(r"\bAIR\s+COOLER",             re.I), CategoryMatch("fan",             "Refroidisseur d'Air", "Fan")),
    (re.compile(r"\bBOULOIRE",                 re.I), CategoryMatch("kettle",          "Bouilloire",          "Kettle")),
    (re.compile(r"\bBOUILLOIRE",               re.I), CategoryMatch("kettle",          "Bouilloire",          "Kettle")),
    (re.compile(r"\bEPILATEUR",                re.I), CategoryMatch("beauty",          "Épilateur",           "Beauty")),
    (re.compile(r"\bTONDEUSE",                 re.I), CategoryMatch("beauty",          "Tondeuse",            "Beauty")),
    (re.compile(r"\bBALANCE",                  re.I), CategoryMatch("kitchen_scale",   "Balance de Cuisine",  "Accessory")),
    (re.compile(r"\bSARTOR[iy]US",             re.I), CategoryMatch("kitchen_scale",   "Balance de Précision","Accessory")),
    (re.compile(r"\bCREPIE?RE",                re.I), CategoryMatch("toaster",         "Crêpière",            "Toaster")),
    (re.compile(r"\bGAFRIERE|\bGAUFRIER",      re.I), CategoryMatch("toaster",         "Gaufrier",            "Toaster")),
    (re.compile(r"\bPLANCHA",                  re.I), CategoryMatch("toaster",         "Plancha",             "Toaster")),
    (re.compile(r"\bRESISTANCE",               re.I), CategoryMatch("oil_heater",     "Résistance",          "Accessory")),
    (re.compile(r"\bRECHAUD",                  re.I), CategoryMatch("cooktop",         "Réchaud à Gaz",       "Cooktop")),
    # TV last so it doesn't clobber 'TVS' in nonsense names — but \bTV\b is safe
    (re.compile(r"\bTV\b",                     re.I), CategoryMatch("tv",              "Télévision",          "TV")),
    # IT / Mobile
    (re.compile(r"\bSMARTPHONE|\bIPHONE|\bGALAXY", re.I), CategoryMatch("smartphone", "Smartphone",  "Smartphone")),
    (re.compile(r"\bLAPTOP|\bPC\s+PORTABLE",    re.I), CategoryMatch("laptop",         "Ordinateur Portable", "Laptop")),
    (re.compile(r"\bTABLET|\bIPAD",             re.I), CategoryMatch("tablet",         "Tablette",            "Tablet")),
)


def detect_category(name: str) -> CategoryMatch | None:
    if not name:
        return None
    for pattern, cat in CATEGORY_PATTERNS:
        if pattern.search(name):
            return cat
    return None


# ── Specs & flags ───────────────────────────────────────────────────────────

_SCREEN_RE   = re.compile(r"\b(\d{2,3})\s*(?:P\b|\"|\s*(?:POUCES?|INCHES?))", re.I)
_KG_RE       = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*KG?\b", re.I)
_LITRE_RE    = re.compile(r"\b(\d+)\s*L(?:ITRES?)?\b", re.I)
_WATT_RE     = re.compile(r"\b(\d{3,4})\s*W(?:ATTS?)?\b", re.I)
_HP_RE       = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(?:HP|CV|CH)\b", re.I)
_BTU_RE      = re.compile(r"\b(\d{4,6})\s*BTU", re.I)
_COUVERT_RE  = re.compile(r"\b(\d+)\s*COUVERTS?", re.I)
_ELEMENT_RE  = re.compile(r"\b(\d+)\s*ELEMENT", re.I)


def extract_specs(name: str) -> dict[str, Any]:
    """Pull numeric specs from product name."""
    if not name:
        return {}
    upper = name.upper()
    specs: dict[str, Any] = {}

    if m := _SCREEN_RE.search(upper):
        specs["size_or_feux"] = int(m.group(1))
    if m := _KG_RE.search(upper):
        specs["capacity_kg"] = float(m.group(1).replace(",", "."))
    if m := _LITRE_RE.search(upper):
        # Filter false positives (model numbers like 'LG'). Require ≥ 10L.
        v = int(m.group(1))
        if v >= 10:
            specs["capacity_l"] = v
    if m := _WATT_RE.search(upper):
        specs["watts"] = int(m.group(1))
    if m := _HP_RE.search(upper):
        specs["hp"] = float(m.group(1).replace(",", "."))
    if m := _BTU_RE.search(upper):
        specs["btu"] = int(m.group(1))
    if m := _COUVERT_RE.search(upper):
        specs["couvert"] = int(m.group(1))
    if m := _ELEMENT_RE.search(upper):
        specs["elements"] = int(m.group(1))
    return specs


def parse_flags(name: str) -> dict[str, bool]:
    if not name:
        return {}
    upper = name.upper()
    return {
        "smart":       bool(re.search(r"SMART|GOOGLE\s+TV|VIDAA|ANDROID", upper)),
        "afficheur":   bool(re.search(r"AFFICHEUR|DISPLAY|DIGITAL",       upper)),
        "ventil":      bool(re.search(r"VENTIL",                          upper)),
        "glass":       bool(re.search(r"GLASS|VERRE|VITRE",               upper)),
        "inox":        bool(re.search(r"INOX",                            upper)),
        "double":      bool(re.search(r"DOUBLE",                          upper)),
        "multi":       bool(re.search(r"MULTI|3EN1|3IN1|2IN1|2EN1|5IN1",  upper)),
        "qled":        bool(re.search(r"QLED",                            upper)),
        "encastrable": bool(re.search(r"ENCASTRABLE",                     upper)),
        "inverter":    bool(re.search(r"INVERTER|INVENTER",               upper)),
    }


# ── ATTR_BUILDERS — per-category derived attributes ─────────────────────────

def _b_tv(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "panel_type": "QLED" if flags.get("qled") else "LED",
        "smart_tv":   flags.get("smart", False),
    }
    if (size := nums.get("size_or_feux")) is not None:
        out["screen_size"] = f'{size}"'
        out["resolution"] = "4K UHD" if size >= 50 else ("FHD" if size >= 40 else "HD")
    if "GOOGLE TV" in name.upper(): out["os"] = "Google TV"
    elif "VIDAA" in name.upper():   out["os"] = "VIDAA"
    elif "ANDROID" in name.upper(): out["os"] = "Android TV"
    elif flags.get("smart"):        out["os"] = "Smart TV"
    return out


def _b_washing(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "motor_type":  "Inverter" if flags.get("inverter") else "Standard",
        "loading_type": "Top" if "TOP" in name.upper() else ("Semi-Auto" if "SEMI" in name.upper() else "Frontal"),
        "energy_class": "A+",
    }
    if cap := nums.get("capacity_kg"):
        out["capacity_kg"] = cap
        out["spin_rpm"] = 1400 if cap >= 10 else 1200
    return out


def _b_refrigerator(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"compressor": "Standard", "energy_class": "A+"}
    if cap := nums.get("capacity_l"):
        out["capacity_l"] = cap
        out["no_frost"] = cap > 300
    if flags.get("inox"): out["finish"] = "Inox"
    if "DISTRIBUT" in name.upper(): out["dispenser"] = True
    out["doors"] = "2 Portes" if re.search(r"2P|SIDE|DISTRIBUT", name.upper()) else "1 Porte"
    return out


def _b_freezer(nums: dict, flags: dict, _name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "Coffre"}
    if cap := nums.get("capacity_l"): out["capacity_l"] = cap
    elif cap := nums.get("capacity_kg"): out["capacity_kg"] = cap
    return out


def _b_ac(nums: dict, flags: dict, _name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "Split", "inverter": True}
    if hp := nums.get("hp"): out["power_hp"] = hp
    if btu := nums.get("btu"): out["btu"] = btu
    return out


def _b_microwave(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    cap = nums.get("capacity_l") or 20
    out: dict[str, Any] = {
        "capacity_l": cap,
        "power_w": nums.get("watts") or (900 if cap >= 25 else 700),
        "grill": bool(re.search(r"GRILL", name.upper())) or cap >= 25,
        "display": flags.get("afficheur") or cap >= 28,
    }
    return out


def _b_dishwasher(nums: dict, flags: dict, _name: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if c := nums.get("couvert"): out["couvert"] = c
    return out


def _b_cooker(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    feux = nums.get("size_or_feux") or (5 if "5F" in name.upper() else 4)
    return {
        "burners": feux,
        "oven_capacity_l": 80 if feux >= 5 else 55,
        "width_cm": 90 if feux >= 5 else 60,
        "material": "Inox" if flags.get("inox") else "Émaillé",
        "grill": True,
        "ignition": "Auto",
    }


def _b_iron(_nums: dict, _flags: dict, name: str) -> dict[str, Any]:
    upper = name.upper()
    if "CENTRALE" in upper: steam = "Centrale Vapeur"
    elif "VAPEUR" in upper or "VAPPEUR" in upper: steam = "Vapeur Variable"
    else: steam = "Vapeur Variable"
    return {
        "power_w": 2600 if "CENTRALE" in upper else 2200,
        "soleplate": "Céramique",
        "steam_type": steam,
        "anti_calc": True,
    }


def _b_fryer(nums: dict, flags: dict, _name: str) -> dict[str, Any]:
    cap = nums.get("capacity_l") or 4
    return {
        "capacity_l": cap,
        "power_w": 1800 if cap >= 6 else 1400,
        "controls": "Digital" if flags.get("afficheur") else "Mécanique",
    }


def _b_mixer(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    bowl = nums.get("capacity_l") or 6
    return {
        "power_w": 1400 if bowl >= 8 else (1000 if bowl >= 6 else 800),
        "bowl_l": bowl,
        "bowl_material": "Inox" if flags.get("inox") else "Inox",
        "speeds": 6,
        "planetary": True,
        "attachments": (
            ["Fouet", "Crochet", "Batteur", "Hachoir"]
            if flags.get("multi") or re.search(r"3EN1|2EN1|5IN1", name.upper())
            else ["Fouet", "Crochet", "Batteur"]
        ),
    }


def _b_blender(nums: dict, flags: dict, name: str) -> dict[str, Any]:
    return {
        "power_w": 1000 if "MULTI" in name.upper() else 700,
        "capacity_l": nums.get("capacity_l") or 1.5,
        "jar_material": "Verre" if flags.get("glass") else "Plastique",
        "ice_crush": True,
    }


def _b_coffee(_nums: dict, _flags: dict, name: str) -> dict[str, Any]:
    upper = name.upper()
    if "ESPRESSO" in upper or "EXPRESSO" in upper:
        return {"type": "Expresso", "pressure_bar": 15, "milk_frother": True}
    if "PRESSE" in upper:
        return {"type": "Italienne"}
    if "PORTABLE" in upper:
        return {"type": "Turque"}
    return {"type": "Filtre", "capacity_cups": 12}


def _b_vacuum(_nums: dict, _flags: dict, name: str) -> dict[str, Any]:
    return {
        "power_w": 1800,
        "type": "Balai" if "BALAI" in name.upper() else "Traîneau",
        "hepa": True,
    }


def _b_oil_heater(nums: dict, flags: dict, _name: str) -> dict[str, Any]:
    elements = nums.get("elements") or 9
    return {
        "elements": elements,
        "power_w": 2500 if elements >= 13 else 2000,
        "fan": flags.get("ventil", False),
        "thermostat": True,
    }


def _b_default(_nums: dict, _flags: dict, _name: str) -> dict[str, Any]:
    return {"warranty": "24 Mois"}


ATTR_BUILDERS: dict[str, Callable[[dict, dict, str], dict[str, Any]]] = {
    "tv":               _b_tv,
    "washing_machine":  _b_washing,
    "refrigerator":     _b_refrigerator,
    "freezer":          _b_freezer,
    "ac":               _b_ac,
    "microwave":        _b_microwave,
    "dishwasher":       _b_dishwasher,
    "cooker":           _b_cooker,
    "iron":             _b_iron,
    "fryer":            _b_fryer,
    "mixer":            _b_mixer,
    "blender":          _b_blender,
    "coffee_machine":   _b_coffee,
    "vacuum":           _b_vacuum,
    "oil_heater":       _b_oil_heater,
}


# ── Completeness scoring ────────────────────────────────────────────────────

def compute_completeness(
    *,
    has_brand: bool,
    has_category: bool,
    has_retail_price: bool,
    has_stock: bool,
    has_barcode_or_mpn: bool,
    has_description: bool,
    has_primary_image: bool,
    spec_count: int,
) -> float:
    """Weighted completeness in [0,1]. Mirrors PKOS confidence math."""
    score = 0.0
    if has_brand:           score += 0.18
    if has_category:        score += 0.18
    if has_retail_price:    score += 0.18
    if has_stock:           score += 0.10
    if has_barcode_or_mpn:  score += 0.06
    if has_description:     score += 0.10
    if has_primary_image:   score += 0.10
    # Specs: 0.10 saturating at ≥3 keys
    score += min(spec_count, 3) * (0.10 / 3.0)
    return round(min(score, 1.0), 3)


# ── Main entry ──────────────────────────────────────────────────────────────

@dataclass
class EnrichmentResult:
    """Output of a single enrichment pass — dictate UPDATEs the caller applies."""
    detected_brand: str | None
    brand_source: str  # 'explicit' | 'regex' | 'unknown'
    detected_category_id: str | None
    detected_category_label: str | None    # English label for products.category
    detected_category_label_fr: str | None # French display
    extracted_specs: dict[str, Any]
    auto_attributes: dict[str, Any]
    flags: dict[str, bool]
    description: str
    completeness: float
    new_status: str  # next product status

    def to_dict(self) -> dict[str, Any]:
        return {
            "brand": self.detected_brand,
            "brand_source": self.brand_source,
            "category_id": self.detected_category_id,
            "category": self.detected_category_label,
            "category_label_fr": self.detected_category_label_fr,
            "specs": self.extracted_specs,
            "attributes": self.auto_attributes,
            "flags": self.flags,
            "description": self.description,
            "completeness": self.completeness,
            "status": self.new_status,
        }


def enrich(
    name: str,
    *,
    explicit_brand: str | None = None,
    explicit_category: str | None = None,
    explicit_specs: dict[str, Any] | None = None,
    has_retail_price: bool = False,
    has_stock: bool = False,
    has_barcode_or_mpn: bool = False,
    has_description: bool = False,
    has_primary_image: bool = False,
) -> EnrichmentResult:
    """Run rule-based enrichment on a single product. Pure function — no IO."""
    explicit_specs = dict(explicit_specs or {})

    # ── Brand ─────────────────────────────────────────────────
    if explicit_brand and explicit_brand.strip() and explicit_brand.upper() != "INCONNU":
        brand = explicit_brand.strip().upper()
        brand_source = "explicit"
    else:
        detected = detect_brand(name)
        if detected:
            brand, brand_source = detected, "regex"
        else:
            brand, brand_source = None, "unknown"

    # ── Category ──────────────────────────────────────────────
    cat = detect_category(name)
    cat_id    = cat.id    if cat else None
    cat_en    = cat.en_label if cat else None
    cat_fr    = cat.label if cat else None

    # If user explicitly set a category and it's non-trivial, prefer it for the EN label
    if explicit_category and explicit_category.strip() and explicit_category.lower() not in ("other", "autre", "electromenager"):
        cat_en = explicit_category.strip()

    # ── Specs ─────────────────────────────────────────────────
    nums  = extract_specs(name)
    flags = parse_flags(name)
    builder = ATTR_BUILDERS.get(cat_id or "", _b_default)
    auto_attrs = builder(nums, flags, name) if cat_id else _b_default(nums, flags, name)

    # Merged specs (explicit takes precedence over auto)
    merged_specs: dict[str, Any] = {**auto_attrs, **explicit_specs}
    # Add raw extracted numbers under a namespaced key for traceability
    if nums:
        merged_specs.setdefault("_extracted", nums)

    # ── Description ───────────────────────────────────────────
    cat_part = (cat_fr or cat_en or "Produit").upper()
    brand_part = brand or "Marque inconnue"
    description = f"{cat_part} {brand_part}. {get_brand_description(brand)}"

    # ── Completeness ──────────────────────────────────────────
    spec_count = sum(1 for k in merged_specs if not k.startswith("_"))
    completeness = compute_completeness(
        has_brand=bool(brand),
        has_category=bool(cat_id or cat_en),
        has_retail_price=has_retail_price,
        has_stock=has_stock,
        has_barcode_or_mpn=has_barcode_or_mpn,
        has_description=bool(description) or has_description,
        has_primary_image=has_primary_image,
        spec_count=spec_count,
    )

    # ── Status transition ─────────────────────────────────────
    # RAW → NORMALIZED (always after enrichment)
    # If brand AND category both present → CLASSIFIED
    # If completeness >= 0.85 → VERIFIED
    if completeness >= 0.85 and brand and cat_id:
        new_status = "VERIFIED"
    elif brand and cat_id:
        new_status = "CLASSIFIED"
    elif not brand or not cat_id:
        new_status = "NEEDS_FIX"
    else:
        new_status = "NORMALIZED"

    return EnrichmentResult(
        detected_brand=brand,
        brand_source=brand_source,
        detected_category_id=cat_id,
        detected_category_label=cat_en,
        detected_category_label_fr=cat_fr,
        extracted_specs=nums,
        auto_attributes=merged_specs,
        flags=flags,
        description=description,
        completeness=completeness,
        new_status=new_status,
    )
