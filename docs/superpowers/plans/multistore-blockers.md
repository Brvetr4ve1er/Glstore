# Plan: Unblock the multi-brand supermarket

## Context

The owner wants ONE platform hosting SEVERAL of his own brands (e.g. GLAIVE gaming
gear + a home-appliance brand), each with its own domain, look, catalog and orders,
all managed by him alone from one admin. This is **multi-brand, not a marketplace** —
no third-party vendors, no commissions, no payouts.

The `stores` schema (migration 005) already models this correctly: `slug`, `name`,
`status`, `theme` JSONB, `order_prefix`, `currency`, plus `store_domains` (Host → store)
and `store_id` on 12 tables. Checkout, orders, customers and the admin picker are done.

A 13-agent audit found **three blockers** that make running a second brand unsafe or
broken. This plan fixes exactly those three. Everything here is a bug or a security
hole regardless of product direction — no speculative work.

Baseline: branch `gaming-store`, HEAD `760b8b7`, clean tree, 365 tests passing.

## Global Constraints

- **Branch:** stay on `gaming-store`. Never push, never touch `main`, never switch branches.
- **No force git ops:** no `reset --hard`, `clean`, `checkout -- <file>`, `stash`, `rebase`,
  `commit --amend`. Never `git add -A|.|-u` — stage explicit paths only.
- **Do not break the public storefront.** It is unauthenticated and resolves its store
  from the Host header. Any change to store resolution MUST preserve that exactly.
- **`python -m pytest tests/` must report 365 passed** before every commit (more is fine
  if a task adds tests; fewer or any failure is a stop).
- **Every new/changed SQL write to a store-scoped table must carry `store_id`.** The
  store-scoped tables are: products, offers, product_media, observations, customers,
  orders, order_items, inventory_reservations, financial_transactions, events, sync_queue.
  (`scrape_jobs`, `intel_jobs`, `scrape_sources`, `competitor_prices` are deliberately
  platform-level per migration 005 — do NOT add store_id to those tables.)
- **Cross-store access returns 404, never 403**, for resources — confirming a row exists
  in another brand leaks data. (403 is correct only for "you may not act on that store"
  at the store-selection layer, which `require_admin_store_for` already does.)
- Conventional-commit subjects ≤72 chars, with a body. No AI/tool attribution, no
  Co-Authored-By trailers.

## Task 1: Close the cross-brand write hole (CRITICAL)

`api/routes/intel.py` (5 endpoints), `api/routes/scraper.py` (9) and `api/routes/jobs.py`
(9) contain **23 endpoints with zero store scoping** — none of them import `store_context`.
`intel.py:48` and `scraper.py:60-62` validate their target with
`SELECT 1 FROM products WHERE id = :id` with no `store_id` predicate, so an OPERATOR of
Store A can enqueue a job against Store B's product; `full_intel` then overwrites B's
description, specs, images and observations. This is brand-A corrupting brand-B.

**Requirements:**

1. Read `api/routes/enrichment.py:31-38` first — `_assert_product_in_store()` is the
   already-correct guard and the pattern to follow. Do not invent a new mechanism.
2. In `intel.py` and `scraper.py`: every endpoint that accepts or acts on a `product_id`
   must resolve the admin's store via `require_admin_store_for(require_role(...))` and
   verify the product belongs to it, returning **404** if not. Preserve each endpoint's
   existing role requirements exactly — do not widen or narrow who may call them.
3. In `jobs.py`: this is the unified job console reading `scrape_jobs` / `intel_jobs` /
   `events` / `sync_queue`. Those job tables are platform-level by design, so do NOT add
   `store_id` to them. Instead, where a listing joins to or exposes **product** data,
   scope that join by the admin's store so one brand's console cannot enumerate another
   brand's products. If an endpoint exposes no product data at all, leave it and say so
   in the report.
4. Do not change any table schema in this task.

**Verification:**
- `grep -c "require_admin_store_for" api/routes/intel.py api/routes/scraper.py` > 0 for both
- No endpoint in intel.py/scraper.py accepts a product_id without a store check — list each
  endpoint and its guard in the report
- `python -m pytest tests/` → 365 passed
- `python -m py_compile` clean on all touched files

## Task 2: One store per admin request (HIGH)

Admin **reads** and **writes** currently resolve DIFFERENT stores:
- `products.py:83` (list), `products.py:185` (detail), and `catalog.py:31,50` + the graph
  endpoint use `require_store` → resolves from the **Host header**
- every write uses `require_admin_store_for` → resolves from the **`x-store-id` header**

The admin sends `x-store-id` on every call (`admin/src/lib/api.ts:37-38`) and those GETs
ignore it. `SINGLE_STORE_MODE` masks this entirely today; with a second brand the admin
would browse Brand A while editing Brand B.

**These endpoints are dual-purpose** — the public storefront also calls them
unauthenticated. So they must NOT simply switch to the admin dependency.

**Requirements — the design decision is made, implement it as specified:**

1. Add ONE new dependency to `api/core/store_context.py`, named `resolve_store`:
   - If the request carries a valid admin JWT **and** an `x-store-id` header → resolve
     that store using the SAME authorization rules as `require_admin_store_for`
     (a store-scoped operator naming a different store is 403; a platform operator must
     name one; unknown store id is 404).
   - Otherwise → fall back to the existing `require_store` behaviour exactly
     (Host lookup, then the single-store/dev fallback, then 404).
   - It must NOT require authentication. An anonymous request must behave precisely as it
     does today. A malformed or expired token must be treated as anonymous, not as an
     error — the public storefront must never break because of a stale token.
   - Bind the resolved store into the ContextVar as the existing dependencies do.
2. Switch these read endpoints from `require_store` to `resolve_store`:
   `products.py` list + detail, `catalog.py` categories + brands + price-bounds + featured
   + graph. Do not change any write endpoint.
3. Leave `public_orders.py` (`/offers/availability`, `/orders/track`) on `require_store` —
   those are customer-facing and must stay Host-resolved.

**Verification:**
- Anonymous `GET /api/v1/products` still resolves by Host (state how you proved it)
- An admin request with `x-store-id` for store B returns store B's products even when the
  Host maps to store A
- A store-scoped operator sending another store's `x-store-id` gets 403
- `python -m pytest tests/` → 365 passed

## Task 3: Per-store theme — give each brand its own look (HIGH)

`/storefront/theme` (`api/routes/settings.py:349-359`) reads a **global**
`app_settings['storefront.theme']` row with no Store dependency. `stores.theme` exists,
is returned by `/stores`, and is rendered by nothing. So every brand would look identical,
and any one store's admin restyles all of them.

**Requirements:**

1. Create `db/migrations/007_per_store_theme.sql`, idempotent:
   - Copy the existing `app_settings` value for key `storefront.theme` into
     `stores.theme` for the store with slug `default`, but only where `stores.theme` is
     still empty (`'{}'::jsonb`) — never clobber a theme an operator already set.
   - Do NOT drop the `app_settings` row (rollback safety) and do NOT touch `admin.theme`.
2. `GET /storefront/theme` (public) must resolve the store (Host-based, via `require_store`)
   and return **that store's** `stores.theme`. If the store's theme is empty, fall back to
   the existing `app_settings['storefront.theme']` so nothing regresses to a blank page.
3. The admin's theme write path for scope `storefront` must write to `stores.theme` for the
   admin's selected store (via `require_admin_store_for`), NOT to `app_settings`.
4. **`admin.theme` stays global** — that is the operator's own console chrome, not a brand
   asset. Do not move it.
5. Keep the existing server-side token validation/whitelisting behaviour that
   `settings.py` already applies to theme payloads — a per-store theme must not become an
   injection vector. If that validation lives in a helper, reuse it; do not bypass it.

**Verification:**
- Two stores with different `stores.theme` values return different payloads from
  `/storefront/theme` depending on Host (describe how you verified without a live DB if
  Docker is unavailable — source tracing is acceptable, say so explicitly)
- Migration 007 is idempotent: applying it twice is a no-op (state how you checked)
- `python -m pytest tests/` → 365 passed

## Task 4: Prove it with a second store + document

**Requirements:**

1. Create `scripts/deploy/add_store.py` — stdlib + asyncpg only, mirroring the style of
   `scripts/deploy/init_remote_db.py`:
   - Args: `--slug`, `--name`, `--prefix`, optional `--domain` (repeatable), `--currency`
     (default DZD).
   - Inserts the `stores` row and any `store_domains` rows, idempotently
     (`ON CONFLICT DO NOTHING`), and prints the new store's id.
   - Refuses invalid slug/prefix with a clear message rather than a DB constraint error
     (the schema requires slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` and prefix `^[A-Z][A-Z0-9]{1,9}$`).
   - Module docstring: this creates a NEW BRAND on the platform; point it at the right DB.
2. Extend `scripts/deploy/smoke_test_checkout.py` with an OPTIONAL `--store-host <host>`
   flag that sets the `Host` header on every request, so the same smoke test can prove a
   specific brand end-to-end. Default behaviour with no flag must be unchanged.
3. Add a "Running more than one brand" section to `DEPLOY.md` covering: turning
   `SINGLE_STORE_MODE` off, adding a store with the new script, pointing a domain at it,
   and per-brand theming.
4. **Fix the known doc bug** while here: `DEPLOY.md` Step 5's curl example uses
   `"address"` in `shipping_address`; the real schema (`api/models/schemas.py:108-112`)
   requires `"street"`. Copy-pasting it today yields a 422.

**Verification:**
- `python -m py_compile` on both scripts
- `python scripts/deploy/add_store.py --slug "Bad Slug" --name x --prefix bad` exits
  non-zero with a readable validation message (not a traceback)
- `python scripts/deploy/smoke_test_checkout.py http://127.0.0.1:9` still exits 1 cleanly
  with no traceback (regression check on the existing script)
- `git status --porcelain` clean after commit
- `python -m pytest tests/` → 365 passed

## Task 5: Close the remaining cross-brand influence + consistency gaps

Found by the Task 1 review. All three are small, and the first is a genuine
cross-brand hole that the rest of this plan would otherwise leave open.

**Requirements:**

1. **`PUT /settings/scraper` and `POST /settings/scraper/probe`** (`api/routes/scraper.py`,
   around lines 457 and 489) write/act on a PLATFORM-GLOBAL `app_settings['scraper.config']`
   row that governs every brand's scraping — including `searxng_url` (fetched server-side,
   an SSRF surface) and the price-outlier factors that decide what lands in
   `competitor_prices` against other brands' products. A store-scoped ADMIN of one brand can
   currently change it for everyone.
   Fix WITHOUT a schema change: restrict these two endpoints to **platform operators only**
   (an admin whose `admin_users.store_id IS NULL`). A store-scoped admin must get 403.
   `CurrentAdmin.is_platform_operator` already exists in `api/core/security.py` — use it.
   Apply the same restriction to `PUT /settings/llm` if it has the same global-write shape
   (read it and decide; state your reasoning either way).
   Leave the GET endpoints readable by their current roles.
2. **Hoist the duplicated guard.** `_assert_product_in_store()` is now byte-identical in
   three files (`api/routes/enrichment.py:31`, `api/routes/intel.py:45`,
   `api/routes/scraper.py:49`). Move ONE copy to `api/core/store_context.py` and import it
   in all three. Behaviour must be identical — this is a pure de-duplication.
3. **`GET /intel-batches/{batch_id}`** (`api/routes/intel.py`, ~line 282) returns 200 with an
   empty result for another store's batch id, while every other guarded endpoint returns 404.
   Make it 404 for consistency with the plan's 404-not-403 rule.

**Verification:**
- A store-scoped admin calling `PUT /settings/scraper` gets 403; a platform operator succeeds
- `grep -c "_assert_product_in_store" api/core/store_context.py` == 1 and the three route
  files import it rather than defining it
- `python -m pytest tests/` → 365 passed
- `python -m py_compile` clean on all touched files
