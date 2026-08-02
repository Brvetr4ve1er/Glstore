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
-- ---------------------------------------------------------------------------
-- WHY THE GUARD IS "has no 'overrides' key" AND NOT "= '{}'::jsonb"
-- ---------------------------------------------------------------------------
-- 005 does not leave `stores.theme` empty. It seeds the default store with
--
--     {"preset":"dark","colors":{"brand":"#3DA9FC","accent":"#FFD400"}}
--
-- (005_stores.sql:76-83) — a placeholder written before the theme contract
-- existed: `colors` is not a key any reader understands, and `dark` is not a
-- real preset name. A `s.theme = '{}'::jsonb` guard therefore matches ZERO
-- rows on every deployment that ran 005, i.e. the backfill would be a no-op
-- exactly where it needs to work, silently dropping whatever storefront theme
-- the operator had saved in Theme Studio.
--
-- The guard instead asks: "was this theme ever authored through the product?"
--
--     PUT /api/v1/settings/theme  (api/routes/settings.py:441) is the ONLY
--     writer of stores.theme in the codebase. It always persists
--         {"preset": …, "overrides": {…}, "mode": …}
--     and the `overrides` key is UNCONDITIONAL — present even when the
--     operator set no token overrides, in which case it is `{}`.
--     (scripts/deploy/init_remote_db.py touches only name/order_prefix.)
--
-- So `overrides` is present if and only if the blob came from Theme Studio.
-- `NOT jsonb_exists(theme, 'overrides')` therefore cannot clobber an
-- operator-authored theme: any such theme necessarily carries the key and is
-- excluded. It matches exactly the two cases we want — the '{}' default and
-- the untouched 005 placeholder — plus anything else that provably did not
-- come from the theme editor.
--
-- `jsonb_exists(x, 'k')` is the function form of the `x ? 'k'` operator.
-- Preferred here so no layer can mistake a bare `?` for a bind placeholder.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENT — safe to re-run
-- ---------------------------------------------------------------------------
-- Walking the predicate against the post-run-1 state:
--
--   · Run 1 copies app_settings['storefront.theme'] into stores.theme. That
--     value was written by PUT /settings/theme, so it CONTAINS 'overrides'.
--     On run 2 `NOT jsonb_exists(s.theme,'overrides')` is FALSE → zero rows.
--     That is the primary reason run 2 is a no-op.
--
--   · Edge case — the source value somehow LACKS 'overrides' (e.g. someone
--     hand-inserted a blob into app_settings via psql). Then run 2's
--     `NOT jsonb_exists(...)` would still be TRUE, so the final predicate
--     `s.theme IS DISTINCT FROM a.value` is what stops it: after run 1 the
--     two are byte-identical, so run 2 matches zero rows anyway. With both
--     guards the statement matches zero rows on re-run UNCONDITIONALLY —
--     it never even re-fires the set_updated_at_stores trigger.
--
--   · If app_settings['storefront.theme'] does not exist (no operator ever
--     saved a storefront theme) the join finds nothing and EVERY run —
--     including the first — is a no-op.
--
-- It is a single UPDATE: nothing is created, inserted or altered, so there is
-- no object that could already exist and nothing accumulative.
-- ============================================================================

UPDATE stores AS s
   SET theme = a.value
  FROM app_settings AS a
 WHERE s.slug  = 'default'
   -- "Never written by Theme Studio." Protects an operator-authored theme,
   -- and matches both '{}' and the 005 placeholder. See the note above.
   AND NOT jsonb_exists(s.theme, 'overrides')
   AND a.key   = 'storefront.theme'
   -- Only copy something that is actually a theme object. A scalar or an
   -- empty object would poison the column for the reader — and an empty one
   -- would also defeat the read-time fallback in _load_storefront_theme.
   AND jsonb_typeof(a.value) = 'object'
   AND a.value <> '{}'::jsonb
   -- Belt and braces: guarantees zero matched rows on any re-run even if the
   -- source blob lacks 'overrides' (see the idempotency note above).
   AND s.theme IS DISTINCT FROM a.value;
