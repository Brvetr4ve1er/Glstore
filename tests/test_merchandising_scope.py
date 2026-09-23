"""Static guards on the merchandising layer's brand boundary (migration 008).

WHY THESE ARE SOURCE-LEVEL TESTS RATHER THAN BEHAVIOURAL ONES

Four `store_id` bugs have shipped in this codebase past a fully green suite.
Every one was the same shape: a code path wrote or read a store-scoped table
without the store. None was catchable without a live Postgres, because the
mistake lives in SQL text, and `tests/` has no database.

So these assert on the SQL and the dependency wiring directly. They cannot
prove the queries return the right rows — only Postgres can do that, and
migration 008 has never been applied anywhere. What they CAN prove is that
nobody has written a `reviews` query that forgets the store, which is the
failure that actually happened, repeatedly.

`tests/test_migrations.py` already establishes source-reading as a pattern here.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
REVIEWS = REPO / "api" / "routes" / "reviews.py"
NEWSLETTER = REPO / "api" / "routes" / "newsletter.py"
PRODUCTS = REPO / "api" / "routes" / "products.py"
MIGRATION = REPO / "db" / "migrations" / "008_merchandising.sql"
CONTACT = REPO / "api" / "routes" / "contact.py"
MIGRATION_009 = REPO / "db" / "migrations" / "009_contact_messages.sql"


def _sql_literals(path: Path) -> list[str]:
    """Every string constant in the module that looks like SQL touching reviews."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = " ".join(node.value.split())
            if re.search(r"\b(FROM|INTO|UPDATE)\s+reviews\b", v, re.I):
                out.append(v)
    return out


# ── Migration ─────────────────────────────────────────────────────────────

def test_migration_008_exists():
    assert MIGRATION.is_file(), "migration 008 is missing"


def test_reviews_are_pinned_to_their_product_store_by_the_schema():
    """The composite FK is what makes a cross-brand review impossible.

    `store_id NOT NULL` only stops a NULL. It does not stop a review carrying
    brand B's store_id against brand A's product. The composite foreign key
    does, for every code path, including ones written later.
    """
    sql = " ".join(MIGRATION.read_text(encoding="utf-8").split())
    assert re.search(
        r"FOREIGN KEY\s*\(\s*store_id\s*,\s*product_id\s*\)\s*REFERENCES\s+products\s*\(\s*store_id\s*,\s*id\s*\)",
        sql, re.I,
    ), "reviews must declare FOREIGN KEY (store_id, product_id) -> products (store_id, id)"


def test_the_composite_fk_has_a_target_to_point_at():
    """A composite FK needs a matching UNIQUE on the parent or the migration fails."""
    sql = " ".join(MIGRATION.read_text(encoding="utf-8").split())
    assert re.search(r"UNIQUE\s*\(\s*store_id\s*,\s*id\s*\)", sql, re.I), \
        "products needs UNIQUE (store_id, id) for the reviews FK to reference"


def test_badge_column_is_nullable_with_no_default():
    """A default would silently badge all 29 existing catalog rows.

    Migration 008 is the first migration the seeded catalog passes through:
    14 archived fixtures plus 15 demo products. `NOT NULL DEFAULT 'NEW'` would
    mark every one of them, including the archived ones.
    """
    sql = " ".join(MIGRATION.read_text(encoding="utf-8").split())
    m = re.search(r"ADD COLUMN IF NOT EXISTS badge\s+product_badge_enum([^;]*)", sql, re.I)
    assert m, "badge column not found"
    tail = m.group(1).upper()
    assert "DEFAULT" not in tail, "badge must not have a DEFAULT"
    assert "NOT NULL" not in tail, "badge must be nullable"


def test_newsletter_is_unique_per_store_not_globally():
    """A global unique on email would let one brand probe another's list."""
    sql = " ".join(MIGRATION.read_text(encoding="utf-8").split())
    assert re.search(r"UNIQUE\s*\(\s*store_id\s*,\s*email\s*\)", sql, re.I), \
        "newsletter_subscribers must be UNIQUE (store_id, email)"


# ── Route SQL ─────────────────────────────────────────────────────────────

def test_every_reviews_query_filters_by_store():
    """The bug that shipped four times, caught statically."""
    stmts = _sql_literals(REVIEWS)
    assert stmts, "no reviews SQL found — did the file move?"
    for sql in stmts:
        assert re.search(r"store_id\s*=\s*:", sql, re.I) or "store_id," in sql.lower(), \
            f"reviews SQL without a store_id filter:\n  {sql[:160]}"


def test_review_aggregates_on_products_pin_the_store():
    """`product_id` alone is correct today and silently wrong later.

    The avg_rating/review_count subqueries must join the store explicitly, not
    assume a product id is globally unique.
    """
    src = " ".join(PRODUCTS.read_text(encoding="utf-8").split())
    agg = re.findall(r"FROM reviews r\s+WHERE[^)]+\)", src, re.I)
    assert len(agg) >= 4, f"expected the 4 review subqueries (list + detail), found {len(agg)}"
    for a in agg:
        assert re.search(r"r\.store_id\s*=\s*\w+\.store_id", a, re.I), \
            f"review aggregate not pinned to the store:\n  {a[:160]}"
        assert "APPROVED" in a.upper(), f"aggregate counts unmoderated reviews:\n  {a[:160]}"


# ── Dependency wiring ─────────────────────────────────────────────────────

def _dep_names(path: Path, func: str) -> set[str]:
    """Names of the dependencies a route function declares."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == func:
            found = set()
            for d in node.args.defaults + node.args.kw_defaults:
                for sub in ast.walk(d) if d else []:
                    if isinstance(sub, ast.Name):
                        found.add(sub.id)
                    elif isinstance(sub, ast.Attribute):
                        found.add(sub.attr)
            return found
    raise AssertionError(f"{func} not found in {path.name}")


@pytest.mark.parametrize("func", ["submit_review", "list_reviews"])
def test_public_review_routes_resolve_the_store_from_the_host(func):
    """A shopper's browser never sends x-store-id. Host is the only signal."""
    deps = _dep_names(REVIEWS, func)
    assert "require_store" in deps, f"{func} must use require_store"
    assert "require_admin_store_for" not in deps, \
        f"{func} is public and must not take an admin store header"


@pytest.mark.parametrize("func", ["moderation_queue", "moderate_review"])
def test_admin_review_routes_resolve_the_store_from_the_authenticated_header(func):
    deps = _dep_names(REVIEWS, func)
    assert "require_admin_store_for" in deps, f"{func} must use require_admin_store_for"
    assert "require_store" not in deps, \
        f"{func} is admin and must not resolve by client-controlled Host"


def test_newsletter_is_public_and_host_scoped():
    deps = _dep_names(NEWSLETTER, "subscribe")
    assert "require_store" in deps


def test_submit_review_checks_the_product_belongs_to_the_store():
    """Without this, brand A's domain can review brand B's product by id.

    The composite FK would reject the insert anyway, but as an integrity error,
    not a clean 404 — and a 403/500 would leak that the product exists.
    """
    tree = ast.parse(REVIEWS.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "submit_review":
            called = {
                n.func.id for n in ast.walk(node)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            }
            assert "_assert_product_in_store" in called, \
                "submit_review must assert the product is in the acting store"
            return
    raise AssertionError("submit_review not found")


# ── Migration 009 (contact_messages) — same class of bug, same guards ──────

def test_migration_009_exists():
    assert MIGRATION_009.is_file(), "migration 009 is missing"


def test_contact_messages_store_id_is_not_nullable():
    """`store_id NOT NULL` is the column-level half of the guard.

    It does not by itself stop a message being inserted for the wrong store —
    that is what require_store resolving from Host, tested below, is for. This
    only proves the column can never be silently NULL, which is the exact shape
    of three of the four store_id bugs this codebase has already shipped.
    """
    sql = " ".join(MIGRATION_009.read_text(encoding="utf-8").split())
    assert re.search(
        r"store_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+stores",
        sql, re.I,
    ), "contact_messages.store_id must be NOT NULL REFERENCES stores"


def test_contact_message_text_fields_are_capped():
    """Unbounded text from an anonymous public endpoint is an abuse surface
    regardless of what ever renders it."""
    sql = " ".join(MIGRATION_009.read_text(encoding="utf-8").split())
    assert re.search(r"message\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*length\(message\)", sql, re.I), (
        "contact_messages.message must have a length CHECK"
    )
    assert re.search(r"name\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*length\(name\)", sql, re.I), (
        "contact_messages.name must have a length CHECK"
    )


def _sql_literals_for(path: Path, table: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = " ".join(node.value.split())
            if re.search(rf"\b(FROM|INTO|UPDATE)\s+{table}\b", v, re.I):
                out.append(v)
    return out


def test_every_contact_messages_query_filters_by_store():
    """The bug that has now shipped in this codebase six times, caught statically."""
    stmts = _sql_literals_for(CONTACT, "contact_messages")
    assert stmts, "no contact_messages SQL found — did the file move?"
    for sql in stmts:
        ok = re.search(r"store_id\s*=\s*:", sql, re.I) or "store_id," in sql.lower()
        assert ok, f"contact_messages SQL without a store_id filter:\n  {sql[:160]}"


def test_contact_submit_is_public_and_host_scoped():
    deps = _dep_names(CONTACT, "submit_contact_message")
    assert "require_store" in deps, "POST /contact must use require_store"
    assert "require_admin_store_for" not in deps, (
        "POST /contact is public and must not require an admin store header"
    )


@pytest.mark.parametrize("func", ["contact_inbox", "moderate_contact_message"])
def test_contact_admin_routes_resolve_the_store_from_the_authenticated_header(func):
    deps = _dep_names(CONTACT, func)
    assert "require_admin_store_for" in deps, f"{func} must use require_admin_store_for"
    assert "require_store" not in deps, (
        f"{func} is admin and must not resolve by client-controlled Host"
    )


# ── GET /products?badge= — validated against the enum, not just cast ───────

def test_products_badge_filter_is_validated_against_the_enum():
    """An invalid `badge=` value must 422, not fall through to a raw SQL cast
    that would surface as a 500 and incidentally confirm the column is an enum."""
    src = " ".join(PRODUCTS.read_text(encoding="utf-8").split())
    assert re.search(
        r'badge:\s*Literal\[\s*"NEW",\s*"BEST_SELLER",\s*"PRO",\s*"SALE"\s*\]\s*\|\s*None',
        src,
    ), "badge query param must be typed as the Literal enum, not a bare str"


def test_products_search_matches_barcode_exactly_not_fuzzily():
    """A scanned barcode is the complete string — ILIKE substring-matching it
    is both semantically wrong and, at scale, an unindexed scan for nothing."""
    src = " ".join(PRODUCTS.read_text(encoding="utf-8").split())
    assert "p.barcode = :q_exact" in src, (
        "barcode must be matched with exact equality, not ILIKE"
    )

