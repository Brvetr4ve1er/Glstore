"""
Catalog-quality endpoints — Phase 3.

GET  /products/{id}/issues          → ordered list of resolvable issues for one product
GET  /products/issues/summary       → counts grouped by issue code (catalog-wide)
GET  /products/issues/list          → paginated list of products that have a given issue
GET  /brands                        → canonical brand catalog (for autocomplete + suggestion UI)
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.services import validator
from api.services.enrichment import KNOWN_BRANDS, BRAND_DESCRIPTIONS

router = APIRouter(tags=["catalog-quality"])

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")


# ── Helpers ──────────────────────────────────────────────────

async def _facts_for_product(db: AsyncSession, product_id: UUID) -> validator.ProductFacts | None:
    row = await db.execute(text("""
        SELECT
            p.name, p.brand, p.category, p.description,
            p.barcode, p.mpn, COALESCE(p.specs, '{}'::jsonb) AS specs,
            p.completeness_score,
            (SELECT COUNT(*) FROM offers o
              WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0) AS price_count,
            (SELECT COALESCE(SUM(o.stock_quantity - o.reserved_quantity), 0) FROM offers o
              WHERE o.product_id = p.id AND o.is_active) AS available,
            (SELECT COUNT(*) FROM product_media m
              WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED') AS img_count
          FROM products p
         WHERE p.id = :id
    """), {"id": product_id})
    r = row.first()
    if not r:
        return None

    specs = r[6] if isinstance(r[6], dict) else {}
    spec_count = sum(1 for k in specs if not k.startswith("_"))

    return validator.ProductFacts(
        name=r[0] or "",
        brand=r[1],
        category=r[2],
        description=r[3],
        barcode=r[4],
        mpn=r[5],
        spec_count=spec_count,
        has_retail_price=(r[8] or 0) > 0,
        has_stock=(r[9] or 0) > 0,
        has_primary_image=(r[10] or 0) > 0,
        completeness_score=float(r[7] or 0),
    )


# ── GET /products/{id}/issues ────────────────────────────────

@router.get("/products/{product_id}/issues",
            dependencies=[Depends(require_role(*READ_ROLES))])
async def product_issues(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    facts = await _facts_for_product(db, product_id)
    if not facts:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")

    issues = validator.derive_issues(facts)
    return {
        "product_id": str(product_id),
        "completeness_score": facts.completeness_score,
        "summary": validator.severity_summary(issues),
        "issues": [i.to_dict() for i in issues],
    }


# ── GET /products/issues/summary ─────────────────────────────

@router.get("/products/issues/summary",
            dependencies=[Depends(require_role(*READ_ROLES))])
async def issues_summary(
    db: AsyncSession = Depends(get_db),
    exclude_archived: bool = Query(True),
) -> dict[str, Any]:
    """Returns counts of products affected by each issue code, catalog-wide."""
    where = "p.status <> 'ARCHIVED'" if exclude_archived else "TRUE"

    rows = await db.execute(text(f"""
        SELECT
            -- missing brand
            COUNT(*) FILTER (WHERE p.brand IS NULL OR UPPER(p.brand) IN ('INCONNU','UNKNOWN','')) AS missing_brand,
            -- missing category (broadened to include legacy 'Electromenager')
            COUNT(*) FILTER (WHERE p.category IS NULL OR LOWER(p.category) IN ('other','autre','electromenager','')) AS missing_category,
            -- missing description (or short)
            COUNT(*) FILTER (WHERE p.description IS NULL OR length(p.description) < 30) AS missing_description,
            -- missing barcode AND mpn
            COUNT(*) FILTER (WHERE (p.barcode IS NULL OR p.barcode = '') AND (p.mpn IS NULL OR p.mpn = '')) AS missing_barcode_or_mpn,
            -- low completeness
            COUNT(*) FILTER (WHERE p.completeness_score < 0.5) AS low_completeness,
            -- low specs (< 3 keys, ignoring _-prefixed)
            COUNT(*) FILTER (
                WHERE (
                    SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(p.specs, '{{}}'::jsonb)) AS k
                    WHERE k NOT LIKE '\\_%'
                ) < 3
            ) AS low_specs,
            -- missing primary image
            COUNT(*) FILTER (
                WHERE NOT EXISTS (
                    SELECT 1 FROM product_media m
                    WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                )
            ) AS missing_image,
            -- missing price (no active offer with retail_price > 0)
            COUNT(*) FILTER (
                WHERE NOT EXISTS (
                    SELECT 1 FROM offers o
                    WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0
                )
            ) AS missing_price,
            -- no stock (sum of available <= 0)
            COUNT(*) FILTER (
                WHERE COALESCE((
                    SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o
                    WHERE o.product_id = p.id AND o.is_active
                ), 0) <= 0
            ) AS no_stock,
            COUNT(*) AS total
          FROM products p
         WHERE {where}
    """))
    r = rows.first()
    if not r:
        return {"total": 0, "by_issue": {}}

    return {
        "total": int(r[9]),
        "by_issue": {
            validator.CODE_MISSING_BRAND:        int(r[0]),
            validator.CODE_MISSING_CATEGORY:     int(r[1]),
            validator.CODE_MISSING_DESCRIPTION:  int(r[2]),
            validator.CODE_MISSING_BARCODE_MPN:  int(r[3]),
            validator.CODE_LOW_COMPLETENESS:     int(r[4]),
            validator.CODE_LOW_SPECS:            int(r[5]),
            validator.CODE_MISSING_IMAGE:        int(r[6]),
            validator.CODE_MISSING_PRICE:        int(r[7]),
            validator.CODE_NO_STOCK:             int(r[8]),
        },
    }


# ── GET /products/issues/list ────────────────────────────────

_ISSUE_WHERE_FRAGMENTS: dict[str, str] = {
    validator.CODE_MISSING_BRAND:
        "(p.brand IS NULL OR UPPER(p.brand) IN ('INCONNU','UNKNOWN',''))",
    validator.CODE_MISSING_CATEGORY:
        "(p.category IS NULL OR LOWER(p.category) IN ('other','autre','electromenager',''))",
    validator.CODE_MISSING_DESCRIPTION:
        "(p.description IS NULL OR length(p.description) < 30)",
    validator.CODE_MISSING_BARCODE_MPN:
        "((p.barcode IS NULL OR p.barcode = '') AND (p.mpn IS NULL OR p.mpn = ''))",
    validator.CODE_LOW_COMPLETENESS:
        "p.completeness_score < 0.5",
    validator.CODE_MISSING_IMAGE:
        ("NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id "
         "AND m.is_primary AND m.status = 'STORED')"),
    validator.CODE_MISSING_PRICE:
        ("NOT EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id "
         "AND o.is_active AND o.retail_price > 0)"),
    validator.CODE_NO_STOCK:
        ("COALESCE((SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o "
         "WHERE o.product_id = p.id AND o.is_active), 0) <= 0"),
}


@router.get("/products/issues/list",
            dependencies=[Depends(require_role(*READ_ROLES))])
async def issues_list(
    code: str = Query(..., description="Issue code to filter on"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    fragment = _ISSUE_WHERE_FRAGMENTS.get(code)
    if not fragment:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown issue code: {code}")

    offset = (page - 1) * page_size
    where = f"p.status <> 'ARCHIVED' AND {fragment}"

    rows = await db.execute(text(f"""
        SELECT p.id, p.sku, p.name, p.brand, p.category,
               p.completeness_score, p.status,
               (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
                  WHERE o.product_id = p.id AND o.is_active) AS min_price,
               (SELECT url FROM product_media m
                  WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                  LIMIT 1) AS primary_image
          FROM products p
         WHERE {where}
         ORDER BY p.completeness_score ASC, p.updated_at DESC
         LIMIT :lim OFFSET :off
    """), {"lim": page_size, "off": offset})

    items = [{
        "id": r[0], "sku": r[1], "name": r[2],
        "brand": r[3], "category": r[4],
        "completeness_score": float(r[5] or 0),
        "status": r[6],
        "min_price": float(r[7]) if r[7] is not None else None,
        "primary_image": r[8],
    } for r in rows.all()]

    total_row = await db.execute(text(f"SELECT COUNT(*) FROM products p WHERE {where}"))
    total = int(total_row.scalar_one())

    return {
        "code": code,
        "items": items,
        "page": page, "page_size": page_size, "total": total,
    }


# ── GET /brands (catalog autocomplete) ───────────────────────

@router.get("/brands", dependencies=[Depends(require_role(*READ_ROLES))])
async def list_brands(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Canonical brand catalog + counts of products per brand currently in DB."""
    rows = await db.execute(text("""
        SELECT UPPER(COALESCE(NULLIF(brand, ''), 'INCONNU')) AS b, COUNT(*)
          FROM products
         WHERE status <> 'ARCHIVED'
         GROUP BY b
         ORDER BY b ASC
    """))
    in_use = {r[0]: int(r[1]) for r in rows.all()}

    catalog: list[dict[str, Any]] = []
    for brand in KNOWN_BRANDS:
        catalog.append({
            "id": brand,
            "label": brand,
            "description": BRAND_DESCRIPTIONS.get(brand, BRAND_DESCRIPTIONS["DEFAULT"]),
            "products_in_db": in_use.get(brand, 0),
        })
    # Add unknown brands present in DB but not in KNOWN_BRANDS
    extras = sorted(set(in_use) - set(KNOWN_BRANDS) - {"INCONNU"})
    for b in extras:
        catalog.append({
            "id": b, "label": b,
            "description": BRAND_DESCRIPTIONS["DEFAULT"],
            "products_in_db": in_use.get(b, 0),
        })

    return {
        "total_known": len(KNOWN_BRANDS),
        "total_extras_in_db": len(extras),
        "items": catalog,
    }
