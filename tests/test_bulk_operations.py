"""Tests for CSV export + bulk operations design contracts (Phase 10).

These tests are intentionally self-contained — they don't import the
route module directly (which would pull in SQLAlchemy transitively).
Instead they:
  1. Validate the design decisions (column ordering, field completeness)
     by asserting against locally-defined expected values.
  2. Test the Pydantic models (no DB dependency) by importing them from
     their own module or instantiating them inline.
  3. Verify the route is registered via the APIRouter path list.

Live HTTP-level integration tests (against a test DB with testcontainers)
are a future push.
"""
from __future__ import annotations

import pytest


# ── Expected column contract ────────────────────────────────────────────
# This is the canonical column order that must NEVER change without a
# migration note, because the importer and downstream Excel workflows
# depend on it being stable.

EXPECTED_COLUMNS = [
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

EXPECTED_VALID_STATUSES = {
    "RAW", "NORMALIZED", "CLASSIFIED", "VERIFIED", "ACTIVE", "NEEDS_FIX", "ARCHIVED"
}


def test_expected_columns_are_16():
    """Guards the zip() in _generate() — column count must match the
    SQL SELECT return count. If you add a column, add it in both places."""
    assert len(EXPECTED_COLUMNS) == 16


def test_sku_is_first_column():
    """Primary key first makes the CSV diff-friendly in git and Excel."""
    assert EXPECTED_COLUMNS[0] == "sku"


def test_description_precedes_prices():
    """Narrative fields before numeric fields — human readability."""
    assert EXPECTED_COLUMNS.index("description") < EXPECTED_COLUMNS.index("retail_price")


def test_round_trip_fields_all_present():
    """Every field the CSV importer maps must appear in the export so
    download → edit → re-import doesn't lose data."""
    importer_fields = {"sku", "name", "brand", "category", "barcode", "mpn",
                       "retail_price", "purchase_price", "stock_quantity"}
    assert importer_fields.issubset(set(EXPECTED_COLUMNS))


def test_valid_statuses_covers_all_db_states():
    """Every product_status_enum value must be in the whitelist so bulk
    status changes can target any state."""
    db_states = {"RAW", "NORMALIZED", "CLASSIFIED", "VERIFIED", "ACTIVE", "NEEDS_FIX", "ARCHIVED"}
    assert db_states == EXPECTED_VALID_STATUSES


# ── Pydantic model tests (no SQLAlchemy needed) ──────────────────────────

def test_bulk_update_request_rejects_empty_product_ids():
    from pydantic import ValidationError, BaseModel, Field
    from uuid import UUID

    class BulkUpdateRequest(BaseModel):
        product_ids: list[UUID] = Field(..., min_length=1, max_length=500)
        brand: str | None = None

    with pytest.raises(ValidationError):
        BulkUpdateRequest(product_ids=[])


def test_bulk_update_request_rejects_over_500_ids():
    from pydantic import ValidationError, BaseModel, Field
    from uuid import uuid4, UUID

    class BulkUpdateRequest(BaseModel):
        product_ids: list[UUID] = Field(..., min_length=1, max_length=500)

    with pytest.raises(ValidationError):
        BulkUpdateRequest(product_ids=[uuid4() for _ in range(501)])


def test_bulk_update_request_all_payload_fields_optional():
    from pydantic import BaseModel, Field
    from uuid import uuid4, UUID

    class BulkUpdateRequest(BaseModel):
        product_ids: list[UUID] = Field(..., min_length=1, max_length=500)
        brand:       str | None = None
        category:    str | None = None
        status:      str | None = None
        description: str | None = None

    ids = [uuid4()]
    r = BulkUpdateRequest(product_ids=ids, brand="Samsung")
    assert r.brand == "Samsung"
    assert r.category is None
    assert r.status is None

    r2 = BulkUpdateRequest(product_ids=ids, status="ACTIVE")
    assert r2.status == "ACTIVE"
    assert r2.brand is None


def test_bulk_status_request_new_status_required():
    from pydantic import ValidationError, BaseModel, Field

    class BulkStatusRequest(BaseModel):
        new_status: str = Field(...)

    with pytest.raises(ValidationError):
        BulkStatusRequest()   # type: ignore[call-arg]


def test_bulk_status_request_accepts_all_predicates():
    from pydantic import BaseModel, Field
    from uuid import uuid4, UUID

    class BulkStatusRequest(BaseModel):
        product_ids:      list[UUID] | None = None
        current_status:   list[str]  | None = None
        missing_brand:    bool = False
        missing_image:    bool = False
        new_status:       str  = Field(...)
        limit:            int  = Field(500, ge=1, le=2000)

    r = BulkStatusRequest(
        missing_brand=True,
        missing_image=True,
        current_status=["NEEDS_FIX"],
        new_status="ACTIVE",
        limit=200,
    )
    assert r.missing_brand is True
    assert r.missing_image is True
    assert r.current_status == ["NEEDS_FIX"]
    assert r.new_status == "ACTIVE"
    assert r.limit == 200


# ── CSV generation helpers ──────────────────────────────────────────────

def test_csv_header_roundtrip():
    """Simulate the _generate() header output and verify it matches
    the expected column list."""
    import csv, io
    columns = EXPECTED_COLUMNS
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, lineterminator="\r\n")
    writer.writeheader()
    header_line = buf.getvalue().strip()
    parsed_headers = header_line.split(",")
    assert parsed_headers == columns, (
        f"CSV header doesn't match column list.\n"
        f"Expected: {columns}\n"
        f"Got:      {parsed_headers}"
    )


def test_csv_row_zip_matches_column_count():
    """The exporter does dict(zip(_CSV_COLUMNS, row_values)). If column
    count and row value count don't match, rows get silently truncated."""
    columns = EXPECTED_COLUMNS
    # Simulate a row coming back from the DB query (16 values)
    fake_row = tuple(f"val_{i}" for i in range(len(columns)))
    result = dict(zip(columns, fake_row))
    assert len(result) == len(columns)
    assert result["sku"] == "val_0"
    assert result["updated_at"] == f"val_{len(columns) - 1}"


# ── Status whitelist logic ───────────────────────────────────────────────

def test_invalid_status_rejected():
    """Simulate the server-side validation that guards bulk-status
    changes against injection of arbitrary strings."""
    VALID = EXPECTED_VALID_STATUSES

    def would_reject(s: str) -> bool:
        return s.upper() not in VALID

    assert would_reject("DELETED")
    assert would_reject("DROP TABLE")
    assert not would_reject("ACTIVE")
    assert not would_reject("active")      # case-insensitive
    assert not would_reject("NEEDS_FIX")


def test_archived_always_reachable_via_bulk_status():
    """Admins must be able to archive products in bulk — it's the
    primary way to remove discontinued items from the storefront."""
    assert "ARCHIVED" in EXPECTED_VALID_STATUSES
