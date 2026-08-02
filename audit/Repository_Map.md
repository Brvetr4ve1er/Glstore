# GLstore — Repository Map

**Audit date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` · **Read-only audit.**
Every row below was verified by reading the file or grepping its importers — not inferred. Where a claim is inference rather than a read, it is marked **SUSPECTED**; everything else is **CONFIRMED**. See `audit/_shared_context.md` and `audit/Architecture.md` for the system model this map assumes.

---

## 0. Top-level tree

```
GLstore/
├── api/                  FastAPI backend — routes/services/core, THE only backend
├── workers/              4 DB-polling background workers (import api/services/*)
├── db/                   schema.sql + migrations/ (000-006), seed files
├── storefront/           React 19 + Vite — public shop (the real customer surface)
├── admin/                React 19 + Vite — ops dashboard (JWT)
├── gaming-store/         static HTML/CSS/JS — GLAIVE brand prototype, NO API calls
├── scripts/              one-off ops scripts + scripts/deploy/ (Vercel path)
├── tests/                16 pytest files, backend-only, no route/app test
├── docker/               3 Dockerfiles (api, worker, scraper — scraper is heavier)
├── monitoring/           Prometheus + Grafana config — SEE §7, WIRED TO NOTHING
├── docs/                 10 pre-multi-store markdown docs — historical only
├── audit/                this audit's own output directory
├── docker-compose.yml    local dev stack: db+api+4 workers+searxng
├── docker-compose.observability.yml   prometheus+grafana add-on
├── vercel.json            Vercel serverless build manifest (storefront + api/index.py only)
├── CLAUDE.md              project anchor (mostly accurate, pre-multi-store in places)
├── DEPLOY.md              Vercel deploy guide (one bug — see Feature_Map "Deploy")
└── README.md              STALE — still describes "Ghir Laffaire", pre-storefront
```

---

## 1. `api/` — the backend

### 1.1 `api/core/` — cross-cutting infrastructure

| File | Purpose | Imported by (count) | Notes |
|---|---|---|---|
| `config.py` | `pydantic.BaseSettings`, the env source of truth | `db.py`, `security.py`, `store_context.py`, `main.py`, `auth.py`, `orders.py` (service) | No internal imports — leaf module |
| `db.py` | async SQLAlchemy engine + `SessionLocal` + `get_db()` dep. `NullPool` branch when `db_serverless=true` | **25 files** import it (every route + `store_context.py` + all 4 workers) — the single busiest module in the repo | Imports `config.py` only |
| `security.py` | bcrypt, JWT (`create_access_token`, `CurrentAdmin`), `require_role(*roles)` | **15 files**: every route except `catalog.py`, `public_orders.py` | Imports `config.py` only |
| `store_context.py` | ★ tenancy boundary. `Store` dataclass, `require_store` (Host-based), `require_admin_store_for` (x-store-id-based), `bound_store()` ContextVar reader | **13 files**: `main.py` + 10 routes + `services/events.py` + `services/orders.py` | Imports `config.py`, `db.py`. **NOT imported by** `intel.py`, `scraper.py`, `jobs.py`, `settings.py`, `products_export.py` — CONFIRMED via grep, this is the exact set of modules the Architecture audit flags as unscoped (§7.1/§6 of Architecture.md) |
| `migrations.py` | advisory-locked runner, SHA-256 checksum tamper detection, applies `db/migrations/*.sql` | `main.py` (lifespan), `scripts/deploy/init_remote_db.py`, `scripts/migrate.py` | No internal imports |
| `ratelimit.py` | in-memory sliding-window limiter, `RateLimiter` + `client_key()` | `main.py` only | No internal imports. Spoofable via XFF, unbounded `defaultdict` — see Architecture.md §7.10 |
| `logging.py` | JSON structured logs, `request_id` via ContextVar | `main.py` + all 4 workers | No internal imports |
| `health.py` | probe runner (`_run_with_timeout`, `overall_ok`) for `/healthz` family | `routes/health.py`, `tests/test_health.py` | Pure async logic, testable without a live DB |
| `metrics.py` | **CONFIRMED DEAD.** Full Prometheus wiring: `setup_metrics(app)`, `record_scrape_tier`, `observe_intel_duration`, `refresh_db_metrics`. Guards its own import so a missing `prometheus_client` doesn't crash | **Zero importers anywhere in the codebase** — repo-wide grep for `metrics` in `.py` finds only itself. `api/main.py` never calls `setup_metrics(app)` | See §7 below — this is a new finding, not in the shared Architecture doc |

### 1.2 `api/routes/` — 17 files, 16 mounted

| File | Mount (`api/main.py`) | Store dependency used | Entry points call into |
|---|---|---|---|
| `auth.py` | `/auth` | n/a (pre-auth) | `core.security`, `core.config` |
| `catalog.py` | `/` (public facets) | `require_store` | `core.store_context` |
| `images.py` | `/` (image review queue) | `require_admin_store_for` | `services.full_intel._recompute_status_and_completeness` |
| `products.py` | `/products` | **SPLIT**: GETs (`:83`, `:185`) use `require_store`; writes use `require_admin_store_for` | `models.schemas` |
| `products_import.py` | `/products/import` | `require_admin_store_for` | `services.csv_import`, `services.csv_parser`, `services.enrichment_runner` |
| `products_export.py` | **NOT MOUNTED** — not in `api/main.py:19` import list, never `include_router`'d | none (no `store_context` import at all) | `core.db`, `core.security` only |
| `enrichment.py` | `/products` | `require_admin_store_for`; defines `_assert_product_in_store()` (:31-38), the correct cross-tenant guard | `services.enrichment_runner`, `services.llm`, `services.llm_enrichment` |
| `intel.py` | `/` | **NONE** — no `store_context` import | `services.full_intel` (via worker, not directly) |
| `scraper.py` | `/` | **NONE** — no `store_context` import | — |
| `issues.py` | `/` | `require_admin_store_for` | `services.validator`, `services.enrichment.{KNOWN_BRANDS,BRAND_DESCRIPTIONS}` |
| `jobs.py` | `/jobs` | **NONE** — no `store_context` import | — |
| `orders.py` | `/orders` | `require_admin_store_for` + `require_store` (public create vs admin manage) | `services.orders` |
| `public_orders.py` | `/` | `require_store` | — |
| `events.py` | `/events` | `require_admin_store_for` | `models.schemas.EventIn` |
| `settings.py` | `/settings` + public `/storefront/theme` | **NONE** — global config, no store dep | `services.llm` |
| `health.py` | `/` (root, no `/api/v1` prefix) | n/a | `core.health` |
| `stores.py` | `/stores` — **omitted from CLAUDE.md's route table entirely** | scopes via `CurrentAdmin.store_id` directly, not the two helpers | `core.security` |

### 1.3 `api/services/` — all business logic, routes are thin wrappers

| File | Purpose | Depends on (internal) | Called by |
|---|---|---|---|
| `orders.py` | full order lifecycle: idempotency check → customer upsert → order-number → offer lock → insert → `fn_reserve_stock` → `emit_event` | `core.store_context.Store`, `models.schemas.OrderCreate`, `services.events.emit_event` | `routes/orders.py` |
| `events.py` | `emit_event()` — the *only* writer of the `events` outbox table | none | `services/orders.py` (×3), `routes/events.py` (indirectly, via schema only) |
| `enrichment.py` | deterministic rule engine: brand/category detection, spec extraction, completeness scoring | none (leaf) | `enrichment_runner.py`, `validator.py`, `routes/issues.py` |
| `enrichment_runner.py` | orchestrates rule enrichment + writes `observations` (derives `store_id` from product — correct pattern) | `services.enrichment.enrich` | `routes/enrichment.py`, `routes/products_import.py` |
| `llm.py` | LLM chat client (Ollama / Anthropic / OpenAI-compat), `chat(json_mode=True)` | none (leaf) | `full_intel.py`, `llm_enrichment.py`, `routes/enrichment.py`, `routes/settings.py` |
| `llm_enrichment.py` | LLM-only enrichment (no scraping), writes `observations` (`:133`, derives store_id) | `services.llm` | `routes/enrichment.py` |
| `full_intel.py` | full pipeline: scrape + LLM merge. Inserts shadow `scrape_jobs` row + commits (`:437-466`), writes `product_media` + `observations` (both derive store_id) | `services.llm`, `services.scraper.engine`, `services.scraper.types` | `workers/intel_worker.py`, `routes/images.py` (`_recompute_status_and_completeness`) |
| `csv_parser.py` | pure CSV row parsing/validation, no DB | none (leaf) | `csv_import.py`, `routes/products_import.py` |
| `csv_import.py` | commits parsed rows to DB, carries `store_id` | `services.csv_parser.RawProductRow` | `routes/products_import.py` |
| `validator.py` | catalog-quality issue detection (missing fields, low completeness) | `services.enrichment.{KNOWN_BRANDS, detect_brand, detect_category}` | `routes/issues.py` |
| `spec_sanitizer.py` | normalizes/cleans product `specs` JSONB | none (leaf) | (no importer found outside `tests/test_spec_sanitizer.py` — **SUSPECTED unused in routes**; not confirmed dead, needs deeper grep before flagging as such) |

### 1.4 `api/services/scraper/` — the 4-tier scraper subsystem

```
scraper/
├── engine.py            run_job() — orchestrator. Imports extractors, ranker, search,
│                         fetcher.TieredFetcher, types, utils.domain, validators.price_validator
├── search.py             SearXNG/DDG query → SearchResult list
├── ranker.py             scores/sorts SearchResult by relevance + tier quota
├── fetcher.py            TieredFetcher — cascades tiers/{1,2,3,3.5,4} in order
├── types.py              shared dataclasses (FetchResult, SourceTier, ExtractedData, ScrapeOutcome…) — the leaf every submodule imports
├── tiers/
│   ├── tier1_http.py        plain httpx
│   ├── tier2_playwright.py  headless browser (also imported directly by workers for lifecycle)
│   ├── tier3_stealth.py     imports tier2_playwright._fetch_inner (intra-package reuse)
│   ├── tier3_5_patchright.py  patched-Chromium variant
│   └── tier4_paid.py        paid fetch API fallback
├── extractors/           generic + per-site (jumia, ouedkniss, condor, batolis) HTML→data
├── retailers/            adapter layer: base.RetailerAdapter, classifier, images.extract_images,
│                         + jumia/ouedkniss/condor/batolis/facebook/midtier adapters
├── validators/           normalization.py (price/currency parsing), price_validator.py
└── utils/                cache.py, domain.py (host_of/should_skip — imported by 4 siblings),
                         proxy_manager.py, rate_limiter.py, robots.py
```
No circular imports found in this subpackage (verified by exhaustive grep of every file's `from api.services.scraper...` imports — see `audit/Dependency_Graph.md` §2 for the edge list). `types.py` and `utils/domain.py` are the two internal god-modules — nearly every other file in the subpackage imports one or both.

### 1.5 `api/models/`

| File | Purpose | Importers |
|---|---|---|
| `schemas.py` | **the only model file in the repo** — 187 lines of Pydantic DTOs, no ORM anywhere | Only 5 files: `routes/auth.py`, `routes/events.py`, `routes/orders.py`, `routes/products.py`, `services/orders.py`. Most routes build response shapes ad hoc rather than through a shared schema — **CONFIRMED narrower usage than the "the ONLY model file" framing implies uniform adoption** |

### 1.6 `api/index.py` and `api/main.py`

- `api/main.py` — app assembly: middleware stack (GZip, CORS, TrustedHost-in-prod, request-id, rate limit, security headers), lifespan (DB ping + migrations), 16 router mounts in a load-bearing order (static-path routers before `products.router`'s dynamic catcher — comment at `:169-173` explains why).
- `api/index.py` — Vercel entry point. 38 lines, re-exports `api.main.app` unchanged; its own docstring documents the required Vercel env vars. Confirmed **not** to import scraper/worker code at load time (keeps the serverless bundle Playwright-free).

---

## 2. `workers/` — 4 files, lifecycle-only

| File | Claims from | Calls into `api/services/` | Singleton? |
|---|---|---|---|
| `event_worker.py` | `events` table | none (writes `sync_queue` directly via SQL, no service import) | not enforced, but idempotent |
| `reservation_worker.py` | (no queue table — runs on a timer) | none — calls `fn_expire_stale_reservations()` / `fn_prune_observations()` directly via SQL | **documented singleton, comment only, no lock** (Architecture.md §7.12) |
| `scraper_worker.py` | `scrape_jobs` | `services.scraper.engine`, `services.scraper.tiers.tier2_playwright` | not enforced |
| `intel_worker.py` | `intel_jobs` | `services.full_intel`, `services.llm`, `services.scraper.tiers.tier2_playwright` | not enforced |

All 4 use the identical claim idiom: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING …`. None import each other or any route module — coordination is exclusively through DB rows (CONFIRMED, zero `from workers` imports found anywhere except each worker's own `__init__.py`, which is empty).

---

## 3. `db/`

| File | Purpose | Notes |
|---|---|---|
| `schema.sql` | base 13 tables + **inlined copies** of migrations 001-004 (lines 580, 609, 742, 778) | 831 lines. Migrations 005/006 are **not** inlined — two sources of truth for 4 of 6 migrations (Architecture.md §7.9) |
| `migrations/000_migrations_table.sql` … `006_store_scope_orders.sql` | the checksum-protected, auto-applied migration chain | `000` creates the `_migrations` bookkeeping table itself |
| `seed_admin.sql` | seeds the default admin login | loaded on every branch |
| `seed_gaming.sql` | GLAIVE catalog seed | **`gaming-store`-branch only** — loaded as `02-seed_gaming.sql` per CLAUDE.md §6 |

## 4. `storefront/` (React 19 + Vite) — public shop

```
storefront/src/
├── App.tsx            route table (9 lazy-loaded pages, all wired — no orphan pages)
├── main.tsx            bootstraps theme (lib/theme.ts) before render
├── lib/
│   ├── api.ts           ★ hand-written typed fetch wrapper — EVERY page/component
│   │                     that talks to the backend imports from here (god-module, see Dependency_Graph)
│   ├── cart.tsx          client-only cart state (localStorage), no server persistence
│   ├── theme.ts           GET /api/v1/storefront/theme bootstrap + apply
│   ├── format.ts, tags.ts, wilayas.ts, recently-viewed.ts, query.ts   pure helpers
├── components/         Navbar, Footer, ProductCard, ProductGallery, FilterSidebar,
│                        SearchBox, SortMenu, Breadcrumbs, SEO, ScrollReveal, ui.tsx, ErrorBoundary, BrandLogo
├── pages/               Home, Catalog, SearchResults, ProductDetail, Cart, Checkout,
│                        OrderConfirmation, OrderTracking, NotFound — all 9 present in App.tsx routes
└── __tests__/           format.test.ts (9 cases), tags.test.ts (9 cases) — vitest
```
**CONFIRMED** — every page listed in `App.tsx`'s lazy imports has a matching `<Route>`; no dead page files found in `pages/`.

## 5. `admin/` (React 19 + Vite) — ops dashboard

```
admin/src/
├── App.tsx             route table under RequireAuth+StoreProvider — 14 lazy pages, all wired
│                        (matches CLAUDE.md's "14 pages" claim exactly)
├── main.tsx             bootstraps cached theme pre-auth
├── lib/
│   ├── api.ts            ★ 827 lines — the largest single frontend file in the repo,
│   │                      god-module: every page and most components import from here.
│   │                      Injects x-store-id header on every request (:37-38, per Architecture.md §7.2)
│   ├── auth.tsx           JWT session state, login/logout
│   ├── store.tsx          store picker state — GET /stores, persists selection to localStorage
│   ├── theme.ts            theme presets + apply + cross-tab sync (BroadcastChannel)
│   └── query.ts, utils.ts  react-query client, formatters
├── components/          Layout, BrandLogo, ThemeSwitcher, IssuePanel, ui.tsx, ErrorBoundary
└── pages/ (14)          Login, Dashboard, Products, ProductDetail, ProductEditor, ProductImport,
                          IssueExplorer, Settings, ThemeStudio, JobsConsole, CatalogGraph,
                          Orders, OrderDetail, ImageReview (exports 2 route components:
                          ProductImageReview + GlobalImageQueue)
```
No admin-side test files exist (`find admin -iname '*.test.*' -o -iname '*.spec.*'` → empty). **CONFIRMED zero frontend test coverage on the admin app.**

## 6. `gaming-store/` — static prototype, zero backend integration

```
gaming-store/
├── index.html, shop.html, product.html, compare.html, checkout.html,
│   quiz.html, software.html, 404.html    8 static pages
├── assets/js/data.js     176-line hardcoded product array — the ENTIRE "database"
├── assets/js/app.js       961 lines vanilla JS. Only "API" mention (:641) is prose
│                          inside a mock checkout page — not a real fetch call
├── assets/css/styles.css
├── README.md, ANALYSIS.md   prototype's own docs
```
**CONFIRMED — no network calls.** Repo-wide grep for `fetch(` / `/api/` inside `gaming-store/**` returns exactly the one prose hit above. This directory has no runtime dependency on `api/`, `db/`, or either other frontend, and nothing else in the repo depends on it (not referenced from `docker-compose.yml`, `vercel.json`, or any backend route).

## 7. `monitoring/` and `docker-compose.observability.yml` — **CONFIRMED wired to a non-existent endpoint**

- `monitoring/prometheus.yml:14-15` scrapes `targets: ["api:8000"]`, `metrics_path: /metrics`.
- `monitoring/grafana/dashboards/glstore.json` presumably renders panels against those series (not opened line-by-line, but its existence presupposes the scrape works).
- `docker-compose.observability.yml:9` documents `/metrics: http://localhost:8000/metrics` as the intended endpoint.
- **But `api/core/metrics.py`'s `setup_metrics(app)` is never called anywhere** — `api/main.py` has no reference to `metrics` at all (verified by full read of `main.py`). Even if it were called, `prometheus-fastapi-instrumentator` and `prometheus_client` are **not in `requirements.txt`** (grep returns nothing), so `_PROM_AVAILABLE` would be `False` and `/metrics` would never register.
- Net effect: the entire observability add-on stack scrapes an endpoint that has never existed on any deployment. This is a new finding not previously catalogued in `audit/Architecture.md` or CLAUDE.md.

## 8. `scripts/`

| File | Purpose | Run by |
|---|---|---|
| `create_admin.py` | 78 lines — CLI to seed/create an admin user | manual ops |
| `migrate.py` | 123 lines — standalone migration runner (same engine as `api/core/migrations.py`) | manual ops / CI |
| `deploy/init_remote_db.py` | 169 lines — one-shot schema+migration apply against a remote (Neon) DB for the Vercel path | manual, once per environment |
| `deploy/smoke_test_checkout.py` | 179 lines — stdlib-only end-to-end checkout proof (the *only* test that exercises a live HTTP route against a real DB, per CLAUDE.md's own admission) | manual, post-deploy |

## 9. `tests/` — 16 files, backend-only

No test file imports `api.main` or any `api.routes.*` module (verified: every `from api...` import across all 16 files resolves to `api.services.*` or `api.core.{health,logging,migrations}`). `tests/test_bulk_operations.py` is the sharpest example: its docstring claims it will "verify the route is registered via the APIRouter path list" (`:10`), but **CONFIRMED by reading the full file — no such assertion exists**; every test asserts against constants re-declared inside the test file itself (`EXPECTED_COLUMNS`, locally-defined Pydantic-like checks), and the router under test (`products_export.py`) isn't even mounted. The test suite is green regardless of whether that router would work.

Storefront adds 2 vitest files (`format.test.ts`, `tags.test.ts`, 9 cases each); admin has none.

## 10. Files provably unreferenced

| File | Proof | Severity of leaving as-is |
|---|---|---|
| `api/routes/products_export.py` | Not in `api/main.py:19` import list; repo-wide grep for `products_export` outside this file and docs returns nothing; neither frontend calls `/export`, `/bulk-update`, or `/bulk-status` (checked `admin/src`, `storefront/src`) | Medium — also contains 2 dormant `store_id`-missing INSERTs (`:278`, `:359`) that would break on mount |
| `api/core/metrics.py` | Zero importers repo-wide; `setup_metrics()` never called from `main.py`; Prometheus deps absent from `requirements.txt` | Medium — dead code plus a monitoring stack (`monitoring/`, `docker-compose.observability.yml`) that silently does nothing |
| `financial_transactions`, `audit_log` (DB tables, not files, but namable) | Zero Python/TS references anywhere except schema + docs (per Architecture.md §7.6) | Medium-High, financial/audit-controls gap |

No other file was found unreferenced — every route, service, worker, and frontend page/component has at least one importer or router mount, confirmed by grep against its exact module path.

---

*Prepared as part of a three-file repository-intelligence audit. Companion files: `audit/Dependency_Graph.md`, `audit/Feature_Map.md`.*
