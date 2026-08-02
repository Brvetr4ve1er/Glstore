#!/usr/bin/env python3
"""
Add a NEW BRAND to the platform — one `stores` row plus its hostnames.

This platform hosts several brands owned by the same person (GLAIVE gaming
gear, a home-appliance brand, …). Each brand is one row in `stores`: its own
slug, name, order-number prefix, currency, theme, and its own hostnames in
`store_domains`. Catalog, customers and orders are isolated per store by
migration 005 — creating the row here is all it takes for a second brand to
exist. This is multi-brand, NOT a marketplace: there are no vendors, no
commissions, no payouts.

*** POINT THIS AT THE RIGHT DATABASE. It writes to whatever DSN you give it
*** (or to $DATABASE_URL if you give it none). Adding a brand to production
*** by accident is not destructive, but a wrong --domain silently steals a
*** hostname's routing from another brand, so read the FAIL lines.

There is no POST /stores in the API — the admin console can only switch
between stores that already exist. This script is the supported way to
create one.

Requirements:
    pip install asyncpg

Usage:
    # minimal — a brand with no domain yet (reachable in SINGLE_STORE_MODE
    # or via the admin's x-store-id picker)
    python scripts/deploy/add_store.py --slug appliances \\
        --name "Appliances DZ" --prefix APP

    # with hostnames; the FIRST --domain becomes the store's primary
    python scripts/deploy/add_store.py --slug appliances \\
        --name "Appliances DZ" --prefix APP \\
        --domain appliances.example.dz --domain www.appliances.example.dz

    # explicit DSN instead of $DATABASE_URL
    python scripts/deploy/add_store.py "postgresql://USER:PASS@HOST/db" \\
        --slug appliances --name "Appliances DZ" --prefix APP

Idempotent: re-running with the same arguments inserts nothing and exits 0.
Re-running with the same slug but DIFFERENT name/prefix/currency is refused
(see `_check_existing_matches`) — silently re-branding a live store would
change its order numbering mid-flight.

Use the DIRECT (non-pooler) connection string for this one-off write.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys

# NOTE: asyncpg is imported inside main(), not here. Argument validation is
# pure stdlib and runs before any connection, so `--slug "Bad Slug"` must
# report the bad slug even on a box that has not run `pip install asyncpg`.
# A driver-missing error would be a confusing answer to a typo.

# These mirror the CHECK constraints in db/migrations/005_stores.sql. They are
# enforced here so a typo is a readable message instead of a Postgres
# `violates check constraint "stores_slug_format"` traceback.
SLUG_RE     = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")   # stores_slug_format
PREFIX_RE   = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")         # stores.order_prefix
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")                   # stores.currency CHAR(3)
# store_domains.domain is stored lowercase and WITHOUT a port — the Host
# resolver strips ":8000" before looking it up (api/core/store_context.py).
DOMAIN_RE   = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")

# stores.name CHECK (length(name) BETWEEN 1 AND 200)
NAME_MAX = 200


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


def _normalize_domain(raw: str) -> str:
    """`WWW.Brand.Example.dz:8000` -> `www.brand.example.dz`.

    Same normalisation the request-time resolver applies, so what we store is
    exactly what a lookup will compare against.
    """
    host = raw.strip().lower()
    if host.startswith("["):          # bracketed IPv6 literal
        end = host.find("]")
        return host[1:end] if end != -1 else host
    return host.split(":", 1)[0]


def _validate(args: argparse.Namespace) -> tuple[list[str], list[str]]:
    """Check every argument against the schema BEFORE opening a connection.

    Returns (errors, normalized_domains). All problems are collected so the
    operator fixes them in one pass instead of one round-trip per typo.
    """
    errors: list[str] = []

    slug = args.slug.strip()
    if not SLUG_RE.match(slug):
        errors.append(
            f"--slug {args.slug!r} is not a valid store slug.\n"
            f"    Must be lowercase letters/digits, words joined by single "
            f"hyphens (schema: ^[a-z0-9]+(?:-[a-z0-9]+)*$).\n"
            f"    e.g. 'appliances', 'ghir-laffaire'"
        )

    name = args.name.strip()
    if not 1 <= len(name) <= NAME_MAX:
        errors.append(
            f"--name must be between 1 and {NAME_MAX} characters "
            f"(got {len(name)})."
        )

    prefix = args.prefix.strip()
    if not PREFIX_RE.match(prefix):
        errors.append(
            f"--prefix {args.prefix!r} is not a valid order prefix.\n"
            f"    Must be UPPERCASE: a letter followed by 1-9 more letters or "
            f"digits (schema: ^[A-Z][A-Z0-9]{{1,9}}$).\n"
            f"    e.g. 'APP', 'GLV2'. It prefixes every order number for this "
            f"brand (APP-2026-000001)."
        )

    currency = args.currency.strip()
    if not CURRENCY_RE.match(currency):
        errors.append(
            f"--currency {args.currency!r} is not a 3-letter uppercase ISO 4217 "
            f"code (e.g. DZD, EUR, USD)."
        )

    domains: list[str] = []
    for raw in args.domain or []:
        # Reject URLs BEFORE normalising. `_normalize_domain` strips at the
        # first ':', so "https://shop.example.dz/" would quietly become the
        # single label "https" and get stored as a routable hostname.
        bad_chars = [c for c in "/\\?#@ \t" if c in raw]
        if bad_chars:
            errors.append(
                f"--domain {raw!r} is not a bare hostname. Drop the scheme, "
                f"path and any credentials — give just the host "
                f"(e.g. shop.example.dz)."
            )
            continue
        d = _normalize_domain(raw)
        if not d or not DOMAIN_RE.match(d) or len(d) > 253:
            errors.append(
                f"--domain {raw!r} is not a valid hostname. Use letters, digits "
                f"and hyphens in dot-separated labels (e.g. shop.example.dz)."
            )
            continue
        if d in domains:
            errors.append(f"--domain {raw!r} was given more than once.")
            continue
        domains.append(d)

    return errors, domains


def _check_existing_matches(row, name: str, prefix: str, currency: str) -> list[str]:
    """Differences between an existing store row and the requested arguments.

    An empty list means this invocation is a genuine idempotent re-run.
    """
    diffs: list[str] = []
    if row["name"] != name:
        diffs.append(f"name: existing {row['name']!r} != requested {name!r}")
    if row["order_prefix"] != prefix:
        diffs.append(
            f"order_prefix: existing {row['order_prefix']!r} != requested {prefix!r}"
        )
    if row["currency"].strip() != currency:
        diffs.append(
            f"currency: existing {row['currency'].strip()!r} != requested {currency!r}"
        )
    return diffs


async def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create a new brand (stores row + hostnames) on the GLstore platform.",
    )
    ap.add_argument("dsn", nargs="?", default=os.environ.get("DATABASE_URL", ""),
                    help="Postgres connection string (or set DATABASE_URL).")
    ap.add_argument("--slug", required=True,
                    help="URL-safe store key, lowercase (e.g. appliances).")
    ap.add_argument("--name", required=True,
                    help="Display name of the brand (e.g. \"Appliances DZ\").")
    ap.add_argument("--prefix", required=True,
                    help="UPPERCASE order-number prefix (e.g. APP).")
    ap.add_argument("--domain", action="append", default=[],
                    help="Hostname serving this brand. Repeatable; the first "
                         "one becomes the store's primary domain.")
    ap.add_argument("--currency", default="DZD",
                    help="ISO 4217 code, 3 uppercase letters (default: DZD).")
    args = ap.parse_args()

    # ── 1. Validate everything in Python, before touching the DB ───────────
    errors, domains = _validate(args)
    if errors:
        print("✗ invalid arguments:", file=sys.stderr)
        for e in errors:
            print(f"  · {e}", file=sys.stderr)
        return 2

    slug     = args.slug.strip()
    name     = args.name.strip()
    prefix   = args.prefix.strip()
    currency = args.currency.strip()

    if not args.dsn:
        return _fail("No connection string. Pass it as an argument or set DATABASE_URL.")

    try:
        import asyncpg
    except ImportError:
        return _fail("asyncpg is required — run:  pip install asyncpg")

    dsn = _normalize_dsn(args.dsn)
    print("→ connecting (TLS) …")
    try:
        conn = await asyncpg.connect(dsn, ssl=True, timeout=30)
    except Exception as e:  # noqa: BLE001
        return _fail(f"could not connect: {type(e).__name__}: {e}")

    try:
        # ::text so the result comes back as a plain string (or NULL) rather
        # than relying on a codec for the `regclass` type.
        if await conn.fetchval("SELECT to_regclass('public.stores')::text") is None:
            return _fail(
                "this database has no 'stores' table — migration 005 has not "
                "been applied.\n   Run scripts/deploy/init_remote_db.py first."
            )

        # ── 2. The store row (idempotent) ──────────────────────────────────
        # RETURNING yields a row only on a real INSERT, so this doubles as the
        # created/already-existed signal without a second round trip.
        new_id = await conn.fetchval(
            """
            INSERT INTO stores (slug, name, order_prefix, currency)
                 VALUES ($1, $2, $3, $4)
            ON CONFLICT (slug) DO NOTHING
              RETURNING id
            """,
            slug, name, prefix, currency,
        )
        store = await conn.fetchrow(
            "SELECT id, name, order_prefix, currency, status::text AS status "
            "FROM stores WHERE slug = $1",
            slug,
        )
        if store is None:  # pragma: no cover — insert succeeded or conflicted
            return _fail(f"store '{slug}' vanished between insert and read.")

        store_id = store["id"]
        if new_id is None:
            diffs = _check_existing_matches(store, name, prefix, currency)
            if diffs:
                # The slug already belongs to a brand with different details.
                # We do NOT update it: order_prefix is baked into every order
                # number that brand has already issued, and a rename driven by
                # a deploy script is not something an operator can review.
                # Refuse loudly instead of pretending the brand was created.
                print(f"✗ a store with slug '{slug}' already exists with "
                      f"different details (id={store_id}):", file=sys.stderr)
                for d in diffs:
                    print(f"  · {d}", file=sys.stderr)
                print("  Nothing was changed. Use a different --slug for a new "
                      "brand, or edit the existing store deliberately "
                      "(admin UI / SQL).", file=sys.stderr)
                return 1
            print(f"→ store '{slug}' already exists and matches "
                  f"(id={store_id}, status={store['status']}) — no change.")
        else:
            print(f"→ created store '{slug}' (id={store_id}, "
                  f"status={store['status']}).")

        # ── 3. The domains (idempotent) ────────────────────────────────────
        # `is_primary` is guarded by a UNIQUE partial index (one primary per
        # store), so only claim primary when this store has none yet.
        has_primary = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM store_domains "
            "WHERE store_id = $1 AND is_primary)",
            store_id,
        )
        stolen: list[str] = []
        for d in domains:
            want_primary = not has_primary
            await conn.execute(
                """
                INSERT INTO store_domains (store_id, domain, is_primary)
                     VALUES ($1, $2, $3)
                ON CONFLICT (domain) DO NOTHING
                """,
                store_id, d, want_primary,
            )
            owner = await conn.fetchrow(
                "SELECT s.id, s.slug, d.is_primary FROM store_domains d "
                "JOIN stores s ON s.id = d.store_id WHERE d.domain = $1",
                d,
            )
            if owner is None:  # pragma: no cover — insert or conflict, never neither
                return _fail(f"domain '{d}' was neither inserted nor found.")
            if owner["id"] != store_id:
                # ON CONFLICT DO NOTHING swallowed it because the hostname
                # already routes to a DIFFERENT brand. Saying nothing here
                # would leave the operator believing the domain was mapped.
                stolen.append(f"{d} → already mapped to store '{owner['slug']}'")
                continue
            if owner["is_primary"]:
                has_primary = True
            print(f"→ domain '{d}' → this store"
                  f"{' (primary)' if owner['is_primary'] else ''}.")

        if stolen:
            print(f"✗ {len(stolen)} domain(s) belong to another brand and were "
                  f"NOT re-pointed:", file=sys.stderr)
            for s in stolen:
                print(f"  · {s}", file=sys.stderr)
            print(f"  The store row itself is fine (id={store_id}). Remove the "
                  f"domain from the other store first, then re-run.", file=sys.stderr)
            return 1

        # ── 4. Report ──────────────────────────────────────────────────────
        mapped = await conn.fetch(
            "SELECT domain, is_primary FROM store_domains WHERE store_id = $1 "
            "ORDER BY is_primary DESC, domain",
            store_id,
        )
        print("\n✅ Store ready.")
        print(f"   id:       {store_id}")
        print(f"   slug:     {slug}")
        print(f"   name:     {name}")
        print(f"   prefix:   {prefix}   (order numbers look like {prefix}-2026-000001)")
        print(f"   currency: {currency}")
        print(f"   domains:  {', '.join(r['domain'] + ('*' if r['is_primary'] else '') for r in mapped) or '(none yet)'}")
        print("\nNext:")
        print("  · set SINGLE_STORE_MODE=false so Host resolution picks the brand")
        print("  · point the DNS + your host (e.g. Vercel) at each domain above")
        print("  · theme it: admin → Settings → Theme with this store selected")
        print(f"  · prove it: python scripts/deploy/smoke_test_checkout.py "
              f"<base-url> --store-host {mapped[0]['domain'] if mapped else '<domain>'}")
        return 0
    finally:
        await conn.close()


def _fail(msg: str) -> int:
    print(f"✗ {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
