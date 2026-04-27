"""
Catalog metadata — public endpoints used by the storefront navbar / filters.

GET /categories            distinct categories with per-category product count
GET /brands/public         distinct brands with per-brand product count
GET /price-bounds          min/max retail across active offers (for filter slider)
GET /products/featured     highest-completeness ACTIVE products with images, capped
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db

router = APIRouter(tags=["catalog"])

# Hard cap so the graph endpoint stays predictable even if include_products=true
# is hit on a 50k-product catalog. The frontend asks for a page-able window via
# `product_limit`; the API still enforces a max for safety.
_PRODUCT_NODE_HARD_CAP = 4000


@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = await db.execute(text("""
        SELECT category, COUNT(*) AS n
          FROM products
         WHERE status = 'ACTIVE'
           AND category IS NOT NULL
           AND length(trim(category)) > 0
         GROUP BY category
         ORDER BY n DESC, category ASC
    """))
    items = [{"name": r[0], "count": int(r[1])} for r in rows.all()]
    return {"items": items, "total": sum(i["count"] for i in items)}


@router.get("/brands/public")
async def list_public_brands(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = await db.execute(text("""
        SELECT UPPER(brand) AS b, COUNT(*) AS n
          FROM products
         WHERE status = 'ACTIVE'
           AND brand IS NOT NULL
           AND UPPER(brand) NOT IN ('INCONNU','UNKNOWN','')
         GROUP BY UPPER(brand)
         ORDER BY n DESC, b ASC
    """))
    items = [{"name": r[0], "count": int(r[1])} for r in rows.all()]
    return {"items": items}


@router.get("/price-bounds")
async def price_bounds(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    row = await db.execute(text("""
        SELECT MIN(COALESCE(o.sale_price, o.retail_price)),
               MAX(COALESCE(o.sale_price, o.retail_price))
          FROM offers o
          JOIN products p ON p.id = o.product_id
         WHERE o.is_active AND o.retail_price > 0
           AND p.status = 'ACTIVE'
    """))
    r = row.first()
    return {
        "min": float(r[0]) if r and r[0] is not None else 0.0,
        "max": float(r[1]) if r and r[1] is not None else 0.0,
    }


@router.get("/products/graph")
async def catalog_graph(
    include_products: bool = Query(False, description="Add product nodes wired to their brand + category."),
    product_limit:    int  = Query(800, ge=10, le=_PRODUCT_NODE_HARD_CAP),
    only_status:      list[str] | None = Query(None, description="Restrict product nodes to these statuses."),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Returns the catalog graph used by the admin's Obsidian-style explorer.

    By default returns brand × category aggregates only — fast, ~60 nodes.
    With `include_products=true` it also returns up to `product_limit` product
    nodes connected via `product:{id} → brand:{X}` and `product:{id} → cat:{Y}`
    edges, giving the user a true Obsidian-style three-tier graph (brands ←
    products → categories).

    Shape:
      {
        "nodes": [
          {"id": "brand:SAMSUNG",  "type": "brand",    "label": "SAMSUNG",  "count": 24, "score": 0.81},
          {"id": "cat:TV",         "type": "category", "label": "TV",       "count": 89, "score": null},
          {"id": "product:<uuid>", "type": "product",  "label": "...",      "count": 1,  "score": 0.62,
           "sku": "...", "brand": "SAMSUNG", "category": "TV", "status": "ACTIVE",
           "primary_image": "https://..."},
          ...
        ],
        "edges": [
          {"source": "brand:SAMSUNG", "target": "cat:TV", "weight": 12, "avg_completeness": 0.78, "kind": "brand-category"},
          {"source": "product:<id>",  "target": "brand:SAMSUNG",        "weight": 1,  "avg_completeness": 0.62, "kind": "product-brand"},
          ...
        ]
      }

    `kind` on edges lets the frontend dim/colour them differently and gives
    the search overlay enough metadata to highlight only the connected
    sub-graph for a hovered/searched node.
    """
    statuses = [s.upper() for s in (only_status or []) if s.strip()]
    where_status_unqualified = "status <> 'ARCHIVED'"
    where_status_p           = "p.status <> 'ARCHIVED'"
    params: dict[str, Any] = {}
    if statuses:
        where_status_unqualified = "status = ANY(:statuses)"
        where_status_p           = "p.status = ANY(:statuses)"
        params["statuses"] = statuses

    # ── Brand nodes ──────────────────────────────────────────────────────
    brand_rows = await db.execute(text(f"""
        SELECT UPPER(brand) AS b, COUNT(*) AS n, AVG(completeness_score)::real AS avg_comp
          FROM products
         WHERE {where_status_unqualified}
           AND brand IS NOT NULL
           AND UPPER(brand) NOT IN ('INCONNU','UNKNOWN','')
         GROUP BY UPPER(brand)
    """), params)

    # ── Category nodes ───────────────────────────────────────────────────
    cat_rows = await db.execute(text(f"""
        SELECT category AS c, COUNT(*) AS n, AVG(completeness_score)::real AS avg_comp
          FROM products
         WHERE {where_status_unqualified}
           AND category IS NOT NULL
           AND length(trim(category)) > 0
           -- Note: we INCLUDE generic categories like 'Electromenager' on purpose.
           -- The graph should reveal where the catalog still needs re-classification,
           -- not hide it.
         GROUP BY category
    """), params)

    # ── Brand × Category edges ───────────────────────────────────────────
    edge_rows = await db.execute(text(f"""
        SELECT UPPER(brand) AS b, category AS c, COUNT(*) AS n,
               AVG(completeness_score)::real AS avg_comp
          FROM products
         WHERE {where_status_unqualified}
           AND brand IS NOT NULL
           AND UPPER(brand) NOT IN ('INCONNU','UNKNOWN','')
           AND category IS NOT NULL
           AND length(trim(category)) > 0
         GROUP BY UPPER(brand), category
    """), params)

    nodes: list[dict[str, Any]] = []
    for r in brand_rows.all():
        nodes.append({
            "id":    f"brand:{r[0]}",
            "type":  "brand",
            "label": r[0],
            "count": int(r[1]),
            "score": round(float(r[2] or 0), 3),
        })
    for r in cat_rows.all():
        nodes.append({
            "id":    f"cat:{r[0]}",
            "type":  "category",
            "label": r[0],
            "count": int(r[1]),
            "score": round(float(r[2] or 0), 3),
        })

    edges: list[dict[str, Any]] = [{
        "source":            f"brand:{r[0]}",
        "target":            f"cat:{r[1]}",
        "weight":            int(r[2]),
        "avg_completeness":  round(float(r[3] or 0), 3),
        "kind":              "brand-category",
    } for r in edge_rows.all()]

    product_count = 0

    if include_products:
        # ── Product nodes ────────────────────────────────────────────────
        # We hard-cap to `product_limit` so the frontend doesn't choke on a 50k
        # catalog. We pick the LOWEST-completeness products first because those
        # are the ones the user actually wants to see in the graph (the work
        # queue) — high-quality products are already done.
        prod_rows = await db.execute(text(f"""
            SELECT p.id, p.sku, p.name,
                   UPPER(p.brand) AS brand, p.category, p.status::text AS status,
                   p.completeness_score::real AS score,
                   (SELECT m.url FROM product_media m
                     WHERE m.product_id = p.id
                       AND m.kind = 'image'
                       AND m.status = 'STORED'
                     ORDER BY m.is_primary DESC, m.position ASC
                     LIMIT 1) AS primary_image
              FROM products p
             WHERE {where_status_p}
             ORDER BY p.completeness_score ASC, p.updated_at DESC
             LIMIT :plim
        """), {**params, "plim": min(product_limit, _PRODUCT_NODE_HARD_CAP)})

        existing_brands = {n["id"] for n in nodes if n["type"] == "brand"}
        existing_cats   = {n["id"] for n in nodes if n["type"] == "category"}

        for r in prod_rows.all():
            pid = str(r[0])
            brand = (r[3] or "").strip()
            cat   = (r[4] or "").strip()
            nodes.append({
                "id":            f"product:{pid}",
                "type":          "product",
                "label":         r[2] or r[1],
                "count":         1,
                "score":         round(float(r[6] or 0), 3),
                "sku":           r[1],
                "brand":         brand or None,
                "category":      cat or None,
                "status":        r[5],
                "primary_image": r[7],
            })
            product_count += 1
            if brand and brand not in ("INCONNU", "UNKNOWN"):
                bid = f"brand:{brand}"
                if bid in existing_brands:
                    edges.append({
                        "source":            f"product:{pid}",
                        "target":            bid,
                        "weight":            1,
                        "avg_completeness":  round(float(r[6] or 0), 3),
                        "kind":              "product-brand",
                    })
            if cat:
                cid = f"cat:{cat}"
                if cid in existing_cats:
                    edges.append({
                        "source":            f"product:{pid}",
                        "target":            cid,
                        "weight":            1,
                        "avg_completeness":  round(float(r[6] or 0), 3),
                        "kind":              "product-category",
                    })

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "brand_count":    sum(1 for n in nodes if n["type"] == "brand"),
            "category_count": sum(1 for n in nodes if n["type"] == "category"),
            "product_count":  product_count,
            "edge_count":     len(edges),
            "include_products": include_products,
            "product_limit":  product_limit if include_products else 0,
        },
    }


@router.get("/products/featured")
async def featured_products(
    limit: int = Query(12, ge=1, le=48),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public storefront's hero featured: ACTIVE, has primary image, highest completeness."""
    rows = await db.execute(text("""
        SELECT p.id, p.sku, p.slug, p.name, p.brand, p.category,
               p.completeness_score,
               (SELECT url FROM product_media m
                 WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
                 LIMIT 1) AS primary_image,
               (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
                 WHERE o.product_id = p.id AND o.is_active) AS min_price,
               (SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o
                 WHERE o.product_id = p.id AND o.is_active) AS available
          FROM products p
         WHERE p.status = 'ACTIVE'
         ORDER BY (
             (CASE WHEN EXISTS (
                 SELECT 1 FROM product_media m
                  WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
             ) THEN 1 ELSE 0 END)
         ) DESC,
         p.completeness_score DESC,
         p.updated_at DESC
         LIMIT :lim
    """), {"lim": limit})
    items = [{
        "id": r[0], "sku": r[1], "slug": r[2], "name": r[3],
        "brand": r[4], "category": r[5],
        "completeness_score": float(r[6] or 0),
        "primary_image": r[7],
        "min_price": float(r[8]) if r[8] is not None else None,
        "available": int(r[9] or 0),
    } for r in rows.all()]
    return {"items": items}
