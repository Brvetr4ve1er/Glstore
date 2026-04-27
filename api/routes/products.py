"""
Products routes — read + write (Phase 0).

Public:    GET /products, GET /products/{id}
Admin:     POST, PATCH, DELETE /products  + /products/{id}/offers CRUD
"""
import json
import re
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.models.schemas import (
    OfferCreate,
    OfferPatch,
    ProductCreate,
    ProductPatch,
)

router = APIRouter(prefix="/products", tags=["products"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")


# ── helpers ──────────────────────────────────────────────────────────────

def _slugify(value: str) -> str:
    """Conservative slug: lowercase, alnum-only, hyphenated. Fallback on uuid suffix."""
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return base or f"product-{uuid4().hex[:8]}"


async def _ensure_unique(db: AsyncSession, table: str, field: str, value: str, exclude_id: UUID | None = None) -> None:
    sql = f"SELECT 1 FROM {table} WHERE {field} = :v"
    params: dict[str, Any] = {"v": value}
    if exclude_id is not None:
        sql += " AND id <> :id"
        params["id"] = exclude_id
    row = await db.execute(text(sql), params)
    if row.first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"{field} '{value}' already in use")


# ── Reads (public) ───────────────────────────────────────────────────────

_SORT_CLAUSES: dict[str, str] = {
    "recent":       "updated_at DESC NULLS LAST, id",
    "price_asc":    "min_price ASC NULLS LAST, id",
    "price_desc":   "min_price DESC NULLS LAST, id",
    "completeness": "completeness_score DESC NULLS LAST, updated_at DESC, id",
    "name_asc":     "name ASC, id",
}


@router.get("")
async def list_products(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, min_length=1, max_length=200),
    category: str | None = None,
    brand: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    in_stock: bool | None = Query(None, description="If true, exclude items with 0 available"),
    price_min: float | None = Query(None, ge=0),
    price_max: float | None = Query(None, ge=0),
    sort: str = Query("recent", description="recent|price_asc|price_desc|completeness|name_asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=120),
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    where: list[str] = []
    params: dict[str, Any] = {"limit": page_size, "offset": offset}

    # Default: only show non-archived. Caller can pass status= to override.
    if status_filter:
        where.append("p.status = :st")
        params["st"] = status_filter
    else:
        where.append("p.status <> 'ARCHIVED'")

    if q:
        where.append("(p.name ILIKE :q OR p.sku ILIKE :q OR p.brand ILIKE :q)")
        params["q"] = f"%{q}%"
    if category:
        where.append("p.category = :cat")
        params["cat"] = category
    if brand:
        where.append("p.brand = :brand")
        params["brand"] = brand

    where_sql = " AND ".join(where) if where else "TRUE"

    # Sort + post-where filters (price/in_stock are post-aggregate, applied via HAVING-equivalent
    # on the subquery results). We keep using a single SELECT with subqueries because indexes
    # cover the per-product subqueries acceptably at < 50K rows.
    order_clause = _SORT_CLAUSES.get(sort, _SORT_CLAUSES["recent"])

    # Build extra subquery filters
    extra_having: list[str] = []
    if in_stock:
        extra_having.append("COALESCE(available, 0) > 0")
    if price_min is not None:
        extra_having.append("min_price IS NOT NULL AND min_price >= :pmin")
        params["pmin"] = price_min
    if price_max is not None:
        extra_having.append("min_price IS NOT NULL AND min_price <= :pmax")
        params["pmax"] = price_max
    extra_where_sql = (" AND " + " AND ".join(extra_having)) if extra_having else ""

    rows = await db.execute(
        text(
            f"""
            SELECT id, sku, slug, name, brand, category, specs,
                   completeness_score, status, primary_image, min_price, available
              FROM (
                SELECT p.id, p.sku, p.slug, p.name, p.brand, p.category,
                       p.specs, p.completeness_score, p.status, p.updated_at,
                       (SELECT url FROM product_media m
                         WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                         LIMIT 1) AS primary_image,
                       (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
                         WHERE o.product_id = p.id AND o.is_active) AS min_price,
                       (SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o
                         WHERE o.product_id = p.id AND o.is_active) AS available
                  FROM products p
                 WHERE {where_sql}
              ) p
             WHERE TRUE {extra_where_sql}
             ORDER BY {order_clause}
             LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    items = [
        {
            "id": r[0], "sku": r[1], "slug": r[2], "name": r[3],
            "brand": r[4], "category": r[5], "specs": r[6],
            "completeness_score": float(r[7]),
            "status": r[8],
            "primary_image": r[9],
            "min_price": r[10],
            "available": r[11] or 0,
        }
        for r in rows.all()
    ]

    total_row = await db.execute(
        text(f"""
            SELECT COUNT(*) FROM (
                SELECT p.id,
                       (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
                         WHERE o.product_id = p.id AND o.is_active) AS min_price,
                       (SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o
                         WHERE o.product_id = p.id AND o.is_active) AS available
                  FROM products p
                 WHERE {where_sql}
            ) q WHERE TRUE {extra_where_sql}
        """),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = total_row.scalar_one()
    return {"items": items, "page": page, "page_size": page_size, "total": total}


@router.get("/{product_id}")
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    prod_row = await db.execute(
        text(
            """
            SELECT id, sku, slug, name, brand, model, category, subcategory,
                   description, specs, status, completeness_score, updated_at,
                   barcode, mpn
              FROM products WHERE id = :id
            """
        ),
        {"id": product_id},
    )
    p = prod_row.first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")

    offers_rows = await db.execute(
        text(
            """
            SELECT id, variant_sku, variant_attrs, purchase_price, retail_price,
                   sale_price, currency, stock_quantity, reserved_quantity, is_active,
                   low_stock_threshold
              FROM offers WHERE product_id = :id
             ORDER BY is_active DESC, retail_price ASC
            """
        ),
        {"id": product_id},
    )
    offers = [
        {
            "id": r[0], "variant_sku": r[1], "variant_attrs": r[2],
            "purchase_price": r[3], "retail_price": r[4], "sale_price": r[5],
            "currency": r[6],
            "stock_quantity": r[7], "reserved_quantity": r[8],
            "is_active": r[9], "low_stock_threshold": r[10],
            "available": max((r[7] or 0) - (r[8] or 0), 0),
        }
        for r in offers_rows.all()
    ]

    media_rows = await db.execute(
        text(
            """
            SELECT id, url, kind, is_primary, position, alt_text
              FROM product_media
             WHERE product_id = :id AND status = 'STORED'
             ORDER BY is_primary DESC, position ASC
            """
        ),
        {"id": product_id},
    )
    media = [
        {"id": r[0], "url": r[1], "kind": r[2], "is_primary": r[3],
         "position": r[4], "alt": r[5]}
        for r in media_rows.all()
    ]

    return {
        "id": p[0], "sku": p[1], "slug": p[2], "name": p[3],
        "brand": p[4], "model": p[5], "category": p[6], "subcategory": p[7],
        "description": p[8], "specs": p[9], "status": p[10],
        "completeness_score": float(p[11]), "updated_at": p[12],
        "barcode": p[13], "mpn": p[14],
        "offers": offers, "media": media,
    }


# ── Writes (admin) ───────────────────────────────────────────────────────

@router.post("", status_code=201, dependencies=[Depends(require_role(*WRITE_ROLES))])
async def create_product(
    dto: ProductCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Auto-derive slug if missing/conflicting
    slug = dto.slug or _slugify(dto.name)

    await _ensure_unique(db, "products", "sku",  dto.sku)
    await _ensure_unique(db, "products", "slug", slug)

    pid = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO products (
                id, sku, slug, name, brand, model, category, subcategory,
                description, specs, barcode, mpn, ean, status, completeness_score
            ) VALUES (
                :id, :sku, :slug, :name, :brand, :model, :category, :subcategory,
                :description, CAST(:specs AS JSONB), :barcode, :mpn, :ean,
                'NORMALIZED', 0.5
            )
            """
        ),
        {
            "id": pid,
            "sku": dto.sku,
            "slug": slug,
            "name": dto.name,
            "brand": dto.brand,
            "model": dto.model,
            "category": dto.category,
            "subcategory": dto.subcategory,
            "description": dto.description,
            "specs": json.dumps(dto.specs),
            "barcode": dto.barcode,
            "mpn": dto.mpn,
            "ean": dto.ean,
        },
    )

    if dto.initial_offer:
        await _create_offer_internal(db, pid, dto.initial_offer)

    await db.commit()
    return await get_product(pid, db)


@router.patch("/{product_id}", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def update_product(
    product_id: UUID,
    dto: ProductPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Make sure product exists
    exists = await db.execute(text("SELECT 1 FROM products WHERE id = :id"), {"id": product_id})
    if not exists.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")

    updates = dto.model_dump(exclude_unset=True)
    if not updates:
        return await get_product(product_id, db)

    if "sku" in updates:
        await _ensure_unique(db, "products", "sku", updates["sku"], exclude_id=product_id)
    if "slug" in updates:
        await _ensure_unique(db, "products", "slug", updates["slug"], exclude_id=product_id)

    set_parts: list[str] = []
    params: dict[str, Any] = {"id": product_id}
    for k, v in updates.items():
        if k == "specs":
            set_parts.append("specs = CAST(:specs AS JSONB)")
            params["specs"] = json.dumps(v)
        else:
            set_parts.append(f"{k} = :{k}")
            params[k] = v
    set_parts.append("updated_at = NOW()")
    set_parts.append("version = version + 1")

    await db.execute(
        text(f"UPDATE products SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    await db.commit()
    return await get_product(product_id, db)


@router.delete("/{product_id}", status_code=204, dependencies=[Depends(require_role("SUPER_ADMIN", "ADMIN"))])
async def delete_product(
    product_id: UUID,
    hard: bool = Query(False, description="If true, fully delete (admin only). Default = soft archive."),
    db: AsyncSession = Depends(get_db),
) -> None:
    if hard:
        # Block hard delete if there are any order_items referencing this product
        ref = await db.execute(
            text("SELECT 1 FROM order_items WHERE product_id = :id LIMIT 1"),
            {"id": product_id},
        )
        if ref.first():
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Cannot hard-delete: product has order history. Archive instead.",
            )
        await db.execute(text("DELETE FROM products WHERE id = :id"), {"id": product_id})
    else:
        # Soft delete — archive + deactivate offers
        result = await db.execute(
            text(
                "UPDATE products SET status = 'ARCHIVED', updated_at = NOW(), "
                "version = version + 1 WHERE id = :id RETURNING id"
            ),
            {"id": product_id},
        )
        if not result.first():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
        await db.execute(
            text("UPDATE offers SET is_active = false, updated_at = NOW() WHERE product_id = :id"),
            {"id": product_id},
        )
    await db.commit()


# ── Offers nested CRUD ───────────────────────────────────────────────────

async def _create_offer_internal(db: AsyncSession, product_id: UUID, dto: OfferCreate) -> UUID:
    if dto.sale_price is not None and dto.sale_price > dto.retail_price:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "sale_price cannot exceed retail_price")

    await _ensure_unique(db, "offers", "variant_sku", dto.variant_sku)
    oid = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO offers (
                id, product_id, variant_sku, variant_attrs,
                purchase_price, retail_price, sale_price, currency,
                stock_quantity, low_stock_threshold, is_active
            ) VALUES (
                :id, :pid, :sku, CAST(:attrs AS JSONB),
                :pp, :rp, :sp, :cur,
                :stock, :low, true
            )
            """
        ),
        {
            "id": oid,
            "pid": product_id,
            "sku": dto.variant_sku,
            "attrs": json.dumps(dto.variant_attrs),
            "pp": dto.purchase_price,
            "rp": dto.retail_price,
            "sp": dto.sale_price,
            "cur": dto.currency,
            "stock": dto.stock_quantity,
            "low": dto.low_stock_threshold,
        },
    )
    return oid


@router.post("/{product_id}/offers", status_code=201, dependencies=[Depends(require_role(*WRITE_ROLES))])
async def add_offer(
    product_id: UUID,
    dto: OfferCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    exists = await db.execute(text("SELECT 1 FROM products WHERE id = :id"), {"id": product_id})
    if not exists.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")

    await _create_offer_internal(db, product_id, dto)
    await db.commit()
    return await get_product(product_id, db)


@router.patch("/{product_id}/offers/{offer_id}", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def update_offer(
    product_id: UUID,
    offer_id: UUID,
    dto: OfferPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await db.execute(
        text("SELECT 1 FROM offers WHERE id = :id AND product_id = :pid"),
        {"id": offer_id, "pid": product_id},
    )
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "offer not found")

    updates = dto.model_dump(exclude_unset=True)
    if not updates:
        return await get_product(product_id, db)

    if "variant_sku" in updates:
        await _ensure_unique(db, "offers", "variant_sku", updates["variant_sku"], exclude_id=offer_id)

    set_parts: list[str] = []
    params: dict[str, Any] = {"id": offer_id}
    for k, v in updates.items():
        if k == "variant_attrs":
            set_parts.append("variant_attrs = CAST(:variant_attrs AS JSONB)")
            params["variant_attrs"] = json.dumps(v)
        else:
            set_parts.append(f"{k} = :{k}")
            params[k] = v
    set_parts.append("updated_at = NOW()")
    set_parts.append("version = version + 1")

    await db.execute(
        text(f"UPDATE offers SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    await db.commit()
    return await get_product(product_id, db)


@router.delete("/{product_id}/offers/{offer_id}", status_code=204, dependencies=[Depends(require_role(*WRITE_ROLES))])
async def delete_offer(
    product_id: UUID,
    offer_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    # Block delete if reservations exist
    ref = await db.execute(
        text("SELECT 1 FROM inventory_reservations WHERE offer_id = :id AND status = 'ACTIVE' LIMIT 1"),
        {"id": offer_id},
    )
    if ref.first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot delete: offer has active reservations. Deactivate instead.",
        )
    result = await db.execute(
        text("DELETE FROM offers WHERE id = :id AND product_id = :pid RETURNING id"),
        {"id": offer_id, "pid": product_id},
    )
    if not result.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "offer not found")
    await db.commit()
