-- ============================================================================
-- Migration 008: merchandising — reviews, badges, newsletter capture
--
-- Phase 1 of docs/superpowers/plans/amanatkom-merchandising.md.
--
-- One migration rather than three: one advisory-lock cycle, one checksum, one
-- `apply_migrations.py --dry-run` for the operator.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------

-- Reviews are moderated. This is not optional: a cash-on-delivery shop with
-- unmoderated public reviews is a spam target from the first day it has a URL.
DO $$ BEGIN
    CREATE TYPE review_status_enum AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- One badge, not three booleans. A product shows at most one flag at a time,
-- and the column should say so rather than leaving the frontend to arbitrate
-- between is_new + is_bestseller both being true.
--
-- SALE is derivable from offers.sale_price, but merchants expect to set it
-- deliberately, and a derived-only badge cannot be suppressed on a product
-- that happens to be discounted for an unrelated reason.
DO $$ BEGIN
    CREATE TYPE product_badge_enum AS ENUM ('NEW','BEST_SELLER','PRO','SALE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. products.badge
-- ---------------------------------------------------------------------------
--
-- NULLABLE, NO DEFAULT — deliberately.
--
-- This is the first migration the demo catalog passes through. Those rows
-- (14 archived fixtures from seed_gaming.sql + 15 demo products from
-- seed_glaive_starter.sql) are what this ALTER TABLE lands on. A
-- `NOT NULL DEFAULT 'NEW'` would silently badge the entire catalog "NEW",
-- including the archived ones, and nothing downstream would flag it.

ALTER TABLE products ADD COLUMN IF NOT EXISTS badge product_badge_enum;


-- ---------------------------------------------------------------------------
-- 3. REVIEWS
-- ---------------------------------------------------------------------------
--
-- WHY THE COMPOSITE FOREIGN KEY BELOW MATTERS
--
-- Four separate `store_id` bugs were found in this codebase, all of the same
-- shape: a code path wrote a store-scoped table without the store, and a green
-- test suite could not see it. Declaring `store_id NOT NULL` prevents a NULL;
-- it does NOT prevent a review being filed against brand A while carrying
-- brand B's store_id.
--
-- So the store is pinned in the schema instead of in the application:
--
--     FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id)
--
-- A review whose store_id disagrees with its product's store_id cannot be
-- inserted at all, by anyone, through any code path — including a future
-- endpoint written by someone who has never read this file. The application
-- check (`_assert_product_in_store`) stays as well, because it produces a
-- clean 404 instead of an integrity error, but it is no longer the only thing
-- standing between the data and a cross-brand leak.
--
-- This mirrors migration 006, which derives store_id inside fn_reserve_stock
-- so cross-store reservation is structurally impossible rather than merely
-- checked.

-- The composite FK needs a matching unique constraint on the parent. `id` is
-- already the primary key, so (store_id, id) is unique by construction — this
-- just makes it addressable as a foreign-key target.
DO $$ BEGIN
    ALTER TABLE products ADD CONSTRAINT products_store_id_id_key UNIQUE (store_id, id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL,
    product_id      UUID NOT NULL,

    -- No customer accounts exist on this platform (`customers` is a COD order
    -- record: name, phone, address — no login, no session). A review therefore
    -- carries a free-text display name and is moderated before it is public.
    customer_name   TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 120),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title           TEXT CHECK (title IS NULL OR length(title) <= 200),
    body            TEXT CHECK (body IS NULL OR length(body) <= 4000),

    status          review_status_enum NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT reviews_product_in_same_store
        FOREIGN KEY (store_id, product_id)
        REFERENCES products (store_id, id) ON DELETE CASCADE
);


-- Admin moderation queue: newest pending first, per store.
CREATE INDEX IF NOT EXISTS reviews_moderation_idx
    ON reviews (store_id, created_at DESC) WHERE status = 'PENDING';

-- Public read path + the avg_rating/review_count aggregates on the product
-- list. Partial, because only APPROVED rows are ever read publicly.
CREATE INDEX IF NOT EXISTS reviews_approved_idx
    ON reviews (product_id) WHERE status = 'APPROVED';


-- ---------------------------------------------------------------------------
-- 4. NEWSLETTER CAPTURE
-- ---------------------------------------------------------------------------
--
-- Exists so the storefront's newsletter form has somewhere real to land. A
-- form that accepts an address and discards it is the "fake form that does not
-- submit anywhere" pattern, and it is worse than having no form.
--
-- Storing the capture is in scope. SENDING anything to these addresses is not:
-- there is no mail infrastructure in this platform, and adding one is a
-- separate decision with its own consent and unsubscribe obligations.
--
-- CITEXT so Ahmed@example.dz and ahmed@example.dz are the same subscriber.

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    email           CITEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Per store, not global: the same person subscribing to GLAIVE and to
    -- Ghir Laffaire is two subscriptions, and one brand must not be able to
    -- discover the other's list by probing for conflicts.
    CONSTRAINT newsletter_subscribers_unique_per_store UNIQUE (store_id, email)
);
