"""Migration 012 attaches three reviewed product cards. These keep the SQL and
the committed files honest with each other, and keep the rejected or
still-under-review renders out."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "db" / "migrations" / "012_pilot_product_media.sql"
PUBLIC = REPO / "storefront" / "public"

_ROW = re.compile(
    r"\('(?P<sku>[^']+)',\s*'(?P<url>/media/products/[^']+)',\s*'[^']+',\s*(?P<bytes>\d+),\s*'(?P<sha>[0-9a-f]{64})'\)"
)


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _rows():
    rows = [m.groupdict() for m in _ROW.finditer(_sql())]
    assert rows, "no media rows found in migration 012"
    return rows


def test_exactly_the_three_qa_passed_skus_are_attached():
    assert {r["sku"] for r in _rows()} == {"GX332810", "GN-SFP502M-G", "AMB-021CM"}


@pytest.mark.parametrize("sku", ["SF-8044", "BL3001", "GK-CZ86DV-N"])
def test_renders_not_approved_for_the_site_stay_out(sku):
    values = _sql().split("FROM (VALUES", 1)[1]
    assert f"'{sku}'" not in values


@pytest.mark.parametrize("row", _rows(), ids=lambda r: r["sku"])
def test_every_referenced_file_ships_and_matches_its_recorded_checksum(row):
    path = PUBLIC / row["url"].lstrip("/")
    assert path.is_file(), f"{row['url']} is not in storefront/public"
    data = path.read_bytes()
    assert len(data) == int(row["bytes"]), "recorded size is stale — re-export without updating 012?"
    assert hashlib.sha256(data).hexdigest() == row["sha"], "recorded checksum is stale"


def test_media_rows_take_their_store_from_the_product():
    sql = " ".join(_sql().split())
    assert "SELECT p.store_id, p.id," in sql
    assert "JOIN products p ON p.sku = v.sku" in sql


def test_the_migration_marks_them_generated_and_never_inserts_twice():
    sql = " ".join(_sql().split())
    assert "'GENERATED'::media_source_enum" in sql
    assert "AND pm.url = v.url" in sql
