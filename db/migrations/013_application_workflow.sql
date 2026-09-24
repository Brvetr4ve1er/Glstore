-- ============================================================================
-- Migration 013: application workflow — profiles, documents, review
--
-- Phase C of docs/superpowers/plans/amantcom-financing.md.
--
--   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED,  APPROVED → SIGNED
--
-- The legal transitions, the frozen figures, and "a submitted file can no
-- longer be edited" are enforced here by triggers, not only by the API: a
-- credit file must mean the same thing whatever code path touched it.
--
-- Ships no required documents: which documents a lender asks for is the
-- operator's (regulatory) call. With none configured, nothing is required.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------

-- Factual vocabulary of Algerian employment, not a credit policy.
DO $$ BEGIN
    CREATE TYPE employment_type_enum AS ENUM
        ('CDI','CDD','FONCTIONNAIRE','INDEPENDANT','RETRAITE','AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE document_review_status_enum AS ENUM ('UPLOADED','ACCEPTED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. APPLICATIONS — review columns, and the guard
-- ---------------------------------------------------------------------------

-- The affordability verdict computed at submission, with the declared
-- profile. Kept apart from `decision` (the draft record) so neither
-- overwrites the other.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS submission_decision JSONB;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
-- Internal. What a customer is told about a refusal is operator-approved copy.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 2000);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
-- No e-signature provider (plan: "not in this pass"). The operator may record
-- the SHA-256 of the signed contract file.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS signature_sha256 TEXT
    CHECK (signature_sha256 IS NULL OR signature_sha256 ~ '^[0-9a-f]{64}$');


CREATE OR REPLACE FUNCTION fn_applications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'applications are part of the credit record and are never deleted';
    END IF;

    IF (NEW.store_id, NEW.reference, NEW.customer_id, NEW.rule_id,
        NEW.cash_total, NEW.down_payment, NEW.financed_amount, NEW.markup_amount,
        NEW.total_repayable, NEW.duration_months, NEW.monthly_instalment,
        NEW.decision, NEW.created_at)
       IS DISTINCT FROM
       (OLD.store_id, OLD.reference, OLD.customer_id, OLD.rule_id,
        OLD.cash_total, OLD.down_payment, OLD.financed_amount, OLD.markup_amount,
        OLD.total_repayable, OLD.duration_months, OLD.monthly_instalment,
        OLD.decision, OLD.created_at)
    THEN
        RAISE EXCEPTION 'application figures are immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'DRAFT'        AND NEW.status = 'SUBMITTED')
        OR (OLD.status = 'SUBMITTED'    AND NEW.status = 'UNDER_REVIEW')
        OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED','REJECTED'))
        OR (OLD.status = 'APPROVED'     AND NEW.status = 'SIGNED')
    ) THEN
        RAISE EXCEPTION 'illegal application transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.submission_decision IS DISTINCT FROM OLD.submission_decision
       AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
    THEN
        RAISE EXCEPTION 'the submission decision is written once, at submission';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_guard ON applications;
CREATE TRIGGER applications_guard
    BEFORE UPDATE OR DELETE ON applications
    FOR EACH ROW EXECUTE FUNCTION fn_applications_guard();


-- ---------------------------------------------------------------------------
-- 3. PROFILES — one of each per application, editable only while DRAFT
-- ---------------------------------------------------------------------------
--
-- Per application rather than per customer: the credit decision must forever
-- reference what was declared for THIS application. A later application
-- declares again (the storefront can prefill it).

CREATE TABLE IF NOT EXISTS financial_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID NOT NULL,
    application_id      UUID NOT NULL,
    -- Net monthly income, all sources, as declared.
    monthly_income      NUMERIC(12,2) NOT NULL CHECK (monthly_income >= 0),
    -- Existing monthly repayments, as declared.
    monthly_obligations NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_obligations >= 0),
    dependents          SMALLINT CHECK (dependents IS NULL OR dependents BETWEEN 0 AND 30),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT financial_profiles_one_per_application UNIQUE (store_id, application_id),
    CONSTRAINT financial_profiles_application_in_same_store
        FOREIGN KEY (store_id, application_id)
        REFERENCES applications (store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employment_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID NOT NULL,
    application_id      UUID NOT NULL,
    employment_type     employment_type_enum NOT NULL,
    employer_name       TEXT CHECK (employer_name IS NULL OR length(employer_name) BETWEEN 1 AND 200),
    job_title           TEXT CHECK (job_title IS NULL OR length(job_title) BETWEEN 1 AND 120),
    employed_since      DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employment_profiles_one_per_application UNIQUE (store_id, application_id),
    CONSTRAINT employment_profiles_application_in_same_store
        FOREIGN KEY (store_id, application_id)
        REFERENCES applications (store_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION fn_application_profile_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    app_status application_status_enum;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO app_status FROM applications
         WHERE store_id = OLD.store_id AND id = OLD.application_id;
    ELSE
        SELECT status INTO app_status FROM applications
         WHERE store_id = NEW.store_id AND id = NEW.application_id;
    END IF;

    IF app_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'a profile can only change while its application is DRAFT (it is %)', app_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_profiles_guard ON financial_profiles;
CREATE TRIGGER financial_profiles_guard
    BEFORE INSERT OR UPDATE OR DELETE ON financial_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_application_profile_guard();

DROP TRIGGER IF EXISTS employment_profiles_guard ON employment_profiles;
CREATE TRIGGER employment_profiles_guard
    BEFORE INSERT OR UPDATE OR DELETE ON employment_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_application_profile_guard();


-- ---------------------------------------------------------------------------
-- 4. REQUIRED DOCUMENTS — operator-configured, none shipped
-- ---------------------------------------------------------------------------
--
-- Deactivated, never deleted, once anything was uploaded against it.

CREATE TABLE IF NOT EXISTS required_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code            TEXT NOT NULL
                    CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND length(code) <= 60),
    label           TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
    description     TEXT CHECK (description IS NULL OR length(description) <= 1000),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT required_documents_code_per_store UNIQUE (store_id, code),
    CONSTRAINT required_documents_store_id_id_key UNIQUE (store_id, id)
);


-- ---------------------------------------------------------------------------
-- 5. UPLOADED DOCUMENTS
-- ---------------------------------------------------------------------------
--
-- The bytes live in a PRIVATE bucket (api/services/documents). The key is
-- generated from ids — the shopper's filename is display metadata only and
-- never part of a path. content_type is what the server SNIFFED from the
-- bytes, not what the browser claimed.

CREATE TABLE IF NOT EXISTS uploaded_documents (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id                UUID NOT NULL,
    application_id          UUID NOT NULL,
    required_document_id    UUID NOT NULL,
    object_key              TEXT NOT NULL UNIQUE,
    original_filename       TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
    content_type            TEXT NOT NULL
                            CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
    byte_size               INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
    sha256                  TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status                  document_review_status_enum NOT NULL DEFAULT 'UPLOADED',
    reviewed_by             UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at             TIMESTAMPTZ,
    rejection_reason        TEXT CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 1000),
    uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uploaded_documents_application_in_same_store
        FOREIGN KEY (store_id, application_id)
        REFERENCES applications (store_id, id) ON DELETE RESTRICT,
    CONSTRAINT uploaded_documents_type_in_same_store
        FOREIGN KEY (store_id, required_document_id)
        REFERENCES required_documents (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS uploaded_documents_application_idx
    ON uploaded_documents (store_id, application_id);


-- The shopper adds and removes files only while DRAFT; the content of a file
-- never changes; a reviewer's verdict is recorded only while UNDER_REVIEW.
CREATE OR REPLACE FUNCTION fn_uploaded_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    app_status application_status_enum;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO app_status FROM applications
         WHERE store_id = OLD.store_id AND id = OLD.application_id;
        IF app_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'a document can only be removed while its application is DRAFT';
        END IF;
        RETURN OLD;
    END IF;

    SELECT status INTO app_status FROM applications
     WHERE store_id = NEW.store_id AND id = NEW.application_id;

    IF TG_OP = 'INSERT' THEN
        IF app_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'a document can only be added while its application is DRAFT';
        END IF;
        RETURN NEW;
    END IF;

    IF (NEW.store_id, NEW.application_id, NEW.required_document_id, NEW.object_key,
        NEW.original_filename, NEW.content_type, NEW.byte_size, NEW.sha256, NEW.uploaded_at)
       IS DISTINCT FROM
       (OLD.store_id, OLD.application_id, OLD.required_document_id, OLD.object_key,
        OLD.original_filename, OLD.content_type, OLD.byte_size, OLD.sha256, OLD.uploaded_at)
    THEN
        RAISE EXCEPTION 'an uploaded document is immutable';
    END IF;

    IF (NEW.status, NEW.reviewed_at, NEW.rejection_reason)
       IS DISTINCT FROM (OLD.status, OLD.reviewed_at, OLD.rejection_reason)
       AND app_status IS DISTINCT FROM 'UNDER_REVIEW'
    THEN
        RAISE EXCEPTION 'documents are reviewed only while the application is UNDER_REVIEW';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS uploaded_documents_guard ON uploaded_documents;
CREATE TRIGGER uploaded_documents_guard
    BEFORE INSERT OR UPDATE OR DELETE ON uploaded_documents
    FOR EACH ROW EXECUTE FUNCTION fn_uploaded_documents_guard();
