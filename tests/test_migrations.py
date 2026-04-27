"""Tests for the migration runner (Phase 9 Push 5).

These tests exercise the *pure* parts of api/core/migrations.py — discovery,
ordering, checksum derivation, the bootstrap-first invariant — without a
live Postgres. The live-DB path (advisory lock, apply-in-transaction, the
tracking table itself) is exercised in integration tests against a docker
compose stack — a future Push.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from api.core.migrations import (
    Migration, _BOOTSTRAP_FILENAME, discover_migrations,
)


# ── Discovery ──────────────────────────────────────────────────────────────

def _write(p: Path, content: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def test_discovery_returns_empty_list_when_dir_missing(tmp_path: Path):
    missing = tmp_path / "nope"
    assert discover_migrations(missing) == []


def test_discovery_returns_empty_list_when_dir_empty(tmp_path: Path):
    (tmp_path / "migrations").mkdir()
    assert discover_migrations(tmp_path / "migrations") == []


def test_discovery_orders_by_filename_lexicographically(tmp_path: Path):
    """Zero-padded numeric prefixes mean lexical sort == numeric sort."""
    d = tmp_path / "migrations"
    d.mkdir()
    _write(d / "002_b.sql", "-- second")
    _write(d / "010_d.sql", "-- fourth")
    _write(d / "001_a.sql", "-- first")
    _write(d / "003_c.sql", "-- third")
    out = discover_migrations(d)
    assert [m.filename for m in out] == [
        "001_a.sql", "002_b.sql", "003_c.sql", "010_d.sql",
    ]


def test_discovery_only_picks_sql_files(tmp_path: Path):
    d = tmp_path / "migrations"
    d.mkdir()
    _write(d / "001_real.sql",        "-- yes")
    _write(d / "002_skip_me.txt",     "no — wrong extension")
    _write(d / "003_skip_me.sql.bak", "no — wrong extension")
    _write(d / "README.md",           "documentation")
    names = [m.filename for m in discover_migrations(d)]
    assert names == ["001_real.sql"]


def test_discovery_reads_sql_content_into_each_migration(tmp_path: Path):
    d = tmp_path / "migrations"
    d.mkdir()
    sql = "CREATE TABLE x (id INT);"
    _write(d / "001_x.sql", sql)
    out = discover_migrations(d)
    assert out[0].sql == sql


# ── Checksum ───────────────────────────────────────────────────────────────

def test_checksum_is_sha256_of_file_bytes(tmp_path: Path):
    d = tmp_path / "migrations"
    d.mkdir()
    sql = "SELECT 1;"
    _write(d / "001_one.sql", sql)
    expected = hashlib.sha256(sql.encode("utf-8")).hexdigest()
    out = discover_migrations(d)
    assert out[0].checksum == expected


def test_checksum_changes_when_a_byte_changes(tmp_path: Path):
    d = tmp_path / "migrations"
    d.mkdir()
    p = _write(d / "001.sql", "SELECT 1;")
    cs1 = discover_migrations(d)[0].checksum
    p.write_text("SELECT 2;", encoding="utf-8")
    cs2 = discover_migrations(d)[0].checksum
    assert cs1 != cs2


def test_checksum_is_byte_stable_across_runs(tmp_path: Path):
    """Two discoveries of the same file produce the same hash. Important
    because tampering detection compares stored vs. live."""
    d = tmp_path / "migrations"
    d.mkdir()
    _write(d / "001.sql", "SELECT 1;\n-- a comment\n")
    a = discover_migrations(d)[0].checksum
    b = discover_migrations(d)[0].checksum
    assert a == b


def test_checksum_is_unicode_safe(tmp_path: Path):
    """Migrations occasionally contain non-ASCII (Algerian wilaya names,
    French inline comments). The hash mustn't blow up."""
    d = tmp_path / "migrations"
    d.mkdir()
    sql = "-- État, accentué, ضواحي\nCREATE TABLE wilaya (nom TEXT);"
    _write(d / "001_unicode.sql", sql)
    out = discover_migrations(d)
    assert len(out[0].checksum) == 64
    # Hex chars only
    int(out[0].checksum, 16)


# ── Bootstrap invariant ────────────────────────────────────────────────────

def test_bootstrap_filename_sorts_to_the_front(tmp_path: Path):
    """000_migrations_table.sql must come before 001_… so the runner
    creates the tracking table before checking it. This is enforced by
    naming convention; the test guards against someone renaming the
    bootstrap to a higher prefix."""
    d = tmp_path / "migrations"
    d.mkdir()
    _write(d / "001_first.sql",                        "-- ")
    _write(d / "999_last.sql",                         "-- ")
    _write(d / _BOOTSTRAP_FILENAME,                    "-- bootstrap")
    out = discover_migrations(d)
    assert out[0].filename == _BOOTSTRAP_FILENAME


# ── Real-repo migrations sanity ───────────────────────────────────────────

def test_repo_migrations_all_have_zero_padded_3digit_prefix():
    repo_root = Path(__file__).resolve().parents[1]
    migrations = discover_migrations(repo_root / "db" / "migrations")
    assert migrations, "expected at least the bootstrap migration"
    for m in migrations:
        assert m.filename[:3].isdigit(), (
            f"{m.filename}: must start with 3-digit zero-padded prefix so "
            f"lexical sort == numeric sort"
        )
        assert m.filename.endswith(".sql")


def test_repo_migrations_include_bootstrap():
    repo_root = Path(__file__).resolve().parents[1]
    migrations = discover_migrations(repo_root / "db" / "migrations")
    assert any(m.filename == _BOOTSTRAP_FILENAME for m in migrations), (
        f"expected {_BOOTSTRAP_FILENAME} as the bootstrap migration"
    )


def test_repo_migrations_have_unique_prefixes():
    repo_root = Path(__file__).resolve().parents[1]
    migrations = discover_migrations(repo_root / "db" / "migrations")
    prefixes = [m.filename.split("_", 1)[0] for m in migrations]
    duplicates = {p for p in prefixes if prefixes.count(p) > 1}
    assert not duplicates, (
        f"duplicate migration numeric prefixes: {sorted(duplicates)}. "
        f"Two migrations with the same number means apply order is ambiguous."
    )


# ── Migration dataclass ────────────────────────────────────────────────────

def test_migration_dataclass_is_frozen():
    """Migrations must be hashable + immutable so we can put them in a
    set / use them as dict keys without weird semantics."""
    m = Migration(filename="001.sql", path=Path("/tmp/x"), checksum="abc", sql="-- ")
    with pytest.raises((AttributeError, Exception)):
        m.filename = "002.sql"   # type: ignore[misc]
