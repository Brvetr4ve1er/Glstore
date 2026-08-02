#!/usr/bin/env python3
"""
Apply PENDING migrations to an ALREADY-INITIALIZED remote Postgres (e.g. Neon).

This is the missing half of the deploy story:

  · `scripts/deploy/init_remote_db.py` is the ONE-SHOT initializer. It refuses
    any database that already has a `products` table, so it can never be the
    answer to "I just added db/migrations/007_… — how does it reach prod?".
  · `api/core/migrations.py` runs on API startup — but Vercel sets
    `RUN_STARTUP_MIGRATIONS=false` (correct: serverless has no single startup
    to hang a schema change off), so that path is off in production.

Without this script a new `db/migrations/*.sql` is stranded: the code ships,
the schema does not, and the mismatch shows up as a silent behaviour change
(007 is exactly that — until it runs, brand #1's storefront quietly loses the
theme its operator saved).

WHAT IT DOES
    1. Discovers `db/migrations/*.sql` in filename order.
    2. Runs the `000_` bootstrap unconditionally (it is
       `CREATE TABLE IF NOT EXISTS` — idempotent) so `_migrations` exists.
    3. Reads `_migrations` and applies only the files NOT recorded there.
    4. Records each applied file as (filename, checksum, duration_ms,
       applied_at) with the SHA-256 of the file BYTES.
    5. Aborts if an already-applied migration's file has changed since.

*** THE CHECKSUM IS THE LOAD-BEARING DETAIL. If this script hashed the file
*** differently from `api/core/migrations.py`, a later boot on a persistent
*** host would either re-apply everything or abort with a false tamper error.
*** So it does not reimplement the hash — it IMPORTS `discover_migrations`
*** from that module and uses its `Migration.checksum` verbatim. (This is the
*** one place where `init_remote_db.py`'s standalone-copy style is the wrong
*** call: that script has to hash files too, but it only ever writes rows into
*** a virgin table. This one has to AGREE with rows somebody else wrote.)
*** The INSERT below is likewise a character-for-character transcription of
*** `api/core/migrations._apply_one`, modulo asyncpg's $1 placeholders.

It also takes the SAME Postgres advisory lock the startup runner takes, so a
persistent replica booting mid-run cannot race this script.

DIFFERENCE FROM THE STARTUP RUNNER (deliberate): the runner wraps the whole
run in one outer transaction with per-migration savepoints. This script commits
each migration separately. For an operator running one command against a live
database, "005 and 006 landed, 007 failed" is a resumable state; "nothing
landed, and you don't know how far it got" is not.

Requirements:
    pip install asyncpg

Usage:
    # 1. ALWAYS look first
    python scripts/deploy/apply_migrations.py "postgresql://USER:PASS@HOST/db" --dry-run

    # 2. then apply
    python scripts/deploy/apply_migrations.py "postgresql://USER:PASS@HOST/db"

    # or set DATABASE_URL and pass no argument
    export DATABASE_URL="postgresql://USER:PASS@HOST/db"
    python scripts/deploy/apply_migrations.py --dry-run

Safe to re-run: a second run with nothing pending says so and exits 0.

Use Neon's DIRECT (non-pooler) connection string — this is DDL, and the pooler
can hand you a different backend mid-session, which the advisory lock and the
per-migration transactions both assume will not happen.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from time import monotonic

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"

# This script's output uses the same →/✅/✗/· glyphs as its siblings in this
# directory. A legacy Windows console is cp1252, which cannot encode them, and
# `print` would raise UnicodeEncodeError — turning "you forgot the connection
# string" into a traceback. Degrade unencodable characters to '?' instead of
# dying; the words carry the meaning, the arrows are decoration.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")   # type: ignore[union-attr]
    except Exception:                           # noqa: BLE001 — not a TextIOWrapper
        pass

# The script is normally invoked by path (`python scripts/deploy/…`), which
# puts scripts/deploy/ on sys.path, not the repo root. Add the root so the
# `api.core.migrations` import below resolves.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    # `api.core.migrations` is importable with the standard library alone —
    # its SQLAlchemy dependency is under TYPE_CHECKING plus a lazy `_text()`
    # helper, on purpose (see that module's docstring). So this import does
    # NOT drag the whole API's dependency tree into a deploy script.
    from api.core.migrations import (        # noqa: E402
        _ADVISORY_LOCK_KEY,   # same lock namespace as the startup runner
        _BOOTSTRAP_FILENAME,  # "000_migrations_table.sql"
        Migration,
        discover_migrations,  # <- the single source of truth for checksums
    )
except Exception as e:  # noqa: BLE001
    sys.exit(
        f"could not import api.core.migrations ({type(e).__name__}: {e}).\n"
        f"Run this from a full checkout of the repo — it reuses the API's "
        f"migration discovery so the checksums cannot drift apart."
    )

LOCK_WAIT_SECONDS = 30.0


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


async def _read_applied(conn) -> dict[str, str] | None:
    """{ filename → checksum } from `_migrations`, or None if the table does
    not exist yet (a DB that has never been through the runner)."""
    if await conn.fetchval("SELECT to_regclass('public._migrations')::text") is None:
        return None
    rows = await conn.fetch(
        "SELECT filename, checksum FROM _migrations ORDER BY filename"
    )
    return {r["filename"]: r["checksum"] for r in rows}


def _find_tampered(
    applied: dict[str, str], others: list[Migration]
) -> list[str]:
    """Already-recorded migrations whose file no longer hashes to what was
    stored. Same rule as `api/core/migrations.run_pending_migrations`: fatal.

    The 000_ bootstrap is excluded, exactly as the runner excludes it — it is
    re-executed unconditionally on every boot, so it is not part of the
    tracked-and-immutable set.
    """
    bad: list[str] = []
    for m in others:
        prev = applied.get(m.filename)
        if prev is not None and prev != m.checksum:
            bad.append(
                f"{m.filename}: stored={prev[:12]}… vs file={m.checksum[:12]}…"
            )
    return bad


def _print_tampered(bad: list[str]) -> int:
    print("✗ checksum mismatch — refusing to touch this database:",
          file=sys.stderr)
    for b in bad:
        print(f"  · {b}", file=sys.stderr)
    print(
        "  A migration that has already been applied was edited afterwards.\n"
        "  Migrations are immutable once applied: the recorded SQL and the SQL\n"
        "  in the file are now different, so nobody can say what this database\n"
        "  actually contains. Restore the file to its applied content (git) and\n"
        "  put the change in a NEW migration instead.\n"
        "  Nothing was applied and nothing was recorded.",
        file=sys.stderr,
    )
    return 1


def _warn_bootstrap_drift(applied: dict[str, str], bootstrap: Migration | None) -> None:
    """Non-fatal, and non-fatal on purpose: the startup runner re-executes the
    bootstrap every boot without checking its checksum, so treating drift here
    as fatal would make the two paths disagree. Say it out loud anyway."""
    if bootstrap is None:
        return
    prev = applied.get(bootstrap.filename)
    if prev is not None and prev != bootstrap.checksum:
        print(
            f"⚠ {bootstrap.filename} no longer matches its recorded checksum "
            f"(stored={prev[:12]}… vs file={bootstrap.checksum[:12]}…).\n"
            f"  Not fatal — the bootstrap is re-run unconditionally by "
            f"api/core/migrations.py too — but it should not normally change.",
            file=sys.stderr,
        )


async def _guard_initialized(conn) -> str | None:
    """This script MIGRATES, it does not INITIALIZE. `db/schema.sql` — not any
    migration — is what creates `products`, and 005 assumes those tables are
    already there. Pointing this at a virgin database would fail somewhere in
    the middle rather than at the door, so check the door.

    Returns an error message, or None when the DB looks initialized.
    """
    if await conn.fetchval("SELECT to_regclass('public.products')::text") is None:
        return (
            "this database has no 'products' table — it has never been "
            "initialized.\n   Run scripts/deploy/init_remote_db.py first; this "
            "script only applies migrations on top of an existing schema."
        )
    return None


async def _dry_run(
    conn, bootstrap: Migration | None, others: list[Migration]
) -> int:
    """Report what a real run would do. Opens no transaction, writes nothing —
    not even the `_migrations` table itself."""
    applied = await _read_applied(conn)
    if applied is None:
        print("→ no `_migrations` table yet — a real run would create it "
              f"(via {_BOOTSTRAP_FILENAME}) and record every migration below.")
        applied = {}

    bad = _find_tampered(applied, others)
    if bad:
        # A dry run whose whole job is "tell me before I write" must not
        # report a clean bill of health here. Exit non-zero.
        return _print_tampered(bad)

    _warn_bootstrap_drift(applied, bootstrap)

    pending = [m for m in others if m.filename not in applied]
    if bootstrap is not None and bootstrap.filename not in applied:
        print(f"→ would run + record {bootstrap.filename} (bootstrap, idempotent)")

    if not pending:
        print(f"\n✅ Nothing pending — all {len(others)} tracked migration(s) "
              f"are already applied. (dry run: nothing was written.)")
        return 0

    print(f"\n→ {len(pending)} migration(s) WOULD be applied, in this order:")
    for m in pending:
        print(f"   · {m.filename}   sha256={m.checksum[:16]}…")
    print(f"   ({len(others) - len(pending)} already applied, would be skipped.)")
    print("\nDry run — nothing was written. Re-run without --dry-run to apply.")
    return 0


async def _apply(
    conn, bootstrap: Migration | None, others: list[Migration]
) -> int:
    # ── Advisory lock ─────────────────────────────────────────────────────
    # Same key api/core/migrations.py uses, so a persistent replica booting
    # with RUN_STARTUP_MIGRATIONS=true cannot run migrations underneath us.
    deadline = monotonic() + LOCK_WAIT_SECONDS
    got = await conn.fetchval("SELECT pg_try_advisory_lock($1)", _ADVISORY_LOCK_KEY)
    while not got and monotonic() < deadline:
        print("→ migration lock busy; waiting …")
        await asyncio.sleep(1.0)
        got = await conn.fetchval("SELECT pg_try_advisory_lock($1)", _ADVISORY_LOCK_KEY)
    if not got:
        return _fail(
            f"another process held the migration lock for "
            f"{LOCK_WAIT_SECONDS:.0f}s. Nothing was applied — try again."
        )

    try:
        # ── Bootstrap ─────────────────────────────────────────────────────
        # Unconditional + idempotent, exactly like `_ensure_bootstrap`. It has
        # to run before we can read the table we are about to read.
        if bootstrap is not None:
            await conn.execute(bootstrap.sql)

        applied = await _read_applied(conn)
        if applied is None:  # pragma: no cover — bootstrap just created it
            return _fail(
                "`_migrations` still missing after running the bootstrap "
                f"({_BOOTSTRAP_FILENAME}). Nothing was applied."
            )

        # ── Tamper check BEFORE any write ─────────────────────────────────
        bad = _find_tampered(applied, others)
        if bad:
            return _print_tampered(bad)
        _warn_bootstrap_drift(applied, bootstrap)

        # Record the bootstrap so it shows up in `_migrations` like everything
        # else (same insert + same reasoning as the startup runner).
        if bootstrap is not None and bootstrap.filename not in applied:
            await conn.execute(
                """
                INSERT INTO _migrations (filename, checksum, duration_ms, applied_at)
                     VALUES ($1, $2, 0, NOW())
                ON CONFLICT (filename) DO NOTHING
                """,
                bootstrap.filename, bootstrap.checksum,
            )
            applied[bootstrap.filename] = bootstrap.checksum
            print(f"→ recorded {bootstrap.filename} (bootstrap).")

        # ── Apply the pending ones, in filename order ─────────────────────
        pending = [m for m in others if m.filename not in applied]
        if not pending:
            print(f"\n✅ Nothing to do — all {len(others)} tracked migration(s) "
                  f"are already applied.")
            await _report(conn)
            return 0

        applied_now: list[str] = []
        for m in pending:
            print(f"→ applying {m.filename} …")
            started = monotonic()
            try:
                # One transaction per migration: a failure rolls back THIS
                # file only, leaving earlier ones committed and re-runnable.
                async with conn.transaction():
                    # No bind args → asyncpg's simple-query protocol, which is
                    # the only one that accepts multi-statement scripts (our
                    # migrations are CREATE TABLE + CREATE INDEX + DO blocks).
                    await conn.execute(m.sql)
                    duration_ms = int((monotonic() - started) * 1000)
                    # Byte-for-byte the same INSERT as
                    # api/core/migrations._apply_one, with $n placeholders.
                    await conn.execute(
                        """
                        INSERT INTO _migrations (filename, checksum, duration_ms, applied_at)
                             VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (filename) DO NOTHING
                        """,
                        m.filename, m.checksum, duration_ms,
                    )
            except Exception as e:  # noqa: BLE001
                print(f"✗ {m.filename} FAILED and was rolled back: "
                      f"{type(e).__name__}: {e}", file=sys.stderr)
                if applied_now:
                    print(f"  Already applied and COMMITTED this run: "
                          f"{', '.join(applied_now)}", file=sys.stderr)
                print(f"  {m.filename} and everything after it are still "
                      f"pending. Fix the SQL and re-run — this script resumes "
                      f"from where it stopped.", file=sys.stderr)
                return 1
            applied_now.append(m.filename)
            print(f"  ✓ {m.filename} ({duration_ms} ms)")

        print(f"\n✅ Applied {len(applied_now)} migration(s): "
              f"{', '.join(applied_now)}")
        await _report(conn)
        return 0
    finally:
        try:
            await conn.execute("SELECT pg_advisory_unlock($1)", _ADVISORY_LOCK_KEY)
        except Exception:  # noqa: BLE001
            # Postgres drops session locks when the session ends, so a failed
            # unlock is cosmetic. Don't mask the real error with it.
            print("⚠ advisory unlock failed (harmless — the lock is released "
                  "when this connection closes).", file=sys.stderr)


async def _report(conn) -> None:
    rows = await conn.fetch(
        "SELECT filename, applied_at FROM _migrations ORDER BY filename"
    )
    print(f"   _migrations now records {len(rows)} file(s):")
    for r in rows:
        print(f"     · {r['filename']}  @ {r['applied_at']}")


async def main() -> int:
    ap = argparse.ArgumentParser(
        description="Apply pending db/migrations/*.sql to a live GLstore database.",
    )
    ap.add_argument("dsn", nargs="?", default=os.environ.get("DATABASE_URL", ""),
                    help="Postgres connection string (or set DATABASE_URL). "
                         "Use Neon's DIRECT, non-pooled string for DDL.")
    ap.add_argument("--dry-run", action="store_true",
                    help="List what WOULD be applied, write nothing, exit 0.")
    args = ap.parse_args()

    # ── 1. Discovery is pure filesystem — do it before the DSN check so a
    #       broken checkout is reported as such, not as a connection problem.
    migrations = discover_migrations(MIGRATIONS_DIR)
    if not migrations:
        return _fail(f"no migration files found in {MIGRATIONS_DIR}")
    bootstrap = next((m for m in migrations if m.filename == _BOOTSTRAP_FILENAME), None)
    others    = [m for m in migrations if m.filename != _BOOTSTRAP_FILENAME]
    print(f"→ discovered {len(migrations)} migration file(s) in "
          f"{MIGRATIONS_DIR.relative_to(REPO_ROOT)}")

    if not args.dsn:
        return _fail("No connection string. Pass it as an argument or set DATABASE_URL.")

    # asyncpg is imported HERE, not at module scope: everything above is pure
    # stdlib, so a missing DSN or a broken checkout must report itself even on
    # a machine that has never run `pip install asyncpg`. "asyncpg missing" is
    # a confusing answer to "you forgot the connection string".
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
        problem = await _guard_initialized(conn)
        if problem is not None:
            return _fail(problem)
        if args.dry_run:
            return await _dry_run(conn, bootstrap, others)
        return await _apply(conn, bootstrap, others)
    finally:
        await conn.close()


def _fail(msg: str) -> int:
    print(f"✗ {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
