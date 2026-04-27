-- =============================================================================
-- GLstore :: Write Model (CQRS) :: PostgreSQL 15+
-- Authoritative state. Strictly normalized. State-machine enforced.
-- Event-compatible. Financially safe. Concurrency-safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text (emails, slugs)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search on product names

-- -----------------------------------------------------------------------------
-- 1. ENUM TYPES (State Machines)
-- -----------------------------------------------------------------------------

CREATE TYPE product_status_enum AS ENUM (
    'RAW',          -- just imported, unvalidated
    'NORMALIZED',   -- cleaned + canonicalized
    'CLASSIFIED',   -- category assigned
    'VERIFIED',     -- human/LLM confirmed
    'ACTIVE',       -- live on storefront
    'NEEDS_FIX',    -- flagged for review
    'ARCHIVED'      -- soft-deleted / retired
);

CREATE TYPE media_status_enum AS ENUM (
    'PENDING',      -- queued for upload
    'UPLOADING',    -- transfer in progress
    'STORED',       -- persisted to R2
    'FAILED',       -- upload error
    'DELETED'       -- marked for removal
);

CREATE TYPE media_source_enum AS ENUM (
    'UPLOAD',       -- admin upload
    'SCRAPED',      -- pulled from web
    'SUPPLIER',     -- supplier-provided
    'GENERATED'     -- AI-generated
);

CREATE TYPE order_status_enum AS ENUM (
    'PENDING',      -- created, awaiting stock reservation
    'RESERVED',     -- stock locked
    'CONFIRMED',    -- customer confirmed (call center / web)
    'PACKED',       -- warehouse packed
    'SHIPPED',      -- handed to courier
    'DELIVERED',    -- customer received
    'CANCELLED',    -- cancelled before delivery
    'RETURNED',     -- returned after delivery
    'FAILED'        -- delivery failed
);

CREATE TYPE payment_status_enum AS ENUM (
    'UNPAID',       -- no payment yet
    'PENDING',      -- awaiting confirmation (COD on-delivery)
    'PAID',         -- captured
    'REFUNDED',     -- money returned
    'PARTIAL',      -- partial refund / partial capture
    'FAILED'        -- gateway rejected
);

CREATE TYPE event_status_enum AS ENUM (
    'PENDING',      -- queued
    'PROCESSING',   -- worker claimed it
    'COMPLETED',    -- handled successfully
    'FAILED',       -- permanent failure
    'RETRYING'      -- transient failure, will retry
);

CREATE TYPE sync_status_enum AS ENUM (
    'PENDING',      -- queued for external system
    'IN_PROGRESS',  -- worker pushing now
    'SYNCED',       -- acknowledged
    'FAILED',       -- max retries exceeded
    'SKIPPED'       -- filtered out
);

CREATE TYPE transaction_status_enum AS ENUM (
    'PENDING',      -- authorized, not captured
    'SUCCESS',      -- captured
    'FAILED',       -- declined / errored
    'REVERSED',     -- voided
    'REFUNDED'      -- money returned
);

-- -----------------------------------------------------------------------------
-- 2. TABLES
-- -----------------------------------------------------------------------------

-- 2.1 PRODUCTS :: canonical product catalog (one row per SKU family)
CREATE TABLE products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                 TEXT NOT NULL UNIQUE,
    slug                CITEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
    brand               TEXT,
    model               TEXT,
    category            TEXT,
    subcategory         TEXT,
    description         TEXT,
    specs               JSONB NOT NULL DEFAULT '{}'::jsonb,
    barcode             TEXT,
    mpn                 TEXT,
    ean                 TEXT,
    status              product_status_enum NOT NULL DEFAULT 'RAW',
    completeness_score  NUMERIC(4,3) NOT NULL DEFAULT 0.000
                        CHECK (completeness_score >= 0 AND completeness_score <= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID,
    version             INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT products_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- 2.2 OFFERS :: sellable SKU variants + inventory
CREATE TABLE offers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_sku         TEXT NOT NULL UNIQUE,
    variant_attrs       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {color, size, ...}
    purchase_price      NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
    retail_price        NUMERIC(12,2) NOT NULL CHECK (retail_price >= 0),
    sale_price          NUMERIC(12,2) CHECK (sale_price IS NULL OR sale_price >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'DZD',
    stock_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    reserved_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT offers_reserved_not_exceed_stock CHECK (reserved_quantity <= stock_quantity),
    CONSTRAINT offers_sale_below_retail CHECK (sale_price IS NULL OR sale_price <= retail_price)
);

-- 2.3 PRODUCT_MEDIA :: images / videos (URLs only — binaries in R2)
CREATE TABLE product_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('image','video','document')),
    position        INTEGER NOT NULL DEFAULT 0,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    status          media_status_enum NOT NULL DEFAULT 'PENDING',
    source          media_source_enum NOT NULL DEFAULT 'UPLOAD',
    alt_text        TEXT,
    width           INTEGER,
    height          INTEGER,
    bytes           BIGINT,
    checksum_sha256 TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly ONE primary image per product (partial unique index)
CREATE UNIQUE INDEX product_media_one_primary_per_product
    ON product_media(product_id)
    WHERE is_primary = true AND kind = 'image';

-- 2.4 OBSERVATIONS :: fact-level history (Source X says price = Y at time T)
CREATE TABLE observations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('product','offer')),
    entity_id       UUID NOT NULL,
    field           TEXT NOT NULL,                -- e.g. 'retail_price','stock','brand'
    value           JSONB NOT NULL,               -- {"v": 45000, "currency": "DZD"}
    source          TEXT NOT NULL,                -- 'csv:supplier_a','scraper:ouedkniss','manual:admin'
    source_url      TEXT,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.500
                    CHECK (confidence >= 0 AND confidence <= 1),
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.5 CUSTOMERS :: lightweight — no user accounts, just order contact info
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           TEXT NOT NULL,
    phone_normalized TEXT NOT NULL UNIQUE,        -- E.164-ish for dedupe
    full_name       TEXT NOT NULL,
    email           CITEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.6 ORDERS :: customer orders (COD-first for Algerian market)
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        TEXT NOT NULL UNIQUE,           -- human-readable: GL-2026-000123
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status              order_status_enum NOT NULL DEFAULT 'PENDING',
    payment_status      payment_status_enum NOT NULL DEFAULT 'UNPAID',
    payment_method      TEXT NOT NULL DEFAULT 'COD'
                        CHECK (payment_method IN ('COD','CARD','BANK_TRANSFER','WALLET')),
    subtotal            NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    shipping_cost       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
    discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total               NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'DZD',
    shipping_address    JSONB NOT NULL,                  -- {wilaya, commune, street, notes}
    notes               TEXT,
    idempotency_key     TEXT UNIQUE,                     -- prevents duplicate submits
    confirmed_at        TIMESTAMPTZ,
    shipped_at          TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT orders_total_matches CHECK (
        total = subtotal + shipping_cost + tax_amount - discount_amount
    )
);

-- 2.7 ORDER_ITEMS :: line items (price SNAPSHOT at order time)
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    offer_id        UUID NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    -- snapshot fields (immutable after creation)
    product_name    TEXT NOT NULL,
    variant_sku     TEXT NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    line_total      NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
    currency        CHAR(3) NOT NULL DEFAULT 'DZD',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT order_items_line_total_matches CHECK (line_total = unit_price * quantity)
);

-- 2.8 INVENTORY_RESERVATIONS :: stock holds between order-create and confirm/cancel
CREATE TABLE inventory_reservations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id        UUID NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id   UUID REFERENCES order_items(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reservations_one_active_per_item UNIQUE (order_item_id, status)
);

-- 2.9 EVENTS :: event queue (idempotent, retryable, correlated)
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL UNIQUE,           -- idempotency key
    correlation_id  UUID,                           -- trace across services
    causation_id    UUID,                           -- parent event
    entity_type     TEXT NOT NULL,                  -- 'order','product','offer',...
    entity_id       UUID,
    event_type      TEXT NOT NULL,                  -- 'order.created','stock.adjusted',...
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          event_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries     INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT,
    next_retry_at   TIMESTAMPTZ,
    locked_by       TEXT,                           -- worker id
    locked_at       TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.10 SYNC_QUEUE :: outbound sync to external systems (n8n, accounting, shipping)
CREATE TABLE sync_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_system   TEXT NOT NULL,                  -- 'n8n','shipper_x','accounting'
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL,                  -- 'create','update','delete'
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          sync_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries     INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT,
    next_retry_at   TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.11 FINANCIAL_TRANSACTIONS :: money movements (one per order at capture)
CREATE TABLE financial_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    kind            TEXT NOT NULL CHECK (kind IN ('PAYMENT','REFUND','ADJUSTMENT','COD_COLLECTION')),
    amount          NUMERIC(12,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'DZD',
    status          transaction_status_enum NOT NULL DEFAULT 'PENDING',
    gateway         TEXT,                            -- 'cod','cib','edahabia','stripe'
    gateway_ref     TEXT,                            -- external transaction id
    idempotency_key TEXT NOT NULL UNIQUE,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT financial_tx_unique_per_order_kind UNIQUE (order_id, kind, idempotency_key)
);

-- 2.12 ADMIN_USERS :: the ONLY user accounts (storefront has no accounts)
CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,                   -- bcrypt
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'OPERATOR'
                    CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERATOR','VIEWER')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.13 AUDIT_LOG :: who did what, when (for admin actions)
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    actor_ip        INET,
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       UUID,
    before_state    JSONB,
    after_state     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. INDEXES
-- -----------------------------------------------------------------------------

-- Products: FK-ish lookups + search
CREATE INDEX idx_products_status         ON products(status);
CREATE INDEX idx_products_category       ON products(category);
CREATE INDEX idx_products_brand          ON products(brand);
CREATE INDEX idx_products_updated_at     ON products(updated_at DESC);
CREATE INDEX idx_products_specs_gin      ON products USING GIN (specs);
CREATE INDEX idx_products_name_trgm      ON products USING GIN (name gin_trgm_ops);

-- Offers: hot paths (lookup by product, stock checks)
CREATE INDEX idx_offers_product          ON offers(product_id);
CREATE INDEX idx_offers_active           ON offers(product_id, is_active);
CREATE INDEX idx_offers_low_stock        ON offers(stock_quantity) WHERE stock_quantity <= low_stock_threshold;

-- Media
CREATE INDEX idx_media_product           ON product_media(product_id);
CREATE INDEX idx_media_status            ON product_media(status);

-- Observations (heavy write table — index sparingly)
CREATE INDEX idx_observations_entity     ON observations(entity_type, entity_id);
CREATE INDEX idx_observations_field      ON observations(entity_type, entity_id, field);
CREATE INDEX idx_observations_observed   ON observations(observed_at DESC);
CREATE INDEX idx_observations_value_gin  ON observations USING GIN (value);

-- Customers
CREATE INDEX idx_customers_phone_norm    ON customers(phone_normalized);

-- Orders: primary dashboard queries
CREATE INDEX idx_orders_status           ON orders(status, created_at DESC);
CREATE INDEX idx_orders_customer         ON orders(customer_id);
CREATE INDEX idx_orders_payment_status   ON orders(payment_status);
CREATE INDEX idx_orders_created_at       ON orders(created_at DESC);

-- Order items
CREATE INDEX idx_order_items_order       ON order_items(order_id);
CREATE INDEX idx_order_items_offer       ON order_items(offer_id);
CREATE INDEX idx_order_items_product     ON order_items(product_id);

-- Reservations
CREATE INDEX idx_reservations_offer      ON inventory_reservations(offer_id);
CREATE INDEX idx_reservations_order      ON inventory_reservations(order_id);
CREATE INDEX idx_reservations_expiry     ON inventory_reservations(expires_at)
    WHERE status = 'ACTIVE';

-- Events: worker polling is the hot path
CREATE INDEX idx_events_pending          ON events(status, next_retry_at NULLS FIRST, created_at)
    WHERE status IN ('PENDING','RETRYING');
CREATE INDEX idx_events_entity           ON events(entity_type, entity_id);
CREATE INDEX idx_events_correlation      ON events(correlation_id);
CREATE INDEX idx_events_payload_gin      ON events USING GIN (payload);

-- Sync queue
CREATE INDEX idx_sync_pending            ON sync_queue(status, next_retry_at NULLS FIRST, created_at)
    WHERE status IN ('PENDING','IN_PROGRESS');
CREATE INDEX idx_sync_entity             ON sync_queue(entity_type, entity_id);
CREATE INDEX idx_sync_target             ON sync_queue(target_system, status);

-- Financial
CREATE INDEX idx_finance_order           ON financial_transactions(order_id);
CREATE INDEX idx_finance_status          ON financial_transactions(status);

-- Audit
CREATE INDEX idx_audit_actor             ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity            ON audit_log(entity_type, entity_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. TRIGGERS :: updated_at maintenance + version bumps
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    IF TG_TABLE_NAME IN ('products','offers','orders') THEN
        NEW.version := COALESCE(OLD.version, 0) + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER offers_set_updated_at
    BEFORE UPDATE ON offers
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER orders_set_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER customers_set_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER media_set_updated_at
    BEFORE UPDATE ON product_media
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER reservations_set_updated_at
    BEFORE UPDATE ON inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER admin_users_set_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. CORE STORED PROCEDURES :: concurrency-safe inventory ops
-- -----------------------------------------------------------------------------

-- Atomic reserve: lock the offer row, verify availability, bump reserved_quantity
CREATE OR REPLACE FUNCTION fn_reserve_stock(
    p_offer_id      UUID,
    p_order_id      UUID,
    p_order_item_id UUID,
    p_quantity      INTEGER,
    p_ttl_minutes   INTEGER DEFAULT 30
) RETURNS UUID AS $$
DECLARE
    v_available     INTEGER;
    v_reservation   UUID;
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'reserve_stock: quantity must be > 0';
    END IF;

    -- row lock
    SELECT (stock_quantity - reserved_quantity)
      INTO v_available
      FROM offers
     WHERE id = p_offer_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'reserve_stock: offer % not found', p_offer_id;
    END IF;

    IF v_available < p_quantity THEN
        RAISE EXCEPTION 'reserve_stock: insufficient stock (have %, need %)',
            v_available, p_quantity;
    END IF;

    UPDATE offers
       SET reserved_quantity = reserved_quantity + p_quantity
     WHERE id = p_offer_id;

    INSERT INTO inventory_reservations (
        offer_id, order_id, order_item_id, quantity, status, expires_at
    ) VALUES (
        p_offer_id, p_order_id, p_order_item_id, p_quantity,
        'ACTIVE', NOW() + (p_ttl_minutes || ' minutes')::INTERVAL
    ) RETURNING id INTO v_reservation;

    RETURN v_reservation;
END;
$$ LANGUAGE plpgsql;

-- Consume reservation: decrement stock + reserved, mark reservation consumed
CREATE OR REPLACE FUNCTION fn_consume_reservation(p_reservation_id UUID)
RETURNS VOID AS $$
DECLARE
    v_offer_id  UUID;
    v_quantity  INTEGER;
    v_status    TEXT;
BEGIN
    SELECT offer_id, quantity, status
      INTO v_offer_id, v_quantity, v_status
      FROM inventory_reservations
     WHERE id = p_reservation_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'consume_reservation: % not found', p_reservation_id;
    END IF;

    IF v_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'consume_reservation: reservation % not ACTIVE (status=%)',
            p_reservation_id, v_status;
    END IF;

    UPDATE offers
       SET stock_quantity    = stock_quantity - v_quantity,
           reserved_quantity = reserved_quantity - v_quantity
     WHERE id = v_offer_id;

    UPDATE inventory_reservations
       SET status = 'CONSUMED', consumed_at = NOW()
     WHERE id = p_reservation_id;
END;
$$ LANGUAGE plpgsql;

-- Release reservation: give stock back, mark released
CREATE OR REPLACE FUNCTION fn_release_reservation(p_reservation_id UUID)
RETURNS VOID AS $$
DECLARE
    v_offer_id  UUID;
    v_quantity  INTEGER;
    v_status    TEXT;
BEGIN
    SELECT offer_id, quantity, status
      INTO v_offer_id, v_quantity, v_status
      FROM inventory_reservations
     WHERE id = p_reservation_id
       FOR UPDATE;

    IF NOT FOUND OR v_status <> 'ACTIVE' THEN
        RETURN;  -- idempotent no-op
    END IF;

    UPDATE offers
       SET reserved_quantity = reserved_quantity - v_quantity
     WHERE id = v_offer_id;

    UPDATE inventory_reservations
       SET status = 'RELEASED', released_at = NOW()
     WHERE id = p_reservation_id;
END;
$$ LANGUAGE plpgsql;

-- Expire stale reservations (called by worker)
CREATE OR REPLACE FUNCTION fn_expire_stale_reservations() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    r       RECORD;
BEGIN
    FOR r IN
        SELECT id FROM inventory_reservations
         WHERE status = 'ACTIVE' AND expires_at < NOW()
         FOR UPDATE SKIP LOCKED
         LIMIT 200
    LOOP
        PERFORM fn_release_reservation(r.id);
        UPDATE inventory_reservations
           SET status = 'EXPIRED'
         WHERE id = r.id AND status = 'RELEASED';
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
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
-- ============================================================================
-- Migration 003: observations retention
-- Phase: post-audit C-3 fix.
--
-- Adds a stored procedure that deletes old observation rows EXCEPT the latest
-- per (entity_id, field, source). This way:
--   - we keep the canonical "what does source X currently say about field Y"
--   - we drop the historical churn that's of marginal value past N days.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_prune_observations(retain_days INTEGER DEFAULT 180)
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY entity_id, field, source
                   ORDER BY observed_at DESC
               ) AS rn
          FROM observations
         WHERE observed_at < NOW() - (retain_days || ' days')::INTERVAL
    )
    DELETE FROM observations
     WHERE id IN (
         SELECT id FROM ranked WHERE rn > 1
     );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- An index that makes the partitioned ROW_NUMBER cheap.
CREATE INDEX IF NOT EXISTS observations_entity_field_source_observed_idx
    ON observations(entity_id, field, source, observed_at DESC);
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
