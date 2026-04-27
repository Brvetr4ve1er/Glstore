# System Context — Ghir Laffaire

> Single source of truth. If documentation conflicts with this file, update the other doc.

---

## 1. System Overview

**Ghir Laffaire** is a vertically-integrated e-commerce + intelligence platform for the Algerian consumer-electronics market. It does three things at once:

1. **Sells** — public storefront for browsing, searching, ordering (COD-first).
2. **Operates** — admin console for managing the catalog, orders, and operations.
3. **Enriches** — automated pipelines that turn messy supplier CSVs into clean, decorated, market-aware product data via rules + LLM + competitor scraping.

The platform is **single-tenant** (one store, one brand) but **multi-admin** (role-based: SUPER_ADMIN > ADMIN > OPERATOR > VIEWER). It is built for the **Algerian DZD market** — currency, shipping wilayas, brand catalog, all DZ-localised.

The "intelligence" angle is what differentiates it from off-the-shelf Shopify-style storefronts. Three layers of enrichment progressively decorate every product:

| Layer | When | Cost | Coverage |
|---|---|---|---|
| **Rule engine** (Phase 2) | Auto on import + on-demand | Free | 100% of catalog |
| **LLM** (Phase 4) | On-demand or bulk | $0.001-0.01/product | Whatever you opt in |
| **Web scraper** (Phase 5) | On-demand jobs | Free → ~$0.01 if Tier 4 | Whatever you scrape |

Product data accretes layer by layer. The schema (`observations` table) records every fact's provenance and confidence, so you can always trace "where did this spec come from?"

---

## 2. Core Components

### 2.1 PostgreSQL (Write Model)

**Role:** authoritative state. Every other component reads/writes through it.
**Why:** CQRS-shaped, no Read Model yet (premature for current scale).
**Key invariants:**
- `CHECK (reserved_quantity <= stock_quantity)` — overselling structurally impossible
- `UNIQUE (idempotency_key)` on orders — no double-charges
- `UNIQUE (product_id, source_domain, observed_at)` on competitor_prices — no daily duplicates
- ENUM types enforce state machines (order, payment, scrape, product status)

### 2.2 FastAPI service (`api/`)

**Role:** every external read/write goes through here. JWT-protected admin endpoints, public catalog/order endpoints.
**Why:** async-first (asyncpg + SQLAlchemy 2 async). Type-safe via Pydantic. Stateless — horizontally scalable except for the in-process rate limiter.
**Key middleware:** request-id + rate-limit + CORS + GZip + security headers.

### 2.3 Async workers (`workers/`)

Four workers, all polling Postgres with `FOR UPDATE SKIP LOCKED`:

| Worker | Polls table | Job type |
|---|---|---|
| `event_worker` | `events` | downstream sync (n8n, accounting hooks) |
| `reservation_worker` | `inventory_reservations` | release stale stock holds every 30s |
| `scraper_worker` | `scrape_jobs` | run a multi-tier scrape pipeline |
| `intel_worker` | `intel_jobs` | run **Full Intel** = scrape + LLM + tiered merge (Phase 9) |

All horizontally scalable: `docker compose up -d --scale event_worker=3`. `intel_worker` and `scraper_worker` both run a 60-second heartbeat loop (`UPDATE claimed_at = NOW()`) plus a stale-claim sweeper (5-minute threshold) so a crashed worker's claims are returned to the queue automatically.

### 2.4 Rule-based enrichment (`api/services/enrichment.py`)

**Role:** pure-Python regex + lookup table. Detects brand (60 known DZ + intl), classifies category (65 patterns), extracts numeric specs (KG, L, W, BTU, HP, screen sizes), synthesises sensible defaults via 14 `ATTR_BUILDERS`.
**Why:** runs in microseconds, no network, deterministic. 100% catalog coverage. Should always run first.

### 2.5 LLM client (`api/services/llm.py`)

**Role:** pluggable client for Ollama / OpenAI-compat / Anthropic. JSON-mode with repair fallback. Config in `app_settings.llm.config`.
**Why:** local Ollama is free, hosted is opt-in. Same prompt works across all three.

### 2.6 LLM enrichment orchestrator (`api/services/llm_enrichment.py`)

**Role:** prompts the LLM with structured product facts → parses JSON → merges into `products.specs` (additive — never overwrites rule-engine keys) → updates `description` only if missing/short → recomputes completeness inline via SQL.
**Why:** the LLM extends but doesn't override deterministic rule output. This keeps the catalog stable even if the LLM hallucinates.

### 2.7 Multi-tier scraper (`api/services/scraper/`)

**Role:** discover + extract competitor prices, specs, and images from the web.
**Why:** market-awareness (margin alerts) + spec discovery for products the rule engine couldn't classify.
**Tier ladder** (research-aligned):

| Tier | Tool | Cost | Use |
|---|---|---|---|
| 1 | httpx + BS4 + JSON-LD | free | static HTML, ~60-70% of sites |
| 2 | Playwright | free (CPU/RAM) | JS-rendered storefronts |
| 3 | Playwright + stealth + networkidle | free | Cloudflare-protected (Ouedkniss) |
| 4 | Paid API (ScraperAPI / ScrapingBee / Zyte) | $0.001-0.01/req | last-resort, opt-in |

### 2.8 Admin SPA (`admin/`)

**Role:** internal console. JWT-protected. Manages products, offers, orders, enrichment, scraper config.
**Why:** React 19 + Vite + Tailwind 4. Lazy-routed. TanStack Query for server state. Framer Motion for visible motion. Brand-styled.

### 2.9 Storefront SPA (`storefront/`)

**Role:** public-facing site. No auth. Browse, search, cart, checkout.
**Why:** separate Vite app — different audience, different perf budget, different security model.

### 2.10 SearXNG container

**Role:** federated meta-search engine. Used by the scraper to issue queries across Google/Bing/DuckDuckGo/Qwant simultaneously without API keys.
**Why:** ~50MB RAM, free, privacy-first. The scraper's primary search backend; DDG-HTML is fallback.

---

## 3. Data Lifecycle

### 3.1 A product's life

```
                         (CSV file)
                              │
                              ▼
         ┌─────── csv_parser.parse() (pure) ────────┐
         │                                            │
         ▼                                            ▼
  csv_import.preview_import()           csv_import.commit_import()
         │                                            │
         │ no DB writes — admin reviews              │ idempotent upsert by SKU
         ▼                                            │
  preview_report                                      ▼
                                          INSERT/UPDATE products + offers
                                                      │
                                                      ▼
                                          [auto_enrich = True by default]
                                          enrichment_runner.enrich_many()
                                                      │
                              ┌───────────────────────┴───────────────────────┐
                              │                                                 │
                              ▼                                                 ▼
           Detect brand (60 known)                              Detect category (65 patterns)
                              │                                                 │
                              └───────────────┬─────────────────────────────────┘
                                              ▼
                            Extract specs (KG/L/W/BTU/HP/screen)
                                              │
                                              ▼
                          ATTR_BUILDERS synthesise defaults per category
                                              │
                                              ▼
                  UPDATE products.brand/category/specs/description/status
                  INSERT observations × N (audit trail with confidence)
                                              │
                                              │
   [user clicks "Draft with LLM"]             │
                  │                            │
                  ▼                            │
   llm_enrichment.enrich_one()                 │
   → llm.chat(structured prompt)               │
   → JSON parse + repair                       │
   → merge ADDITIVELY into specs               │
   → update description if missing/short       │
   → INSERT observations × N                   │
                  │                            │
                  └────────────┬───────────────┘
                               ▼
                       products.completeness_score
                       recomputed (inline SQL)
                       status auto-promotes
                       (NEEDS_FIX → CLASSIFIED → VERIFIED)
                               │
                               ▼
   [user clicks "Get market intel" — Phase 5]
                  │
                  ▼
   POST /products/{id}/scrape → INSERT scrape_jobs (PENDING)
                  │
                  ▼ scraper_worker polls
   ┌───────────────────────────────────────────────────────┐
   │ search.search() → SearXNG / DDG fallback              │
   │ ranker.rank_and_diversify(max=6) → 1 official + …     │
   │ for url (parallel sem=3):                              │
   │     fetcher.fetch(url) → cache → robots → rate-limit   │
   │       → tier escalation 1 → 2 → 3 → 4                  │
   │     extractors.extract(html) → JSON-LD → microdata     │
   │       → OpenGraph → CSS heuristic                      │
   │     price_validator.validate_one()                     │
   │       → bounds + tier-trust weighting                  │
   │ consensus_of(prices) → median + ±20% agreement check   │
   │ INSERT scrape_sources × N (audit per URL)              │
   │ INSERT competitor_prices × M (idempotent on day)       │
   │ UPDATE scrape_jobs status='COMPLETED' + summary        │
   └───────────────────────────────────────────────────────┘
                               │
                               ▼
                    Admin sees market intel:
                    - median price + delta vs ours
                    - per-source list with confidence
                    - margin alert if our price > median × 1.10
```

### 3.2 An order's life

```
[Storefront] cart in localStorage
     │ user clicks "Confirmer la commande"
     ▼
POST /orders/create
{ customer_phone, customer_name, items: [{offer_id, qty}], shipping_address, idempotency_key }
     │
     ▼
upsert customers (dedupe by phone_normalized)
     │
     ▼
SELECT offers WHERE id = ANY(...) FOR UPDATE   ← row-lock
     │
     ▼
INSERT orders (status='PENDING')
INSERT order_items × N (price snapshot — immutable)
fn_reserve_stock(offer_id, order_id, item_id, qty, ttl) × N
   ↓ atomic: UPDATE offers SET reserved_quantity += qty
              CHECK (reserved_quantity <= stock_quantity) — fails if oversold
     │
     ▼
UPDATE orders SET status = 'RESERVED'
emit_event('order.created')   ← INSERT events row
COMMIT
     │
     ▼
event_worker polls → INSERT sync_queue (n8n) → mark COMPLETED

(if customer doesn't pay within reservation_ttl_minutes:
 reservation_worker → fn_expire_stale_reservations()
                   → fn_release_reservation per stale row
                   → reserved_quantity -= qty)

(admin clicks "Confirm" in console:
 POST /orders/{id}/confirm → fn_consume_reservation per item
                          → reserved_quantity -= qty
                          → stock_quantity   -= qty
                          → status='CONFIRMED' → PACKED → SHIPPED → DELIVERED)
```

---

## 4. Key Design Decisions

This section explains the **why** behind every controversial choice. If you disagree with one, read the rationale before proposing a change.

### 4.1 Why CQRS-shaped Write Model and no Read Model yet

**Decision:** every read hits the authoritative tables directly.
**Why:** the catalog is small (567 products today, target 5-10K). Postgres can serve all reads under 50ms with proper indexes. Adding a Read Model adds: cache invalidation, eventual consistency surprises, two systems to debug. **Defer until measured pain.**
**When to revisit:** `/products` p95 > 200ms or catalog > 50K SKUs.

### 4.2 Why no customer accounts

**Decision:** the storefront has no signup, no login, no password.
**Why:** Algerian market is COD-first. Customers don't trust online accounts. Eliminates a huge auth/PII surface. Cart lives in localStorage. Order tracking will be by phone+order# (a small future endpoint).

### 4.3 Why localStorage cart, not server-side

**Decision:** cart state lives in the browser only.
**Why:** zero server cost, zero session management, scales infinitely. The downside (cross-device cart) is irrelevant when there's no account.

### 4.4 Why Postgres-as-queue instead of Redis/RabbitMQ

**Decision:** `events`, `inventory_reservations`, `scrape_jobs` are all Postgres tables polled by workers.
**Why:** **transactional consistency**. When you create an order + reserve stock + emit an event, all four happen in the same transaction. With Redis you'd need an outbox pattern.
**Cost:** poll interval (3s for scraper, 1s for events) means latency is 0-3s, not microseconds. Acceptable for our use case.

### 4.5 Why tier-escalation in scraping (not "use Playwright for everything")

**Decision:** start with Tier 1 (httpx) and escalate only on failure.
**Why:** **economics**. Per the deep-research report, Tier 1 covers 60-70% of static sites at ~1s and zero CPU. Playwright takes 5-15s and 200MB RSS. Burning Playwright on every fetch when most fetches don't need it is wasteful.
**Cost:** more code (4 tier modules + escalation logic). Worth it.

### 4.6 Why confidence scoring + cross-source consensus

**Decision:** every extractor self-rates `confidence`. Validator weights by source tier. Cross-source agreement boosts/drops confidence.
**Why:** scraping is noisy. A single bad price (typo, promo, parser bug) shouldn't poison the median. Multi-source agreement is the cheapest sanity check we have.
**Real number:** even with all 60 brands hardcoded right and 65 category patterns, we expect ~80% accuracy on price extraction. Without consensus, that 20% would silently corrupt margin calculations.

### 4.7 Why three observation-writer paths today

**Decision:** rule-engine, LLM, and scraper each write `observations` differently.
**Why:** historical — each phase added its own. **This is debt** (see SYSTEM_AUDIT.md, Technical Debt #1). Should be unified into `services/observations.py:record(...)`.

### 4.8 Why robots.txt is honored permissively (allow-on-failure)

**Decision:** if robots.txt is unreachable, we proceed.
**Why:** the spec says no robots.txt = implicit allow. Strict mode would mean any DNS hiccup kills our scrape coverage.
**Honest trade-off:** we do not respect robots.txt blocks — we **honor** them. If a site is down or returns 500 on /robots.txt, we scrape anyway. Production-strict policy would change this.

### 4.9 Why admin and storefront are separate Vite apps

**Decision:** two npm projects, two Vite dev servers, one shared backend.
**Why:** different audiences, different bundle budgets, different threat models. Admin can ship 500KB; storefront wants 200KB. Admin tolerates JWT-localStorage; storefront avoids any auth surface entirely.

### 4.10 Why the scraper worker is a separate Docker image

**Decision:** `Dockerfile.scraper` instead of using the regular worker image.
**Why:** Playwright + Chromium adds ~500MB. The API and other workers stay slim (<200MB). Failure of `playwright install chromium` doesn't break the rest of the stack.

### 4.11 Why we store enriched scraper data in `products.specs` JSONB rather than a typed column

**Decision:** all extra specs (energy class, dimensions, refresh rate, etc.) live in `products.specs JSONB`.
**Why:** specs are category-dependent (TVs have refresh rate, washing machines don't). Modeling each as a column would either explode the schema or force NULLable columns. JSONB lets us evolve the spec shape per category without migrations.
**Cost:** can't index efficiently for filtering by arbitrary spec. Acceptable today.

### 4.12 Why we keep raw CSV columns in `products.specs`

**Decision:** on import, we stash the entire raw row in `products.specs` (under non-aux keys).
**Why:** **never lose source data**. If a column we don't currently understand turns out to matter later, we still have it.
**Cost:** specs JSONB grows. Trim during retention if needed.

---

## 5. Known Limitations

This is what the system cannot do today. Not a roadmap — a limitations list.

### Product / catalog
- ✘ No customer reviews/ratings (no schema)
- ✘ No product variants beyond SKU+attrs (no size/color matrix)
- ✘ No bundles or complementary upsell logic at checkout
- ✘ No image upload to R2 (URLs only)
- ✘ No multi-currency display (DZD only)

### Search
- ✘ No fuzzy / typo-tolerant search (ILIKE only)
- ✘ No faceted search beyond brand + category + price + stock
- ✘ No autocomplete by category or by brand alone (only by full product)

### Pricing / margin
- ✘ No dynamic pricing or competitor-aware repricing
- ✘ No promotion engine (sale_price exists but no scheduled promos)
- ✘ No coupons / discount codes
- ✘ Foreign-currency competitor prices excluded from aggregation (no FX conversion)

### Orders
- ✓ ~~No customer-side order tracking page~~ — `/order/track` shipped in Phase 6 polish
- ✘ No SMS/email notification on order events
- ✘ No payment gateway (COD only)
- ✘ No partial fulfillment (whole order or nothing)

### Operations
- ✘ No multi-tenant (one store, one brand)
- ✘ No multi-warehouse (single stock pool per offer)
- ✘ No GraphQL (REST only)

### Observability
- ✘ No metrics endpoint (no Prometheus)
- ✘ No distributed tracing
- ✘ No error reporting (no Sentry)
- ✘ No structured/JSON logs
- ✘ No CI pipeline

### Testing
- ✓ ~~Zero unit tests~~ — 110 pytest + 18 vitest shipped post-audit
- ✘ Zero integration tests (HTTP-level, against running stack)
- ✘ Zero e2e tests (Playwright/Cypress)

### Scraper
- ✘ No proxy pool by default (implementation exists, config empty)
- ✘ No `playwright-stealth` library (manual stealth init only)
- ✓ ~~No image-validity check~~ — Phase 9 Push 2: scraped images land as `status='PENDING'` and require admin approval via `/products/{id}/images`
- ✘ No spec sanity bounds (LLM could write `screen_size: "1000″"` without rejection)
- ✘ No per-source dispute / blacklist mechanism

### Full Intel (Phase 9 Push 1)
- `api/services/full_intel.py` welds the multi-tier scraper + the LLM client + a tiered-overwrite merge into one coherent pipeline.
- Background worker (`workers/intel_worker.py`) consumes `intel_jobs` with the same `FOR UPDATE SKIP LOCKED` pattern as `scraper_worker`.
- Tiered-overwrite policy (Q2=d): brand/category fill-only · description always overwrite ≥20 chars · specs per-key merge · images additive PENDING.
- Bulk filter: `missing_brand`, `missing_category`, `missing_image`, `only_status`. Returns a `batch_id` the UI polls for live progress (TanStack Query `refetchInterval` on `is_terminal`).

### Image Review (Phase 9 Push 2)
- Scraped image URLs land in `product_media` with `status='PENDING' AND source='SCRAPED'`.
- Admin reviews them at `/products/{id}/images` (per-product) or `/images` (global queue) before they're shown to customers.
- Approve flips status to STORED (with optional `is_primary` promotion); reject flips status to DELETED. Both recompute completeness via the canonical `_recompute_status_and_completeness`.
- Future: a downloader-worker can pick STORED+SCRAPED rows and push the bytes to R2 with checksums.

### Health-check endpoints (Phase 9 Push 6)
- **Three-tier convention** mapping to k8s / Cloud Run / ALB: `/healthz` (liveness, no deps, < 50 ms) · `/readyz` (readiness, DB + SearXNG probes, < 3 s) · `/healthz/details` (admin-only deep diagnostic with LLM ping + queue depths, < 15 s).
- **Structured probe results** — every probe returns `{ name, ok, duration_ms, detail, error, required }`. `required=False` probes (LLM, db_extended) failing don't 503 `/readyz`; only DB and SearXNG do.
- **Per-probe timeouts** — every probe runs under `asyncio.wait_for(...)` so one slow dep can't make the whole health check hang. Budgets: db=1s, searxng=2.5s for `/readyz`; db=1.5s, searxng=3s, llm=10s for `/healthz/details`.
- **Module:** `api/core/health.py` (probe registry + aggregator) and `api/routes/health.py` (HTTP layer).
- **docker-compose integration** — `api` service has its own healthcheck via `/healthz`; every worker `depends_on: api: condition: service_healthy` so migrations finish before workers query schema-dependent tables. One-command `docker compose up -d` is now race-free.

### Migration runner (Phase 9 Push 5)
- **Auto-applied on API startup.** `api/core/migrations.py` runs every `*.sql` in `db/migrations/` (filename-ordered) inside the FastAPI lifespan hook, then serves traffic. The bootstrap migration `000_migrations_table.sql` creates the `_migrations(filename, checksum, duration_ms, applied_at)` tracker.
- **Multi-replica safe.** `pg_try_advisory_lock` so scaled-out replicas don't race; second replica waits up to 30s then proceeds (the holder's work makes the schema current).
- **Tamper detection.** Every applied file's SHA-256 is stored. If a later boot finds the live file's hash mismatching the stored one, the API refuses to start with `MigrationChecksumMismatch`.
- **Per-migration transaction** via `begin_nested()` so a failed migration rolls back cleanly without affecting earlier-in-the-run migrations.
- **CLI:** `python -m scripts.migrate [--status | --check]` for ops + CI gating.

### Structured logging (Phase 9 Push 4)
- **One canonical log line shape** across every Python process — API + 4 workers — is JSON, one object per line, on stdout. Docker / container runtimes collect from there.
- Token list per line: `ts` (ISO 8601 ms UTC), `level`, `logger`, `component`, `msg`, `request_id`, plus any `extra={...}` kwargs promoted to top-level.
- **`request_id` flows automatically** via a `ContextVar` so handlers don't have to thread it through every call. The middleware binds it on every request; asyncio tasks inherit. Workers bind a per-job correlation ID like `intel:<short-uuid>` so log lines from a job are greppable.
- **Exception serialization** — when `log.exception(...)` is used, the line gets `exc_type`, `exc_message`, and `exc_traceback` as separate JSON fields, not interpolated into the message.
- **Module:** `api/core/logging.py`. Public API: `setup_logging(component, level?)`, `bind_request_id(rid)`, `bound_request_id() -> str | None`.
- **Env override:** `GL_LOG_LEVEL=DEBUG|INFO|WARNING|ERROR` (default INFO). Noisy third-parties (uvicorn.access, httpx, asyncio, watchfiles) are clamped to WARNING.
- **Ship-to anywhere posture** — because lines are already JSON and stdout-tagged, shipping to Loki, Datadog, Sentry, OpenSearch, etc. is a deployment-config change, not a code change.

### Theme customization (Phase 9 Push 2 → expanded in Push 3)
- **32** CSS custom properties on `:root` are server-overridable, split across two scopes:
  - `app_settings.key='admin.theme'`        → controls the admin console
  - `app_settings.key='storefront.theme'`   → controls the public storefront
- Token groups: palette · surface ramp · text · status · typography (font families) · radii · glass material (blur/saturate/opacity) · motion (durations) · background gradient anchors.
- Server-side per-kind validators (color regex, font regex, length, duration, unitless) prevent arbitrary CSS injection. Tokens are also bounded to 200 chars.
- 11 curated presets: canon · Midnight Tokyo · Sakura Punk · Matcha CRT · Algiers Sunset · Paper Edge · Cyberpunk · Dune · Monokrom · Spring Garden · Neo-Tokyo.
- Full **Theme Studio** at `/settings/theme` (admin) — tabs for Presets, Colors, Typography, Radii, Effects, Storefront, JSON. Live preview + import/export + scope copy.
- Sidebar **ThemeSwitcher** for one-click preset cycling from any admin page.
- Public `GET /api/v1/storefront/theme` (no auth) lets the storefront fetch the admin-controlled theme; both apps load synchronously from a localStorage cache before React mounts (no FOUC) and refresh from the server in the background.
- `gl:theme-changed` window event keeps canvas-painted surfaces (e.g. catalog graph) in sync with theme switches.

### Catalog Graph (Phase 9 Push 2 rebuild)
- Three node types (brand · category · product). Backend opt-in with `?include_products=true&product_limit=N`.
- Renderer auto-pick: ≤220 nodes → SVG (accessible, animated); >220 → Canvas (60fps with 4 000 nodes).
- d3-force physics: charge, link distance, collision, alpha decay — all live-tweakable in the on-graph settings panel.
- localStorage persistence: settings, per-graph layout (pinned positions only — free nodes get re-laid-out on load), zoom + pan.
- Drag-to-pin (yellow dot indicator); `/` for search; `Ctrl+,` for physics panel; `Esc` closes.

### Storefront
- ✓ ~~No SEO metadata per route~~ — `<SEO>` component on every page, native React 19 hoisting
- ✓ ~~No OG image generation per product~~ — primary product image used as og:image
- ✓ ~~Cart availability snapshot can drift~~ — live re-validation on cart visit via `/offers/availability`
- ✓ ~~Catalog sort applies per-page only~~ — moved to backend (`?sort=`)
- ✘ No wishlist
- ✘ No "recently viewed" persistence beyond localStorage (no cross-device)
- ✘ No SMS/email notifications

### Admin
- ✘ No bulk edit (one product at a time)
- ✘ No CSV export of the catalog (only import)
- ✘ No order export

These are all **deliberate scope cuts**. None of them block the system from running today.
