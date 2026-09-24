-- ============================================================================
-- Migration 014: partners — point-of-sale applications, partners, locations
--
-- Phase E of docs/superpowers/plans/amantcom-financing.md.
--
-- A shop applies through the public form (POST /partners/apply); an admin
-- approves or refuses it; approval creates the partner and its first
-- location in one transaction. Store-scoped throughout, composite FKs pin
-- every row to its brand.
--
-- Deliberately absent:
--   · No uniqueness on the applicant's phone. Refusing a second application
--     would tell anyone who types a number whether that shop already applied.
--     Duplicates land; the admin queue shows how many came from that phone.
--   · No commune codes. The blueprint's "auto commune code" needs reference
--     data this platform does not have; it is left out rather than invented.
--   · No partner rows. None ship; every partner is an approved application.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- Factual shop-type vocabulary (like employment_type_enum), not a policy.
DO $$ BEGIN
    CREATE TYPE partner_activity_enum AS ENUM
        ('ELECTROMENAGER','MULTIMEDIA','MEUBLE','GENERALISTE','AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE partner_application_status_enum AS ENUM
        ('NEW','UNDER_REVIEW','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- PARTNERS — created only by approving an application
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    activity        partner_activity_enum NOT NULL,
    contact_name    TEXT NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
    phone           TEXT NOT NULL CHECK (length(phone) BETWEEN 6 AND 30),
    email           CITEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 320),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT partners_store_id_id_key UNIQUE (store_id, id)
);

CREATE TABLE IF NOT EXISTS partner_locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    partner_id      UUID NOT NULL,
    wilaya_code     CHAR(2) NOT NULL CHECK (wilaya_code ~ '^(0[1-9]|[1-4][0-9]|5[0-8])$'),
    commune         TEXT NOT NULL CHECK (length(commune) BETWEEN 1 AND 120),
    address         TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 300),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT partner_locations_partner_in_same_store
        FOREIGN KEY (store_id, partner_id)
        REFERENCES partners (store_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS partner_locations_partner_idx
    ON partner_locations (store_id, partner_id);


-- ---------------------------------------------------------------------------
-- APPLICATIONS — anonymous, public
-- ---------------------------------------------------------------------------
--
-- Every text field is capped: this is free text from an anonymous endpoint.
-- Any UI that renders it must treat it as plain text (see contact.py).

CREATE TABLE IF NOT EXISTS partner_applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    business_name       TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 160),
    activity            partner_activity_enum NOT NULL,
    contact_name        TEXT NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
    owner_name          TEXT CHECK (owner_name IS NULL OR length(owner_name) BETWEEN 1 AND 120),
    phone               TEXT NOT NULL CHECK (length(phone) BETWEEN 6 AND 30),
    phone_normalized    TEXT NOT NULL CHECK (phone_normalized ~ '^[0-9]{8,20}$'),
    email               CITEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 320),
    wilaya_code         CHAR(2) NOT NULL CHECK (wilaya_code ~ '^(0[1-9]|[1-4][0-9]|5[0-8])$'),
    commune             TEXT NOT NULL CHECK (length(commune) BETWEEN 1 AND 120),
    address             TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 300),
    reason              TEXT CHECK (reason IS NULL OR length(reason) <= 2000),

    status              partner_application_status_enum NOT NULL DEFAULT 'NEW',
    review_note         TEXT CHECK (review_note IS NULL OR length(review_note) <= 2000),
    reviewed_by         UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    partner_id          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT partner_applications_partner_in_same_store
        FOREIGN KEY (store_id, partner_id)
        REFERENCES partners (store_id, id) ON DELETE RESTRICT,
    -- An approved application always names its partner, and only then.
    CONSTRAINT partner_applications_partner_iff_approved
        CHECK ((status = 'APPROVED') = (partner_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS partner_applications_queue_idx
    ON partner_applications (store_id, status, created_at);
CREATE INDEX IF NOT EXISTS partner_applications_phone_idx
    ON partner_applications (store_id, phone_normalized);
