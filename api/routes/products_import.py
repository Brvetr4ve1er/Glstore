"""
CSV import endpoints — Phase 1.

POST /products/import/preview   multipart file   → diagnostic + sample, no writes.
POST /products/import/commit    multipart file   → upserts everything, returns report.

Both use the universal CSV parser. Commit is idempotent on SKU.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.core.store_context import Store, require_admin_store_for
from api.services import csv_import, csv_parser, enrichment_runner

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


@router.post("/preview")
async def preview(
    file: UploadFile = File(..., description="CSV file (any delimiter / encoding)"),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
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
    report = await csv_import.preview_import(db, rows, store.id, sample_size=20)
    return {"diagnostic": diag.to_dict(), "report": report.to_dict()}


@router.post("/commit")
async def commit(
    file: UploadFile = File(...),
    auto_enrich: bool = Form(default=True, description="Run rule-based enrichment on imported rows"),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    text = await _read_csv(file)
    rows, diag = csv_parser.parse(text)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no rows extracted from CSV")

    report = await csv_import.commit_import(db, rows, store.id)
    await db.commit()

    enrichment_payload: dict[str, Any] | None = None
    if auto_enrich and (report.products_created + report.products_updated) > 0:
        enr = await enrichment_runner.enrich_many(
            db, only_status=("RAW", "NORMALIZED", "NEEDS_FIX"), limit=20000, store_id=store.id,
        )
        await db.commit()
        enrichment_payload = enr.to_dict()

    return {
        "diagnostic": diag.to_dict(),
        "report": report.to_dict(),
        "enrichment": enrichment_payload,
    }
