"""
Issue derivation — Phase 3.

Pure function: takes a product's facts and returns a typed list of issues
the admin should resolve. Each issue has a stable `code`, severity, and an
optional `fix_hint` payload that the frontend can pre-fill into the editor.

The codes are stable strings — UI keys off them for icons / actions.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from api.services.enrichment import KNOWN_BRANDS, detect_brand, detect_category


@dataclass(frozen=True)
class Issue:
    code: str
    field: str
    severity: str        # 'error' | 'warning' | 'info'
    message: str
    fix_hint: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "field": self.field,
            "severity": self.severity,
            "message": self.message,
            "fix_hint": self.fix_hint,
        }


# ── Stable issue codes (UI dispatches off these) ────────────────────────────
CODE_MISSING_BRAND        = "missing_brand"
CODE_MISSING_CATEGORY     = "missing_category"
CODE_MISSING_DESCRIPTION  = "missing_description"
CODE_MISSING_IMAGE        = "missing_image"
CODE_MISSING_PRICE        = "missing_price"
CODE_NO_STOCK             = "no_stock"
CODE_MISSING_BARCODE_MPN  = "missing_barcode_or_mpn"
CODE_LOW_COMPLETENESS     = "low_completeness"
CODE_LOW_SPECS            = "low_specs"


@dataclass
class ProductFacts:
    name: str
    brand: str | None
    category: str | None
    description: str | None
    barcode: str | None
    mpn: str | None
    spec_count: int
    has_retail_price: bool
    has_stock: bool
    has_primary_image: bool
    completeness_score: float


def derive_issues(facts: ProductFacts) -> list[Issue]:
    """Return the list of unresolved issues for a single product, ordered by severity."""
    out: list[Issue] = []

    # ── Brand ─────────────────────────────────────────────────
    if not facts.brand or facts.brand.upper() in ("INCONNU", "UNKNOWN", ""):
        # Re-run regex detection now to suggest a fix
        suggested = detect_brand(facts.name)
        out.append(Issue(
            code=CODE_MISSING_BRAND,
            field="brand",
            severity="error",
            message="Brand is missing or unknown.",
            fix_hint={
                "suggested_value": suggested,
                "options": list(KNOWN_BRANDS),
            },
        ))

    # ── Category ──────────────────────────────────────────────
    if not facts.category or facts.category.lower() in ("other", "autre", "electromenager", ""):
        cat = detect_category(facts.name)
        out.append(Issue(
            code=CODE_MISSING_CATEGORY,
            field="category",
            severity="error",
            message="Category is missing or generic.",
            fix_hint={
                "suggested_value": cat.en_label if cat else None,
                "suggested_label_fr": cat.label if cat else None,
            },
        ))

    # ── Price ─────────────────────────────────────────────────
    if not facts.has_retail_price:
        out.append(Issue(
            code=CODE_MISSING_PRICE,
            field="retail_price",
            severity="error",
            message="No active offer with a retail price.",
            fix_hint={"action": "add_offer"},
        ))

    # ── Stock ─────────────────────────────────────────────────
    if not facts.has_stock:
        out.append(Issue(
            code=CODE_NO_STOCK,
            field="stock_quantity",
            severity="warning",
            message="Out of stock — no available inventory across active offers.",
            fix_hint={"action": "update_offer_stock"},
        ))

    # ── Barcode / MPN ─────────────────────────────────────────
    if not facts.barcode and not facts.mpn:
        out.append(Issue(
            code=CODE_MISSING_BARCODE_MPN,
            field="barcode",
            severity="warning",
            message="Neither barcode nor MPN — needed for downstream sync.",
            fix_hint={},
        ))

    # ── Description ───────────────────────────────────────────
    if not facts.description or len(facts.description) < 30:
        out.append(Issue(
            code=CODE_MISSING_DESCRIPTION,
            field="description",
            severity="warning",
            message="Description is missing or too short.",
            fix_hint={"min_length": 30, "llm_eligible": True},
        ))

    # ── Image ─────────────────────────────────────────────────
    if not facts.has_primary_image:
        out.append(Issue(
            code=CODE_MISSING_IMAGE,
            field="primary_image",
            severity="warning",
            message="No primary image — storefront listings will look broken.",
            fix_hint={},
        ))

    # ── Specs depth ───────────────────────────────────────────
    if facts.spec_count < 3:
        out.append(Issue(
            code=CODE_LOW_SPECS,
            field="specs",
            severity="info",
            message=f"Only {facts.spec_count} spec(s). Consider re-running enrichment or adding more.",
            fix_hint={"current": facts.spec_count, "recommended": 3, "action": "enrich"},
        ))

    # ── Overall completeness ──────────────────────────────────
    if facts.completeness_score < 0.5:
        out.append(Issue(
            code=CODE_LOW_COMPLETENESS,
            field="completeness_score",
            severity="info",
            message=f"Completeness is {int(facts.completeness_score * 100)}% — below the 50% target.",
            fix_hint={"current": facts.completeness_score, "target": 0.5},
        ))

    # Order: errors first, then warnings, then infos
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    out.sort(key=lambda i: severity_rank.get(i.severity, 3))
    return out


def severity_summary(issues: Iterable[Issue]) -> dict[str, int]:
    counts = {"error": 0, "warning": 0, "info": 0}
    for i in issues:
        counts[i.severity] = counts.get(i.severity, 0) + 1
    return counts
