-- ============================================================================
-- Migration 000: _migrations tracking table
-- Phase 9 Push 5 — auto-apply migrations on API startup.
--
-- This is THE bootstrap migration. The runner (`api/core/migrations.py`)
-- calls this file unconditionally before checking the table — that way a
-- DB at any starting state ends up with the table present.
--
-- Convention:
--   filename     — the migration's basename, e.g. '001_app_settings.sql'.
--                  Runner orders by filename (zero-padded numeric prefix).
--   checksum     — SHA-256 of the file content at the time of application.
--                  Lets the runner detect tampering ("once applied, never
--                  edit a migration") and refuse to start, instead of
--                  silently running modified SQL.
--   duration_ms  — for ops visibility ("which migration is slow?")
--   applied_at   — defaults to NOW(); UNIQUE on filename so we can't
--                  double-record.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS _migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    duration_ms INTEGER,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful for "show me everything applied in the last hour" sort of queries
CREATE INDEX IF NOT EXISTS _migrations_applied_at_idx
    ON _migrations(applied_at DESC);
