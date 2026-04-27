"""
Enrichment runner — bridges the pure enrichment service to the database.

Responsibilities:
1. Load product (+ aggregated offer/media facts).
2. Run rule-based enrichment.
3. Apply UPDATE to products: brand, category, specs, description, status,
   completeness_score.
4. Append observations to the `observations` table for audit/consensus.

Caller is responsible for `db.commit()`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.enrichment import enrich


@dataclass
class ProductFacts:
    """Lightweight aggregate used to feed the enrichment scorer."""
    id: UUID
    sku: str
    name: str
    brand: str | None
    category: str | None
    specs: dict[str, Any]
    description: str | None
    barcode: str | None
    mpn: str | None
    has_retail_price: bool
    has_stock: bool
    has_primary_image: bool
    raw_specs: dict[str, Any]


async def _load_facts(db: AsyncSession, product_id: UUID) -> ProductFacts | None:
    row = await db.execute(text("""
        SELECT
            p.id, p.sku, p.name, p.brand, p.category,
            COALESCE(p.specs, '{}'::jsonb)        AS specs,
            p.description, p.barcode, p.mpn,
            (SELECT COUNT(*) FROM offers o
              WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0)  AS price_count,
            (SELECT COALESCE(SUM(o.stock_quantity), 0) FROM offers o
              WHERE o.product_id = p.id AND o.is_active)                          AS total_stock,
            (SELECT COUNT(*) FROM product_media m
              WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED') AS primary_image_count
          FROM products p
         WHERE p.id = :id
    """), {"id": product_id})
    r = row.first()
    if not r:
        return None

    specs = r[5] if isinstance(r[5], dict) else json.loads(r[5] or "{}")

    return ProductFacts(
        id=r[0], sku=r[1], name=r[2],
        brand=r[3], category=r[4],
        specs=specs, description=r[6],
        barcode=r[7], mpn=r[8],
        has_retail_price=(r[9] or 0) > 0,
        has_stock=(r[10] or 0) > 0,
        has_primary_image=(r[11] or 0) > 0,
        raw_specs=specs,
    )


async def _add_observation(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    field: str,
    value: Any,
    source: str,
    confidence: float,
) -> None:
    await db.execute(text("""
        INSERT INTO observations (
            entity_type, entity_id, field, value, source, confidence
        ) VALUES (
            :etype, :eid, :field, CAST(:val AS JSONB), :src, :conf
        )
    """), {
        "etype": entity_type, "eid": entity_id, "field": field,
        "val": json.dumps({"v": value}),
        "src": source, "conf": confidence,
    })


@dataclass
class EnrichmentApplied:
    product_id: UUID
    sku: str
    brand_before: str | None
    brand_after: str | None
    category_before: str | None
    category_after: str | None
    completeness_before: float
    completeness_after: float
    status_after: str
    auto_attrs_added: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "product_id": str(self.product_id),
            "sku": self.sku,
            "brand_before": self.brand_before,
            "brand_after": self.brand_after,
            "category_before": self.category_before,
            "category_after": self.category_after,
            "completeness_before": self.completeness_before,
            "completeness_after": self.completeness_after,
            "status_after": self.status_after,
            "auto_attrs_added": self.auto_attrs_added,
        }


async def enrich_one(db: AsyncSession, product_id: UUID, *, source: str = "rule_engine_v1") -> EnrichmentApplied | None:
    facts = await _load_facts(db, product_id)
    if not facts:
        return None

    # Read existing completeness for delta reporting
    cur = await db.execute(
        text("SELECT completeness_score FROM products WHERE id = :id"),
        {"id": product_id},
    )
    completeness_before = float(cur.scalar_one_or_none() or 0)

    # Don't auto-overwrite a brand/category the user explicitly chose: pass them
    # as `explicit_*` so the engine respects them.
    result = enrich(
        facts.name,
        explicit_brand=facts.brand,
        explicit_category=facts.category,
        explicit_specs=facts.raw_specs,
        has_retail_price=facts.has_retail_price,
        has_stock=facts.has_stock,
        has_barcode_or_mpn=bool(facts.barcode or facts.mpn),
        has_description=bool(facts.description),
        has_primary_image=facts.has_primary_image,
    )

    # ── Apply UPDATE ─────────────────────────────────────────
    new_brand    = result.detected_brand or facts.brand
    new_category = result.detected_category_label or facts.category
    new_desc     = facts.description or result.description
    merged_specs = {**facts.specs, **result.auto_attributes}

    await db.execute(text("""
        UPDATE products SET
            brand              = :brand,
            category           = :category,
            specs              = CAST(:specs AS JSONB),
            description        = :description,
            status             = :status,
            completeness_score = :score,
            updated_at         = NOW(),
            version            = version + 1
        WHERE id = :id
    """), {
        "id": product_id,
        "brand": new_brand,
        "category": new_category,
        "specs": json.dumps(merged_specs),
        "description": new_desc,
        "status": result.new_status,
        "score": result.completeness,
    })

    # ── Observations (audit trail) ──────────────────────────
    if result.detected_brand and result.brand_source != "explicit":
        await _add_observation(
            db, entity_type="product", entity_id=product_id,
            field="brand", value=result.detected_brand,
            source=source, confidence=0.75,
        )
    if result.detected_category_id:
        await _add_observation(
            db, entity_type="product", entity_id=product_id,
            field="category", value=result.detected_category_label,
            source=source, confidence=0.80,
        )
    for spec_key, spec_val in result.extracted_specs.items():
        await _add_observation(
            db, entity_type="product", entity_id=product_id,
            field=f"spec.{spec_key}", value=spec_val,
            source=source, confidence=0.70,
        )

    return EnrichmentApplied(
        product_id=product_id,
        sku=facts.sku,
        brand_before=facts.brand,
        brand_after=new_brand,
        category_before=facts.category,
        category_after=new_category,
        completeness_before=completeness_before,
        completeness_after=result.completeness,
        status_after=result.new_status,
        auto_attrs_added=len(result.auto_attributes),
    )


@dataclass
class BulkEnrichmentReport:
    total: int
    enriched: int
    skipped: int
    by_status: dict[str, int]
    avg_completeness_before: float
    avg_completeness_after: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "enriched": self.enriched,
            "skipped": self.skipped,
            "by_status": self.by_status,
            "avg_completeness_before": self.avg_completeness_before,
            "avg_completeness_after": self.avg_completeness_after,
        }


async def enrich_many(
    db: AsyncSession,
    *,
    only_status: tuple[str, ...] = ("RAW", "NORMALIZED", "NEEDS_FIX"),
    limit: int = 5000,
) -> BulkEnrichmentReport:
    """Bulk-enrich every product matching the given status set."""
    rows = await db.execute(text(f"""
        SELECT id FROM products
         WHERE status = ANY(:statuses)
         ORDER BY updated_at ASC
         LIMIT :lim
    """), {"statuses": list(only_status), "lim": limit})

    ids = [r[0] for r in rows.all()]
    enriched = 0
    skipped = 0
    by_status: dict[str, int] = {}
    sum_before, sum_after = 0.0, 0.0

    for pid in ids:
        applied = await enrich_one(db, pid)
        if applied is None:
            skipped += 1
            continue
        enriched += 1
        sum_before += applied.completeness_before
        sum_after  += applied.completeness_after
        by_status[applied.status_after] = by_status.get(applied.status_after, 0) + 1

    return BulkEnrichmentReport(
        total=len(ids),
        enriched=enriched,
        skipped=skipped,
        by_status=by_status,
        avg_completeness_before=round(sum_before / enriched, 3) if enriched else 0.0,
        avg_completeness_after=round(sum_after  / enriched, 3) if enriched else 0.0,
    )
