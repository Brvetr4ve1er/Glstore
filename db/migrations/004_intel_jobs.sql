-- ============================================================================
-- Migration 004: intel_jobs
-- The unified Full-Intel pipeline (scrape + LLM + merge) needs its own queue
-- because it has different lifecycle metadata than scrape_jobs.
-- Idempotent — safe to re-run.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE intel_status_enum AS ENUM (
        'PENDING','CLAIMED','RUNNING','COMPLETED','FAILED','CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS intel_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    status          intel_status_enum NOT NULL DEFAULT 'PENDING',
    -- Bulk-batch grouping: jobs created together share batch_id so the UI can
    -- show "47 / 160 done in current run" type progress.
    batch_id        UUID,
    -- Snapshot of the LLM cfg used for this run (for audit if cfg changes mid-batch).
    llm_kind        TEXT,
    llm_model       TEXT,
    -- Outcome
    fields_filled   TEXT[],
    images_added    INTEGER NOT NULL DEFAULT 0,
    completeness_before NUMERIC(4,3),
    completeness_after  NUMERIC(4,3),
    status_after        TEXT,
    duration_ms         INTEGER,
    -- Lifecycle
    claimed_by      TEXT,
    claimed_at      TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    raw_payload     JSONB,             -- the LLM JSON, kept for audit
    scrape_summary  JSONB,             -- summary of the scrape sub-job
    retry_count     INTEGER NOT NULL DEFAULT 0,
    requested_by    UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_jobs_status_idx
    ON intel_jobs(status, created_at)
    WHERE status IN ('PENDING','CLAIMED','RUNNING');

CREATE INDEX IF NOT EXISTS intel_jobs_product_idx
    ON intel_jobs(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS intel_jobs_batch_idx
    ON intel_jobs(batch_id, status)
    WHERE batch_id IS NOT NULL;
