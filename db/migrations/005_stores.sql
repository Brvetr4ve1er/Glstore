-- ============================================================================
-- Migration 005: multi-store (superstore) foundation
--
-- Turns the single-tenant catalog into N isolated stores under one platform.
-- Scoping model: ISOLATED CATALOGS — each store owns its own products, offers,
-- customers and orders. Nothing is shared except the platform itself.
--
-- Routing: HOST-BASED. `store_domains` maps a Host header to a store, so
-- glaive.example.dz and ghir.example.dz hit the same API and get different data.
--
-- Deliberately NOT scoped here (platform-level tooling, derivable via product_id):
--   scrape_jobs, scrape_sources, competitor_prices, scrape_domain_state, intel_jobs
-- The scraper researches the *market*, not one store's catalog. If per-store
-- scraper budgets are ever needed, that is a separate migration.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. STORES
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE store_status_enum AS ENUM ('ACTIVE','SUSPENDED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS stores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    status          store_status_enum NOT NULL DEFAULT 'ACTIVE',

    -- Presentation. Read by the storefront on boot so a new brand needs no
    -- redeploy — colors, logo, fonts, copy overrides all live here.
    theme           JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Commercial identity. Order numbers are prefixed per store so GLAIVE-000123
    -- and GHIR-000123 can coexist.
    order_prefix    TEXT NOT NULL DEFAULT 'GL'
                    CHECK (order_prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
    currency        CHAR(3) NOT NULL DEFAULT 'DZD',
    support_email   CITEXT,
    support_phone   TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT stores_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);


-- Host header → store. One store may answer on several hostnames
-- (apex + www + a staging domain), so this is a child table, not a column.
CREATE TABLE IF NOT EXISTS store_domains (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    -- Stored lowercase without port. The resolver strips ":8000" before lookup.
    domain          CITEXT NOT NULL UNIQUE,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_domains_store ON store_domains(store_id);

-- At most one primary hostname per store (the one used to build absolute URLs).
CREATE UNIQUE INDEX IF NOT EXISTS store_domains_one_primary_per_store
    ON store_domains(store_id) WHERE is_primary = true;


-- ---------------------------------------------------------------------------
-- 2. DEFAULT STORE  (backfill target for every pre-existing row)
-- ---------------------------------------------------------------------------

INSERT INTO stores (slug, name, order_prefix, theme)
VALUES (
    'default',
    'Default Store',
    'GL',
    '{"preset":"dark","colors":{"brand":"#3DA9FC","accent":"#FFD400"}}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Dev hostnames resolve to the default store so `docker compose up` works
-- with no DNS setup. Production hostnames get added via the admin UI.
INSERT INTO store_domains (store_id, domain, is_primary)
SELECT s.id, d.domain, d.is_primary
FROM stores s
CROSS JOIN (VALUES
    ('localhost',  true),
    ('127.0.0.1',  false)
) AS d(domain, is_primary)
WHERE s.slug = 'default'
ON CONFLICT (domain) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. ADD store_id  (nullable first — backfill cannot happen on a NOT NULL col)
-- ---------------------------------------------------------------------------

ALTER TABLE products                ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE offers                  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE product_media           ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE observations            ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE customers               ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE orders                  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE order_items             ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE inventory_reservations  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE financial_transactions  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE events                  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE sync_queue              ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE audit_log               ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

-- admin_users.store_id stays NULLABLE on purpose:
--   NULL     → platform operator, sees every store
--   NOT NULL → scoped to exactly one store
ALTER TABLE admin_users             ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;


-- ---------------------------------------------------------------------------
-- 4. BACKFILL  (every existing row belongs to the default store)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_default UUID;
BEGIN
    SELECT id INTO v_default FROM stores WHERE slug = 'default';

    UPDATE products               SET store_id = v_default WHERE store_id IS NULL;
    UPDATE offers                 SET store_id = v_default WHERE store_id IS NULL;
    UPDATE product_media          SET store_id = v_default WHERE store_id IS NULL;
    UPDATE observations           SET store_id = v_default WHERE store_id IS NULL;
    UPDATE customers              SET store_id = v_default WHERE store_id IS NULL;
    UPDATE orders                 SET store_id = v_default WHERE store_id IS NULL;
    UPDATE order_items            SET store_id = v_default WHERE store_id IS NULL;
    UPDATE inventory_reservations SET store_id = v_default WHERE store_id IS NULL;
    UPDATE financial_transactions SET store_id = v_default WHERE store_id IS NULL;
    UPDATE events                 SET store_id = v_default WHERE store_id IS NULL;
    UPDATE sync_queue             SET store_id = v_default WHERE store_id IS NULL;
    -- audit_log + admin_users intentionally left NULL-able (see above).
END $$;


-- ---------------------------------------------------------------------------
-- 5. ENFORCE NOT NULL  (safe now that every row is backfilled)
-- ---------------------------------------------------------------------------

ALTER TABLE products                ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE offers                  ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE product_media           ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE observations            ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE customers               ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE orders                  ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE order_items             ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE inventory_reservations  ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE financial_transactions  ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE events                  ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE sync_queue              ALTER COLUMN store_id SET NOT NULL;


-- ---------------------------------------------------------------------------
-- 6. RE-SCOPE UNIQUE CONSTRAINTS
--
-- These were globally unique. Two stores must be able to use the same SKU,
-- the same order number sequence, and serve the same customer phone number
-- without colliding. Global → composite (store_id, col).
-- ---------------------------------------------------------------------------

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_sku_key  ON products(store_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS products_store_slug_key ON products(store_id, slug);

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_variant_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS offers_store_variant_sku_key ON offers(store_id, variant_sku);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_normalized_key;
CREATE UNIQUE INDEX IF NOT EXISTS customers_store_phone_key ON customers(store_id, phone_normalized);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS orders_store_number_key ON orders(store_id, order_number);
-- Partial: NULL idempotency keys are common and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS orders_store_idempotency_key
    ON orders(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- admin_users.email stays GLOBALLY unique — it is the login identity. Allowing
-- the same address in two stores would make "which account am I signing into?"
-- ambiguous at the auth boundary.


-- ---------------------------------------------------------------------------
-- 7. INDEXES  (every hot query now carries a store_id predicate)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_products_store_status   ON products(store_id, status);
CREATE INDEX IF NOT EXISTS idx_products_store_category ON products(store_id, category);
CREATE INDEX IF NOT EXISTS idx_products_store_brand    ON products(store_id, brand);
CREATE INDEX IF NOT EXISTS idx_offers_store_active     ON offers(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_media_store_status      ON product_media(store_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_store_status     ON orders(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_store         ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_events_store            ON events(store_id);
CREATE INDEX IF NOT EXISTS idx_sync_store              ON sync_queue(store_id);
CREATE INDEX IF NOT EXISTS idx_finance_store           ON financial_transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_observations_store      ON observations(store_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_store       ON admin_users(store_id);


-- ---------------------------------------------------------------------------
-- 8. TRIGGER  keep stores.updated_at fresh (reuses the existing helper)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS set_updated_at_stores ON stores;
CREATE TRIGGER set_updated_at_stores
    BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
