#!/usr/bin/env python3
"""
Attach hostnames to a brand that ALREADY EXISTS — `store_domains` rows, nothing else.

WHY THIS IS SEPARATE FROM add_store.py
    `add_store.py` CREATES a brand: `--slug`, `--name` and `--prefix` are all
    required, and pointed at an existing slug whose name/prefix you mistype it
    exits 1 having done nothing. That is right for "create a brand" and wrong
    for "my live URL needs to route somewhere" — the second job needs no
    identity at all, only a slug that already exists.

    So this script CANNOT create a store. It has no `--name`, no `--prefix`,
    and never writes to `stores`. A mistyped `--slug` is therefore a readable
    error listing the real slugs, not a phantom second brand.

WHY YOU NEED IT (the failure it prevents)
    Migration 005 seeds exactly two domains — `localhost` and `127.0.0.1` —
    onto the `default` store. The moment `SINGLE_STORE_MODE=false` is set,
    `api/core/store_context.py` stops falling back to the default store and an
    unrecognised Host is a hard 404 "No store is configured for this address."
    Your `<project>.vercel.app` URL is an unrecognised Host. Attach it FIRST,
    with this script, and the flag flip is a no-op for brand #1.

*** POINT THIS AT THE RIGHT DATABASE. It writes to whatever DSN you give it
*** (or to $DATABASE_URL if you give it none). It will not re-point a hostname
*** that already belongs to another brand — it refuses and exits non-zero —
*** but it is still a live write. Use --dry-run first.

Requirements:
    pip install asyncpg

Usage:
    # look, change nothing (prints the whole domain -> store mapping)
    python scripts/deploy/add_domain.py --slug default \\
        --domain my-project.vercel.app --dry-run

    # attach the live URL to brand #1 before flipping SINGLE_STORE_MODE
    python scripts/deploy/add_domain.py --slug default \\
        --domain my-project.vercel.app \\
        --domain shop.mydomain.dz

    # make the first --domain this store's primary (fails cleanly if the
    # store already has a different primary — it will not demote it for you)
    python scripts/deploy/add_domain.py --slug glaive \\
        --domain glaive.mydomain.dz --primary

    # explicit DSN instead of $DATABASE_URL
    python scripts/deploy/add_domain.py "postgresql://USER:PASS@HOST/db" \\
        --slug default --domain my-project.vercel.app

Idempotent: re-attaching a hostname the store already owns writes nothing and
exits 0. Attaching a hostname owned by a DIFFERENT brand writes nothing and
exits 1, naming the owner.

Use the DIRECT (non-pooler) connection string for this one-off write.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# Same reason as apply_migrations.py: this output uses →/✅/✗/· and a legacy
# Windows console is cp1252, which cannot encode them. Without this, "you
# forgot the connection string" comes out as a UnicodeEncodeError traceback.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")   # type: ignore[union-attr]
    except Exception:                           # noqa: BLE001 — not a TextIOWrapper
        pass

# Invoked by path (`python scripts/deploy/add_domain.py`) CPython already puts
# this directory on sys.path; add it explicitly so `python -m` and any other
# entry point behave the same.
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    # Imported, not copied. `_normalize_domain` has to produce byte-identical
    # output to `api.core.store_context.normalize_host`, because what we store
    # is what a request-time lookup compares against — a second hand-written
    # copy of that rule in the same directory is exactly how the two drift.
    # (`api.core.store_context` itself is not importable here: it pulls in
    # fastapi + sqlalchemy at module scope. add_store.py's copy is the closest
    # thing to a source of truth a stdlib-only deploy script can reach.)
    from add_store import (          # noqa: E402
        DOMAIN_RE,
        SLUG_RE,
        _normalize_domain,
        _normalize_dsn,
    )
except Exception as e:  # noqa: BLE001
    sys.exit(
        f"could not import scripts/deploy/add_store.py "
        f"({type(e).__name__}: {e}).\n"
        f"Run this from a full checkout of the repo — it reuses that script's "
        f"hostname validation so the two cannot disagree about what a valid "
        f"domain is."
    )


def _validate(args: argparse.Namespace) -> tuple[list[str], str, list[str]]:
    """Check every argument against the schema BEFORE opening a connection.

    Returns (errors, slug, normalized_domains). All problems are collected so
    the operator fixes them in one pass instead of one round-trip per typo.
    """
    errors: list[str] = []

    slug = args.slug.strip().lower()
    if not SLUG_RE.match(slug):
        errors.append(
            f"--slug {args.slug!r} is not a valid store slug.\n"
            f"    Must be lowercase letters/digits, words joined by single "
            f"hyphens (schema: ^[a-z0-9]+(?:-[a-z0-9]+)*$).\n"
            f"    e.g. 'default', 'glaive', 'appliances'"
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
                f"(e.g. shop.example.dz, my-project.vercel.app)."
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

    if not args.domain:
        # `--dry-run` with no --domain is legal and useful: it is the
        # "show me the current domain → store mapping" mode the DEPLOY.md
        # runbook opens with. A real run with nothing to attach is not.
        # Reported even alongside a bad --slug: two mistakes in one pass beats
        # two round-trips. (If they DID pass domains and all were rejected,
        # the per-domain errors above already said so.)
        if args.primary:
            errors.append(
                "--primary applies to the first --domain, but no --domain was "
                "given."
            )
        elif not args.dry_run:
            errors.append(
                "no --domain given — there is nothing to attach.\n"
                "    Add --dry-run to just print the current domain → store "
                "mapping and change nothing.\n"
                "    This script only adds hostnames. To create a brand use "
                "scripts/deploy/add_store.py."
            )

    return errors, slug, domains


async def _load_store(conn, slug: str):
    """The `stores` row for `slug`, or None. Never creates one."""
    # ::text on citext/enum columns so asyncpg gets plain strings back, and
    # lower(...) on the left so the parameter is a plain text bind rather than
    # relying on a citext codec — same comparison citext would make anyway.
    return await conn.fetchrow(
        """
        SELECT id, slug::text AS slug, name, order_prefix,
               status::text AS status
          FROM stores
         WHERE lower(slug::text) = $1
        """,
        slug,
    )


async def _owner_of(conn, domain: str):
    """Which store (if any) currently answers on `domain`."""
    return await conn.fetchrow(
        """
        SELECT s.id, s.slug::text AS slug, s.name, d.is_primary
          FROM store_domains d
          JOIN stores s ON s.id = d.store_id
         WHERE lower(d.domain::text) = $1
        """,
        domain,
    )


async def _primary_of(conn, store_id) -> str | None:
    """This store's primary hostname, or None if it has not claimed one."""
    return await conn.fetchval(
        "SELECT domain::text FROM store_domains "
        "WHERE store_id = $1 AND is_primary",
        store_id,
    )


async def _print_mapping(conn, highlight_id) -> None:
    """The whole platform's domain → store map.

    Printed on every run, including --dry-run, because this is the thing the
    operator has to eyeball before setting SINGLE_STORE_MODE=false: any brand
    listed here with no domains is a brand that 404s the moment the fallback
    is switched off.
    """
    rows = await conn.fetch(
        """
        SELECT s.id, s.slug::text AS slug, s.name, s.status::text AS status,
               d.domain::text AS domain, d.is_primary
          FROM stores s
          LEFT JOIN store_domains d ON d.store_id = s.id
         ORDER BY s.slug, d.is_primary DESC NULLS LAST, d.domain
        """
    )
    by_store: dict = {}
    for r in rows:
        entry = by_store.setdefault(
            r["id"],
            {"slug": r["slug"], "name": r["name"],
             "status": r["status"], "domains": []},
        )
        if r["domain"] is not None:
            entry["domains"].append((r["domain"], r["is_primary"]))

    print("\nDomain → store mapping (every brand on this database):")
    for store_id, s in by_store.items():
        mark = "  ←" if store_id == highlight_id else ""
        status = "" if s["status"] == "ACTIVE" else f"  [{s['status']}]"
        print(f"\n  {s['slug']}{status}   \"{s['name']}\"{mark}")
        if not s["domains"]:
            print("      (no domains — unreachable by Host; it will 404 once "
                  "SINGLE_STORE_MODE=false)")
            continue
        for domain, is_primary in s["domains"]:
            print(f"      · {domain}{'   (primary)' if is_primary else ''}")


def _print_conflicts(conflicts: list[tuple[str, str, str]]) -> int:
    """`store_domains.domain` is globally UNIQUE, so `ON CONFLICT DO NOTHING`
    on a hostname another brand owns succeeds while attaching nothing. Saying
    nothing here would leave the operator believing the domain was mapped."""
    print(f"\n✗ {len(conflicts)} hostname(s) already belong to another brand "
          f"and were NOT re-pointed:", file=sys.stderr)
    for domain, slug, name in conflicts:
        print(f"  · {domain} → store '{slug}' (\"{name}\")", file=sys.stderr)
    print(
        "  Nothing was changed for those hostnames. A hostname routes to "
        "exactly one\n"
        "  brand, so moving one is a deliberate two-step: remove it from the "
        "other store\n"
        "  first, then re-run.\n"
        "      DELETE FROM store_domains WHERE domain = '<hostname>';",
        file=sys.stderr,
    )
    return 1


def _print_primary_taken(slug: str, store_id, wanted: str, current: str) -> int:
    """`store_domains_one_primary_per_store` (migration 005) is a partial
    UNIQUE index. Letting the INSERT hit it would answer a reasonable request
    with a raw `duplicate key value violates unique constraint` — so refuse
    first, and hand over the swap the operator actually meant."""
    print(
        f"\n✗ store '{slug}' already has a primary domain: {current}\n"
        f"  --primary would give it a second one, which "
        f"store_domains_one_primary_per_store forbids (one per store).\n"
        f"  Nothing was changed. Attach {wanted} without --primary, or swap "
        f"the primary deliberately:\n"
        f"      BEGIN;\n"
        f"      UPDATE store_domains SET is_primary = false\n"
        f"       WHERE store_id = '{store_id}' AND is_primary;\n"
        f"      UPDATE store_domains SET is_primary = true\n"
        f"       WHERE store_id = '{store_id}' AND domain = '{wanted}';\n"
        f"      COMMIT;\n"
        f"  (The primary is only used to build absolute URLs for a brand; "
        f"every domain routes.)",
        file=sys.stderr,
    )
    return 1


async def _run(conn, slug: str, domains: list[str], want_primary: bool,
               dry_run: bool) -> int:
    if await conn.fetchval("SELECT to_regclass('public.store_domains')::text") is None:
        return _fail(
            "this database has no 'store_domains' table — migration 005 has "
            "not been applied.\n   Run scripts/deploy/apply_migrations.py "
            "(or init_remote_db.py on a virgin database) first."
        )

    # ── 1. The store must already exist. This script never creates one ─────
    store = await _load_store(conn, slug)
    if store is None:
        known = await conn.fetch("SELECT slug::text AS slug, name FROM stores ORDER BY slug")
        print(f"✗ no store has slug '{slug}'. Nothing was changed.",
              file=sys.stderr)
        if known:
            print("  Stores on this database:", file=sys.stderr)
            for k in known:
                print(f"    · {k['slug']}   \"{k['name']}\"", file=sys.stderr)
        else:
            print("  This database has no stores at all — migration 005 "
                  "should have created 'default'.", file=sys.stderr)
        print("  This script only ADDS DOMAINS to an existing brand. To "
              "create a brand:\n"
              "    python scripts/deploy/add_store.py --slug <slug> "
              "--name \"<name>\" --prefix <PFX>", file=sys.stderr)
        return 1

    store_id = store["id"]
    print(f"→ store '{store['slug']}' (\"{store['name']}\", prefix "
          f"{store['order_prefix']}, id={store_id}, status={store['status']}).")
    if store["status"] != "ACTIVE":
        # resolve_store_by_host filters on s.status = 'ACTIVE', so a domain on
        # a suspended store still 404s. Attaching it is legal; believing it
        # will serve traffic is not.
        print(f"⚠ this store is {store['status']}, not ACTIVE — Host "
              f"resolution ignores it, so these domains will still 404 until "
              f"you reactivate it.", file=sys.stderr)

    # Inspection mode: `--dry-run` with no --domain. Just show the operator
    # what the platform currently looks like (DEPLOY.md's first runbook step).
    if not domains:
        await _print_mapping(conn, store_id)
        print("\nNothing was written — no --domain given. Re-run with "
              "--domain <hostname> to attach one.")
        return 0

    # ── 2. Plan every domain read-only, BEFORE writing anything ────────────
    # A refusal must not leave half the hostnames attached, so classify the
    # whole batch first and bail on the batch.
    current_primary = await _primary_of(conn, store_id)
    conflicts: list[tuple[str, str, str]] = []
    already: list[tuple[str, bool]] = []
    to_insert: list[str] = []
    for d in domains:
        owner = await _owner_of(conn, d)
        if owner is None:
            to_insert.append(d)
        elif owner["id"] != store_id:
            conflicts.append((d, owner["slug"], owner["name"]))
        else:
            already.append((d, owner["is_primary"]))

    if conflicts:
        await _print_mapping(conn, store_id)
        return _print_conflicts(conflicts)

    # ── 3. Who, if anyone, claims primary ──────────────────────────────────
    # --primary applies to the FIRST --domain, matching add_store.py's "the
    # first --domain becomes the store's primary".
    promote: str | None = None      # already attached, needs an UPDATE
    primary_on_insert: str | None = None
    spoken_for: set[str] = set()    # domains whose fate a later line explains
    if want_primary:
        wanted = domains[0]
        if current_primary is not None and current_primary != wanted:
            return _print_primary_taken(slug, store_id, wanted, current_primary)
        if current_primary == wanted:
            print(f"→ '{wanted}' is already attached to this store and is "
                  f"already its primary — nothing to do.")
            spoken_for.add(wanted)
        elif wanted in to_insert:
            primary_on_insert = wanted
        else:
            promote = wanted        # attached, non-primary, store has no primary
            spoken_for.add(wanted)  # the promotion line below is its report
    elif current_primary is None and to_insert:
        # Same rule add_store.py applies: a store with no primary yet gets one
        # from the first hostname actually inserted. A store that already has
        # one keeps it — this script never demotes anything implicitly.
        primary_on_insert = to_insert[0]

    for d, is_primary in already:
        if d in spoken_for:
            continue
        print(f"→ '{d}' is already attached to this store"
              f"{' (primary)' if is_primary else ''} — no change.")

    if not to_insert and promote is None:
        print("\n✅ Nothing to do — every hostname given is already attached "
              "to this store.")
        await _print_mapping(conn, store_id)
        return 0

    # ── 4. Write (or describe the write) ───────────────────────────────────
    if dry_run:
        print(f"\n→ {len(to_insert) + (1 if promote else 0)} change(s) WOULD "
              f"be made:")
        for d in to_insert:
            print(f"   · attach {d}"
                  f"{'   (as primary)' if d == primary_on_insert else ''}")
        if promote:
            print(f"   · promote {promote} to primary")
        await _print_mapping(conn, store_id)
        print("\nDry run — nothing was written. Re-run without --dry-run to "
              "apply.")
        return 0

    written: list[str] = []
    for d in to_insert:
        is_primary = (d == primary_on_insert)
        try:
            # $2::text so the parameter binds as text and Postgres casts it
            # into the citext column, instead of asyncpg needing a citext
            # codec. ON CONFLICT (domain) DO NOTHING keeps a hostname that
            # appeared underneath us (step 2 is a separate read) from raising
            # — the owner re-read below is what actually decides.
            await conn.execute(
                """
                INSERT INTO store_domains (store_id, domain, is_primary)
                     VALUES ($1, $2::text, $3)
                ON CONFLICT (domain) DO NOTHING
                """,
                store_id, d, is_primary,
            )
        except Exception as e:  # noqa: BLE001
            return _explain_write_error(e, store["slug"], d, written)
        owner = await _owner_of(conn, d)
        if owner is None:  # pragma: no cover — insert or conflict, never neither
            return _fail(f"domain '{d}' was neither inserted nor found.")
        if owner["id"] != store_id:
            # Lost a race with another writer between step 2 and here.
            conflicts.append((d, owner["slug"], owner["name"]))
            continue
        written.append(d)
        print(f"→ attached '{d}'"
              f"{'   (primary)' if owner['is_primary'] else ''}.")

    if promote is not None:
        try:
            await conn.execute(
                "UPDATE store_domains SET is_primary = true "
                "WHERE store_id = $1 AND lower(domain::text) = $2",
                store_id, promote,
            )
        except Exception as e:  # noqa: BLE001
            return _explain_write_error(e, store["slug"], promote, written)
        written.append(f"{promote} (now primary)")
        print(f"→ '{promote}' is now this store's primary.")

    await _print_mapping(conn, store_id)

    if conflicts:
        return _print_conflicts(conflicts)

    print(f"\n✅ {len(written)} hostname change(s) applied to '{store['slug']}'.")
    print("   Host resolution caches domain lookups for 60s "
          "(api/core/store_context._CACHE_TTL_SECONDS), so give it a minute "
          "or redeploy.")
    print("\nNext:")
    print("   · make sure ALLOWED_HOSTS admits each hostname (or is '*'), and "
          "CORS_ORIGINS its origin")
    print("   · only THEN set SINGLE_STORE_MODE=false — see \"Turning on "
          "multi-brand\" in DEPLOY.md")
    print(f"   · prove it: python scripts/deploy/smoke_test_checkout.py "
          f"<base-url> --store-host {domains[0]}")
    return 0


def _explain_write_error(e: Exception, slug: str, domain: str,
                         written: list[str]) -> int:
    """Turn a Postgres constraint violation into a sentence.

    The one that is actually reachable is the partial unique index
    `store_domains_one_primary_per_store` losing a race with another writer —
    step 3 rules it out for a single run, but two operators can still collide.
    """
    sqlstate = getattr(e, "sqlstate", None)
    constraint = getattr(e, "constraint_name", None) or ""
    detail = f"{type(e).__name__}: {e}"
    if sqlstate == "23505" and "one_primary" in f"{constraint}{e}":
        print(f"\n✗ store '{slug}' already has a primary domain — "
              f"'{domain}' could not become a second one.\n"
              f"  (Something set it between this script's check and its write.)"
              f"\n  Re-run without --primary, or swap the primary deliberately "
              f"in SQL.", file=sys.stderr)
    elif sqlstate == "23505":
        print(f"\n✗ '{domain}' collided with an existing row "
              f"({constraint or 'unique constraint'}). Nothing was changed for "
              f"it.", file=sys.stderr)
    else:
        print(f"\n✗ writing '{domain}' failed: {detail}", file=sys.stderr)
    if written:
        print(f"  Already applied and COMMITTED this run: "
              f"{', '.join(written)}", file=sys.stderr)
    return 1


async def main() -> int:
    ap = argparse.ArgumentParser(
        description="Attach hostnames to an existing brand on the GLstore "
                    "platform. Never creates a store — use add_store.py for that.",
    )
    ap.add_argument("dsn", nargs="?", default=os.environ.get("DATABASE_URL", ""),
                    help="Postgres connection string (or set DATABASE_URL). "
                         "Use Neon's DIRECT, non-pooled string.")
    ap.add_argument("--slug", required=True,
                    help="Slug of the EXISTING store (e.g. default). "
                         "Run with --dry-run to see what exists.")
    ap.add_argument("--domain", action="append", default=[],
                    help="Hostname to attach. Repeatable. Bare host only — no "
                         "scheme, no port, no path.")
    ap.add_argument("--primary", action="store_true",
                    help="Make the FIRST --domain this store's primary. Fails "
                         "if the store already has a different primary; it is "
                         "never demoted implicitly.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what WOULD change and print the mapping, "
                         "write nothing, exit 0.")
    args = ap.parse_args()

    # ── Validate everything in Python, before touching the DB ──────────────
    errors, slug, domains = _validate(args)
    if errors:
        print("✗ invalid arguments:", file=sys.stderr)
        for e in errors:
            print(f"  · {e}", file=sys.stderr)
        return 2

    if not args.dsn:
        return _fail("No connection string. Pass it as an argument or set DATABASE_URL.")

    # asyncpg is imported HERE, not at module scope: everything above is pure
    # stdlib, so `--domain https://oops/` must report the bad hostname even on
    # a box that has never run `pip install asyncpg`.
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
        return await _run(conn, slug, domains, args.primary, args.dry_run)
    finally:
        await conn.close()


def _fail(msg: str) -> int:
    print(f"✗ {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
