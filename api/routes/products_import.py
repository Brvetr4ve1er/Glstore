"""
CSV import endpoints — Phase 1.

POST /products/import/preview   multipart file   → diagnostic + sample, no writes.
POST /products/import/commit    multipart file   → upserts everything, returns report.

Both use the universal CSV parser. Commit is idempotent on SKU.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.services import csv_import, csv_parser, enrichment_runner, url_import

router = APIRouter(prefix="/products/import", tags=["products-import"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")

MAX_BYTES = 16 * 1024 * 1024   # 16 MiB upload cap


def _decode(raw: bytes) -> str:
    """Tolerant decoding — try UTF-8 first, fall back to cp1252 (common Excel-saved-CSV)."""
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # Last-ditch: replace bad bytes
    return raw.decode("utf-8", errors="replace")


async def _read_csv(file: UploadFile) -> str:
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"file too large (>{MAX_BYTES // (1024 * 1024)} MiB)",
        )
    return _decode(raw)


@router.post("/preview", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def preview(
    file: UploadFile = File(..., description="CSV file (any delimiter / encoding)"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    text = await _read_csv(file)
    rows, diag = csv_parser.parse(text)
    if not rows:
        return {
            "diagnostic": diag.to_dict(),
            "report": {
                "parsed_rows": 0, "valid_rows": 0, "blocked_rows": 0,
                "products_to_create": 0, "products_to_update": 0,
                "offers_to_create": 0, "offers_to_update": 0,
                "issues": [], "sample_preview": [],
            },
        }
    report = await csv_import.preview_import(db, rows, sample_size=20)
    return {"diagnostic": diag.to_dict(), "report": report.to_dict()}


@router.post("/commit", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def commit(
    file: UploadFile = File(...),
    auto_enrich: bool = Form(default=True, description="Run rule-based enrichment on imported rows"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    text = await _read_csv(file)
    rows, diag = csv_parser.parse(text)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no rows extracted from CSV")

    report = await csv_import.commit_import(db, rows)
    await db.commit()

    enrichment_payload: dict[str, Any] | None = None
    if auto_enrich and (report.products_created + report.products_updated) > 0:
        enr = await enrichment_runner.enrich_many(
            db, only_status=("RAW", "NORMALIZED", "NEEDS_FIX"), limit=20000,
        )
        await db.commit()
        enrichment_payload = enr.to_dict()

    return {
        "diagnostic": diag.to_dict(),
        "report": report.to_dict(),
        "enrichment": enrichment_payload,
    }


# ════════════════════════════════════════════════════════════════════════════
# URL import — paste a product link, scrape its data, add it to the store.
# ════════════════════════════════════════════════════════════════════════════

class UrlPreviewIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class UrlCommitIn(BaseModel):
    """The (possibly edited) draft the admin reviewed, plus publish options."""
    source_url: str = Field(min_length=8, max_length=2048)
    name: str | None = None
    brand: str | None = None
    sku: str | None = None
    category: str | None = None
    description: str | None = None
    specs: dict[str, Any] = Field(default_factory=dict)
    images: list[str] = Field(default_factory=list)
    price: float | None = Field(default=None, ge=0)
    currency: str = "DZD"
    availability: str = "unknown"
    publish: bool = True
    default_stock: int = Field(default=0, ge=0, le=1_000_000)


@router.post("/url/preview", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def url_preview(
    body: UrlPreviewIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        draft = await url_import.scrape_url(db, body.url.strip())
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    return {"draft": draft.to_dict()}


@router.post("/url/commit", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def url_commit(
    body: UrlCommitIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    draft = url_import.ProductDraft(
        source_url=body.source_url.strip(),
        name=body.name,
        brand=body.brand,
        sku=(body.sku or "").strip(),
        category=body.category,
        description=body.description,
        specs=body.specs,
        images=body.images,
        price=body.price,
        currency=body.currency,
        availability=body.availability,
    )
    result = await url_import.commit_draft(
        db, draft, publish=body.publish, default_stock=body.default_stock,
    )
    return result
