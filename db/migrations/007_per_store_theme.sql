-- ============================================================================
-- Migration 007: per-store storefront theme
--
-- `stores.theme` has existed since 005 — commented there as "read by the
-- storefront on boot so a new brand needs no redeploy" — but nothing ever
-- rendered it. The public GET /storefront/theme read the GLOBAL
-- app_settings row 'storefront.theme', so every brand on the platform looked
-- identical and whichever store's ADMIN saved last restyled all the others.
--
-- Storefront theming now lives on the store row (see api/routes/settings.py).
-- This migration seeds the store that exists today with the theme it is
-- already wearing, so the switch is invisible to it.
--
-- Deliberately NOT done here:
--   · app_settings['storefront.theme'] is KEPT, not deleted. It stays the
--     read-time fallback for a store whose theme is still empty, and it makes
--     a rollback to the pre-007 code a no-op rather than a data loss.
--   · app_settings['admin.theme'] is untouched. That is the operator's own
--     console chrome, correctly global — one operator running three brands
--     still wants one console. It is not a brand asset.
--   · No new columns, indexes or constraints. 005 already shipped the column
--     with the right type and a '{}'::jsonb default.
--
-- Idempotent — safe to re-run:
--   The UPDATE only matches while the target store's theme is still the
--   empty object. The first run makes that predicate false, so a second run
--   matches zero rows. If the app_settings row does not exist (no operator
--   ever saved a storefront theme) the join finds nothing and every run is a
--   no-op. Nothing here is order-dependent or accumulative.
-- ============================================================================

UPDATE stores AS s
   SET theme = a.value
  FROM app_settings AS a
 WHERE s.slug  = 'default'
   -- Never clobber a theme an operator already set. This is what makes the
   -- statement re-runnable AND what protects a store that was themed before
   -- this migration reached it.
   AND s.theme = '{}'::jsonb
   AND a.key   = 'storefront.theme'
   -- Only copy something that is actually a theme object. A NULL-ish or
   -- scalar value would poison the column for the reader.
   AND jsonb_typeof(a.value) = 'object'
   AND a.value <> '{}'::jsonb;
