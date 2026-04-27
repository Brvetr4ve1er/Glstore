-- ============================================================================
-- Migration 001: app_settings
-- Phase 4 — LLM enrichment shared configuration store.
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID
);

-- Seed the LLM config row so endpoints have something to read on first boot.
INSERT INTO app_settings (key, value)
VALUES (
    'llm.config',
    '{
        "kind": "ollama",
        "endpoint": "http://host.docker.internal:11434",
        "model": "llama3.1:8b",
        "api_key": "",
        "temperature": 0.1,
        "max_tokens": 2048,
        "timeout_seconds": 90,
        "json_mode": true
    }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
