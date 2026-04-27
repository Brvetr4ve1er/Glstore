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
