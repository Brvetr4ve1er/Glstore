"""
Universal CSV Parser — Python port of orbital-perihelion's
src/core/universal-csv-parser.ts.

Reads any CSV regardless of column names, delimiter, or encoding.
Uses fuzzy header mapping (NFD-normalized) so French/English/accented
headers resolve to the same canonical fields.

Pure functions — no DB, no IO. Returns RawProductRow records ready
for the import service to upsert.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

# ── Canonical field → header variants (all pre-normalized lower-ASCII) ──────
COLUMN_MAP: dict[str, list[str]] = {
    "id":              ["id", "ref", "code", "code barre", "barcode", "sku",
                        "reference", "article id", "product id"],
    "name":            ["nom", "name", "designation", "libelle", "produit",
                        "article", "description", "label", "prod", "titre",
                        "title", "product name"],
    "brand":           ["marque", "brand", "fabricant", "manufacturer", "supplier",
                        "fournisseur", "brand name", "mfr"],
    "category":        ["categorie", "category", "famille", "family", "type",
                        "sous famille", "departement", "dept", "groupe", "group",
                        "division", "classe", "class"],
    "sku":             ["sku", "reference", "cod", "code article", "code produit",
                        "article code", "part number", "partnumber", "sku number"],
    "barcode":         ["code barre", "barcode", "ean", "upc", "gtin", "ean13",
                        "ean 13", "code barres", "code a barres", "codebarres",
                        "codebar", "upc code"],
    "mpn":             ["mpn", "manufacturer part", "mfr part", "part no",
                        "part number", "modele", "model number", "model no",
                        "numero modele", "model"],
    "price_retail":    ["prix de vente", "prix vente", "pv ttc", "pv ht", "price",
                        "prix retail", "prix detail", "prix de vente detail",
                        "retail price", "selling price", "sale price", "tarif",
                        "pvttc", "pvht", "prix unit", "prix de vente detail"],
    "price_purchase":  ["prix achat", "pa", "cost", "purchase price", "cout",
                        "cump", "dernier prix achat", "last purchase price",
                        "cout unitaire", "cout unitaire moyen pondere", "pa ht",
                        "prix d achat"],
    "price_wholesale": ["prix de gros", "gros", "wholesale", "prix gros",
                        "prix revendeur"],
    "stock":           ["quantite", "qte", "qty", "stock", "quantite en stock",
                        "quantity", "disponible", "quantity in stock",
                        "stock qty", "stk"],
    "stock_status":    ["statut stock", "statut", "status", "etat stock",
                        "disponibilite", "availability"],
}

# Priority order — checked first so generic patterns don't claim specific columns
PRIORITY_ORDER = [
    "barcode", "mpn", "id", "name", "brand", "category", "sku",
    "price_retail", "price_purchase", "price_wholesale",
    "stock", "stock_status",
]

DELIMITERS = [";", ",", "\t", "|"]

# ── String helpers ──────────────────────────────────────────────────────────

_DIACRITIC_RE = re.compile(r"[̀-ͯ]")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9 ]")
_MULTI_SPACE_RE = re.compile(r"\s+")


def normalize_key(s: str) -> str:
    """Lower + strip accents + non-alnum → space, collapsed.
    NFD must come first so combining diacritics can be stripped.
    """
    decomposed = unicodedata.normalize("NFD", s or "")
    no_diacritics = _DIACRITIC_RE.sub("", decomposed)
    lower = no_diacritics.lower()
    cleaned = _NON_ALNUM_RE.sub(" ", lower)
    return _MULTI_SPACE_RE.sub(" ", cleaned).strip()


# Pre-compute normalized variants for O(1)-ish lookup
_NORMALIZED_MAP: dict[str, list[str]] = {
    field: [normalize_key(v) for v in variants]
    for field, variants in COLUMN_MAP.items()
}


def detect_delimiter(first_line: str) -> str:
    best, max_count = ",", 0
    for d in DELIMITERS:
        count = first_line.count(d)
        if count > max_count:
            max_count, best = count, d
    return best


def parse_row(line: str, delimiter: str) -> list[str]:
    """RFC 4180-ish CSV row parser handling quoted fields with escaped quotes."""
    out: list[str] = []
    cur, in_quotes = "", False
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if ch == '"':
            if in_quotes and i + 1 < n and line[i + 1] == '"':
                cur += '"'
                i += 1
            else:
                in_quotes = not in_quotes
        elif ch == delimiter and not in_quotes:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
        i += 1
    out.append(cur.strip())
    return out


def map_headers(headers: list[str]) -> dict[str, int]:
    """Match each canonical field to the index of its best header match."""
    sorted_entries = [(f, _NORMALIZED_MAP[f]) for f in PRIORITY_ORDER if f in _NORMALIZED_MAP]
    mapping: dict[str, int] = {}

    for idx, raw in enumerate(headers):
        norm = normalize_key(raw)
        if not norm:
            continue
        for field_name, variants in sorted_entries:
            if field_name in mapping:
                continue
            for variant in variants:
                exact = norm == variant
                partial = (
                    len(norm) >= 3 and len(variant) >= 3
                    and (variant in norm or norm in variant)
                )
                if exact or partial:
                    mapping[field_name] = idx
                    break
    return mapping


def _at(values: list[str], mapping: dict[str, int], field_name: str) -> str:
    idx = mapping.get(field_name)
    if idx is None or idx >= len(values):
        return ""
    return (values[idx] or "").strip()


def parse_number(s: str) -> float:
    """Locale-tolerant numeric parser. Handles:
       - 1,234.56 (US)
       - 1.234,56 (EU)
       - 1 234,56 (space thousands)
       - 1234     (plain)
       Currency/letters are stripped.
    """
    if not s:
        return 0.0

    cleaned = re.sub(r"[^\d.,\- ]", "", s).strip()
    if not cleaned:
        return 0.0

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")

    if last_comma != -1 and last_dot != -1:
        if last_comma > last_dot:
            # EU: 1.234,56
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            # US: 1,234.56
            cleaned = cleaned.replace(",", "")
    elif last_comma != -1:
        after = cleaned[last_comma + 1:]
        if len(after) == 3 and "," not in after:
            # Thousands separator: 1,234
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
    elif cleaned.count(".") > 1:
        # Multiple dots: keep last as decimal, drop the rest
        parts = cleaned.split(".")
        cleaned = "".join(parts[:-1]) + "." + parts[-1]

    cleaned = cleaned.replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


# ── Output shape ─────────────────────────────────────────────────────────────

@dataclass
class RawProductRow:
    line_number: int                  # 1-indexed source row (after header)
    id: str
    name: str
    brand: str
    category: str
    sku: str
    barcode: str
    mpn: str
    price_retail: float
    price_purchase: float
    price_wholesale: float
    stock: float
    stock_status: str
    raw: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        d = {k: getattr(self, k) for k in (
            "line_number", "id", "name", "brand", "category", "sku",
            "barcode", "mpn", "price_retail", "price_purchase",
            "price_wholesale", "stock", "stock_status",
        )}
        d["raw"] = self.raw
        return d


@dataclass
class ParseDiagnostic:
    delimiter: str
    headers: list[str]
    mapped_fields: dict[str, str]      # field → matched header
    unmapped_headers: list[str]
    total_lines: int
    parsed_rows: int
    skipped_empty: int
    skipped_no_name: int

    def to_dict(self) -> dict[str, object]:
        return {
            "delimiter": self.delimiter,
            "headers": self.headers,
            "mapped_fields": self.mapped_fields,
            "unmapped_headers": self.unmapped_headers,
            "total_lines": self.total_lines,
            "parsed_rows": self.parsed_rows,
            "skipped_empty": self.skipped_empty,
            "skipped_no_name": self.skipped_no_name,
        }


# ── Public API ──────────────────────────────────────────────────────────────

def _split_lines(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def diagnose(csv_text: str) -> ParseDiagnostic:
    lines = [ln for ln in _split_lines(csv_text) if ln.strip()]
    if not lines:
        return ParseDiagnostic(",", [], {}, [], 0, 0, 0, 0)

    delimiter = detect_delimiter(lines[0])
    headers = parse_row(lines[0], delimiter)
    mapping = map_headers(headers)
    mapped_indices = set(mapping.values())

    return ParseDiagnostic(
        delimiter=delimiter,
        headers=headers,
        mapped_fields={f: headers[i] for f, i in mapping.items() if i < len(headers)},
        unmapped_headers=[h for i, h in enumerate(headers) if i not in mapped_indices],
        total_lines=len(lines),
        parsed_rows=0, skipped_empty=0, skipped_no_name=0,
    )


def parse(csv_text: str) -> tuple[list[RawProductRow], ParseDiagnostic]:
    """Parse CSV text → list of RawProductRow + diagnostic."""
    if not csv_text or not csv_text.strip():
        return [], ParseDiagnostic(",", [], {}, [], 0, 0, 0, 0)

    all_lines = _split_lines(csv_text)
    non_empty = [ln for ln in all_lines if ln.strip()]
    skipped_empty = len(all_lines) - len(non_empty)
    if len(non_empty) < 2:
        return [], ParseDiagnostic(",", [], {}, [], len(all_lines), 0, skipped_empty, 0)

    delimiter = detect_delimiter(non_empty[0])
    raw_headers = parse_row(non_empty[0], delimiter)
    mapping = map_headers(raw_headers)

    rows: list[RawProductRow] = []
    skipped_no_name = 0

    for line_no, line in enumerate(non_empty[1:], start=2):
        if not line.strip():
            continue
        values = parse_row(line, delimiter)
        if len(values) < 2:
            continue

        raw_obj = {h: (values[i] if i < len(values) else "") for i, h in enumerate(raw_headers)}

        name = _at(values, mapping, "name")
        if not name:
            skipped_no_name += 1
            continue

        # Derive id: id → barcode → sku → row index fallback
        rid = (
            _at(values, mapping, "id")
            or _at(values, mapping, "barcode")
            or _at(values, mapping, "sku")
            or f"row_{line_no}"
        )

        sku = _at(values, mapping, "sku") or _at(values, mapping, "id") or rid
        barcode = _at(values, mapping, "barcode")
        mpn = _at(values, mapping, "mpn")
        brand = _at(values, mapping, "brand")
        category = _at(values, mapping, "category")

        price_retail = parse_number(_at(values, mapping, "price_retail"))
        price_purchase = parse_number(_at(values, mapping, "price_purchase"))
        price_wholesale = parse_number(_at(values, mapping, "price_wholesale"))
        if price_retail == 0 and price_wholesale > 0:
            price_retail = price_wholesale

        stock = parse_number(_at(values, mapping, "stock"))
        stock_status = _at(values, mapping, "stock_status")

        rows.append(RawProductRow(
            line_number=line_no,
            id=rid, name=name, brand=brand, category=category,
            sku=sku, barcode=barcode, mpn=mpn,
            price_retail=price_retail,
            price_purchase=price_purchase,
            price_wholesale=price_wholesale,
            stock=stock,
            stock_status=stock_status,
            raw=raw_obj,
        ))

    mapped_indices = set(mapping.values())
    diag = ParseDiagnostic(
        delimiter=delimiter,
        headers=raw_headers,
        mapped_fields={f: raw_headers[i] for f, i in mapping.items() if i < len(raw_headers)},
        unmapped_headers=[h for i, h in enumerate(raw_headers) if i not in mapped_indices],
        total_lines=len(all_lines),
        parsed_rows=len(rows),
        skipped_empty=skipped_empty,
        skipped_no_name=skipped_no_name,
    )
    return rows, diag


# Convenience for tests / iteration
def parse_iter(csv_text: str) -> Iterable[RawProductRow]:
    yield from parse(csv_text)[0]
