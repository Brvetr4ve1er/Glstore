"""
Migration CLI — Phase 9 Push 5.

Run pending migrations from the host shell. Useful for:
  · Applying migrations against a remote database before deploying
    new application code.
  · Smoke-testing a migration in isolation.
  · CI pipelines that want to gate `pytest` behind a migrated DB.

Usage:
    python -m scripts.migrate              # apply all pending
    python -m scripts.migrate --status     # list applied + pending, no writes
    python -m scripts.migrate --check      # exit 1 if any are pending (CI gate)

Environment:
    DATABASE_URL   — pulled from api.core.config (which reads .env).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from api.core.db import engine
from api.core.logging import setup_logging
from api.core.migrations import (
    MigrationChecksumMismatch, MigrationLockBusy,
    discover_migrations, list_applied_migrations, run_pending_migrations,
)


def _migrations_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "db" / "migrations"


async def _cmd_status() -> int:
    discovered = discover_migrations(_migrations_dir())
    from api.core.db import SessionLocal
    async with SessionLocal() as db:
        try:
            applied = await list_applied_migrations(db)
        except Exception as exc:                                    # noqa: BLE001
            print(f"could not read _migrations table: {exc}", file=sys.stderr)
            print("(this is normal on a fresh DB — run without --status to bootstrap)")
            return 0
    applied_by_name = {a["filename"]: a for a in applied}
    print(f"\n{len(discovered)} migration(s) discovered, {len(applied)} applied:\n")
    print(f"  {'FILENAME':<40} {'STATUS':<10} {'APPLIED AT':<28}")
    print(f"  {'-' * 40} {'-' * 10} {'-' * 28}")
    for m in discovered:
        rec = applied_by_name.get(m.filename)
        if rec is None:
            status, ts = "PENDING", "—"
        elif rec["checksum"] != m.checksum:
            status, ts = "TAMPERED", str(rec["applied_at"])
        else:
            status, ts = "applied", str(rec["applied_at"])
        print(f"  {m.filename:<40} {status:<10} {ts:<28}")
    return 0


async def _cmd_check() -> int:
    """Exit 0 iff every discovered migration is in _migrations. For CI."""
    discovered = discover_migrations(_migrations_dir())
    from api.core.db import SessionLocal
    async with SessionLocal() as db:
        try:
            applied = await list_applied_migrations(db)
        except Exception:
            print("FAIL: _migrations table missing — at least the bootstrap is pending", file=sys.stderr)
            return 1
    applied_set = {a["filename"] for a in applied}
    pending = [m.filename for m in discovered if m.filename not in applied_set]
    if pending:
        print(f"FAIL: {len(pending)} migration(s) pending:", file=sys.stderr)
        for p in pending:
            print(f"  · {p}", file=sys.stderr)
        return 1
    print(f"OK: all {len(discovered)} migration(s) applied")
    return 0


async def _cmd_run() -> int:
    try:
        report = await run_pending_migrations(engine, migrations_dir=_migrations_dir())
    except MigrationChecksumMismatch as exc:
        print(f"REFUSING TO RUN: {exc}", file=sys.stderr)
        return 2
    except MigrationLockBusy as exc:
        print(f"another process is migrating: {exc}", file=sys.stderr)
        return 3
    finally:
        await engine.dispose()
    if report.applied:
        print(f"applied {len(report.applied)} migration(s) in {report.duration_ms}ms:")
        for f in report.applied:
            print(f"  ✓ {f}")
    else:
        print(f"all {report.discovered} migration(s) up to date ({report.skipped} already applied)")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply pending DB migrations")
    parser.add_argument("--status", action="store_true",
                        help="show applied vs pending, no writes")
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if any are pending; for CI gating")
    args = parser.parse_args()

    setup_logging(component="migrate-cli")

    if args.status:
        sys.exit(asyncio.run(_cmd_status()))
    if args.check:
        sys.exit(asyncio.run(_cmd_check()))
    sys.exit(asyncio.run(_cmd_run()))


if __name__ == "__main__":
    main()
