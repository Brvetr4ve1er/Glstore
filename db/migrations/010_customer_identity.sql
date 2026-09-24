-- ============================================================================
-- Migration 010: customer identity — phone OTP challenges and sessions
--
-- Phase A of docs/superpowers/plans/amantcom-financing.md. (The plan calls this
-- "migration 009"; 009 was taken by contact_messages first.)
--
-- Identity is phone-first and `customers` is already the anchor: migration 005
-- made it unique on (store_id, phone_normalized). Nothing here adds a parallel
-- `users` table. A shopper who checked out with COD and later verifies the same
-- phone becomes the account holder of the orders they already placed, because
-- the row was always theirs.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. customers: a verified shopper may not have given a name yet
-- ---------------------------------------------------------------------------
--
-- Until now every customer row was created by a COD checkout, which always
-- carries a name. Verifying a phone is the first way to become a customer
-- WITHOUT ordering, and there is no honest value to put in full_name then.
-- NULL means "not given yet"; the first checkout fills it (see
-- `_upsert_customer` in api/services/orders.py). Orders keep no name of their
-- own, so an empty-string placeholder would reach the delivery slip.
--
-- Relaxing NOT NULL cannot fail on existing data.
ALTER TABLE customers ALTER COLUMN full_name DROP NOT NULL;

-- When the phone on this row was last proven to belong to the person using it.
-- Financing (Phase B) must bind an application to a verified phone; a phone
-- typed into a COD form proves nothing.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Target for the composite FK on customer_sessions below. `id` is the primary
-- key, so (store_id, id) is unique by construction — this only makes it
-- addressable. Same move migration 008 made on products.
DO $$ BEGIN
    ALTER TABLE customers ADD CONSTRAINT customers_store_id_id_key UNIQUE (store_id, id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. OTP CHALLENGES
-- ---------------------------------------------------------------------------
--
-- One row per code SENT. The table doubles as the throttle ledger: the API runs
-- serverless, where an in-memory counter resets with every new instance, so
-- "how many codes went to this phone in the last hour" has to be a query, not
-- a dict. That is also why there is no separate rate-limit table.
--
-- No FK to customers: the phone may not belong to a customer yet — verifying
-- it is how it becomes one.
--
-- code_hash is bcrypt, never the code. requester_ip_hash is an HMAC of the
-- client address: enough to count sends per address, not enough to recover
-- the address from a database dump.

CREATE TABLE IF NOT EXISTS otp_challenges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    phone_normalized    TEXT NOT NULL CHECK (phone_normalized ~ '^[0-9]{6,20}$'),
    code_hash           TEXT NOT NULL,
    requester_ip_hash   TEXT,
    attempts            SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Latest challenge for this phone" (verify) and "sends to this phone in the
-- last hour" (request) both walk this index newest-first.
CREATE INDEX IF NOT EXISTS otp_challenges_phone_recent_idx
    ON otp_challenges (store_id, phone_normalized, created_at DESC);

-- Per-address send cap. Partial: rows from an unknown address never count.
CREATE INDEX IF NOT EXISTS otp_challenges_ip_recent_idx
    ON otp_challenges (requester_ip_hash, created_at DESC)
    WHERE requester_ip_hash IS NOT NULL;

-- Per-store hourly ceiling — the cost backstop when an attacker rotates both
-- phone numbers and addresses.
CREATE INDEX IF NOT EXISTS otp_challenges_store_recent_idx
    ON otp_challenges (store_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. CUSTOMER SESSIONS
-- ---------------------------------------------------------------------------
--
-- Opaque bearer tokens, stored as SHA-256. Not JWTs, deliberately: the admin
-- console already trusts any JWT signed with JWT_SECRET whose type is
-- "access", and a customer token must never be one mis-set claim away from
-- being accepted there. An opaque token also revokes instantly (logout sets
-- revoked_at) instead of living until its `exp`.
--
-- SHA-256 rather than bcrypt because the token carries 256 bits of entropy and
-- has to be found by equality lookup on every request; a salted hash cannot be.
--
-- The composite FK pins a session to its customer's brand in the schema: a
-- session whose store_id disagrees with its customer's store_id cannot be
-- inserted by any code path.

CREATE TABLE IF NOT EXISTS customer_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    customer_id     UUID NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT customer_sessions_customer_in_same_store
        FOREIGN KEY (store_id, customer_id)
        REFERENCES customers (store_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx
    ON customer_sessions (store_id, customer_id);


-- ---------------------------------------------------------------------------
-- 4. RETENTION
-- ---------------------------------------------------------------------------
--
-- Throttle windows look back one hour, so a challenge older than a day can
-- never influence a decision again. Sessions are kept a day past expiry or
-- revocation, then dropped. Called from GET /internal/cron/maintenance?prune=true.

CREATE OR REPLACE FUNCTION fn_prune_identity() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    n_challenges INTEGER;
    n_sessions   INTEGER;
BEGIN
    DELETE FROM otp_challenges
     WHERE created_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS n_challenges = ROW_COUNT;

    DELETE FROM customer_sessions
     WHERE expires_at < NOW() - INTERVAL '1 day'
        OR revoked_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS n_sessions = ROW_COUNT;

    RETURN n_challenges + n_sessions;
END;
$$;
