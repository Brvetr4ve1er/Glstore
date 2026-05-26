"""
Single-URL product import — Phase 10.

Given a product page URL from *any* website, fetch the page through the
existing multi-tier scraper fetcher, run the generic structured-data
extractor (JSON-LD → microdata → OpenGraph → CSS heuristic), and map the
result into a product draft the admin can review and commit.

This deliberately reuses the scraper stack rather than re-implementing
fetching/extraction:
    - scraper_engine.load_config(db)   → ScraperConfig (UA, proxies, tiers)
    - TieredFetcher.fetch(url)         → escalates http → playwright → stealth
    - extractors.extract(html, url)    → ExtractedData

Preview does no writes. Commit inserts a product (+ optional offer + media).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.scraper import engine as scraper_engine
from api.services.scraper import extractors
from api.services.scraper.fetcher import TieredFetcher
from api.services.scraper.types import SourceTier
from api.services.scraper.utils.proxy_manager import ProxyPool

log = logging.getLogger("glstore.url_import")

_CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")
_MAX_IMAGES = 8


@dataclass
class ProductDraft:
    """A reviewable product draft extracted from a single URL."""
    source_url: str
    name: str | None
    brand: str | None
    sku: str
    category: str | None
    description: str | None
    specs: dict[str, Any] = field(default_factory=dict)
    images: list[str] = field(default_factory=list)
    price: float | None = None
    currency: str = "DZD"
    availability: str = "unknown"
    # Provenance (surfaced in the preview so the admin can judge trust)
    method: str = "css_heuristic"
    confidence: float = 0.0
    notes: list[str] = field(default_factory=list)
    fetch_engine: str = ""
    http_status: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_url": self.source_url,
            "name": self.name,
            "brand": self.brand,
            "sku": self.sku,
            "category": self.category,
            "description": self.description,
            "specs": self.specs,
            "images": self.images,
            "price": self.price,
            "currency": self.currency,
            "availability": self.availability,
            "method": self.method,
            "confidence": round(self.confidence, 3),
            "notes": self.notes,
            "fetch_engine": self.fetch_engine,
            "http_status": self.http_status,
        }


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return base or f"product-{uuid4().hex[:8]}"


def _title_from_url(url: str) -> str:
    """Best-effort human name from the URL slug when the page gives nothing."""
    path = urlparse(url).path.rstrip("/")
    last = path.split("/")[-1] if path else ""
    last = re.sub(r"\.(html?|php|aspx?)$", "", last, flags=re.I)
    last = re.sub(r"[-_]+", " ", last).strip()
    return last.title() if last else "Imported product"


async def _build_fetcher(db: AsyncSession) -> TieredFetcher:
    cfg = await scraper_engine.load_config(db)
    pool = ProxyPool(cfg.proxies)
    return TieredFetcher(
        user_agent=cfg.user_agent,
        per_domain_rate_limit_s=cfg.per_domain_rate_limit_s,
        proxy_pool=pool,
        confidence_threshold=cfg.min_confidence_for_price,
        tier4_enabled=cfg.tier4_enabled,
        tier4_provider=cfg.tier4_provider,
        tier4_api_key=cfg.tier4_api_key,
    )


async def scrape_url(db: AsyncSession, url: str) -> ProductDraft:
    """Fetch + extract a single product page into a draft. No writes."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL must be an absolute http(s) link")

    fetcher = await _build_fetcher(db)
    result = await fetcher.fetch(url, tier=SourceTier.GENERAL)
    if not result.ok or not result.html:
        reason = result.error or f"could not fetch page (HTTP {result.status})"
        raise ValueError(reason)

    data = extractors.extract(result.html, url)

    specs: dict[str, Any] = dict(data.specs or {})
    # brand / sku live as their own columns, not generic specs
    brand = specs.pop("brand", None)
    sku_seed = specs.pop("sku", None)

    name = (data.title or "").strip() or _title_from_url(url)
    sku = str(sku_seed).strip() if sku_seed else _slugify(name)[:90]

    currency = (data.currency or "DZD").upper()
    if not _CURRENCY_RE.match(currency):
        currency = "DZD"

    notes = list(data.notes or [])
    if data.confidence < 0.45:
        notes.append("low confidence — verify fields before committing")

    return ProductDraft(
        source_url=url,
        name=name,
        brand=str(brand).strip() if brand else None,
        sku=sku,
        category=None,  # left for the admin / rule-engine to classify
        description=data.description,
        specs=specs,
        images=list(data.images or [])[:_MAX_IMAGES],
        price=float(data.price) if data.price is not None else None,
        currency=currency,
        availability=data.availability,
        method=data.method,
        confidence=data.confidence,
        notes=notes,
        fetch_engine=result.engine,
        http_status=result.status,
    )


async def _unique_value(db: AsyncSession, table: str, fieldname: str, base: str) -> str:
    """Return `base`, or `base-2`, `base-3`, … until it is free in `table`."""
    candidate = base
    n = 1
    while True:
        row = await db.execute(
            text(f"SELECT 1 FROM {table} WHERE {fieldname} = :v"), {"v": candidate}
        )
        if not row.first():
            return candidate
        n += 1
        suffix = f"-{n}"
        candidate = base[: 120 - len(suffix)] + suffix


async def commit_draft(
    db: AsyncSession,
    draft: ProductDraft,
    *,
    publish: bool = True,
    default_stock: int = 0,
) -> dict[str, Any]:
    """Insert product (+ optional offer + media) from a reviewed draft.

    Caller does NOT need to commit — this commits its own transaction.
    SKU/slug collisions are auto-resolved with a numeric suffix.
    """
    name = (draft.name or "").strip() or "Imported product"
    slug = await _unique_value(db, "products", "slug", _slugify(name))
    sku = await _unique_value(db, "products", "sku", (draft.sku or slug)[:120])
    status_value = "ACTIVE" if publish else "NORMALIZED"

    # Preserve provenance in specs so the source is auditable.
    specs = dict(draft.specs or {})
    specs.setdefault("_import_source_url", draft.source_url)

    pid = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO products (
                id, sku, slug, name, brand, model, category, subcategory,
                description, specs, status, completeness_score
            ) VALUES (
                :id, :sku, :slug, :name, :brand, NULL, :category, NULL,
                :description, CAST(:specs AS JSONB), :status, 0.5
            )
            """
        ),
        {
            "id": pid,
            "sku": sku,
            "slug": slug,
            "name": name,
            "brand": draft.brand,
            "category": draft.category,
            "description": draft.description,
            "specs": json.dumps(specs),
            "status": status_value,
        },
    )

    offer_created = False
    if draft.price is not None and draft.price > 0:
        currency = (draft.currency or "DZD").upper()
        if not _CURRENCY_RE.match(currency):
            currency = "DZD"
        variant_sku = await _unique_value(db, "offers", "variant_sku", f"{sku}-DEFAULT")
        stock = default_stock if draft.availability != "out_of_stock" else 0
        await db.execute(
            text(
                """
                INSERT INTO offers (
                    id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency,
                    stock_quantity, low_stock_threshold, is_active
                ) VALUES (
                    :id, :pid, :sku, '{}'::jsonb,
                    0, :rp, NULL, :cur,
                    :stock, 5, true
                )
                """
            ),
            {
                "id": uuid4(),
                "pid": pid,
                "sku": variant_sku,
                "rp": Decimal(str(draft.price)),
                "cur": currency,
                "stock": max(0, int(stock)),
            },
        )
        offer_created = True

    images_added = 0
    for i, url in enumerate(draft.images[:_MAX_IMAGES]):
        if not url.startswith(("http://", "https://")):
            continue
        await db.execute(
            text(
                """
                INSERT INTO product_media (
                    id, product_id, url, kind, position, is_primary,
                    status, source, alt_text
                ) VALUES (
                    :id, :pid, :url, 'image', :pos, :primary,
                    'STORED', 'SCRAPED', :alt
                )
                """
            ),
            {
                "id": uuid4(),
                "pid": pid,
                "url": url,
                "pos": i,
                "primary": i == 0,
                "alt": name,
            },
        )
        images_added += 1

    await db.commit()
    return {
        "product_id": str(pid),
        "slug": slug,
        "sku": sku,
        "name": name,
        "status": status_value,
        "published": publish,
        "offer_created": offer_created,
        "images_added": images_added,
    }
