-- ============================================================================
-- Migration 009: contact messages
--
-- WHY THIS EXISTS
-- The storefront has no way for a visitor to reach the shop except a phone
-- number already printed in the footer. A "Contact us" page with no form is
-- honest but incomplete; a form with nowhere to land is the "fake form that
-- doesn't submit anywhere" pattern this project has already flagged once
-- (newsletter_subscribers, migration 008). Same fix, same shape: store the
-- message for real, do not promise a reply channel that does not exist.
--
-- Follows the reviews / newsletter_subscribers pattern from 008: store_id
-- NOT NULL, public write via require_store (Host-resolved), admin read via
-- require_admin_store_for (x-store-id), 404 not 403 across stores.
--
-- Idempotent — safe to re-run.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE contact_message_status_enum AS ENUM ('NEW', 'READ', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contact_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Free text from an anonymous visitor. Capped for the same reason
    -- reviews.body is capped: unbounded text from a public write endpoint is
    -- an abuse surface regardless of what renders it.
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    -- At least one contact channel required, enforced in the API layer
    -- (Pydantic), not here -- a DB CHECK spanning two nullable columns is
    -- brittle and the API is the only writer.
    phone           TEXT CHECK (phone IS NULL OR length(phone) <= 40),
    email           CITEXT CHECK (email IS NULL OR length(email) <= 320),
    message         TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),

    status          contact_message_status_enum NOT NULL DEFAULT 'NEW',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin inbox: newest unread first, per store.
CREATE INDEX IF NOT EXISTS contact_messages_inbox_idx
    ON contact_messages (store_id, created_at DESC) WHERE status = 'NEW';
