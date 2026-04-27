"""
Migration runner — Phase 9 Push 5.

Auto-applies SQL migrations on API startup so a fresh deploy or a
new dev's local stack doesn't have to remember `psql -f db/migrations/...`.

Design choices:

  · **Filename-ordered.** Migrations are zero-padded numeric prefixes
    (`000_`, `001_`, ...). We sort lexicographically; that's well-defined
    for any filename that starts with a 3-digit number.

  · **Bootstrap is itself a migration.** `000_migrations_table.sql`
    creates the tracking table. We run it unconditionally on every boot
    (it's idempotent — `CREATE TABLE IF NOT EXISTS`) BEFORE checking the
    table. After that, every other migration is checked against the
    table and skipped if already applied.

  · **One transaction per migration.** Failure rolls back that specific
    migration without leaving partial state. A failed migration aborts
    the whole run — the API will refuse to start.

  · **Postgres advisory lock.** When the API runs with multiple replicas,
    only one of them should run migrations at a time. `pg_try_advisory_lock`
    is non-blocking; if another instance holds it, we wait briefly then
    skip (assuming the holder finished).

  · **SHA-256 checksum tamper detection.** Once applied, a migration's
    file content is hashed and stored. If a later boot finds the file's
    checksum no longer matches what's recorded, we abort with a clear
    error — "once applied, never edit; create a new migration." This is
    the single most common migration-system foot-gun in the wild.

  · **Plain SQL, no Python migrations.** Every file in `db/migrations/`
    is `.sql`. Simpler than Alembic; works for our scale (5-10 migrations
    over the project's lifetime so far).

Public API:
    await run_pending_migrations(engine, *, migrations_dir=Path("db/migrations"))
        Discover, check, and apply. Idempotent. Holds an advisory lock for
        the duration so multiple replicas don't race.

    list_applied_migrations(db) -> list[dict]
        Read-only audit helper for the Jobs Console / health checks.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import TYPE_CHECKING, Any

# SQLAlchemy is only needed by the apply-side functions, not the pure
# discovery/hash helpers. Importing it lazily through `_text()` lets us
# unit-test discovery + checksums in environments that don't have
# SQLAlchemy installed (e.g. lightweight CI shards).
if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

log = logging.getLogger("glstore.migrations")


def _text(sql: str):
    """Lazy wrapper for sqlalchemy.text — imported here so module-level
    import of api.core.migrations doesn't require SQLAlchemy."""
    from sqlalchemy import text as _sa_text   # local import on purpose
    return _sa_text(sql)


# Stable hash → 64-bit signed int derived from the lock name. Two separate
# Postgres advisory locks namespaces exist — we use the single-int variant
# (pg_try_advisory_lock(bigint)) for simplicity. Picked from a SHA-256 of
# the project name so it's unlikely to collide with anyone else's lock.
_ADVISORY_LOCK_KEY = 0x6C61_6566_6661_6972  # "laeffair" in ASCII (close enough)

_BOOTSTRAP_FILENAME = "000_migrations_table.sql"


# ── Discovery ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Migration:
    filename: str
    path:     Path
    checksum: str    # hex SHA-256 of file content
    sql:      str    # raw text (already read; cheap for our small files)


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def discover_migrations(migrations_dir: Path) -> list[Migration]:
    """List `.sql` files in a directory, ordered by filename. The
    bootstrap (000_*) sorts to the front naturally — no special-casing
    needed at the discovery layer."""
    if not migrations_dir.exists():
        log.warning(
            "migrations dir missing — nothing to apply",
            extra={"path": str(migrations_dir), "event": "migrations.dir_missing"},
        )
        return []
    out: list[Migration] = []
    for p in sorted(migrations_dir.glob("*.sql")):
        raw = p.read_bytes()
        out.append(Migration(
            filename=p.name,
            path=p,
            checksum=_sha256_hex(raw),
            sql=raw.decode("utf-8"),
        ))
    return out


# ── Tracking table I/O ────────────────────────────────────────────────────

async def _exec_script(conn, sql: str) -> None:
    """Run a multi-statement SQL script. Uses the raw asyncpg connection
    because SQLAlchemy's `conn.execute(text(...))` goes through the
    prepared-statement path, which asyncpg refuses for multi-statement
    SQL (`cannot insert multiple commands into a prepared statement`).
    Migrations routinely contain CREATE TABLE + CREATE INDEX + DO blocks
    in one file, so we need the script-execute path."""
    raw = await conn.get_raw_connection()
    # `driver_connection` is the underlying asyncpg.Connection; its
    # `.execute()` accepts arbitrary multi-statement SQL.
    await raw.driver_connection.execute(sql)


async def _ensure_bootstrap(conn, bootstrap: Migration | None) -> None:
    """Run the 000_ bootstrap migration unconditionally. It's idempotent
    (CREATE TABLE IF NOT EXISTS) so re-running on every boot is harmless,
    and it guarantees the tracking table exists before we query it."""
    if bootstrap is None:
        return
    await _exec_script(conn, bootstrap.sql)


async def _list_applied(conn) -> dict[str, str]:
    """Returns { filename → checksum } for everything in `_migrations`."""
    res = await conn.execute(_text(
        "SELECT filename, checksum FROM _migrations ORDER BY filename"
    ))
    return {row[0]: row[1] for row in res.all()}


async def list_applied_migrations(db) -> list[dict[str, Any]]:
    """Read-only audit helper. Surface this from a /jobs or /healthz panel
    if you want to see which migrations are recorded as applied + when."""
    res = await db.execute(_text("""
        SELECT filename, checksum, duration_ms, applied_at
          FROM _migrations
         ORDER BY filename
    """))
    return [
        {
            "filename":    r[0],
            "checksum":    r[1],
            "duration_ms": r[2],
            "applied_at":  r[3].isoformat() if r[3] else None,
        }
        for r in res.all()
    ]


# ── Lock ───────────────────────────────────────────────────────────────────

class MigrationLockBusy(RuntimeError):
    """Another process is already running migrations. We didn't get the
    advisory lock and chose not to block."""


async def _acquire_lock(conn) -> bool:
    """Try to acquire a Postgres advisory lock so multiple API replicas
    don't race. Returns True on acquire, False if another instance holds
    it. The caller should wait + retry or skip."""
    res = await conn.execute(
        _text("SELECT pg_try_advisory_lock(:k)"),
        {"k": _ADVISORY_LOCK_KEY},
    )
    return bool(res.scalar())


async def _release_lock(conn) -> None:
    await conn.execute(
        _text("SELECT pg_advisory_unlock(:k)"),
        {"k": _ADVISORY_LOCK_KEY},
    )


# ── Apply ─────────────────────────────────────────────────────────────────

class MigrationChecksumMismatch(RuntimeError):
    """An already-applied migration's file content has changed since it
    was applied. Refuse to start — this is almost always a footgun
    ("I'll just edit 003_… real quick"), and silently re-running modified
    SQL is much worse than failing loudly here."""


async def _apply_one(conn, m: Migration) -> int:
    """Run one migration in its own transaction. Returns duration in ms."""
    started = monotonic()
    # Begin a SAVEPOINT-style nested transaction so the outer connection
    # can keep going if we want to keep applying after a failure (we
    # don't — but it makes the rollback boundary explicit).
    async with conn.begin_nested():
        # Multi-statement script via raw asyncpg (see _exec_script docstring).
        await _exec_script(conn, m.sql)
        duration_ms = int((monotonic() - started) * 1000)
        # Record + checksum AFTER successful apply, in the same tx.
        # Single-statement INSERT — SQLAlchemy's prepared-statement path
        # is fine here (and gives us safe parameter binding).
        await conn.execute(_text("""
            INSERT INTO _migrations (filename, checksum, duration_ms, applied_at)
                 VALUES (:fn, :cs, :dur, NOW())
            ON CONFLICT (filename) DO NOTHING
        """), {"fn": m.filename, "cs": m.checksum, "dur": duration_ms})
    return duration_ms


# ── Public entry point ────────────────────────────────────────────────────

@dataclass
class MigrationReport:
    discovered: int            # total *.sql files found
    skipped:    int            # already applied with matching checksum
    applied:    list[str]      # filenames applied this round
    duration_ms: int           # whole-run duration


async def run_pending_migrations(
    engine: AsyncEngine,
    *,
    migrations_dir: Path | None = None,
    lock_wait_seconds: float = 30.0,
) -> MigrationReport:
    """Discover and apply pending migrations. Holds an advisory lock for
    the duration so multiple API replicas don't race.

    Behaviour matrix:
      · Lock free            → run; return report
      · Lock taken            → wait up to `lock_wait_seconds`, retry
                                every 1s; if still taken, raise
                                MigrationLockBusy. Caller can decide to
                                fail-fast or proceed without migrations.
      · Tampered file         → raise MigrationChecksumMismatch with the
                                offending filename; refuse to start.
      · SQL error in a file   → SQLAlchemy raises; we let it propagate so
                                container orchestration can crash + alert.
    """
    started = monotonic()
    if migrations_dir is None:
        # Default to repo-root/db/migrations/ relative to this module.
        # In Docker we mount /app and run from there.
        migrations_dir = Path(__file__).resolve().parents[2] / "db" / "migrations"

    migrations = discover_migrations(migrations_dir)
    bootstrap  = next((m for m in migrations if m.filename == _BOOTSTRAP_FILENAME), None)
    others     = [m for m in migrations if m.filename != _BOOTSTRAP_FILENAME]

    # Open ONE connection for the whole run so the advisory lock + the
    # apply loop share the same session (advisory locks are session-scoped).
    async with engine.begin() as conn:
        # Try to grab the lock with a short retry loop. We don't use
        # pg_advisory_lock (blocking) because we want a clear timeout
        # rather than indefinite waits.
        deadline = monotonic() + lock_wait_seconds
        got = await _acquire_lock(conn)
        while not got and monotonic() < deadline:
            log.info(
                "migration lock busy; waiting…",
                extra={"event": "migrations.lock.waiting"},
            )
            await asyncio.sleep(1.0)
            got = await _acquire_lock(conn)
        if not got:
            raise MigrationLockBusy(
                f"another process held the migration lock for {lock_wait_seconds:.0f}s"
            )

        try:
            # 1) Bootstrap — idempotent, always run.
            await _ensure_bootstrap(conn, bootstrap)

            # 2) Read the applied table so we can skip + detect tampering.
            applied = await _list_applied(conn)

            # If the bootstrap was discovered, record it as applied (it
            # ran above; treat as belonging to the tracked set). Otherwise
            # admins might wonder why 000_ never appears in _migrations.
            if bootstrap is not None and bootstrap.filename not in applied:
                await conn.execute(_text("""
                    INSERT INTO _migrations (filename, checksum, duration_ms, applied_at)
                         VALUES (:fn, :cs, 0, NOW())
                    ON CONFLICT (filename) DO NOTHING
                """), {"fn": bootstrap.filename, "cs": bootstrap.checksum})
                applied[bootstrap.filename] = bootstrap.checksum

            # 3) For each non-bootstrap migration, decide skip vs. apply.
            skipped = 0
            applied_now: list[str] = []
            for m in others:
                prev = applied.get(m.filename)
                if prev is not None:
                    if prev != m.checksum:
                        raise MigrationChecksumMismatch(
                            f"{m.filename} content has changed since it was applied "
                            f"(stored={prev[:12]}… vs file={m.checksum[:12]}…). "
                            f"Migrations are immutable once applied — create a new "
                            f"migration file instead of editing this one."
                        )
                    skipped += 1
                    continue
                dur = await _apply_one(conn, m)
                applied_now.append(m.filename)
                log.info(
                    "applied migration",
                    extra={
                        # NB: don't use "filename" — it collides with the
                        # reserved LogRecord attribute and Python's
                        # logging module raises KeyError. Same for "module"
                        # and "name".
                        "migration": m.filename,
                        "duration_ms": dur,
                        "event": "migrations.applied",
                    },
                )
        finally:
            try:
                await _release_lock(conn)
            except Exception:                                       # noqa: BLE001
                # If unlock fails (e.g. connection dropped) Postgres
                # cleans the lock when the session ends. Log but don't
                # mask the original error.
                log.warning(
                    "advisory unlock failed",
                    extra={"event": "migrations.unlock.failed"},
                )

    duration_ms = int((monotonic() - started) * 1000)
    report = MigrationReport(
        discovered=len(migrations),
        skipped=skipped,
        applied=applied_now,
        duration_ms=duration_ms,
    )
    log.info(
        "migrations check complete",
        extra={
            "discovered":  report.discovered,
            "skipped":     report.skipped,
            "applied":     report.applied,
            "duration_ms": report.duration_ms,
            "event":       "migrations.check_complete",
        },
    )
    return report
