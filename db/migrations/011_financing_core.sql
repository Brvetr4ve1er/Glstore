-- ============================================================================
-- Migration 011: financing core — versioned rules, simulations, applications
--
-- Phase B of docs/superpowers/plans/amantcom-financing.md.
--
-- Store-scoped throughout (plan, Decision 3): brand A's credit book is
-- invisible to brand B. Every table carries store_id NOT NULL, and every
-- reference to another store-scoped row is a COMPOSITE foreign key, so a
-- cross-brand link is unrepresentable rather than merely checked.
--
-- SHIPS NO RULE. Durations, markups, bounds, down payment and debt ratio are
-- business terms the operator supplies through the admin API. Until one is
-- activated, financing is simply unavailable.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE financing_rule_status_enum AS ENUM ('DRAFT','ACTIVE','RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The plan's status machine. Only DRAFT is reachable in Phase B; the
-- transitions after it belong to the Phase C review workflow.
DO $$ BEGIN
    CREATE TYPE application_status_enum AS ENUM
        ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','SIGNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE application_actor_enum AS ENUM ('CUSTOMER','ADMIN','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. FK TARGETS
-- ---------------------------------------------------------------------------
--
-- (store_id, product_id, id) on offers lets an application line pin BOTH its
-- brand and its product to the offer: a line cannot name one product while
-- pricing another product's offer. `id` is the primary key, so the triple is
-- unique by construction.
DO $$ BEGIN
    ALTER TABLE offers ADD CONSTRAINT offers_store_product_id_key UNIQUE (store_id, product_id, id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 3. FINANCING RULES — versioned, and frozen once written
-- ---------------------------------------------------------------------------
--
-- An application must forever reference the terms it was evaluated under, so
-- a rule's terms are never edited: a change is a new version. At most one
-- version per store is ACTIVE; activating one retires the previous.
--
-- terms: [{"months": 12, "markup_pct": "5.00"}, ...] — markup as a string so
-- no float ever touches a credit figure.

CREATE TABLE IF NOT EXISTS financing_rules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id                UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    version                 INTEGER NOT NULL CHECK (version > 0),
    status                  financing_rule_status_enum NOT NULL DEFAULT 'DRAFT',

    min_financed            NUMERIC(12,2) NOT NULL CHECK (min_financed > 0),
    max_financed            NUMERIC(12,2) NOT NULL,
    min_down_payment_pct    NUMERIC(5,2)  NOT NULL
                            CHECK (min_down_payment_pct >= 0 AND min_down_payment_pct < 100),
    max_debt_ratio_pct      NUMERIC(5,2)
                            CHECK (max_debt_ratio_pct IS NULL
                                   OR (max_debt_ratio_pct > 0 AND max_debt_ratio_pct <= 100)),
    terms                   JSONB NOT NULL
                            CHECK (jsonb_typeof(terms) = 'array' AND jsonb_array_length(terms) > 0),

    -- Internal only; never served publicly.
    notes                   TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
    created_by              UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at            TIMESTAMPTZ,
    retired_at              TIMESTAMPTZ,

    CONSTRAINT financing_rules_bounds CHECK (max_financed >= min_financed),
    CONSTRAINT financing_rules_store_version_key UNIQUE (store_id, version),
    CONSTRAINT financing_rules_store_id_id_key UNIQUE (store_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS financing_rules_one_active_per_store
    ON financing_rules (store_id) WHERE status = 'ACTIVE';


-- The freeze, in the schema rather than in the API: no code path — including
-- an ad-hoc UPDATE from a console — can rewrite the terms an application was
-- priced under. created_by and notes stay mutable (an admin account can be
-- deleted; an internal note can be corrected).
CREATE OR REPLACE FUNCTION fn_financing_rules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'financing rule v% has been live and cannot be deleted', OLD.version;
        END IF;
        RETURN OLD;
    END IF;

    IF (NEW.store_id, NEW.version, NEW.min_financed, NEW.max_financed,
        NEW.min_down_payment_pct, NEW.max_debt_ratio_pct, NEW.terms, NEW.created_at)
       IS DISTINCT FROM
       (OLD.store_id, OLD.version, OLD.min_financed, OLD.max_financed,
        OLD.min_down_payment_pct, OLD.max_debt_ratio_pct, OLD.terms, OLD.created_at)
    THEN
        RAISE EXCEPTION 'financing rule terms are immutable; create a new version';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'DRAFT'  AND NEW.status = 'ACTIVE')
        OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED')
    ) THEN
        RAISE EXCEPTION 'illegal financing rule transition % -> %', OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financing_rules_guard ON financing_rules;
CREATE TRIGGER financing_rules_guard
    BEFORE UPDATE OR DELETE ON financing_rules
    FOR EACH ROW EXECUTE FUNCTION fn_financing_rules_guard();


-- ---------------------------------------------------------------------------
-- 4. SIMULATIONS — what figure was shown, under which rule
-- ---------------------------------------------------------------------------
--
-- Anonymous. Kept because "which estimate did a shopper see, and under which
-- rule version" is exactly what a compliance review asks (plan, Phase F).
-- request holds the server-resolved lines (prices snapshotted), not what the
-- client sent.

CREATE TABLE IF NOT EXISTS financing_simulations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    rule_id         UUID NOT NULL,
    request         JSONB NOT NULL,
    decision        JSONB NOT NULL,
    eligible        BOOLEAN NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT financing_simulations_rule_in_same_store
        FOREIGN KEY (store_id, rule_id)
        REFERENCES financing_rules (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS financing_simulations_store_recent_idx
    ON financing_simulations (store_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 5. APPLICATIONS
-- ---------------------------------------------------------------------------
--
-- The figures are a SNAPSHOT of the engine's decision at creation. A later
-- price change or rule version must not move a credit decision already made.
-- The CHECKs restate the engine's arithmetic, so a row whose numbers do not
-- add up cannot be stored whatever wrote it.

CREATE TABLE IF NOT EXISTS applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID NOT NULL,
    reference           TEXT NOT NULL UNIQUE,
    customer_id         UUID NOT NULL,
    rule_id             UUID NOT NULL,
    status              application_status_enum NOT NULL DEFAULT 'DRAFT',

    cash_total          NUMERIC(12,2) NOT NULL CHECK (cash_total > 0),
    down_payment        NUMERIC(12,2) NOT NULL CHECK (down_payment >= 0),
    financed_amount     NUMERIC(12,2) NOT NULL CHECK (financed_amount > 0),
    markup_amount       NUMERIC(12,2) NOT NULL CHECK (markup_amount >= 0),
    total_repayable     NUMERIC(12,2) NOT NULL,
    duration_months     SMALLINT NOT NULL CHECK (duration_months > 0),
    monthly_instalment  NUMERIC(12,2) NOT NULL CHECK (monthly_instalment > 0),
    decision            JSONB NOT NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at        TIMESTAMPTZ,

    CONSTRAINT applications_amounts_add_up CHECK (
            financed_amount = cash_total - down_payment
        AND total_repayable = financed_amount + markup_amount
    ),
    -- The displayed instalment is the largest; the schedule differs by at most
    -- a centime per month.
    CONSTRAINT applications_instalment_matches_total CHECK (
            monthly_instalment * duration_months >= total_repayable
        AND monthly_instalment * duration_months <  total_repayable + duration_months * 0.01
    ),
    CONSTRAINT applications_customer_in_same_store
        FOREIGN KEY (store_id, customer_id)
        REFERENCES customers (store_id, id) ON DELETE RESTRICT,
    CONSTRAINT applications_rule_in_same_store
        FOREIGN KEY (store_id, rule_id)
        REFERENCES financing_rules (store_id, id) ON DELETE RESTRICT,
    CONSTRAINT applications_store_id_id_key UNIQUE (store_id, id)
);

CREATE INDEX IF NOT EXISTS applications_customer_idx
    ON applications (store_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_status_idx
    ON applications (store_id, status, created_at DESC);


CREATE TABLE IF NOT EXISTS application_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    application_id  UUID NOT NULL,
    product_id      UUID NOT NULL,
    offer_id        UUID NOT NULL,
    product_name    TEXT NOT NULL,
    variant_sku     TEXT NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    quantity        INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100),
    line_total      NUMERIC(12,2) NOT NULL,

    CONSTRAINT application_items_line_total CHECK (line_total = unit_price * quantity),
    CONSTRAINT application_items_application_in_same_store
        FOREIGN KEY (store_id, application_id)
        REFERENCES applications (store_id, id) ON DELETE RESTRICT,
    CONSTRAINT application_items_product_in_same_store
        FOREIGN KEY (store_id, product_id)
        REFERENCES products (store_id, id) ON DELETE RESTRICT,
    CONSTRAINT application_items_offer_of_that_product
        FOREIGN KEY (store_id, product_id, offer_id)
        REFERENCES offers (store_id, product_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS application_items_application_idx
    ON application_items (store_id, application_id);


-- ---------------------------------------------------------------------------
-- 6. STATUS EVENTS — append-only
-- ---------------------------------------------------------------------------
--
-- An audit trail is not optional for credit decisions. Rows are never updated
-- or deleted; the trigger makes that true for every code path. Consequently an
-- application with history is never hard-deleted either (RESTRICT above).

CREATE TABLE IF NOT EXISTS application_status_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    application_id  UUID NOT NULL,
    from_status     application_status_enum,
    to_status       application_status_enum NOT NULL,
    actor_type      application_actor_enum NOT NULL,
    actor_id        UUID,
    note            TEXT CHECK (note IS NULL OR length(note) <= 2000),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT application_status_events_application_in_same_store
        FOREIGN KEY (store_id, application_id)
        REFERENCES applications (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS application_status_events_application_idx
    ON application_status_events (store_id, application_id, created_at);

CREATE OR REPLACE FUNCTION fn_application_status_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'application_status_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS application_status_events_append_only ON application_status_events;
CREATE TRIGGER application_status_events_append_only
    BEFORE UPDATE OR DELETE ON application_status_events
    FOR EACH ROW EXECUTE FUNCTION fn_application_status_events_append_only();
