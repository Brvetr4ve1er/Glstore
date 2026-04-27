# Project Structure

Annotated file tree as of **Phase 2 (backend complete)**.

```
GLstore/                                    workspace root (folder name kept; product is "Ghir Laffaire")
│
├── README.md                               top-level entry point + doc index
├── docker-compose.yml                      DB + API + 2 workers · bind mounts + uvicorn --reload
├── requirements.txt                        Python deps (FastAPI, SQLA, asyncpg, bcrypt, jwt, …)
├── .env                                    dev secrets (gitignored)
├── .env.example                            template
├── .gitignore
│
├── docs/                                   ← project documentation
│   ├── PROGRESS.md                         phase-by-phase log of everything built
│   ├── ARCHITECTURE.md                     data model, services, request flows, security
│   ├── STRUCTURE.md                        this file
│   ├── ROADMAP.md                          Phase 3 onward, ordered by value
│   ├── BRAND.md                            Ghir Laffaire visual identity tokens
│   └── API.md                              endpoint reference
│
├── db/
│   ├── schema.sql                          full Write Model — types, tables, indexes, fns
│   ├── seed_admin.sql                      auto-seeds default admin on fresh DB volume
│   └── migrations/                         (future) forward-only migration files
│
├── docker/
│   ├── Dockerfile.api                      multi-stage Python image, non-root uid=10001
│   └── Dockerfile.worker                   shared image for both workers
│
├── scripts/
│   ├── __init__.py
│   └── create_admin.py                     CLI: idempotent admin upsert with bcrypt hash
│
├── api/                                    FastAPI write model
│   ├── __init__.py
│   ├── main.py                             app factory, middleware, router mounts, lifespan
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py                       Pydantic Settings (env-driven)
│   │   ├── db.py                           async engine + SessionLocal + get_db dep
│   │   ├── security.py                     bcrypt + JWT + require_role guard
│   │   └── ratelimit.py                    in-proc sliding-window limiter
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py                      Pydantic DTOs (ProductBase, ProductCreate,
│   │                                        ProductPatch, OfferCreate, OfferPatch,
│   │                                        OrderCreate, AdminLogin, …)
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth.py                         POST /auth/login (lockout-aware)
│   │   ├── products.py                     full CRUD: GET/POST/PATCH/DELETE
│   │   │                                    + nested offers CRUD
│   │   │                                    + soft-archive (default) / hard delete (guarded)
│   │   ├── products_import.py              POST /products/import/preview + /commit
│   │   │                                    + auto_enrich Form param
│   │   ├── enrichment.py                   POST /products/{id}/enrich
│   │   │                                    POST /products/enrich-all
│   │   │                                    GET  /products/enrichment/stats
│   │   ├── issues.py            ★ Phase 3  GET  /products/{id}/issues
│   │   │                                    GET  /products/issues/summary
│   │   │                                    GET  /products/issues/list?code=...
│   │   │                                    GET  /brands
│   │   ├── settings.py          ★ Phase 4  GET/PUT /settings/llm
│   │   │                                    POST /settings/llm/ping
│   │   ├── orders.py                       POST /orders/create (public)
│   │   │                                    POST /orders/{id}/confirm|cancel (admin)
│   │   │                                    GET  /orders[, /{id}] (admin)
│   │   └── events.py                       POST /events (admin/n8n ingest)
│   └── services/
│       ├── __init__.py
│       ├── orders.py                       reserve / confirm / cancel + fetch
│       ├── events.py                       emit_event helper
│       ├── csv_parser.py        ★ Phase 1  pure: text → list[RawProductRow]
│       ├── csv_import.py        ★ Phase 1  pure orchestrator: validate + upsert
│       ├── enrichment.py        ★ Phase 2  pure rule engine — 60 brands, 65 categories
│       ├── enrichment_runner.py ★ Phase 2  DB bridge: enrich_one + enrich_many
│       ├── validator.py         ★ Phase 3  pure: facts → list[Issue] with fix_hints
│       ├── llm.py               ★ Phase 4  pluggable client (Ollama/OpenAI-compat/Anthropic)
│       └── llm_enrichment.py    ★ Phase 4  prompt + parse + merge orchestrator
│
├── workers/                                async pollers
│   ├── __init__.py
│   ├── event_worker.py                     FOR UPDATE SKIP LOCKED + retry/backoff
│   └── reservation_worker.py               releases stale stock holds every 30s
│
└── admin/                                  React 19 admin console
    ├── package.json
    ├── vite.config.ts                      proxy /api → http://localhost:8000
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── index.html                          → "Ghir Laffaire — Admin Console"
    ├── public/
    │   └── favicon.svg                     cart + ? + crown SVG
    └── src/
        ├── main.tsx
        ├── App.tsx                         routes + RequireAuth + Toaster
        ├── index.css                       brand tokens + utilities + keyframes
        ├── components/
        │   ├── BrandLogo.tsx               cart + mystery box + crown + sparkles
        │   ├── Layout.tsx                  sidebar shell with yellow nav pill
        │   ├── IssuePanel.tsx   ★ Phase 3  collapsible issue list + inline fixers
        │   └── ui.tsx                      Button, Input, Select, Textarea, Card,
        │                                    StatCard, Modal, EmptyState, PageHeader, …
        ├── lib/
        │   ├── api.ts                      typed fetch client + multipart helper
        │   ├── auth.tsx                    AuthProvider (JWT in localStorage)
        │   ├── query.ts                    TanStack QueryClient
        │   └── utils.ts                    fmtMoney, fmtDate, status colour maps
        └── pages/
            ├── Login.tsx                   branded entry, ambient glows
            ├── Dashboard.tsx               stagger-reveal stat cards + recent orders
            ├── Products.tsx                virtualised list + Import + New buttons
            ├── ProductDetail.tsx           images, specs, offers + Edit button
            ├── ProductEditor.tsx ★ Phase 0 create + edit in one component
            ├── ProductImport.tsx ★ Phase 1 4-stage flow: drop → preview → commit → done
            ├── IssueExplorer.tsx ★ Phase 3 /products/issues — tabbed bulk fix-by-issue
            ├── Settings.tsx      ★ Phase 4 /settings — LLM backend config + bulk LLM enrich
            ├── Orders.tsx                  virtualised list + status filter
            └── OrderDetail.tsx
```

---

## Sizes (current)

| Area | LOC (approx) |
|---|---|
| `api/` | ~1,800 lines Python |
| `admin/src/` | ~2,300 lines TSX |
| `db/schema.sql` | ~520 lines SQL |
| `workers/` | ~280 lines Python |
| `docs/` | this folder |

---

## Conventions

- **Python:** type hints everywhere, `from __future__ import annotations` at top of every module, `async`-first.
- **TypeScript:** strict mode, no `any` outside `Record<string, unknown>` JSON gateways. `npx tsc --noEmit` must pass before commit.
- **SQL:** parametrised only. No string concatenation. Indexes named `<table>_<col>_idx`.
- **Routes:** every write endpoint behind `Depends(require_role(...))`.
- **Services:** pure where possible. DB-coupled functions never `db.commit()` — that's the route's job.
- **Components:** primitives in `ui.tsx`, page-level work in `pages/*.tsx`, no logic in `Layout.tsx` beyond nav.

---

## Phase 5–9 delta (additions since the tree above)

### Backend

```
api/
├── core/
│   ├── logging.py                     ★ P9 Push 4   JSON formatter + request_id ContextVar plumbing
│   ├── migrations.py                  ★ P9 Push 5   auto-applied SQL migrations (lock + checksum + tx)
│   └── health.py                      ★ P9 Push 6   probe library (db, searxng, llm, db_extended)
├── routes/
│   ├── health.py                      ★ P9 Push 6   /healthz · /readyz · /healthz/details
│   ├── catalog.py                     ★ Phase 8/9   /categories, /brands/public, /products/graph
│   │                                                  (now: ?include_products + product_limit + only_status)
│   │                                                  /products/featured
│   ├── jobs.py                        ★ Phase 7     unified queue: scrape + event + sync_queue
│   ├── intel.py                       ★ Phase 9     Full Intel: per-product + bulk + batch progress
│   ├── images.py                      ★ Phase 9     image confirmation queue (per-product + global)
│   ├── public_orders.py                            customer-facing checkout endpoints
│   ├── settings.py                    ★ Phase 9 P3  + scope param (admin/storefront) + public_router
│   │                                                  for GET /storefront/theme (no auth)
│   └── scraper.py                     ★ Phase 5     market enquiry endpoints + scrape_jobs UI hooks
├── services/
│   ├── full_intel.py                  ★ Phase 9     scrape + LLM + tiered overwrite merge
│   │                                  (P9 test fix) creates real scrape_jobs row before invoking engine
│   │                                                so scrape_sources FK is satisfied
│   └── scraper/                       ★ Phase 5     engine, search, ranker, fetcher, tiers/, extractors/

workers/
├── scraper_worker.py                  ★ Phase 5     polls scrape_jobs · heartbeat 60s · stale 5m
│                                      (P9 Push 4)   + bind_request_id(scrape:<short>) per claim
├── intel_worker.py                    ★ Phase 9     polls intel_jobs · same patterns as scraper_worker
│                                      (P9 Push 4)   + bind_request_id(intel:<short>) per claim
├── event_worker.py                                  + bind_request_id(event:<short>) per process
└── reservation_worker.py                            + setup_logging('reservation-worker')

scripts/
├── create_admin.py                                  CLI: idempotent admin upsert with bcrypt hash
└── migrate.py                          ★ P9 Push 5  CLI: --status / --check / default = apply pending

db/migrations/
├── 000_migrations_table.sql            ★ P9 Push 5  bootstrap — _migrations(filename, checksum, …)
├── 001_app_settings.sql                              app_settings table (Phase 4)
├── 002_scraper.sql                                   scraper schema additions (Phase 5)
├── 003_observations_retention.sql                    audit retention policy (audit fix)
└── 004_intel_jobs.sql                                intel_status_enum + intel_jobs + indexes (Phase 9)
   (Phase 9 theme uses the existing app_settings table — no new migration needed;
    GET /settings/theme returns sane defaults if no row is present, PUT upserts it.)

tests/
├── test_logging.py                     ★ P9 Push 4  16 tests · JSON shape + ContextVar propagation
├── test_migrations.py                  ★ P9 Push 5  14 tests · discovery, ordering, checksum semantics
└── test_health.py                      ★ P9 Push 6  14 tests · probe runner + aggregator + budgets
```

### Frontend

```
admin/src/
├── App.tsx                                         + /products/:id/images, /images, /jobs, /graph
├── main.tsx                          ★ Phase 9     applyTheme(cached) before React mounts
├── lib/
│   ├── theme.ts                      ★ Phase 9     vanilla theme module + 6 presets + applyTheme
│   └── api.ts                        ★ extended    GraphQuery · ImageReview · Theme · Intel types
├── components/
│   └── Layout.tsx                                  + Image Review · Jobs Console · Catalog Graph nav
└── pages/
    ├── JobsConsole.tsx               ★ Phase 7     unified ops view, retry/cancel, auto-refresh
    ├── CatalogGraph.tsx              ★ Phase 8/9   Obsidian rebuild: 3 node types · auto SVG/Canvas
    │                                                physics panel · search · drag-to-pin · localStorage
    ├── ImageReview.tsx               ★ Phase 9     <ProductImageReview> + <GlobalImageQueue>
    ├── Settings.tsx                  ★ extended    + theme summary + open-studio link
    └── ThemeStudio.tsx               ★ Phase 9 P3  full-page editor · 32 tokens · 11 presets ·
                                                     6 tabs (Presets/Colors/Typo/Radii/Effects/Storefront/JSON)
admin/src/components/
    └── ThemeSwitcher.tsx             ★ Phase 9 P3  sidebar quick preset switcher

storefront/src/lib/
    └── theme.ts                      ★ Phase 9 P3  receive-end of admin theming · cached + server fetch
```

### Storefront

The `storefront/` workspace was added in Phase 6 (full e-com surface): home / catalog / search / product / cart / checkout / confirm + SEO + order tracking. Lives at `:5173`, hits the same `/api/v1/*` proxy.
