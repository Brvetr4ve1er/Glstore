-- ============================================================================
-- Migration 002: Scraper engine — Phase 5
-- Multi-tier scrape jobs, per-source granular results, and a price time-series.
-- Idempotent — safe to re-run.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE scrape_status_enum AS ENUM (
        'PENDING','CLAIMED','RUNNING','COMPLETED','FAILED','CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per scrape request (the job queue).
CREATE TABLE IF NOT EXISTS scrape_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    status          scrape_status_enum NOT NULL DEFAULT 'PENDING',
    max_sources     INTEGER NOT NULL DEFAULT 6 CHECK (max_sources BETWEEN 1 AND 20),
    intents         TEXT[] NOT NULL DEFAULT ARRAY['commercial','technical','review'],
    expected_price  NUMERIC(12,2),                 -- our retail, used for sanity-bounds
    claimed_by      TEXT,
    claimed_at      TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    summary         JSONB,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    requested_by    UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scrape_jobs_status_idx
    ON scrape_jobs(status, created_at)
    WHERE status IN ('PENDING','CLAIMED','RUNNING');

CREATE INDEX IF NOT EXISTS scrape_jobs_product_idx
    ON scrape_jobs(product_id, created_at DESC);


-- Granular per-source result, queryable forever.
CREATE TABLE IF NOT EXISTS scrape_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    domain          TEXT NOT NULL,
    tier            TEXT NOT NULL,                    -- 'official'|'retailer'|'review'|'general'
    intent          TEXT,                              -- 'commercial'|'technical'|'review'
    fetch_tier      INTEGER,                           -- 1=httpx, 2=playwright, 3=stealth, 4=paid
    fetch_engine    TEXT,                              -- friendly tag
    fetch_ms        INTEGER,
    http_status     INTEGER,
    title           TEXT,
    snippet         TEXT,
    extracted       JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5
                    CHECK (confidence BETWEEN 0 AND 1),
    error_message   TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scrape_sources_job_idx
    ON scrape_sources(job_id);

CREATE INDEX IF NOT EXISTS scrape_sources_domain_idx
    ON scrape_sources(domain, fetched_at DESC);


-- Append-only price observations (the time series we chart against).
CREATE TABLE IF NOT EXISTS competitor_prices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    source_domain   TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    price           NUMERIC(12,2) NOT NULL CHECK (price > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'DZD',
    availability    TEXT,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scrape_job_id   UUID REFERENCES scrape_jobs(id) ON DELETE SET NULL,
    -- Idempotent on (product, domain, day): re-runs collapse, time series stays clean.
    CONSTRAINT competitor_prices_unique_per_day
        UNIQUE (product_id, source_domain, observed_at)
);

CREATE INDEX IF NOT EXISTS competitor_prices_product_idx
    ON competitor_prices(product_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS competitor_prices_domain_idx
    ON competitor_prices(source_domain, observed_at DESC);


-- Per-domain rate-limit & robots.txt cache (worker-private but persists across restarts).
CREATE TABLE IF NOT EXISTS scrape_domain_state (
    domain              TEXT PRIMARY KEY,
    last_request_at     TIMESTAMPTZ,
    blocked_until       TIMESTAMPTZ,
    block_reason        TEXT,
    robots_txt          TEXT,
    robots_fetched_at   TIMESTAMPTZ,
    success_count       INTEGER NOT NULL DEFAULT 0,
    failure_count       INTEGER NOT NULL DEFAULT 0,
    avg_fetch_ms        INTEGER,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Seed scraper config in app_settings if absent.
INSERT INTO app_settings (key, value)
VALUES (
    'scraper.config',
    '{
        "searxng_url": "http://searxng:8080",
        "ddg_fallback_enabled": true,
        "brave_api_key": "",
        "max_sources_per_product": 6,
        "max_concurrent_fetches": 3,
        "per_domain_rate_limit_seconds": 2,
        "per_job_timeout_seconds": 90,
        "cache_ttl_hours_official": 24,
        "cache_ttl_hours_retailer": 6,
        "cache_ttl_hours_classified": 2,
        "user_agent": "GhirLaffaireBot/1.0 (+https://ghirlaffaire.dz/bot)",
        "tier4_enabled": false,
        "tier4_provider": "",
        "tier4_api_key": "",
        "min_confidence_for_price": 0.6,
        "price_outlier_low_factor": 0.3,
        "price_outlier_high_factor": 2.5,
        "margin_alert_threshold_pct": 0.10
    }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
