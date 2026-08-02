# GLstore — Feature Map

**Audit date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` · **Read-only audit.**
Each feature is traced end to end through the exact files that implement it. **Coverage** reports what actually exists in `tests/` (16 pytest files, backend-only) or `storefront/src/__tests__` (2 vitest files) by name — not aspirational coverage. "None" means grep for the implementing module inside `tests/` returned zero hits.

**Global coverage fact, verified once, applies to every backend feature below unless noted:** no test in `tests/` imports `api.main` or any `api.routes.*` module. So **no feature below has a test that exercises its HTTP route** — "Unit only" in the Coverage column always means service/helper-level unit tests, never a route-level or end-to-end test, except the one exception in §7.

---

## 1. Storefront — customer-facing (public, no auth)

| Feature | Files (call order) | Coverage |
|---|---|---|
| **Theme bootstrap** | `storefront/src/main.tsx` → `lib/theme.ts:372` → `GET /api/v1/storefront/theme` → `api/routes/settings.py:349` `_load_theme(db, 'storefront.theme')` → `app_settings` table (global, not store-scoped) | None |
| **Home / category facets** | `pages/Home.tsx` → `lib/api.ts:100-110` (`fetchCategories`, `fetchFeatured`) → `api/routes/catalog.py:28,47,66,274` (`require_store`) | None |
| **Catalog list + filters + sort** | `pages/Catalog.tsx` + `components/FilterSidebar.tsx` + `components/SortMenu.tsx` → `lib/api.ts:112` `fetchProducts` → `api/routes/products.py:70` `list_products` (`require_store`, `:83`) | None (route); indirectly the *data quality* it displays is covered by `tests/test_enrichment.py`, `tests/test_validator.py` |
| **Search** | `components/SearchBox.tsx`, `pages/SearchResults.tsx` → `lib/api.ts` `fetchProducts` (same endpoint, query param) | None |
| **Product detail** | `pages/ProductDetail.tsx` → `lib/api.ts:121` `fetchProduct` → `api/routes/products.py:181` (`require_store`, `:185`) | None |
| **Cart (client-side)** | `lib/cart.tsx` — pure localStorage, no server call | `storefront/src/__tests__/` has none for cart specifically (only `format.test.ts`, `tags.test.ts`) |
| **Cart re-validation** | `pages/Cart.tsx` → `lib/api.ts:197` `fetchOffersAvailability` → `POST /offers/availability` → `api/routes/public_orders.py:30` (store-scoped, `o.store_id = :sid` at `:60`) | None |
| **Checkout / order creation** | `pages/Checkout.tsx` → `lib/api.ts:175` `createOrder` → `POST /orders/create` → `api/routes/orders.py:20` (`require_store`) → `api/services/orders.py:70` `create_order` (idempotency `:72` → `_upsert_customer` `:22` → `_next_order_number` `:54` → offer lock `:89-102` → `INSERT orders` `:128` → `INSERT order_items` `:162` → `fn_reserve_stock` `:181` → `UPDATE status='RESERVED'` `:190` → `emit_event('order.created')` `:195`) → `db.commit()` at `orders.py:32` | **Route/service logic: None.** Only proof this path works end-to-end at all is the manual `scripts/deploy/smoke_test_checkout.py` (see §7) — not part of the automated suite |
| **Stock hold (DB function)** | `db/migrations/006_store_scope_orders.sql:17-58` `fn_reserve_stock` — row-locks offer, derives `store_id`, inserts `inventory_reservations` | None (no SQL-function test harness exists in the repo) |
| **Order confirmation page** | `pages/OrderConfirmation.tsx` → reads order returned by checkout | None |
| **Order tracking** | `pages/OrderTracking.tsx` → `lib/api.ts` `trackOrder` → `POST /orders/track` → `api/routes/public_orders.py:128` (store-scoped, constant-shape 404 at `:122` to avoid enumeration) | None |

**Notable gap, CONFIRMED:** the single highest-value business flow in the whole system — browse→cart→checkout→reserve — has **zero automated test at any layer except the manual smoke script**. `api/services/orders.py` (332 lines, the entire order lifecycle) has no `tests/test_orders*.py` file; grep for `orders` inside `tests/` returns nothing.

---

## 2. Admin — ops dashboard (JWT auth)

| Feature | Files (call order) | Coverage |
|---|---|---|
| **Login** | `pages/Login.tsx` → `lib/auth.tsx` → `POST /auth/login` → `api/routes/auth.py` (per-account lockout via `admin_users.failed_attempts/locked_until`; per-IP tracker `:34-80`, XFF-spoofable) → `api/core/security.py:30` `create_access_token` (embeds `store_id` in JWT, `:75-81`) | None. No `tests/test_auth.py` exists; grep for `security.py`'s JWT/bcrypt functions inside `tests/` returns nothing |
| **Store picker** | `lib/store.tsx` → `GET /stores` → `api/routes/stores.py:52` `list_stores` — platform operator sees all, scoped operator sees only theirs. Selection persisted to `localStorage['gl.admin.store_id']`, sent as `x-store-id` on every subsequent request (`admin/src/lib/api.ts:37-38, 74-75`) | None. `stores.py` has **only GET endpoints** — no create/edit-store flow exists anywhere in the admin UI; new stores are provisioned only via migration/seed |
| **Product list** | `pages/Products.tsx` → `GET /products` → `products.py:70` — **resolves store via Host header, ignores the `x-store-id` the admin just sent** ⚠ (Architecture.md §7.2) | None |
| **Product detail (admin)** | `pages/ProductDetail.tsx` (admin) → `GET /products/{id}` → `products.py:181` — **also Host-scoped**, same mismatch | None |
| **Product create / edit / delete** | `pages/ProductEditor.tsx` → `POST /products` (`:257`) / `PATCH /products/{id}` (`:308`) / `DELETE /products/{id}` (`:352`) — all `require_admin_store_for` (`x-store-id`-correct) | None |
| **Offer (variant/inventory) CRUD** | `products.py:437,456,500` — `require_admin_store_for` | None |
| **CSV import** | `pages/ProductImport.tsx` → `api/routes/products_import.py` → `api/services/csv_parser.py` (parse/validate) → `api/services/csv_import.py:256,302` (commit, carries `store_id`) → optionally `enrichment_runner` on import | `csv_parser.py` — **Unit-tested**, `tests/test_csv_parser.py` (18 cases). `csv_import.py` (the commit half) — **None**. Route — None |
| **Image review queue** | `pages/ImageReview.tsx` (exports both `ProductImageReview` and `GlobalImageQueue`) → `api/routes/images.py:49,105,171,213,258` — all 5 endpoints correctly `require_admin_store_for` | None |
| **Issue explorer (catalog quality)** | `pages/IssueExplorer.tsx` → `api/routes/issues.py` (store-scoped) → `api/services/validator.py` | `validator.py` — **Unit-tested**, `tests/test_validator.py` (16 cases). Route — None |
| **Catalog relationship graph** | `pages/CatalogGraph.tsx` → `GET /products/graph` → `api/routes/catalog.py:87` — **Host-scoped**, same admin/store mismatch class as product list | None |
| **Orders management (list/detail/confirm/cancel)** | `pages/Orders.tsx`, `pages/OrderDetail.tsx` → `api/routes/orders.py:36,47,59,68` — `require_admin_store_for` ✅ (the one correctly-scoped admin-facing order surface) | None |
| **Settings — LLM / scraper / theme config** | `pages/Settings.tsx`, `pages/ThemeStudio.tsx` → `api/routes/settings.py` — **globally scoped, no store dependency at all**; `PUT /settings/theme` (`:314`) and `PUT /settings/scraper` (`scraper.py:430`) are cross-tenant writes by any store's ADMIN | None |
| **Jobs console (unified queue view)** | `pages/JobsConsole.tsx` → `api/routes/jobs.py` (9 endpoints, reads `scrape_jobs`/`events`/`sync_queue`/`intel_jobs`) — **no store dependency at all**, so any authenticated role sees every store's queue activity | None |

---

## 3. Catalog intelligence — 4 overlapping enrichment paths

| Feature | Files (call order) | Coverage |
|---|---|---|
| **c1 — Rule-based enrichment** (no network) | `api/routes/enrichment.py:40,54` → `api/services/enrichment_runner.py` → `api/services/enrichment.py` (deterministic brand/category/spec rules) → observation write `enrichment_runner.py:91` (correctly derives `store_id` from product) | `enrichment.py` (the rule engine itself) — **Unit-tested**, `tests/test_enrichment.py` (28 cases, the largest single test file). `enrichment_runner.py` (the orchestrator/DB-write half) — **None** |
| **c2 — Scrape only** (competitor price collection) | `api/routes/scraper.py:47` `enqueue_scrape` (**no store dep**) → `INSERT scrape_jobs` → `workers/scraper_worker.py:46` claim → `api/services/scraper/engine.py:151` `run_job`: `search.py` → `ranker.py` → `fetcher.py` tier cascade (`tier1_http` → `tier2_playwright` → `tier3_stealth`/`tier3_5_patchright` → `tier4_paid`) → retailer adapters (`retailers/{jumia,ouedkniss,batolis,condor,facebook,midtier}.py`) → `extractors/*.py` → `validators/{normalization,price_validator}.py` → persist `scrape_sources` + `competitor_prices` → `scraper_worker.py:100` `_mark_complete` | **Heaviest-tested subsystem in the repo.** `tests/test_retailer_adapters.py` (37), `tests/test_dz_adapters.py` (6), `tests/test_ouedkniss_adapter.py` (9), `tests/test_extractors_generic.py` (6), `tests/test_scraper_domain.py` (14), `tests/test_scraper_normalization.py` (15), `tests/test_scraper_validator.py` (13) = **100 unit tests**, all at the pure-function/adapter level. `engine.py`'s own orchestration (`run_job`), `fetcher.py`'s tier cascade, and the route (`enqueue_scrape`) — **no test touches any of them directly** |
| **c3 — Full intel** (scrape + LLM merge) | `api/routes/intel.py:37` (single) / `:114` (bulk) (**no store dep**) → `INSERT intel_jobs` → `workers/intel_worker.py:47` claim → `api/services/full_intel.py`: `load_target` → shadow `scrape_jobs` INSERT + commit (`:437-466`, never completed — see Repository_Map/Architecture §7.3) → `scraper_engine.run_job` → `build_markdown_bundle` → `api/services/llm.py` `chat(json_mode=True)` → `apply_payload` (tiered field merge) → `INSERT product_media` (`:315`) + `INSERT observations` (`:344`) (both correctly derive `store_id`) → `intel_worker.py:102` `_mark_complete` (updates `intel_jobs` only, never the shadow row) | `full_intel.py` — **None**. `llm.py` — **None**. This is the most business-critical and most complex single service file in the repo (525 lines) and has zero direct test coverage |
| **c4 — LLM enrichment without scraping** | `api/routes/enrichment.py:99,116` → `api/services/llm_enrichment.py` → observation write `:133` (correctly derives `store_id`) | None |
| **Cross-tenant guard pattern** | `_assert_product_in_store()` defined and used in `api/routes/enrichment.py:31-38`. **Not called from** `intel.py`, `scraper.py`, or `jobs.py` — CONFIRMED via grep (zero hits for `_assert_product_in_store` outside `enrichment.py`) | The guard itself has no dedicated unit test either |

---

## 4. Background workers

| Feature | Files | Coverage |
|---|---|---|
| **Event fan-out** (`events` → `sync_queue`) | `workers/event_worker.py:107` claim loop → `:37` `handle_order_created` → `INSERT sync_queue` (dead-end integration — no reader exists anywhere, see Architecture.md §3) | None |
| **Reservation TTL expiry** | `workers/reservation_worker.py:34` every 30s → `fn_expire_stale_reservations()` (`db/schema.sql:559`) → `fn_release_reservation()` (`:531`); also nightly `fn_prune_observations()` | None |
| **Scraper worker execution** | `workers/scraper_worker.py:46-61` claim → delegates to `services/scraper/engine.py` (see c2 above) | Same as c2 — component-level only, no worker-loop test |
| **Intel worker execution** | `workers/intel_worker.py:47` claim → `:92` `_mark_running` + heartbeat `:143` → delegates to `services/full_intel.py` (see c3 above) | None |

No worker file (`event_`, `reservation_`, `scraper_`, `intel_worker.py`) is imported by any test — grep for `workers` inside `tests/` returns zero hits.

---

## 5. Platform / infrastructure features

| Feature | Files | Coverage |
|---|---|---|
| **Multi-store tenancy (Host-based public resolution)** | `api/core/store_context.py:168` `require_store` — 60s-cached `store_domains` lookup | None. `store_context.py` has no dedicated test file despite being the newest and most architecturally load-bearing module in the backend |
| **Multi-store tenancy (admin `x-store-id` resolution)** | `store_context.py:235` `require_admin_store_for` | None |
| **Health checks** | `api/routes/health.py` → `api/core/health.py` (`_run_with_timeout`, `overall_ok`) — `/healthz`, `/readyz`, `/healthz/details` | **Unit-tested**, `tests/test_health.py` (7 cases) — pure async logic only; the docstring itself says route-level integration is deferred to a future e2e suite |
| **DB migrations runner** | `api/core/migrations.py` — advisory lock, SHA-256 checksum tamper detection | **Unit-tested**, `tests/test_migrations.py` (14 cases) |
| **Structured logging** | `api/core/logging.py` — JSON logs, `request_id` ContextVar | **Unit-tested**, `tests/test_logging.py` (12 cases) |
| **Rate limiting** | `api/core/ratelimit.py` — spoofable via XFF, unbounded `defaultdict` (Architecture.md §7.10) | None |
| **Observability (Prometheus/Grafana)** | `api/core/metrics.py` (`setup_metrics`, `refresh_db_metrics`, `record_scrape_tier`, `observe_intel_duration`) — **CONFIRMED never called from `api/main.py`**, and `prometheus_client`/`prometheus-fastapi-instrumentator` are absent from `requirements.txt`. `monitoring/prometheus.yml` scrapes a `/metrics` endpoint that has never existed on any deployment | N/A — the feature is not live in either deployment shape |
| **Deploy — Docker Compose** | `docker-compose.yml` (db + api + 4 workers + searxng), `docker/Dockerfile.{api,worker,scraper}` | Not unit-testable; `scripts/deploy/smoke_test_checkout.py` exercises the API surface this compose stack serves |
| **Deploy — Vercel serverless** | `vercel.json` (builds `storefront/package.json` + `api/index.py` only — **no workers, no admin app**), `api/index.py`, `scripts/deploy/init_remote_db.py` | See §7 |

---

## 6. `gaming-store/` — design prototype, not integrated

| Feature | Files | Coverage |
|---|---|---|
| Static shop UI (8 pages), mock checkout, quiz, compare | `gaming-store/*.html`, `assets/js/{app.js,data.js}` | No test infra of any kind (no package.json test script, no test files found under `gaming-store/`). **CONFIRMED zero backend calls** — the entire "catalog" is the hardcoded 176-line `data.js` array. Not part of the FastAPI/Postgres system in any way; changes here cannot break or be broken by the rest of the audit's findings |

---

## 7. The one genuine end-to-end test in the repo

`scripts/deploy/smoke_test_checkout.py` (179 lines, stdlib-only — no pytest, not run by CI as part of the suite) is the **only** code in the repository that exercises a real HTTP request against a real database for the checkout flow. It correctly uses `"street"` for the shipping address field (`:151`), unlike `DEPLOY.md:137`'s copy-pasteable curl example, which uses `"address"` and will 422 (schema requires `street` per `api/models/schemas.py:108-112`). This script is a **manual** deploy-verification tool, not part of `tests/` and not collected by `pytest`.

---

## 8. Coverage summary

| Layer | Has unit tests | Has route/HTTP tests | Has end-to-end tests |
|---|---|---|---|
| Pure logic (`enrichment.py`, `validator.py`, `spec_sanitizer.py`, `csv_parser.py`, scraper adapters/validators/normalization) | **Yes — heavily** (≈200+ of the ≈231 backend pytest cases live here) | No | No |
| Orchestration services (`orders.py`, `full_intel.py`, `enrichment_runner.py`, `llm.py`, `llm_enrichment.py`, `csv_import.py`, `events.py`, `engine.py`) | **No** | No | No |
| `api/core/*` (`db`, `security`, `store_context`, `ratelimit`, `config`) except `health`/`logging`/`migrations` | No | No | No |
| Every route (all 17 files) | No | No | No |
| Every worker (all 4 files) | No | No | No |
| Storefront (`storefront/src`) | 2 files, 18 cases (`format.ts`, `tags.ts` only) | n/a | No |
| Admin (`admin/src`) | **None** | n/a | No |
| Checkout flow specifically | No | No | **Yes, but only via a manual script not in the test suite** (`scripts/deploy/smoke_test_checkout.py`) |

The suite is heavily weighted toward the scraper's pure-function layer (adapters, normalization, validators — ≈100 of ≈231 cases) and almost entirely absent from anything that touches the database, an HTTP route, or a frontend component beyond two small utility files. This exactly matches — and this audit independently reconfirms — the gap already identified in `audit/Architecture.md` §7.5: **the four already-fixed `store_id` NOT NULL bugs were undetectable by this suite by construction**, because nothing in it ever inserts a row into a real table.

---

*Prepared as part of a three-file repository-intelligence audit. Companion files: `audit/Repository_Map.md`, `audit/Dependency_Graph.md`.*
