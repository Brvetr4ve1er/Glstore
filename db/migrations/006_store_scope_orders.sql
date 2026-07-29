-- ============================================================================
-- Migration 006: finish store-scoping the order path
--
-- Migration 005 added `store_id` (NOT NULL) to inventory_reservations but left
-- fn_reserve_stock — which is the ONLY writer of that table — unaware of it.
-- Any checkout would therefore fail with a NOT NULL violation.
--
-- Fix: redefine fn_reserve_stock to derive the reservation's store from the
-- offer being reserved. The store is never a caller's free choice — a
-- reservation always belongs to the same store as its offer — so deriving it
-- inside the function keeps the signature (and every caller) unchanged AND
-- makes it structurally impossible to reserve stock across store boundaries.
--
-- Idempotent — CREATE OR REPLACE, safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_reserve_stock(
    p_offer_id      UUID,
    p_order_id      UUID,
    p_order_item_id UUID,
    p_quantity      INTEGER,
    p_ttl_minutes   INTEGER DEFAULT 30
) RETURNS UUID AS $$
DECLARE
    v_available     INTEGER;
    v_store_id      UUID;
    v_reservation   UUID;
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'reserve_stock: quantity must be > 0';
    END IF;

    -- row lock + capture the owning store in the same read
    SELECT (stock_quantity - reserved_quantity), store_id
      INTO v_available, v_store_id
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
        store_id, offer_id, order_id, order_item_id, quantity, status, expires_at
    ) VALUES (
        v_store_id, p_offer_id, p_order_id, p_order_item_id, p_quantity,
        'ACTIVE', NOW() + (p_ttl_minutes || ' minutes')::INTERVAL
    ) RETURNING id INTO v_reservation;

    RETURN v_reservation;
END;
$$ LANGUAGE plpgsql;
