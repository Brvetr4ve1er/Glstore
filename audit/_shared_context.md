# GLstore — Shared Context Brief

Read this before you touch anything. Everything here was read from source on 2026-07-31 (`gaming-store` @ `760b8b7`). Full reasoning + citations in `audit/Architecture.md`. **Read-only audit — do not modify, stage, or commit source files.**

## 0. The 60-second model

FastAPI + Postgres + 4 DB-polling workers, serving a public React storefront and a React admin. Two halves: **selling** (catalog → cart → COD checkout, DZD, wilaya shipping, no customer accounts) and **catalog intelligence** (CSV import → rule enrichment → 4-tier scraper → LLM merge). Since migration 005 it is **multi-tenant**: N stores routed by `Host` header.

## 1. Module map

```
api/
  main.py              app + middleware + router mounting. 16 routers mounted; products_export NOT mounted.
  core/
    config.py          pydantic BaseSettings. THE env source of truth.
    db.py              async engine. NullPool branch when db_serverless=true.
    security.py        bcrypt, JWT, CurrentAdmin(.store_id), require_role(*roles)
    store_context.py   ★ the tenancy boundary. Store, require_store, require_admin_store_for, bound_store()
    migrations.py      advisory-locked runner, SHA-256 checksum tamper detection
    ratelimit.py       in-memory, XFF-keyed (spoofable — see §6)
    logging.py         JSON logs, request_id via ContextVar
    health.py, metrics.py
  models/schemas.py    the ONLY model file. Pydantic DTOs. No ORM anywhere.
  routes/              17 files, 76 endpoints. Thin: auth + store dep + delegate.
  services/            ALL business logic. orders / csv_import / enrichment_runner /
                       llm_enrichment / full_intel / events / validator / spec_sanitizer
  services/scraper/    engine.py + fetcher/search/ranker + tiers/(1..4) +
                       retailers/(jumia,ouedkniss,batolis,condor,facebook,midtier) +
                       extractors/ + validators/ + utils/(rate_limiter,robots,cache,proxy,domain)
workers/               event_ / reservation_ / scraper_ / intel_worker.py — lifecycle only,
                       the real work is imported from api/services/
db/schema.sql          base 13 tables + INLINE COPIES of migrations 001-004 (see §7)
db/migrations/         000..006. Auto-applied at API startup (unless RUN_STARTUP_MIGRATIONS=false)
storefront/src/        pages/ lib/api.ts lib/cart.tsx lib/theme.ts — public shop
admin/src/             pages/(14) lib/api.ts lib/auth.tsx lib/store.tsx lib/theme.ts
gaming-store/          static HTML. ZERO API calls (verified). data.js is hardcoded.
scripts/deploy/        init_remote_db.py · smoke_test_checkout.py (the only e2e proof)
tests/                 16 files, 257 tests. NONE import api.main or api.routes.*
```

## 2. Conventions actually used (not aspirational)

- **Raw SQL only.** Every query is `sqlalchemy.text("""...""")` with named binds. There is no ORM, no model layer, no migration autogeneration. A schema change has **zero** compile-time consequence — only runtime.
- **Routes are thin, services are fat.** Routes: dependency wiring + `db.commit()`. Logic goes in `api/services/`.
- **Routes never commit inside services.** The route commits (`api/routes/orders.py:32`). Exception: `full_intel.py` commits mid-pipeline to satisfy an FK.
- **Workers = claim loop + heartbeat + stale sweep.** Claim idiom everywhere: `UPDATE t SET status='CLAIMED' WHERE id IN (SELECT id FROM t WHERE status='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n) RETURNING …`
- **Concurrency-safe inventory lives in Postgres functions**, not Python: `fn_reserve_stock`, `fn_consume_reservation`, `fn_release_reservation`, `fn_expire_stale_reservations`, `fn_prune_observations`.
- **Router registration order is load-bearing.** Static paths must register before dynamic catchers — `catalog` and `images` before `products` (`api/main.py:168-180`). Adding `/products/<literal>` after `products.router` gives a 422 UUID-coercion error.
- **Naming:** SQL binds are terse (`:sid` = store_id, `:pid` = product_id, `:eid`, `:oid`). Roles are module constants `WRITE_ROLES` / `READ_ROLES` / `ADMIN_WRITE` / `ADMIN_READ`. Events are dotted: `order.created`, `order.confirmed`, `order.cancelled`.
- **Frontends:** both `lib/api.ts` files are hand-written typed fetch wrappers (no codegen), so **API response shapes are duplicated by hand** in TS and drift silently.

## 3. ★ THE BIGGEST TRAP: `store_id`

**11 tables carry `store_id NOT NULL`** (`db/migrations/005_stores.sql:150-160`):
`products` · `offers` · `product_media` · `observations` · `customers` · `orders` · `order_items` · `inventory_reservations` · `financial_transactions` · `events` · `sync_queue`

Nullable on purpose: `admin_users` (NULL = platform operator), `audit_log`.
Deliberately unscoped (`005_stores.sql:11-14`): `scrape_jobs`, `scrape_sources`, `competitor_prices`, `scrape_domain_state`, `intel_jobs`. Also unscoped: `app_settings` (global k/v).

**Any INSERT into the 11 must supply `store_id` — one of exactly two patterns:**

1. **Pass it in** — you already hold a `Store`: `api/services/orders.py` threads `store.id` everywhere.
2. **Derive from parent** — join to the owner in the INSERT:
   ```sql
   INSERT INTO observations (store_id, entity_type, entity_id, …)
   SELECT p.store_id, 'product', :pid, … FROM products p WHERE p.id = :pid
   ```
   Used at `enrichment_runner.py:91`, `llm_enrichment.py:133`, `full_intel.py:315,344`, and inside `fn_reserve_stock` (`006_store_scope_orders.sql:34-58`).

Four omissions of this were already found and fixed (`routes/events.py`, `workers/event_worker.py`, `full_intel.py` ×2). **Two more are still dormant** in the unmounted `api/routes/products_export.py:278,359`.

Migration 005 also made every uniqueness composite: `(store_id, sku)`, `(store_id, slug)`, `(store_id, variant_sku)`, `(store_id, phone_normalized)`, `(store_id, order_number)`, `(store_id, idempotency_key)` partial. `admin_users.email` stays globally unique.

## 4. ★ The two store resolvers — pick the right one

| Dependency | Source | Use for | Defined |
|---|---|---|---|
| `require_store` | **`Host` header** → `store_domains` (60s cache) | **PUBLIC routes only** | `store_context.py:168` |
| `require_admin_store_for(require_role(...))` | **`x-store-id` header** + `admin.store_id` | **ALL admin routes** | `store_context.py:235` |

`Host` is client-controlled. It is a routing signal, never an authorization signal (`store_context.py:15-22`). A store-scoped operator sending a foreign `x-store-id` gets 403; a platform operator (`store_id IS NULL`) **must** send it or gets 400.

Current per-module state — **use this table, do not assume**:

| Module | Store scoping |
|---|---|
| `catalog.py`, `public_orders.py` | ✅ `require_store` (correct — public) |
| `orders.py`, `images.py`, `enrichment.py`, `issues.py`, `products_import.py` | ✅ `require_admin_store_for` |
| `products.py` | ⚠️ **SPLIT** — GETs (`:83`,`:185`) use `require_store`; all writes use `require_admin_store_for` |
| `intel.py` (5 ep), `scraper.py` (9 ep), `jobs.py` (9 ep) | ❌ **ZERO store scoping** |
| `settings.py` (6 ep) | ❌ global config, cross-tenant writes |
| `stores.py` | scopes via `admin.store_id` directly |
| `auth.py`, `health.py` | n/a |

The correct guard already exists as `_assert_product_in_store()` at `api/routes/enrichment.py:31-38`. Reuse it.

## 5. Key abstractions

- **`Store`** — frozen dataclass `(id, slug, name, status, theme, order_prefix, currency)`; bound to a ContextVar; `bound_store()` reads it anywhere in the request; `api/main.py:140` stamps `x-store` on the response.
- **`CurrentAdmin`** — `(id, email, role, store_id)`; `store_id` is carried **in the JWT** (`security.py:75-81`), so reassigning an operator's store takes effect on next login, not immediately.
- **`observations`** — append-only "source X said field Y = Z at time T". Three writers with slightly different shapes (`enrichment_runner`, `llm_enrichment`, `scraper/engine`); no canonical writer. Pruned daily to latest-per-(entity,field,source).
- **`events` → `sync_queue`** — outbox. `emit_event()` (`api/services/events.py:8`) is the only writer; **always pass `store_id` explicitly** — the `bound_store()` fallback silently yields `None` outside a request and then violates NOT NULL.
- **`app_settings`** — global JSONB k/v: `llm.config`, `scraper.config`, `admin.theme`, `storefront.theme`. Runtime config, edited via admin UI. **Not store-scoped.**
- **`?wait=true`** — enqueue endpoints poll for completion up to 90s (scrape) / 120s (intel) to fake synchronous UX.

## 6. Landmines — verified, do not re-derive

1. **`intel.py:48` and `scraper.py:60-62`** validate products with `SELECT 1 FROM products WHERE id = :id` — **no store filter**. Cross-tenant *write* path (the intel pipeline then overwrites the foreign product + inserts media/observations). **Critical.**
2. **Admin read/write store split** — `GET /products`, `GET /products/{id}`, `GET /products/graph` use `Host`; every write uses `x-store-id`. Admin sends `x-store-id` on all calls (`admin/src/lib/api.ts:37-38`) and those GETs ignore it.
3. **Shadow scrape jobs** — `full_intel.py:437-466` inserts a `PENDING` `scrape_jobs` row and commits; nothing ever completes it; `scraper_worker.py:46-61` claims any PENDING → **every intel job causes a second full scrape** of the same product.
4. **Theme is global** — `/storefront/theme` reads `app_settings['storefront.theme']` (`settings.py:349-359`), not `stores.theme`. All stores render identically; any store ADMIN restyles all of them.
5. **`financial_transactions` and `audit_log` have ZERO code references repo-wide.** No money movement is recorded; no admin action is audited.
6. **`products_export.py` is provably dead** — not in `api/main.py:19`, zero Python imports repo-wide, zero frontend consumers. Contains 2 dormant `store_id`-missing INSERTs.
7. **`GET /products?status=RAW` is public and unauthenticated** (`products.py:88-93` explicitly lets the caller override the ARCHIVED filter) → anonymous enumeration of unpublished catalog.
8. **`ratelimit.py`** — `client_key()` trusts `X-Forwarded-For` with no proxy allowlist (bypassable by header rotation), and `_hits` is a `defaultdict` whose keys are **never evicted** (unbounded growth). Same XFF issue in `auth.py`'s IP tracker.
9. **`db/schema.sql` inlines migrations 001-004** at lines 580/609/742/778 (not 005/006). Two sources of truth; only `db/migrations/` is checksum-protected.
10. **Vercel ships no workers** (`vercel.json` builds only `storefront` + `api/index.py`) → reservations never expire, `offers.reserved_quantity` only grows, `events` never drain. The admin app has no deploy path.
11. **`DEPLOY.md:137`** uses `"address"`; the schema requires `"street"` (`schemas.py:108-112`). Copy-pasting the doc 422s. `scripts/deploy/smoke_test_checkout.py:151` is correct.
12. **`reservation_worker` singleton is a comment, not a lock** — no advisory lock, no compose replica pin. Underlying SQL is idempotent, so the risk is duplicated work.
13. **No test starts the app.** Zero tests import `api.main` or `api.routes.*`. `tests/test_bulk_operations.py` tests re-declared constants for a router that isn't mounted.

## 7. Where to look for what

| Question | Go to |
|---|---|
| Which routers are live? | `api/main.py:19` (imports) + `:174-193` (mounts) |
| Env var truth | `api/core/config.py` — **not** `.env.example`, **not** CLAUDE.md §7 |
| Order lifecycle | `api/services/orders.py` (routes are 5-line wrappers) |
| Stock math | `db/schema.sql:450-578` + `db/migrations/006_store_scope_orders.sql` |
| Tenancy rules | `api/core/store_context.py` docstring (lines 1-23) is accurate |
| Scraper tier cascade | `api/services/scraper/engine.py:151` `run_job`, then `tiers/` |
| LLM merge policy | `api/services/full_intel.py` module docstring (lines 1-25) |
| Admin↔API contract | `admin/src/lib/api.ts` (hand-written, drifts silently) |
| Storefront↔API contract | `storefront/src/lib/api.ts` |
| Runtime config | `app_settings` rows, seeded in `001_app_settings.sql` / `002_scraper.sql` |
| Deploy shapes | `docker-compose.yml` vs `vercel.json` + `api/index.py` docstring |

## 8. Doc trust ranking

1. **Source code** — always wins.
2. `api/core/store_context.py`, `api/services/full_intel.py`, `api/index.py`, `db/migrations/005_stores.sql` docstrings — written with the current code, accurate.
3. `CLAUDE.md` — mostly right, but **pre-multi-store**: says 13 tables (really 21) and 18 route modules (really 17 files / 16 mounted, and it omits `stores.py`); presents `financial_transactions` as live (it is dead); understates the shadow-scrape-job issue.
4. `DEPLOY.md` — accurate except the `address`/`street` bug at line 137.
5. `README.md` — stale. Still "Ghir Laffaire", pre-storefront diagram, never mentions stores, GLAIVE, or the scraper/intel workers.
6. `docs/*.md` (10 files) — **all predate multi-store.** Historical value only. Treat as archaeology.
