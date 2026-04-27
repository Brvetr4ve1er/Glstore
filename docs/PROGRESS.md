# Progress Log

Phase-by-phase log of everything that has been built on the **Ghir Laffaire** platform. Each phase is shippable on its own.

---

## ✅ Foundation (pre-Phase 0)

The bones of the platform — schema, write model, async workers, admin auth, and the order pipeline. Already in place when the intelligence work began.

| Area | What's there |
|---|---|
| **Schema** | `db/schema.sql` — products, offers, customers, orders, order_items, observations, events, sync_queue, financial_transactions, inventory_reservations, admin_users. State-machine ENUMs. CHECK constraints for financial safety. |
| **Stored procedures** | `fn_reserve_stock`, `fn_consume_reservation`, `fn_release_reservation`, `fn_expire_stale_reservations`. Use `FOR UPDATE` row-locks; overselling structurally impossible. |
| **API routes** | `auth.py`, `orders.py`, `products.py` (read-only), `events.py`. |
| **Workers** | `event_worker.py` (FOR UPDATE SKIP LOCKED + retry/backoff), `reservation_worker.py` (releases stale stock holds every 30s). |
| **Auth** | bcrypt(12) + JWT (HS256), role guard `require_role(...)`, lockout after 5 failures. |
| **Middleware** | Request ID, rate limiter, CORS, GZip, security headers, validation handler. |
| **Docker** | Multi-stage Dockerfiles for API + workers; non-root user; healthchecks; compose stack. |

---

## ✅ Brand redesign (Ghir Laffaire identity)

Renamed the admin from "GLstore Admin" → **Ghir Laffaire** with full visual identity overhaul.

**Files added/changed:**

| File | Change |
|---|---|
| `admin/src/index.css` | Full design-token rewrite: Bold Blue / Electric Blue / Neon Yellow / Hot Pink / Jet Black palette; punk-stripe, sparkle-pulse, crown-bounce keyframes; gradient page bg; brand-yellow text selection. |
| `admin/src/components/BrandLogo.tsx` | **NEW** — SVG cart + mystery box `?` + crown + sparkles + speed lines, with hover-tilt motion. |
| `admin/src/components/Layout.tsx` | Yellow `layoutId` active nav pill, gradient top stripe, "Punk mode" sidebar callout. |
| `admin/src/components/ui.tsx` | New `accent` (yellow) + `danger` (pink) Button variants, `Textarea` primitive, gradient-top Modal, motion StatCard with corner stripe, `punk-stripe` PageHeader underline. |
| `admin/src/pages/Login.tsx` | Brand logo, gradient stripe, electric/yellow/pink ambient glows, decorative speed lines, tagline. |
| `admin/src/pages/Dashboard.tsx` | Stagger-reveal stat cards, brand-coloured accents, branded empty state. |
| `admin/src/lib/utils.ts` | Status colours remapped to brand palette only. |
| `admin/index.html` | Title → "Ghir Laffaire — Admin Console", Bricolage Grotesque + heavier Inter weights. |
| `admin/public/favicon.svg` | New SVG mark — cart + mystery box + crown + sparkle. |

**See:** [BRAND.md](BRAND.md) for the full token reference.

---

## ✅ Phase 0 — Manual product CRUD

**Goal:** unblock manual product creation. Add / edit / archive products and offers from the admin.

### Backend

| File | Change |
|---|---|
| `api/models/schemas.py` | `+ ProductPatch`, `OfferCreate`, `OfferPatch`. `ProductCreate` now optionally bundles an `initial_offer`. |
| `api/routes/products.py` | `+ POST /products`, `PATCH /products/{id}`, `DELETE /products/{id}` (soft archive default; `?hard=true` blocked if order history exists). `+ POST /products/{id}/offers`, `PATCH .../offers/{offer_id}`, `DELETE .../offers/{offer_id}` (blocks delete if active reservations). All write endpoints gated behind `require_role(SUPER_ADMIN, ADMIN, OPERATOR)`. |

### Frontend

| File | Change |
|---|---|
| `admin/src/lib/api.ts` | `+ createProduct, patchProduct, deleteProduct, addOffer, patchOffer, deleteOffer` and the matching `ProductInput` / `OfferInput` / `*PatchInput` types. |
| `admin/src/pages/ProductEditor.tsx` | **NEW** — single page handles both create + edit. Auto-derives slug from name. Optional inline initial-offer block on create. Status dropdown on edit. Archive button. |
| `admin/src/pages/Products.tsx` | + Yellow "**+ New Product**" button in the page header. |
| `admin/src/pages/ProductDetail.tsx` | + "**Edit product**" outline button next to Back. |
| `admin/src/App.tsx` | + Routes `/products/new` and `/products/:id/edit`. |
| `admin/src/components/ui.tsx` | + `Textarea` primitive. |

### Validation
- `npx tsc --noEmit` → exit 0
- `python -m py_compile` → OK
- Manual test: create → edit → archive cycle ✅

---

## ✅ Phase 1 — Bulk CSV import

**Goal:** ingest a 567-row supplier CSV in seconds. Fuzzy header matching, EU/US number formats, idempotent on SKU.

### Backend

| File | Purpose |
|---|---|
| `api/services/csv_parser.py` | **NEW** — Python port of `orbital-perihelion`'s `universal-csv-parser.ts`. 65 column variants, NFD-normalised fuzzy header matching, RFC-4180 quoted CSV, EU (`1.234,56`) / US (`1,234.56`) / space-thousands number parsing. |
| `api/services/csv_import.py` | **NEW** — orchestrator: validates rows, dedupes slugs (cascade fallback `name → name+sku → name+uuid`), batches upserts. Idempotent on SKU. `preview_import()` (read-only diagnostic) + `commit_import()` (writes). |
| `api/routes/products_import.py` | **NEW** — `POST /products/import/preview` and `POST /products/import/commit`. Tolerant decoding (utf-8-sig → utf-8 → cp1252 → latin-1). 16 MiB cap. |
| `api/main.py` | + Router mounted under `/api/v1`. |

### Frontend

| File | Purpose |
|---|---|
| `admin/src/lib/api.ts` | + `reqMultipart` helper, `previewImport()` / `commitImport()`, full type set. |
| `admin/src/pages/ProductImport.tsx` | **NEW** — 4-stage flow: drop-zone → preview (header mapping + stat tiles + issue list + 20-row sample) → commit → done summary. Punk-styled, motion-reactive. |
| `admin/src/pages/Products.tsx` | + Outlined "**Import CSV**" button next to "**+ New Product**". |
| `admin/src/App.tsx` | + Route `/products/import`. |

### Infra

| File | Change |
|---|---|
| `docker-compose.yml` | + Bind-mounted `./api`, `./workers`, `./scripts` into containers. + uvicorn `--reload` watching `/app/api`. **Code edits now hot-reload — no rebuild.** |

### Live verification
- Real `inventory-raw.csv` (567 rows, French headers) → 11/18 canonical fields auto-mapped.
- `POST /import/preview`: 567 valid, 0 blocked, 567 warnings (brand-missing — Phase 2 fuel).
- `POST /import/commit`: **567 products + 567 offers in 2.99s**.
- Idempotent re-run: 0 created, 567 updated, total still 567.

---

## ✅ Phase 2 — Rule-based enrichment (backend)

**Goal:** every imported product gets brand / category / specs detected automatically from its name. No LLM, no network calls — pure regex + lookup tables.

### Backend

| File | Purpose |
|---|---|
| `api/services/enrichment.py` | **NEW** — pure functions, no DB. **60 known brands** (incl. Algerian: CONDOR, IRIS, GEANT). **65 category regex patterns** with French + English coverage. Spec extractors (KG, L, W, BTU, HP, screen sizes). 14 `ATTR_BUILDERS` (TV, washing machine, AC, refrigerator, microwave, etc.) that synthesise sensible defaults from detected numbers. `enrich(name, ...) → EnrichmentResult`. |
| `api/services/enrichment_runner.py` | **NEW** — DB bridge. `enrich_one(db, product_id)` loads facts, runs `enrich()`, applies `UPDATE products SET ...`, writes `observations` rows for audit. `enrich_many(db, only_status=...)` for bulk. |
| `api/routes/enrichment.py` | **NEW** — `POST /products/{id}/enrich`, `POST /products/enrich-all`, `GET /products/enrichment/stats`. All admin-gated. |
| `api/main.py` | + Enrichment router mounted. |
| `api/routes/products_import.py` | + `auto_enrich=True` Form param on commit. Imported products get enriched in the same request. |

### Completeness scoring

Weighted in [0, 1]:

```
brand          → +0.18    barcode/mpn   → +0.06
category       → +0.18    description   → +0.10
retail price   → +0.18    primary image → +0.10
stock present  → +0.10    specs (sat≥3) → +0.10
```

### Status transitions (auto)

```
RAW / NORMALIZED / NEEDS_FIX
     │
     │  enrich()
     ▼
  ┌────────────────────────────┐
  │ has brand AND category     │
  │ AND completeness ≥ 0.85    │ → VERIFIED
  ├────────────────────────────┤
  │ has brand AND category     │ → CLASSIFIED
  ├────────────────────────────┤
  │ missing brand OR category  │ → NEEDS_FIX
  └────────────────────────────┘
```

### Frontend (Phase 2 UI) ✅

| File | Change |
|---|---|
| `admin/src/lib/api.ts` | + `enrichProduct(id)`, `enrichAll(statuses, limit)`, `fetchEnrichmentStats()` + types `EnrichmentResult`, `BulkEnrichmentReport`, `EnrichmentStats`. `commitImport` now takes `autoEnrich` flag. |
| `admin/src/pages/ProductDetail.tsx` | + Yellow "**Enrich now**" button next to Edit. Toast reports completeness delta + new status. Invalidates `['product', id]` + `['products']` queries on success. |
| `admin/src/pages/Products.tsx` | + Outlined "**Enrich all**" toolbar button (only RAW/NORMALIZED/NEEDS_FIX). + Status filter chips: **All / Needs Fix / Verified / Active**. URL-synced via `?status=...` so Dashboard deep-links work. |
| `admin/src/pages/Dashboard.tsx` | + "**Catalog Intelligence**" card: average completeness bar + per-status histogram + clickable "Needs Fix" chip linking to `/products?status=NEEDS_FIX`. Auto-refetches every 60s. |

### Validation
- `npx tsc --noEmit` → exit 0
- All routes compile and queries are correctly invalidated.

---

## ✅ Phase 3 — Validator + per-product fixers

**Goal:** turn implicit "low completeness" into an explicit, actionable to-do list. Every issue gets an inline mini-form so admins can fix the catalog without leaving the product page.

### Backend

| File | Purpose |
|---|---|
| `api/services/validator.py` | **NEW** — pure issue derivation. `derive_issues(facts) → list[Issue]` with stable `code`s: `missing_brand`, `missing_category`, `missing_description`, `missing_image`, `missing_price`, `no_stock`, `missing_barcode_or_mpn`, `low_completeness`, `low_specs`. Each issue carries a `fix_hint` (suggested values, options, action verbs). Sorted by severity. |
| `api/routes/issues.py` | **NEW** — `GET /products/{id}/issues` (single-product), `GET /products/issues/summary` (catalog-wide histogram), `GET /products/issues/list?code=...` (paginated rows for one issue), `GET /brands` (canonical brand catalog + per-brand product counts). All admin-gated. |
| `api/main.py` | + Issues router mounted. |

### Frontend

| File | Purpose |
|---|---|
| `admin/src/lib/api.ts` | + `fetchProductIssues`, `fetchIssuesSummary`, `fetchIssuesList`, `fetchBrands` + `IssueCode` / `ProductIssue` / `IssuesSummary` / `IssueListItem` / `BrandCatalogItem` types. |
| `admin/src/components/IssuePanel.tsx` | **NEW** — collapsible issue list rendered on every product page. Severity-coloured rows. Per-issue inline fixers: brand autocomplete (with regex-suggested value), category quick-set, description editor with min-length guard, barcode+MPN dual input, image stub, "open editor" deeplink for offer-related issues, and "Re-enrich" buttons for low-completeness/low-specs. All call existing `PATCH /products/{id}` — no new write endpoints needed. |
| `admin/src/pages/ProductDetail.tsx` | + `<IssuePanel />` mounted directly under the action bar. |
| `admin/src/pages/IssueExplorer.tsx` | **NEW** — `/products/issues` triage page. Tabbed view of every issue type with motion `layoutId` indicator. Click a tab → table of affected products (sorted by lowest completeness first), each with mini-thumb + inline status + jump-to-fix link. |
| `admin/src/App.tsx` | + Route `/products/issues`. |
| `admin/src/components/Layout.tsx` | + "**Catalog Quality**" nav item (stethoscope icon) between Products and Orders. |

### Validation
- `npx tsc --noEmit` → exit 0
- `python -m py_compile` (3 files) → OK
- New endpoints: 4. New types: 5. New pages: 1. New components: 1.

---

## ✅ Phase 4 — LLM enrichment

**Goal:** plug a local Ollama (or any OpenAI-compatible endpoint, or Anthropic) into the rule-based pipeline. Generate descriptions, extra specs, marketing copy, pros/cons — all in French — and merge results back without clobbering rule-engine output.

### Schema

| File | Change |
|---|---|
| `db/migrations/001_app_settings.sql` | **NEW** — `app_settings` JSONB key-value store. Idempotent. Seeds the default `llm.config` row pointing at Ollama. |
| `db/schema.sql` | + Same migration appended so fresh deploys get it automatically. |

### Backend

| File | Purpose |
|---|---|
| `api/services/llm.py` | **NEW** — `LLMConfig` dataclass + `chat(cfg, system, user, json_mode)` + `ping(cfg)`. Three backends: **Ollama** (`/api/chat`, `/api/tags`), **OpenAI-compat** (`/v1/chat/completions`, supports LM Studio + vLLM + OpenAI), **Anthropic** (native `/v1/messages`). JSON repair: tries raw → fenced block → first-`{` to last-`}` slice. Config persisted in `app_settings`. API keys masked on read. |
| `api/services/llm_enrichment.py` | **NEW** — orchestrator. Builds CPO-style French extraction prompt, dispatches via `llm.chat`, merges payload onto `products.specs` (LLM never overwrites existing keys), recomputes `completeness_score` inline via SQL, auto-bumps status to VERIFIED when ≥0.85. Writes one `observations` row per merged field. |
| `api/routes/settings.py` | **NEW** — `GET/PUT /settings/llm` (api_key special-cased: `null=clear`, `""=keep`, else overwrite). `POST /settings/llm/ping` returns online + discovered models list. |
| `api/routes/enrichment.py` | + `POST /products/{id}/enrich-llm` (502 on transport, 404 on missing). + `POST /products/enrich-llm-bulk?limit=50` — sequential, fail-soft, breaks on connection-level errors. |
| `api/main.py` | + `settings` router mounted. |

### Frontend

| File | Purpose |
|---|---|
| `admin/src/lib/api.ts` | + `LLMKind`, `LLMConfig`, `LLMConfigInput`, `LLMPing`, `LLMEnrichmentResult`, `LLMBulkReport` types. + `fetchLLMConfig`, `saveLLMConfig`, `pingLLM`, `enrichProductLLM`, `enrichLLMBulk`. |
| `admin/src/pages/Settings.tsx` | **NEW** — `/settings` page. Backend tile picker (Ollama / OpenAI-compat / Anthropic) auto-suggests endpoint. Model autocomplete (datalist) populated from ping. API key with eye-toggle, blank=keep semantics. Generation params (temp, max tokens, timeout, JSON mode). Status card with per-state animation: pinging spinner → online (✅ + model chips) / offline (✖ + error) / empty. **Bulk LLM enrichment** card runs `enrich-llm-bulk` with live result stats. |
| `admin/src/App.tsx` | + Route `/settings`. |
| `admin/src/components/Layout.tsx` | + "**Settings**" sidebar entry (gear icon). |
| `admin/src/components/IssuePanel.tsx` | + "**Draft with LLM**" button in the description fixer — calls `POST /products/{id}/enrich-llm`, pre-fills the textarea with the LLM-generated French description, toasts the completeness delta. |

### Validation
- `python -m py_compile` (5 files) → OK
- `npx tsc --noEmit` → exit 0
- Default Ollama endpoint is `http://host.docker.internal:11434` so a local Ollama install is reachable from the API container without extra setup.

### How it works end-to-end

```
[admin opens Settings] ──► PUT /settings/llm ──► app_settings table
        │
        ▼
[admin clicks "Test connection"]
        │
        ▼
POST /settings/llm/ping ──► llm.ping(cfg) ──► GET /api/tags  (Ollama)
                                              GET /v1/models (OpenAI-compat)
        │
        ▼ models populate the autocomplete

[admin clicks "Draft with LLM" on a product]
        │
        ▼
POST /products/{id}/enrich-llm
        │
        ▼
load product → build French CPO prompt → llm.chat() → parse JSON
        │                                              │
        │                          (repair fence/braces if needed)
        ▼
UPDATE products SET description, specs (additive, namespaced aux keys),
                    completeness_score (recomputed inline),
                    status (auto-bump to VERIFIED when ≥0.85)
        │
        ▼
INSERT observations (one row per merged field, source = "llm:ollama:llama3.1:8b")
```

---

## ✅ Phase 5 — Multi-tier web scraping (backend)

**Goal:** extract competitor prices, specs, and images from heterogeneous Algerian and international sources, with cost-aware tier escalation. Built per the master prompt + two deep-research reports (cost/fallback ladder + DZ source map).

### Schema
| File | Change |
|---|---|
| `db/migrations/002_scraper.sql` | **NEW** — `scrape_jobs`, `scrape_sources`, `competitor_prices` (idempotent on (product, domain, day)), `scrape_domain_state`, `scrape_status_enum`. + Seeded `scraper.config` JSONB in `app_settings`. |
| `db/schema.sql` | + Migration appended. |

### Backend — scraper package layout

```
api/services/scraper/
├── types.py             SourceTier · TIER_TRUST · TIER_QUOTA · ExtractedData ·
│                        FetchResult · SearchResult · ProductTarget ·
│                        ScrapedSourceRecord · ScrapeOutcome
├── engine.py            ScraperEngine (orchestrator) + load_config + load_target
├── search.py            SearXNG → Brave → DDG-HTML cascade · multi-intent queries
├── ranker.py            Tier-quota diversification (1 official + 3 retailer + 1 review + …)
├── fetcher.py           TieredFetcher: cache → robots → rate-limit → tier escalation
├── tiers/
│   ├── tier1_http.py        httpx + realistic headers + block-marker detection
│   ├── tier2_playwright.py  persistent Chromium, resource-block route filter
│   ├── tier3_stealth.py     stealth init script + networkidle + jitter
│   └── tier4_paid.py        ScraperAPI / ScrapingBee / Zyte (off by default)
├── extractors/
│   ├── __init__.py          domain → extractor registry, fail-soft to generic
│   ├── generic.py           JSON-LD → microdata → OpenGraph → CSS, 4 passes
│   ├── jumia.py             Magento spec-table override
│   ├── ouedkniss.py         classified-dampened price (×0.85)
│   ├── condor.py            manufacturer-strength (×0.95)
│   └── batolis.py           WooCommerce attribute-table override
├── validators/
│   ├── normalization.py     parse_price (EU/US/space/apostrophe formats; 89.900 → 89900)
│   └── price_validator.py   bounds (0.3× to 2.5×), abs floor/ceiling,
│                            cross-source consensus + ±20% agreement
└── utils/
    ├── domain.py            classify_url + needs_browser + needs_stealth (60+ DZ/intl domains)
    ├── rate_limiter.py      per-domain throttle + circuit breaker
    ├── robots.py            robots.txt cache, honors Crawl-delay
    ├── cache.py             tier-aware TTL (24h official / 6h retailer / 2h classified)
    └── proxy_manager.py     sticky-per-domain rotation, dead-IP marking
```

### Routes
| File | Purpose |
|---|---|
| `api/routes/scraper.py` | **NEW** — `POST /products/{id}/scrape` (with `?wait=true` dev shortcut), `GET /scrape-jobs/{id}`, `GET /products/{id}/scrape-jobs`, `GET /products/{id}/competitor-prices`, `GET /products/{id}/market-summary`, `GET /products/market/alerts?threshold_pct=`, `GET/PUT /settings/scraper`, `POST /settings/scraper/probe`. |
| `api/main.py` | + Scraper router mounted. |

### Worker
| File | Purpose |
|---|---|
| `workers/scraper_worker.py` | **NEW** — `FOR UPDATE SKIP LOCKED` claim + run_job + stale-claim sweeper (5 min) + Playwright shutdown on SIGINT. |
| `requirements.txt` | + `beautifulsoup4`, `lxml`, `playwright`. |
| `docker/Dockerfile.scraper` | **NEW** — slim base + Chromium runtime libs + `playwright install chromium`. |
| `docker-compose.yml` | + `searxng` service (self-hosted multi-engine search) + `scraper_worker` service with bind-mounted source. |

### Pipeline
```
load_target(product_id)
  → build_query(target, intent) for intent in {commercial, technical, review}
  → search.search(queries) — SearXNG → Brave → DDG cascade
  → ranker.rank_and_diversify(results, max=6) — quota-balanced across tiers
  → for url in selected (parallel sem=3):
      fetcher.fetch(url, tier)              ← tier escalation 1→2→3→4
      extractors.extract(html, url)         ← json_ld → microdata → og → css
      price_validator.validate_one(...)     ← bounds + tier-trust weighting
  → consensus_of(prices)                    ← median + ±20% agreement
  → adjust_confidence_post_consensus(...)
  → persist scrape_sources rows
  → persist competitor_prices (idempotent on day)
  → write summary onto scrape_jobs
```

### Confidence model (research-aligned)
- Extractor self-rates: JSON-LD 0.92 · microdata 0.80 · OG 0.65 · CSS 0.42
- Validator weights by tier: official ×1.00 · retailer ×0.85 · aggregator ×0.70 · classified ×0.55 · review ×0.40
- Cross-source bump: ±0.10 if within ±20% of consensus median
- Hard rejection: `< 0.3 × expected` or `> 2.5 × expected` or absolute floor/ceiling
- Only sources with `confidence ≥ min_confidence_for_price` (default 0.6) flow into `competitor_prices`

### Tier ownership of failure modes
| Failure | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| Static HTML, OG/JSON-LD | ✅ wins | — | — | — |
| Magento/WordPress with JS price | escalate | ✅ wins | — | — |
| Cloudflare challenge | escalate | escalate | ✅ tries (~70-80%) | optional fallback |
| Hard captcha (Ouedkniss worst case) | block | block | block (~20% fail) | ✅ if enabled |
| robots.txt disallow | skipped | skipped | skipped | skipped |

### Validation
- `python -m py_compile` on all 26 scraper files → OK
- Price normalization: **12/12** cases pass (DA, DZD, EUR, USD; EU/US/space/apostrophe formats)
- Domain classifier: condor.dz→official, jumia.dz→retailer, ouedkniss.com→classified+stealth, lesnumeriques→review
- Generic extractor: JSON-LD ✓, OpenGraph ✓, CSS heuristic ✓ — all parse Algerian price strings correctly end-to-end.

### What's deferred (intentional)
- **Frontend** — `MarketTab.tsx` + Dashboard alert chip + Settings page Scraper card are the next ticket.
- **Stealth-plus** — adding `playwright-stealth` lib adds ~10% Cloudflare survival rate but isn't critical for v1.
- **Sentiment from reviews** — needs LLM + scraped review text together; ride along with Phase 6.
- **R2 image upload** — we currently store image URLs only, not binaries.

---

## ✅ Phase 9 (Push 2) — Obsidian graph · Image review · Theme

User feedback after Push 1: "the graph is not displaying", "the enrichment buttons dont really do anything", "id like the node graph view to be the same functionalities as obsidian", "i want to have control over the theme of the admin pannel". Push 1 fixed the broken graph + welded the scraper+LLM into a single Full Intel pipeline. Push 2 closes the rest of the loop.

### Backend

| File | Change |
|---|---|
| `api/routes/catalog.py` | `/products/graph` now accepts `?include_products=true&product_limit=N&only_status=...`. Adds `product` nodes with brand+category edges (`product-brand`, `product-category`). Lowest-completeness products picked first so the graph shows the work queue. Hard cap 4 000 nodes. |
| `api/routes/images.py` | **NEW** — image confirmation queue. `GET /products/{id}/images?status=PENDING`, `POST /products/{id}/images/{image_id}/approve` (optional `is_primary`), `POST .../reject`, `GET /images/pending` (paginated cross-catalog), `GET /images/pending/summary` (top products by pending count). Approving recomputes completeness via the canonical `_recompute_status_and_completeness` from `full_intel`. Reject also recomputes (un-set primary drops the 10 pt media credit). |
| `api/routes/settings.py` | `+ GET/PUT /settings/theme`. Stored at `app_settings.key='admin.theme'`. Server-side whitelist of 18 allowed CSS variables; regex-validated colour values; preset name capped at 64 chars. |
| `api/main.py` | Register `images.router` BEFORE `products.router` so `/products/{id}/images` resolves to the deeper static route, not `/products/{product_id}`. |

### Frontend

| File | Change |
|---|---|
| `admin/src/pages/CatalogGraph.tsx` | **REBUILT, Obsidian-grade.** Three node types (brand · category · product). `forceX/forceY` clustering. Auto SVG/Canvas (>220 nodes → canvas). Physics panel: charge, link distance, collision, alpha decay, label mode, product opacity, edge opacity, linger. Search overlay (`/`) with neighbourhood highlight. Node drag-to-pin (yellow dot), per-node `togglePin`, "Free pins" button. localStorage: `gl.graph.settings.v1`, `gl.graph.layout.{tiers,full}.v1` (pin coords + zoom + pan). Resolved CSS palette → canvas colours (`gl:theme-changed` listener so theme switch re-paints canvas). |
| `admin/src/pages/ImageReview.tsx` | **NEW** — two views in one module. `<ProductImageReview>` for `/products/:id/images` (tabbed by PENDING / STORED / all, approve / approve-as-primary / reject grid), `<GlobalImageQueue>` for `/images` (paginated cross-catalog queue + summary stat cards + top-products-by-pending shortcut row). Broken-URL detection via `<img onError>`. |
| `admin/src/lib/theme.ts` | **NEW** — vanilla module so theme can apply BEFORE React mounts (no FOUC). Six curated presets: Ghir Laffaire (canon) · Midnight Tokyo · Sakura Punk · Matcha CRT · Algiers Sunset · Paper Edge (light). `applyTheme()` resets all known tokens then layers preset → user overrides; flips `color-scheme` for the light preset; dispatches `gl:theme-changed` so canvas surfaces re-read the palette. |
| `admin/src/main.tsx` | Synchronously applies cached theme on first paint. |
| `admin/src/App.tsx` | Re-fetches authoritative theme from server post-auth and applies it. New routes: `/products/:id/images`, `/images`. |
| `admin/src/pages/Settings.tsx` | New `<ThemeCard>` above the LLM section. Preset gallery with swatch row; advanced overrides accordion with native `<input type="color">` and free-text hex/rgba field per token; live preview on every change; "Reset" returns to default preset + zero overrides. |
| `admin/src/components/Layout.tsx` | New "Image Review" sidebar entry (uses `Images` lucide icon). |
| `admin/src/pages/ProductDetail.tsx` | "Validate images" button alongside Edit + Full Intel actions. |
| `admin/src/lib/api.ts` | Types + clients: `GraphQuery`, `GraphNodeType`, `GraphEdgeKind`, `ProductImage`, `PendingImageItem`, `ThemeConfig`, `ThemeOverrides`. Functions: `fetchProductImages`, `approveImage`, `rejectImage`, `fetchPendingImages`, `fetchPendingImagesSummary`, `fetchTheme`, `saveTheme`. `fetchCatalogGraph` now takes a `GraphQuery`. |

### Q&A locked in (from user pre-flight survey)

- **Q1=c** — Keep rule-engine button; replaced LLM-only with Full Intel (Push 1)
- **Q2=d** — Tiered overwrite: brand/category fill-only, description always overwrite, specs per-key merge, images additive PENDING (Push 1)
- **Q3=a** — Background worker + progress bar (Push 1, `intel_worker`)
- **Q4** — URL today, manual confirmation. **Push 2 ImageReview UI** lets the admin approve/reject every scraped URL before it hits the storefront. Future: a downloader-worker can pick up STORED+SCRAPED rows and push them to R2.
- **Q5=a** — Full Obsidian feel — physics, node interactions, settings panel. **Done in Push 2.**
- **Q6=c** — Auto SVG/Canvas based on node count. **Done at SVG_NODE_THRESHOLD=220.**
- **Q7=a** — localStorage persistence. **Done — settings + per-graph layout (pin positions, zoom, pan).**
- **Q8** — Order = my judgement. Picked: graph → images → theme → docs.
- **Bonus** — Admin theme control. **Done via `app_settings.theme.config` + 6 presets + per-token override grid.**

### Validation

- `npx tsc -b --noEmit` → EXIT 0 (all 20 admin pages compile)
- `npx vite build` → EXIT 0 (CatalogGraph chunk 45.95 kB / gzip 15.34 kB, ImageReview 13.4 kB / gzip 3.95 kB)
- `python -m pytest tests/` → **110 passed in 0.60s**
- `python -m py_compile api/routes/{images,catalog,settings}.py api/main.py` → OK

### Files changed in this push

- **Added** — `api/routes/images.py`, `admin/src/pages/ImageReview.tsx`, `admin/src/lib/theme.ts`
- **Modified** — `api/routes/catalog.py`, `api/routes/settings.py`, `api/main.py`, `admin/src/pages/CatalogGraph.tsx` (full rewrite), `admin/src/pages/Settings.tsx`, `admin/src/pages/ProductDetail.tsx`, `admin/src/components/Layout.tsx`, `admin/src/lib/api.ts`, `admin/src/App.tsx`, `admin/src/main.tsx`

---

## ✅ Phase 9 (Push 3) — Theme Studio · End-to-end customization

User feedback after Push 2: "i want a full customization interface option and a theme switcher · i want to be able to tweak the ui as i please · i want the backend to be able to control the theme and styling of the storefront."

### Backend

| File | Change |
|---|---|
| `api/routes/settings.py` | Theme config now scope-aware: `?scope=admin\|storefront`. New `app_settings.key='storefront.theme'` row alongside the existing `admin.theme`. New `public_router` exposes `GET /api/v1/storefront/theme` with NO auth so the storefront can fetch on bootstrap. Server whitelist expanded from 18 to 32 tokens (palette + surface + text + status + typography + radii + glass + motion + bg-glow). Per-kind validators: color regex (#rgb/#rgba/rgb/rgba/hsl/hsla), font regex (alphanumerics + commas + quotes only — no `url()` injection), length (`px/rem/em/%`), duration (`ms/s`), unitless float. Token cap of 200 chars defended at the server. |
| `api/main.py` | Mounts `settings_route.public_router` so the storefront endpoint is reachable without a JWT. |

### Token registry (32 tokens)

Beyond colors, the theme now controls:
- **Typography** — `--font-sans`, `--font-display`, `--font-mono`
- **Radii** — `--radius-{sm,md,lg,xl,2xl,full}`
- **Glass** — `--glass-blur`, `--glass-saturate`, `--glass-opacity`
- **Motion** — `--duration-{fast,base,slow}`
- **Backgrounds** — `--bg-glow-{1,2,3}` (page-level radial gradient anchors)

CSS files (`admin/src/index.css`, `storefront/src/index.css`) refactored so `.glass`, `.glass-strong`, `.glass-sm` and the page background gradient all consume these tokens — the studio's effects panel changes radius/blur/duration/etc. live across every component.

### Frontend (admin)

| File | Change |
|---|---|
| `admin/src/lib/theme.ts` | **REWRITTEN.** Single source-of-truth `TOKENS` registry with `TokenSpec[]` → drives the studio UI, server whitelist (mirrored), and JSON schema. 11 curated presets (was 6): canon · Midnight Tokyo · Sakura Punk · Matcha CRT · Algiers Sunset · Paper Edge · Cyberpunk · Dune · Monokrom · Spring Garden · Neo-Tokyo. New helpers: `resolveTheme()` (preset+overrides→flat map), `exportThemeJson()` / `importThemeJson()`, `withOverride()`, `readLive()`. localStorage cache key bumped to `gl.theme.cache.v2.{scope}` (per scope). |
| `admin/src/lib/api.ts` | `ThemeConfig` now open-record so the registry can grow without a TS type edit. New `ThemeScope = 'admin' \| 'storefront'`. `fetchTheme(scope)` / `saveTheme(cfg, scope)`. New `fetchPublicStorefrontTheme()`. |
| `admin/src/pages/ThemeStudio.tsx` | **NEW** — dedicated full-page studio at `/settings/theme`. Tabs: Presets (gallery + dark/light mode) · Couleurs (5 grouped sections) · Typo (font preview) · Rayons (slider + visual preview) · Effets (glass + motion sliders) · Storefront (scope-bound preset switcher + "copy admin → storefront" + open public site) · JSON (copy/download/file-import). Live preview applies admin draft to `documentElement` on every keystroke; on unmount restores the snapshot if no save happened. |
| `admin/src/components/ThemeSwitcher.tsx` | **NEW** — compact preset switcher in the sidebar bottom. Click → dropdown with all 11 swatch tiles → click to save + apply. Reachable from any admin page. |
| `admin/src/components/Layout.tsx` | Mounts `<ThemeSwitcher>` above the user/sign-out block. |
| `admin/src/pages/Settings.tsx` | Old inline `ThemeCard` replaced with a summary card showing both the current admin and storefront themes side-by-side, plus a "Open studio" deep-link. |
| `admin/src/App.tsx` | New route `/settings/theme` → `<ThemeStudio>`. Theme refetch effect now uses `fetchTheme('admin')` and `applyTheme(t, 'admin')`. |
| `admin/src/main.tsx` | First-paint loads cached admin theme via `loadCachedTheme('admin')`. |

### Frontend (storefront)

| File | Change |
|---|---|
| `storefront/src/lib/theme.ts` | **NEW** — receive-end of the theme system. Same token list as admin, mirrored preset map, `applyTheme()`, `loadCached()`, `cache()`, `refreshThemeFromServer()` (no-throw — failures keep the cached theme). localStorage key `gl.storefront.theme.v2`. |
| `storefront/src/main.tsx` | Synchronously applies cached storefront theme before React mounts (no FOUC), then fires-and-forgets `refreshThemeFromServer()` to pull the latest. |
| `storefront/src/index.css` | Token catalog brought up to parity with admin (radii, glass, motion, bg-glow). `.glass*` classes now use `color-mix(in srgb, …)` and CSS variables instead of hard-coded values. |

### Capability summary

What the admin can now do from one place:
- Pick from 11 curated presets across both surfaces (admin + storefront, independently)
- Swap any of 32 design tokens with a `<input type="color">` picker, slider, or free-text field
- Force light/dark mode regardless of the preset's intrinsic mode
- Live-preview every change on the admin in real time
- Copy the admin theme to the storefront (or vice-versa) with one click
- Export the theme as JSON and re-import it (drag a file or paste)
- Cycle themes from any admin page via the sidebar switcher

What the storefront does:
- Fetches the admin-controlled theme on bootstrap (no auth, no UI)
- Caches it in localStorage so first paint matches the admin's choice
- Updates on the next page load whenever the admin saves a change

### Validation

- `npx tsc -b --noEmit` → admin EXIT 0 · storefront EXIT 0
- `npx vite build` → admin built (ThemeStudio chunk **24.05 kB / gzip 6.81 kB**) · storefront built
- `python -m pytest tests/` → **110 passed in 1.30 s**
- `python -m py_compile api/routes/settings.py api/main.py` → OK

### Files changed in this push

- **Added** — `admin/src/pages/ThemeStudio.tsx`, `admin/src/components/ThemeSwitcher.tsx`, `storefront/src/lib/theme.ts`
- **Modified** — `api/routes/settings.py` (scope routing + extended whitelist + public router), `api/main.py` (mount public_router), `admin/src/lib/theme.ts` (full rewrite, 32 tokens, 11 presets, JSON helpers), `admin/src/lib/api.ts` (scope arg, public storefront fetch), `admin/src/pages/Settings.tsx` (summary card), `admin/src/App.tsx` (route + scoped fetch), `admin/src/main.tsx` (scoped cache), `admin/src/components/Layout.tsx` (mount switcher), `admin/src/index.css` (consume new tokens), `storefront/src/main.tsx` (theme bootstrap), `storefront/src/index.css` (extended tokens + color-mix glass)

---

## ✅ Phase 9 (Push 3.1) — Theme system audit fixes

Self-audit of Push 3 turned up 9 real issues; this push fixes all of them in priority order.

### Bugs fixed

| # | Bug | Fix |
|---|---|---|
| 1 | Settings.tsx preset chips were no-ops (just invalidated query) | Wired to a `saveTheme` mutation that preserves existing overrides + applies + toasts on success |
| 2 | Studio snapshot captured `getComputedStyle` of every CSS var → 32-override bloat polluting localStorage on revert | Snapshot now references `adminQuery.data` directly — only persisted values reach the cache |
| 3 | Studio draft never re-hydrated, so the sidebar `ThemeSwitcher` saving made the studio show stale state | Added `lastSyncedAdmin/Storefront` refs; draft hydrates from server when "clean" (deep-equal to last sync), preserving unsaved local edits |
| 4 | Server silently dropped invalid token values, user thought their override saved when it didn't | `PUT /settings/theme` now returns `{ dropped: [{ key, reason, value }] }`. Studio surfaces a yellow ⚠️ toast listing rejected keys |
| 7 | Storefront `applyTheme` blindly set any key from `theme.overrides` | Added `ALLOWED_KEY_SET` + per-kind regex (`validateTokenValue`) on the storefront side too — defense-in-depth against polluted cache or compromised endpoint |
| 8 | Server accepted `--glass-opacity: 0` (invisible cards) or `--duration-fast: 99999s` (frozen UI) | New `_NUMERIC_BOUNDS` table with per-token min/max; bound-check runs after regex match. Studio sliders already honored looser bounds, so JSON imports can still go beyond UI sliders without hitting the wall |
| 9 | `color-mix(in srgb, …)` had no fallback — older Edge/Safari rendered glass cards transparent | Added `@supports (background: color-mix(...))` blocks in both CSS files. Older browsers get a fixed `rgba(21,21,29,0.78)` glass; modern browsers get the dynamic theme-driven blend |
| 11 | No cross-tab sync — open admin in two tabs, save in one, the other showed the old preset | New `bindCrossTabSync()` in both admin and storefront `theme.ts`. Listens for `storage` events on the cache key and re-applies on every other tab |
| 5/6 | Storefront tab in studio had no live preview — admin had to save + refresh public site to see effect | Added a `postMessage`-based preview channel: studio embeds an iframe of `localhost:5173/?theme-preview=1`, storefront `bindPreviewChannel()` accepts `gl:theme:preview` messages and applies them WITHOUT caching. Studio sends draft via `postMessage` (debounced 80ms) on every change |

### Defense-in-depth additions

- **Storefront-side validators** — even on a no-auth public endpoint, the storefront re-validates each override (color regex, font regex, length, duration, unitless) before calling `setProperty`. A compromised API or polluted localStorage cache cannot inject arbitrary CSS custom properties.
- **postMessage origin check** — preview iframe only honors messages from `window.parent`, never random pop-ups or sibling iframes. Sandboxed `allow-scripts allow-same-origin` only — no forms, no popups, no top-level navigation.
- **Server diagnostics return** — every rejected token appears in `dropped[]` with a `reason` enum (`invalid_color | invalid_font | invalid_length | invalid_duration | invalid_number | unknown_token | non_string | too_long`). The client can map these to user-friendly hints in the future.

### Validation

- `npx tsc -b --noEmit` → admin EXIT 0 · storefront EXIT 0
- `npx vite build` → admin (ThemeStudio chunk **26.02 kB / 7.45 kB gz**) · storefront built clean
- `python -m pytest tests/` → **110 passed in 4.63 s**
- `python -m py_compile api/routes/settings.py api/main.py` → OK

### Files changed in this push

- **Modified** — `api/routes/settings.py` (numeric bounds + dropped diagnostics), `admin/src/lib/api.ts` (ThemeSaveResult + ThemeDropped types), `admin/src/lib/theme.ts` (bindCrossTabSync), `admin/src/pages/Settings.tsx` (live preset chips), `admin/src/pages/ThemeStudio.tsx` (server-data snapshot + draft re-hydration + dropped toast + iframe preview), `admin/src/App.tsx` (mount cross-tab sync), `admin/src/index.css` (@supports fallback), `storefront/src/lib/theme.ts` (validators + bindCrossTabSync + bindPreviewChannel), `storefront/src/main.tsx` (mount cross-tab + preview), `storefront/src/index.css` (@supports fallback)

---

## ✅ Phase 9 (Push 4) — Structured logging foundation

Audit P0 #1 — every Python process now emits JSON to stdout. Sets up Sentry / Loki / Datadog / OpenTelemetry as a configuration change rather than a code change.

### Added

| File | Change |
|---|---|
| `api/core/logging.py` | **NEW** — JsonFormatter + `setup_logging(component, level?)` + `bind_request_id(rid)` / `bound_request_id()` ContextVar plumbing. Idempotent setup, env override `GL_LOG_LEVEL`, third-party noise clamped to WARNING, exceptions serialised to `exc_type`/`exc_message`/`exc_traceback` JSON fields. |
| `tests/test_logging.py` | **NEW** — 16 tests covering: required keys, %-format rendering, extras-promotion, no LogRecord internals leaked, unusual value types (tuple/set/bytes/UUID), exception attachment, level round-trip, ContextVar plumbing (incl. `gather()` propagation into child tasks), explicit-extra-wins-over-ContextVar, ISO 8601 ms UTC timestamp shape. |

### Modified

| File | Change |
|---|---|
| `api/main.py` | Replaced `logging.basicConfig` with `setup_logging(component='api')`. Middleware now `bind_request_id(rid)` so the ContextVar flows through every coroutine spawned in the request. Lifespan / rate-limit / unhandled-error log lines moved to structured `extra={...}`. |
| `workers/intel_worker.py`, `workers/scraper_worker.py`, `workers/event_worker.py`, `workers/reservation_worker.py` | Each calls `setup_logging(component='<name>')` at module load. Per-job processing binds a correlation ID (`intel:<short>` / `scrape:<short>` / `event:<short>`) so every log line during a job is greppable. `bind_request_id(None)` in the `finally` block clears the binding between jobs. |
| `workers/intel_worker.py`, `workers/event_worker.py` | The two hottest log statements ("job completed" / "event completed") migrated to structured `extra={...}` with stable `event` field names: `intel.completed`, `intel.failed`, `event_worker.completed`, `event_worker.failed`. |
| `api/services/full_intel.py`, `api/services/scraper/engine.py` | Hot-path "scrape complete" / "scrape job done" log lines upgraded to structured fields (`product_id`, `sources_succeeded`, `prices_found`, `duration_ms`, `event`). |

### Validation

- `python -m pytest tests/` → **126 passed in 0.80 s** (110 → 126 with new logging tests)
- `python -m py_compile` on every touched module → OK
- `npx tsc -b` admin / storefront → exit 0 (no frontend changes)
- Live smoke: `python -c "from api.core.logging import setup_logging; setup_logging('smoke'); ..."` produces clean JSON lines with request_id from ContextVar

### Files changed

- **Added** — `api/core/logging.py`, `tests/test_logging.py`
- **Modified** — `api/main.py`, `workers/event_worker.py`, `workers/reservation_worker.py`, `workers/scraper_worker.py`, `workers/intel_worker.py`, `api/services/full_intel.py`, `api/services/scraper/engine.py`

### Why this was P0

Every other operational improvement — Sentry, Prometheus, OpenTelemetry traces, log-based alerting — multiplies on top of structured logs. Doing this first means the rest become deployment configuration rather than code changes. The 4 hours invested here pay dividends on every future incident.

---

## ✅ Phase 9 (Push 5) — Migration runner

Audit P0 #2 — migrations now apply automatically on API startup with tracking, tamper detection, and multi-replica safety. Removes the documented "remember to run psql -f …" friction point.

### Added

| File | Purpose |
|---|---|
| `db/migrations/000_migrations_table.sql` | Bootstrap migration that creates the `_migrations(filename, checksum, duration_ms, applied_at)` tracking table. Idempotent (`CREATE TABLE IF NOT EXISTS`) so re-running on every boot is harmless. |
| `api/core/migrations.py` | Async runner. Discovery (filename-ordered, .sql only, SHA-256 hashed), `pg_try_advisory_lock` for replica safety, per-migration transaction with rollback boundary, checksum verification with `MigrationChecksumMismatch` exception, structured-log integration via `event=migrations.*`. SQLAlchemy import is lazy through `_text()` so the pure discovery/hash helpers can be unit-tested without DB drivers. |
| `scripts/migrate.py` | CLI wrapper: `--status` (read-only audit table), `--check` (exit 1 if pending — for CI), default = apply pending. |
| `tests/test_migrations.py` | 14 tests: discovery returns ordered list, only `.sql` files picked up, lexicographic = numeric for zero-padded prefixes, checksum is SHA-256 of bytes (Unicode-safe), bootstrap sorts to front, real-repo migrations all conform, `Migration` is frozen. |

### Modified

| File | Change |
|---|---|
| `api/main.py` | Lifespan hook calls `run_pending_migrations(engine)` before serving requests. `MigrationLockBusy` is caught + logged at WARNING (other replica is migrating, current replica proceeds against current schema). `MigrationChecksumMismatch` propagates so the container crashes loud — never run modified SQL silently. |

### Behaviour matrix

| Situation | Outcome |
|---|---|
| Fresh DB | Bootstrap runs, all migrations apply in order, every row recorded with checksum |
| Fully-migrated DB | Bootstrap runs (no-op), every existing migration's checksum verified, no SQL apply |
| New migration added | Detected on next boot, applied in order, recorded |
| Migration file edited after apply | `MigrationChecksumMismatch` → API refuses to start with a clear message |
| Two replicas booting at once | First grabs `pg_try_advisory_lock`; second waits up to 30s then logs a warning + proceeds (schema already current) |
| Migration SQL fails | Nested transaction rolls back that migration; outer engine connection closes; exception propagates → API crashes for orchestration to handle |

### Validation

- `python -m pytest tests/` → **140 passed in 0.56 s** (126 → 140 with new migration tests)
- `python -m py_compile api/core/migrations.py api/main.py scripts/migrate.py` → OK
- `tsc -b` admin / storefront → exit 0 (no frontend changes)

### Files changed

- **Added** — `db/migrations/000_migrations_table.sql`, `api/core/migrations.py`, `scripts/migrate.py`, `tests/test_migrations.py`
- **Modified** — `api/main.py`, `README.md`, `docs/TUTORIALS.md`

### Why P0

Onboarding a new dev or deploying to a fresh environment used to mean
"don't forget to run `psql -f db/migrations/00X.sql` four times in order."
That's a coordinated step that breaks silently if you skip it. Auto-apply
on startup makes it impossible to forget — and the checksum tamper
detection means the next person to "just edit 003_…" gets an immediate,
clear error instead of half-broken state at runtime.

---

## ✅ Phase 9 (Push 6) — Health-check endpoints

Audit P0 #3 — `/healthz` (liveness), `/readyz` (readiness, with DB + SearXNG probes), `/healthz/details` (admin deep diagnostic). Mapping to the canonical k8s / Cloud Run / ALB conventions so when we deploy to any of those, the wiring is already there.

### Added

| File | Purpose |
|---|---|
| `api/core/health.py` | Probe library. `ProbeResult` dataclass, `_run_with_timeout` (per-probe timeout + exception swallow), individual probes (`db_probe`, `db_extended_probe`, `searxng_probe`, `llm_probe`), composite checks (`readyz_checks`, `details_checks`), and `overall_ok` aggregator (only required probes count toward the 503). SQLAlchemy + httpx imports are lazy so the pure logic is testable without DB drivers. |
| `api/routes/health.py` | HTTP layer. Mounts `/healthz`, `/readyz`, `/healthz/details` at the root (no `/api/v1` prefix) so load balancers don't need version-prefix awareness. `/readyz` returns 503 if any required probe fails; `/healthz/details` is admin-only (gates a potentially expensive LLM ping behind auth). |
| `tests/test_health.py` | 14 tests: probe success/timeout/exception paths, required-flag propagation, aggregator semantics (true when all required pass; true when only optional fails; false when any required fails; vacuously true with empty input), parameterised required-flag-default invariants per probe, total readyz timeout budget assertion. |

### Modified

| File | Change |
|---|---|
| `api/main.py` | Removed inline `/healthz`. Mounts `health.router` at root. |
| `docker-compose.yml` | `api` service has its own healthcheck via `/healthz` (Python urllib one-liner — no curl in slim images). All four workers gain `depends_on: api: condition: service_healthy` so migrations finish before workers query schema-dependent tables. One-command `docker compose up -d` is now race-free on a fresh DB. |

### Behaviour matrix

| Scenario | `/healthz` | `/readyz` | `/healthz/details` |
|---|---|---|---|
| Everything up | 200 | 200 | 200 |
| DB down | 200 (process alive) | 503 | 503 |
| SearXNG down | 200 | 503 | 503 |
| LLM unreachable | 200 | 200 (LLM is `required=False`) | 200 with `llm.ok=false` in checks list |
| Process hung | timeout | timeout | timeout |

### Validation

- `python -m pytest tests/` → **154 passed in 0.60 s** (140 → 154; +14 health tests)
- `python -m py_compile api/core/health.py api/routes/health.py api/main.py` → OK
- `tsc -b` admin / storefront → exit 0 (no frontend changes)

### Files changed

- **Added** — `api/core/health.py`, `api/routes/health.py`, `tests/test_health.py`
- **Modified** — `api/main.py` (removed inline /healthz, mount router), `docker-compose.yml` (api healthcheck + worker dependencies)

### Why P0

A "healthy" container that can't actually serve traffic is the bug-class with the worst signal-to-noise ratio in production: nothing alerts because nothing crashes, but customers get 5xx until someone notices. Wiring `/readyz` into the LB closes that loop — instances that lose their DB or SearXNG get pulled out automatically and rejoin when they recover. The cost was 4 hours; it pays back the first time prod has a partial outage.

---

## ⏳ Future work

| Theme | Notes |
|---|---|
| **R2 image downloader-worker** | Picks rows where `status='STORED' AND source='SCRAPED' AND bytes IS NULL`, downloads, computes SHA-256 + dimensions, re-uploads to R2, swaps the URL. |
| **Theme: per-user vs. global** | Right now `admin.theme` is a single global config. Could promote to `admin_user.theme_overrides` if multiple admins want different palettes. |
| **Graph: brand-brand co-occurrence** | "Brands that share categories" — would surface dropshippers / OEM clusters. |
| **Image moderation auto-flag** | Watermark / NSFW heuristic at insert time so suspect URLs land in a pre-PENDING bucket. |

---

## Infra & ops history

| Date | Change |
|---|---|
| 2026-04-25 | Wired `db/seed_admin.sql` into `docker-entrypoint-initdb.d` so the first admin lands automatically on a fresh volume. |
| 2026-04-25 | Switched API + worker containers to bind-mounted source + `uvicorn --reload` for instant iteration during dev. |
| 2026-04-25 | Generated brand-aligned `.env` (JWT secret, dev DB password, dev CORS). |
