#!/usr/bin/env python3
"""
One-shot initializer for a fresh remote Postgres (e.g. Neon) — the serverless
equivalent of what Docker's initdb + the app's startup migration runner do.

It applies, IN THE SAME ORDER Docker uses (this order is load-bearing):

    1. db/schema.sql            base single-tenant schema + seed data tables
    2. db/seed_admin.sql        the platform admin login
    3. db/seed_gaming.sql       14 GLAIVE products + offers, archived on load
    4. db/migrations/*.sql      000 → 006, in filename order
                                (005 backfills the seeded rows into the
                                 'default' store, THEN sets store_id NOT NULL —
                                 which is exactly why seeds must run first)

Each migration is recorded in the `_migrations` table with its SHA-256, using
the same format the app's runner uses — so if you ever move to a persistent
host with RUN_STARTUP_MIGRATIONS=true, nothing re-applies.

Requirements:
    pip install asyncpg

Usage:
    python scripts/deploy/init_remote_db.py "postgresql://USER:PASS@HOST/db"
    # or set DATABASE_URL and run with no arg
    # optional branding of the single store (slug stays 'default' so the
    # single-store fallback keeps working):
    python scripts/deploy/init_remote_db.py "<url>" --brand "GLAIVE" --prefix GLV

Use Neon's DIRECT (non-pooler) connection string for this one-off DDL run.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import sys
from pathlib import Path

try:
    import asyncpg
except ImportError:
    sys.exit("asyncpg is required — run:  pip install asyncpg")

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = REPO_ROOT / "db"
MIGRATIONS_DIR = DB_DIR / "migrations"


def _normalize_dsn(raw: str) -> str:
    """asyncpg wants a plain libpq DSN. Strip SQLAlchemy's '+asyncpg' driver
    tag and any query string (we set TLS explicitly via ssl=True)."""
    dsn = raw.strip()
    dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")
    dsn = dsn.replace("postgres+asyncpg://", "postgresql://")
    # Drop query params (sslmode/channel_binding/etc.) — asyncpg gets ssl=True.
    if "?" in dsn:
        dsn = dsn.split("?", 1)[0]
    return dsn


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _run_sql_file(conn: "asyncpg.Connection", path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    # asyncpg executes multi-statement scripts (incl. DO blocks + dollar-quoted
    # functions) when called with no bind args (simple query protocol).
    await conn.execute(sql)


async def main() -> int:
    ap = argparse.ArgumentParser(description="Initialize a fresh remote Postgres for GLstore.")
    ap.add_argument("dsn", nargs="?", default=os.environ.get("DATABASE_URL", ""),
                    help="Postgres connection string (or set DATABASE_URL).")
    ap.add_argument("--brand", default=None, help="Rename the single store (e.g. GLAIVE).")
    ap.add_argument("--prefix", default=None, help="Order-number prefix (e.g. GLV).")
    ap.add_argument("--force", action="store_true",
                    help="Proceed even if the DB already has a products table.")
    args = ap.parse_args()

    if not args.dsn:
        return _fail("No connection string. Pass it as an argument or set DATABASE_URL.")

    dsn = _normalize_dsn(args.dsn)
    print(f"→ connecting (TLS) …")
    try:
        conn = await asyncpg.connect(dsn, ssl=True, timeout=30)
    except Exception as e:  # noqa: BLE001
        return _fail(f"could not connect: {type(e).__name__}: {e}")

    try:
        # Guard: refuse to clobber a DB that already looks initialized.
        exists = await conn.fetchval("SELECT to_regclass('public.products')")
        if exists is not None and not args.force:
            return _fail(
                "this database already has a 'products' table — it looks "
                "initialized.\n   Use a fresh Neon project/branch, or pass "
                "--force to run anyway (may error on non-idempotent DDL)."
            )

        # 1) base schema + seeds (order matters — see module docstring)
        for name in ("schema.sql", "seed_admin.sql", "seed_gaming.sql"):
            p = DB_DIR / name
            print(f"→ applying {p.relative_to(REPO_ROOT)} …")
            await _run_sql_file(conn, p)

        # 2) migrations 000 → 006, recording each in _migrations (000 creates
        #    that tracking table, so it must run before we record anything).
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        if not migration_files:
            return _fail(f"no migration files found in {MIGRATIONS_DIR}")
        for p in migration_files:
            raw = p.read_bytes()
            print(f"→ applying migration {p.name} …")
            await conn.execute(raw.decode("utf-8"))
            await conn.execute(
                """
                INSERT INTO _migrations (filename, checksum, duration_ms, applied_at)
                     VALUES ($1, $2, 0, NOW())
                ON CONFLICT (filename) DO NOTHING
                """,
                p.name, _sha256_hex(raw),
            )

        # 3) optional branding of the single store. Keep slug='default' so the
        #    SINGLE_STORE_MODE fallback (resolve_default_store) keeps resolving.
        if args.brand or args.prefix:
            sets, vals, i = [], [], 1
            if args.brand:
                sets.append(f"name = ${i}"); vals.append(args.brand); i += 1
            if args.prefix:
                sets.append(f"order_prefix = ${i}"); vals.append(args.prefix.upper()); i += 1
            await conn.execute(
                f"UPDATE stores SET {', '.join(sets)}, updated_at = NOW() WHERE slug = 'default'",
                *vals,
            )
            print(f"→ branded the single store (slug stays 'default').")

        # 4) verify + report
        n_products = await conn.fetchval("SELECT COUNT(*) FROM products")
        # Seeded products are archived placeholders (see db/seed_gaming.sql),
        # so a bare total would imply a storefront that has stock. Report what
        # a customer would actually see.
        n_active   = await conn.fetchval(
            "SELECT COUNT(*) FROM products WHERE status = 'ACTIVE'")
        n_offers   = await conn.fetchval("SELECT COUNT(*) FROM offers")
        n_admins   = await conn.fetchval("SELECT COUNT(*) FROM admin_users")
        store      = await conn.fetchrow(
            "SELECT slug, name, order_prefix, currency FROM stores WHERE slug='default'")
        applied    = await conn.fetch("SELECT filename FROM _migrations ORDER BY filename")

        print("\n✅ Database initialized.")
        print(f"   store:      {store['name']} (slug={store['slug']}, "
              f"prefix={store['order_prefix']}, currency={store['currency']})")
        print(f"   products:   {n_products}  ({n_active} live on the storefront)")
        print(f"   offers:     {n_offers}")
        print(f"   admins:     {n_admins}")
        print(f"   migrations: {', '.join(r['filename'] for r in applied)}")
        print("\nNext: set the Vercel env vars (see DEPLOY.md) and deploy.")
        return 0
    finally:
        await conn.close()


def _fail(msg: str) -> int:
    print(f"✗ {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
