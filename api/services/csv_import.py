"""
CSV Import service — orchestrates parse → validate → upsert into
products + offers, idempotent on SKU.

Idempotency rules:
- Product matched by `products.sku`. If exists → UPDATE name/brand/category/etc.
  If absent → INSERT new product (status='NORMALIZED').
- Offer matched by `offers.variant_sku` (= product SKU when CSV is single-variant).
  If exists → UPDATE prices/stock. If absent → INSERT new active offer.

This service does NOT call the enrichment service (Phase 2). It just lands
the raw data cleanly. Enrichment will run as a separate worker pass.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.csv_parser import RawProductRow


# ── Slug helper ──────────────────────────────────────────────────────────────

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str, fallback_id: str) -> str:
    base = _SLUG_RE.sub("-", value.lower()).strip("-")
    return base or f"product-{fallback_id[:8]}"


def _slug_with_disambiguator(name: str, sku: str, used: set[str], product_id: UUID) -> str:
    """Generate a unique slug. Cascade:
       1. slugify(name)
       2. slugify(name) + '-' + slugify(sku)         ← bulletproof per-row uniqueness
       3. slugify(name) + '-' + first 8 chars of UUID (paranoid fallback)
    """
    base = _slugify(name, str(product_id))
    if base not in used:
        return base
    sku_slug = _slugify(sku, str(product_id))
    candidate = f"{base}-{sku_slug}"
    if candidate not in used:
        return candidate
    return f"{base}-{str(product_id)[:8]}"


# ── Result shapes ────────────────────────────────────────────────────────────

@dataclass
class RowIssue:
    line_number: int
    field: str
    severity: str          # 'error' | 'warning'
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "line_number": self.line_number,
            "field": self.field,
            "severity": self.severity,
            "message": self.message,
        }


@dataclass
class PreviewReport:
    parsed_rows: int
    valid_rows: int
    blocked_rows: int
    products_to_create: int
    products_to_update: int
    offers_to_create: int
    offers_to_update: int
    issues: list[RowIssue] = field(default_factory=list)
    sample_preview: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "parsed_rows": self.parsed_rows,
            "valid_rows": self.valid_rows,
            "blocked_rows": self.blocked_rows,
            "products_to_create": self.products_to_create,
            "products_to_update": self.products_to_update,
            "offers_to_create": self.offers_to_create,
            "offers_to_update": self.offers_to_update,
            "issues": [i.to_dict() for i in self.issues],
            "sample_preview": self.sample_preview,
        }


@dataclass
class CommitReport:
    products_created: int
    products_updated: int
    offers_created: int
    offers_updated: int
    blocked_rows: int
    issues: list[RowIssue] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "products_created": self.products_created,
            "products_updated": self.products_updated,
            "offers_created": self.offers_created,
            "offers_updated": self.offers_updated,
            "blocked_rows": self.blocked_rows,
            "issues": [i.to_dict() for i in self.issues],
        }


# ── Validation ───────────────────────────────────────────────────────────────

def _validate_row(row: RawProductRow) -> list[RowIssue]:
    issues: list[RowIssue] = []
    if not row.name or not row.name.strip():
        issues.append(RowIssue(row.line_number, "name", "error", "name is required"))
    if not row.sku or not row.sku.strip():
        issues.append(RowIssue(row.line_number, "sku", "error", "sku is required"))
    if row.price_retail < 0:
        issues.append(RowIssue(row.line_number, "price_retail", "error", "negative price"))
    if row.price_purchase < 0:
        issues.append(RowIssue(row.line_number, "price_purchase", "error", "negative cost"))
    if row.price_retail == 0 and row.price_purchase == 0:
        issues.append(RowIssue(row.line_number, "price_retail", "warning", "no prices found"))
    if row.stock < 0:
        issues.append(RowIssue(row.line_number, "stock", "warning", "negative stock — coerced to 0"))
    if not row.brand:
        issues.append(RowIssue(row.line_number, "brand", "warning", "brand missing — will be flagged for enrichment"))
    return issues


# ── Lookup helpers ───────────────────────────────────────────────────────────

async def _existing_product_skus(db: AsyncSession, skus: list[str], store_id: UUID) -> dict[str, UUID]:
    if not skus:
        return {}
    rows = await db.execute(
        text("SELECT sku, id FROM products WHERE sku = ANY(:skus) AND store_id = :sid"),
        {"skus": skus, "sid": store_id},
    )
    return {r[0]: r[1] for r in rows.all()}


async def _existing_offer_skus(db: AsyncSession, skus: list[str], store_id: UUID) -> dict[str, tuple[UUID, UUID]]:
    """variant_sku → (offer_id, product_id), scoped to one store."""
    if not skus:
        return {}
    rows = await db.execute(
        text("SELECT variant_sku, id, product_id FROM offers "
             "WHERE variant_sku = ANY(:skus) AND store_id = :sid"),
        {"skus": skus, "sid": store_id},
    )
    return {r[0]: (r[1], r[2]) for r in rows.all()}


async def _existing_slugs(db: AsyncSession, slugs: list[str], store_id: UUID) -> set[str]:
    if not slugs:
        return set()
    rows = await db.execute(
        text("SELECT slug FROM products WHERE slug = ANY(:slugs) AND store_id = :sid"),
        {"slugs": slugs, "sid": store_id},
    )
    return {r[0] for r in rows.all()}


# ── Preview (no writes) ──────────────────────────────────────────────────────

async def preview_import(db: AsyncSession, rows: list[RawProductRow], store_id: UUID, sample_size: int = 20) -> PreviewReport:
    issues: list[RowIssue] = []
    valid_rows: list[RawProductRow] = []

    for r in rows:
        row_issues = _validate_row(r)
        issues.extend(row_issues)
        if any(i.severity == "error" for i in row_issues):
            continue
        valid_rows.append(r)

    skus = [r.sku for r in valid_rows]
    existing_products = await _existing_product_skus(db, skus, store_id)
    existing_offers = await _existing_offer_skus(db, skus, store_id)

    products_to_create = sum(1 for s in skus if s not in existing_products)
    products_to_update = sum(1 for s in skus if s in existing_products)
    offers_to_create = sum(1 for s in skus if s not in existing_offers)
    offers_to_update = sum(1 for s in skus if s in existing_offers)

    sample = [{
        "line_number": r.line_number,
        "sku": r.sku,
        "name": r.name,
        "brand": r.brand or None,
        "category": r.category or None,
        "barcode": r.barcode or None,
        "purchase_price": r.price_purchase,
        "retail_price": r.price_retail,
        "stock": int(r.stock),
        "action": "update" if r.sku in existing_products else "create",
    } for r in valid_rows[:sample_size]]

    return PreviewReport(
        parsed_rows=len(rows),
        valid_rows=len(valid_rows),
        blocked_rows=len(rows) - len(valid_rows),
        products_to_create=products_to_create,
        products_to_update=products_to_update,
        offers_to_create=offers_to_create,
        offers_to_update=offers_to_update,
        issues=issues,
        sample_preview=sample,
    )


# ── Commit (writes) ─────────────────────────────────────────────────────────

async def commit_import(db: AsyncSession, rows: list[RawProductRow], store_id: UUID) -> CommitReport:
    """Idempotent batch upsert into ONE store. Caller commits the transaction."""
    issues: list[RowIssue] = []
    valid: list[RawProductRow] = []
    for r in rows:
        row_issues = _validate_row(r)
        # Only collect errors here — warnings already accounted for in preview
        errors = [i for i in row_issues if i.severity == "error"]
        if errors:
            issues.extend(errors)
            continue
        valid.append(r)

    skus = [r.sku for r in valid]
    existing_products = await _existing_product_skus(db, skus, store_id)
    existing_offers   = await _existing_offer_skus(db, skus, store_id)

    # Pre-compute slugs and resolve collisions
    used_slugs = await _existing_slugs(db, [_slugify(r.name, r.id) for r in valid], store_id)

    products_created = products_updated = 0
    offers_created = offers_updated = 0

    for r in valid:
        product_id: UUID
        is_new_product = r.sku not in existing_products

        if is_new_product:
            product_id = uuid4()
            slug = _slug_with_disambiguator(r.name, r.sku, used_slugs, product_id)
            used_slugs.add(slug)
            await db.execute(text("""
                INSERT INTO products (
                    id, store_id, sku, slug, name, brand, model, category,
                    description, specs, barcode, mpn, ean,
                    status, completeness_score
                ) VALUES (
                    :id, :sid, :sku, :slug, :name, :brand, :mpn, :category,
                    NULL, CAST(:specs AS JSONB), :barcode, :mpn, :ean,
                    'RAW', 0.300
                )
            """), {
                "id": product_id, "sid": store_id, "sku": r.sku, "slug": slug, "name": r.name,
                "brand": r.brand or None, "mpn": r.mpn or None,
                "category": r.category or None,
                "specs": json.dumps(r.raw),
                "barcode": r.barcode or None,
                "ean": r.barcode or None,
            })
            products_created += 1
        else:
            product_id = existing_products[r.sku]
            await db.execute(text("""
                UPDATE products SET
                    name      = :name,
                    brand     = COALESCE(NULLIF(:brand, ''), brand),
                    category  = COALESCE(NULLIF(:category, ''), category),
                    barcode   = COALESCE(NULLIF(:barcode, ''), barcode),
                    mpn       = COALESCE(NULLIF(:mpn, ''), mpn),
                    ean       = COALESCE(NULLIF(:ean, ''), ean),
                    updated_at = NOW(),
                    version    = version + 1
                WHERE id = :id AND store_id = :sid
            """), {
                "id": product_id, "sid": store_id, "name": r.name,
                "brand": r.brand or "", "category": r.category or "",
                "barcode": r.barcode or "", "mpn": r.mpn or "",
                "ean": r.barcode or "",
            })
            products_updated += 1

        # ── Offer (single variant per row, keyed by SKU) ──
        purchase = Decimal(str(round(r.price_purchase, 2))) if r.price_purchase >= 0 else Decimal("0")
        retail   = Decimal(str(round(r.price_retail,   2))) if r.price_retail   >= 0 else Decimal("0")
        stock    = max(int(r.stock), 0)

        if r.sku not in existing_offers:
            await db.execute(text("""
                INSERT INTO offers (
                    id, store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, currency,
                    stock_quantity, low_stock_threshold, is_active
                ) VALUES (
                    :id, :sid, :pid, :sku, '{}'::jsonb,
                    :pp, :rp, 'DZD',
                    :stk, 5, true
                )
            """), {
                "id": uuid4(), "sid": store_id, "pid": product_id, "sku": r.sku,
                "pp": purchase, "rp": retail, "stk": stock,
            })
            offers_created += 1
        else:
            offer_id, _existing_pid = existing_offers[r.sku]
            await db.execute(text("""
                UPDATE offers SET
                    purchase_price = :pp,
                    retail_price   = :rp,
                    stock_quantity = :stk,
                    is_active      = true,
                    updated_at     = NOW(),
                    version        = version + 1
                WHERE id = :id AND store_id = :sid AND reserved_quantity <= :stk
            """), {
                "id": offer_id, "sid": store_id, "pp": purchase, "rp": retail, "stk": stock,
            })
            offers_updated += 1

    return CommitReport(
        products_created=products_created,
        products_updated=products_updated,
        offers_created=offers_created,
        offers_updated=offers_updated,
        blocked_rows=len(rows) - len(valid),
        issues=issues,
    )
