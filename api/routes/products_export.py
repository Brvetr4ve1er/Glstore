"""
Catalog export + bulk operations — Phase 10.

GET  /products/export           → CSV download (round-trips with /import/commit)
POST /products/bulk-update      → set brand/category/status/description on N products
POST /products/bulk-status      → quick status change with a predicate filter
POST /products/bulk-intel       → already exists at /products/intel-bulk (re-exported here)

The CSV export produces the same columns the universal CSV parser expects,
so any exported file can be edited in Excel and re-imported without column
remapping. The owner can:
  1. Export all products
  2. Fix brand/category in a spreadsheet
  3. Re-import — idempotent upsert on SKU updates those fields
"""
from __future__ import annotations

import csv
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
import io
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

# SQLAlchemy imported lazily inside each handler so pure-Python tests
# can import this module without DB drivers installed.
from api.core.db import get_db
from api.core.security import require_role

router = APIRouter(prefix="/products", tags=["export"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
READ_ROLES  = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")


# ── CSV export ───────────────────────────────────────────────────────────────

# Canonical column order — matches what the universal CSV parser accepts on re-import.
_CSV_COLUMNS = [
    "sku",
    "name",
    "brand",
    "model",
    "category",
    "subcategory",
    "barcode",
    "mpn",
    "status",
    "description",
    "retail_price",
    "purchase_price",
    "stock_quantity",
    "completeness_score",
    "primary_image",
    "updated_at",
]


@router.get("/export", dependencies=[Depends(require_role(*READ_ROLES))])
async def export_products(
    status: list[str] | None = Query(None, description="Filter by status (default: all non-archived)"),
    brand: str | None = Query(None, description="Filter by exact brand"),
    category: str | None = Query(None, description="Filter by exact category"),
    missing_brand: bool = Query(False, description="Only export products with no brand"),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Export the product catalog as CSV.

    The output is designed to round-trip with POST /products/import/commit:
    download → edit in Excel → re-import → only changed rows update.

    Filters allow targeted exports, e.g. just NEEDS_FIX products, or just
    products with missing brand (for a bulk-brand-correction workflow).
    """
    statuses = [s.upper() for s in (status or []) if s.strip()] or None

    from sqlalchemy import text as _text
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F811
    text = _text  # type: ignore[assignment]

    # Build WHERE clause
    conditions: list[str] = ["p.status <> 'ARCHIVED'"]
    params: dict[str, Any] = {}

    if statuses:
        conditions.append("p.status = ANY(:statuses)")
        params["statuses"] = statuses
    if brand:
        conditions.append("UPPER(p.brand) = UPPER(:brand)")
        params["brand"] = brand
    if category:
        conditions.append("p.category = :category")
        params["category"] = category
    if missing_brand:
        conditions.append("(p.brand IS NULL OR TRIM(p.brand) = '' OR UPPER(p.brand) IN ('INCONNU','UNKNOWN'))")

    where = " AND ".join(conditions)

    rows = await db.execute(text(f"""
        SELECT
            p.sku,
            p.name,
            p.brand,
            p.model,
            p.category,
            p.subcategory,
            p.barcode,
            p.mpn,
            p.status::text,
            p.description,
            (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
               FROM offers o WHERE o.product_id = p.id AND o.is_active) AS retail_price,
            (SELECT MIN(o.purchase_price)
               FROM offers o WHERE o.product_id = p.id AND o.is_active) AS purchase_price,
            (SELECT SUM(o.stock_quantity - o.reserved_quantity)
               FROM offers o WHERE o.product_id = p.id AND o.is_active) AS stock_quantity,
            ROUND(p.completeness_score::numeric, 3) AS completeness_score,
            (SELECT m.url FROM product_media m
              WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
              LIMIT 1) AS primary_image,
            p.updated_at
        FROM products p
        WHERE {where}
        ORDER BY p.completeness_score ASC, p.updated_at DESC
    """), params)

    # Stream the CSV rather than building it all in memory
    def _generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_CSV_COLUMNS, lineterminator="\r\n",
                                extrasaction="ignore", quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        for r in rows.all():
            row = dict(zip(_CSV_COLUMNS, [
                r[0],   # sku
                r[1],   # name
                r[2],   # brand
                r[3],   # model
                r[4],   # category
                r[5],   # subcategory
                r[6],   # barcode
                r[7],   # mpn
                r[8],   # status
                (r[9] or "").replace("\n", " ").replace("\r", ""),   # description
                r[10],  # retail_price
                r[11],  # purchase_price
                r[12],  # stock_quantity
                r[13],  # completeness_score
                r[14],  # primary_image
                r[15].isoformat() if r[15] else "",   # updated_at
            ]))
            writer.writerow(row)
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    filename = "glstore-catalog.csv"
    if statuses:
        filename = f"glstore-{'-'.join(s.lower() for s in statuses)}.csv"
    elif missing_brand:
        filename = "glstore-missing-brand.csv"

    return StreamingResponse(
        _generate(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Columns": ",".join(_CSV_COLUMNS),
        },
    )


# ── Bulk update ───────────────────────────────────────────────────────────────

class BulkUpdateBody:
    """FastAPI doesn't support dataclasses directly in POST bodies;
    use a plain Pydantic model."""
    pass


from pydantic import BaseModel, Field


class BulkUpdateRequest(BaseModel):
    """Update a list of products in one shot.

    Only fields that are explicitly set (non-None) are written — skipping
    a field preserves the existing value. This lets you, e.g., set brand
    on 50 products without touching category.
    """
    product_ids: list[UUID] = Field(..., min_length=1, max_length=500)
    brand:       str | None = Field(None, max_length=120)
    category:    str | None = Field(None, max_length=120)
    subcategory: str | None = Field(None, max_length=120)
    status:      str | None = Field(None, description="ACTIVE | ARCHIVED | NEEDS_FIX | NORMALIZED | CLASSIFIED | VERIFIED")
    description: str | None = Field(None, max_length=8000)


class BulkUpdateResponse(BaseModel):
    updated: int
    skipped: int
    product_ids: list[str]


# Allowed status values for bulk updates
_VALID_STATUSES = {"RAW", "NORMALIZED", "CLASSIFIED", "VERIFIED", "ACTIVE", "NEEDS_FIX", "ARCHIVED"}


@router.post("/bulk-update", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def bulk_update_products(
    body: BulkUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> BulkUpdateResponse:
    """Update brand / category / status / description on up to 500 products at once.

    Only the fields you include (non-null) are written. Skipped fields keep
    their current values. Returns counts and the list of updated IDs.

    Audit: every changed field writes an observations row.
    """
    from sqlalchemy import text
    if body.status and body.status.upper() not in _VALID_STATUSES:
        from fastapi import HTTPException
        raise HTTPException(400, f"invalid status '{body.status}'; must be one of {sorted(_VALID_STATUSES)}")

    set_clauses: list[str] = ["updated_at = NOW()", "version = version + 1"]
    params: dict[str, Any] = {"ids": [str(pid) for pid in body.product_ids]}

    if body.brand is not None:
        set_clauses.append("brand = :brand")
        params["brand"] = body.brand.strip() or None
    if body.category is not None:
        set_clauses.append("category = :category")
        params["category"] = body.category.strip() or None
    if body.subcategory is not None:
        set_clauses.append("subcategory = :subcategory")
        params["subcategory"] = body.subcategory.strip() or None
    if body.description is not None:
        set_clauses.append("description = :description")
        params["description"] = body.description.strip() or None
    if body.status is not None:
        set_clauses.append("status = :status")
        params["status"] = body.status.upper()

    if len(set_clauses) == 2:
        # Only updated_at + version — nothing to update
        return BulkUpdateResponse(updated=0, skipped=len(body.product_ids), product_ids=[])

    result = await db.execute(text(f"""
        UPDATE products
           SET {", ".join(set_clauses)}
         WHERE id = ANY(CAST(:ids AS UUID[]))
           AND status <> 'ARCHIVED'
        RETURNING id
    """), params)
    updated_ids = [str(r[0]) for r in result.all()]

    # Write audit observations
    changed_fields = []
    if body.brand is not None:    changed_fields.append("brand")
    if body.category is not None: changed_fields.append("category")
    if body.status is not None:   changed_fields.append("status")
    if body.description is not None: changed_fields.append("description")

    if updated_ids and changed_fields:
        for pid in updated_ids:
            for field_name in changed_fields:
                await db.execute(text("""
                    INSERT INTO observations (entity_type, entity_id, field, value, source, confidence)
                    VALUES ('product', :pid, :field, CAST(:val AS JSONB), 'bulk_admin_edit', 1.0)
                """), {
                    "pid": pid,
                    "field": field_name,
                    "val": f'{{"v": "bulk_update"}}',
                })

    await db.commit()

    skipped = len(body.product_ids) - len(updated_ids)
    return BulkUpdateResponse(
        updated=len(updated_ids),
        skipped=skipped,
        product_ids=updated_ids,
    )


# ── Bulk status ───────────────────────────────────────────────────────────────

class BulkStatusRequest(BaseModel):
    """Quick status change with flexible predicate — for the admin action bar."""
    product_ids:      list[UUID] | None = Field(None, description="Explicit IDs (max 500)")
    current_status:   list[str] | None = Field(None, description="Source status filter")
    missing_brand:    bool = False
    missing_category: bool = False
    missing_image:    bool = False
    new_status:       str  = Field(..., description="Target status for all matched products")
    limit:            int  = Field(500, ge=1, le=2000)


@router.post("/bulk-status", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def bulk_status_change(
    body: BulkStatusRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Change the status of many products matching a predicate.

    Can be combined: change all NEEDS_FIX products with missing brand to NEEDS_FIX
    (useful after running bulk Full Intel to mark resolved ones as CLASSIFIED).
    """
    from sqlalchemy import text
    if body.new_status.upper() not in _VALID_STATUSES:
        from fastapi import HTTPException
        raise HTTPException(400, f"invalid status '{body.new_status}'")

    conditions: list[str] = ["status <> 'ARCHIVED'"]
    params: dict[str, Any] = {"new_status": body.new_status.upper(), "lim": body.limit}

    if body.product_ids:
        conditions.append("id = ANY(CAST(:ids AS UUID[]))")
        params["ids"] = [str(pid) for pid in body.product_ids[:500]]
    if body.current_status:
        conditions.append("status = ANY(:cur_statuses)")
        params["cur_statuses"] = [s.upper() for s in body.current_status]
    if body.missing_brand:
        conditions.append("(brand IS NULL OR TRIM(brand) = '' OR UPPER(brand) IN ('INCONNU','UNKNOWN'))")
    if body.missing_category:
        conditions.append("(category IS NULL OR TRIM(category) = '')")
    if body.missing_image:
        conditions.append(
            "NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = products.id AND m.is_primary AND m.status = 'STORED')"
        )

    where = " AND ".join(conditions)

    result = await db.execute(text(f"""
        UPDATE products
           SET status = :new_status, updated_at = NOW(), version = version + 1
         WHERE id IN (
             SELECT id FROM products WHERE {where}
             ORDER BY completeness_score ASC, updated_at DESC
             LIMIT :lim
         )
        RETURNING id
    """), params)
    updated_ids = [str(r[0]) for r in result.all()]

    if updated_ids:
        for pid in updated_ids:
            await db.execute(text("""
                INSERT INTO observations (entity_type, entity_id, field, value, source, confidence)
                VALUES ('product', :pid, 'status', CAST(:val AS JSONB), 'bulk_admin_status', 1.0)
            """), {"pid": pid, "val": f'{{"v": "{body.new_status.upper()}"}}'})

    await db.commit()

    return {
        "updated": len(updated_ids),
        "new_status": body.new_status.upper(),
        "product_ids": updated_ids,
    }
