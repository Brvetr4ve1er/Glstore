# GLstore — Project Anchor

> **Read this first.** Single source of truth for what this repo is, where things live, and how the parts talk. Existing docs in `docs/` are deep-dive references — this file is the index + the seam map.

---

## 1. What this repo is (one paragraph)

A monorepo for **GLstore** (originally *Ghir Laffaire*, an Algerian-market e-commerce platform). One FastAPI backend + Postgres + 4 background workers serves **three frontends**: a public React storefront, a React admin dashboard, and a static HTML *prototype* (GLAIVE — a SteelSeries-inspired gaming gear study). Currency is DZD, shipping uses Algerian wilayas, payment is COD-first. The `gaming-store` branch is a **replacement-fork** of `main`: same backend, new frontend identity (GLAIVE), and a different seed catalog.

## 2. Branch policy — UNRESOLVED ⚠️

| Branch | What it ships | Status |
|---|---|---|
| `main` | Generic *Ghir Laffaire* storefront, no seed | Last commit `b16f73c` — historical marker, not actively shipped |
| `gaming-store` | GLAIVE gaming gear identity + `db/seed_gaming.sql` | Active development |

**Backend, workers, DB schema, Docker compose, env vars, migrations are 100% identical between branches.** The diff is ~99% frontend + 1 seed file. You **deploy one or the other**, not both.

> **Open question for the owner:** Is gaming-store the new product (and main should be archived/deleted), or is gaming-store a marketing prototype (and main is the real product)? Until this is answered, every PR-merge decision is ambiguous.

## 3. Service map

### Backend (Docker compose: [docker-compose.yml](docker-compose.yml))
| Service | Tech | Port | Purpose |
|---|---|---|---|
| `db` | Postgres 16 | 5432 | Single source of truth |
| `api` | FastAPI / uvicorn | 8000 | All HTTP — see §5 |
| `event_worker` | Python | — | Polls `events` table → fan-out to `sync_queue` (n8n / accounting / shipper) |
| `reservation_worker` | Python | — | **Singleton** — calls `fn_expire_stale_reservations()` every 30s + nightly observation pruning |
| `scraper_worker` | Python + Playwright | — | Polls `scrape_jobs` — tier-escalating fetch (httpx → Playwright → stealth → paid) |
| `intel_worker` | Python + Playwright + LLM | — | Polls `intel_jobs` — full scrape + LLM merge pipeline |
| `searxng` | searxng/searxng | 8088 | Self-hosted search aggregator for the scraper |

### Frontends (not in compose — run locally)
| App | Tech | Port | Run from |
|---|---|---|---|
| [storefront/](storefront/) | React 19 + Vite | 5173 | `npm --prefix storefront run dev` |
| [admin/](admin/) | React 19 + Vite | 5174 | `npm --prefix admin run dev` |
| [gaming-store/](gaming-store/) | Static HTML / CSS / vanilla JS | 8080 | `python -m http.server 8080 --directory gaming-store` |

Launch configs centralized in [.claude/launch.json](.claude/launch.json) — invoke with `preview_start <name>`.

## 4. The architecture seam (the contracts that matter)

```
┌──────────────┐    ┌────────────┐    ┌──────────────────┐
│  storefront  │───►│            │    │   gaming-store   │
│   (React)    │    │            │    │  (static, NO API)│
└──────────────┘    │            │    └──────────────────┘
                    │ /api/v1    │
┌──────────────┐    │  FastAPI   │     ┌──────────────────┐
│    admin     │───►│            │────►│    Postgres      │
│   (React)    │    │            │     │  (13 tables)     │
└──────────────┘    └─────┬──────┘     └──────────────────┘
                          │ enqueues       ▲
                          ▼                │ writes
                  ┌────────────────┐       │
                  │ scrape_jobs    │       │
                  │ intel_jobs     │───────┘
                  │ events         │
                  └───────┬────────┘
                          │ polled by
                          ▼
                  ┌──────────────────┐
                  │  4 workers       │
                  │  (event/intel/   │
                  │   scraper/resv.) │
                  └──────────────────┘
```

**Contracts:**
- **Frontends ↔ API** — HTTP, `/api/v1`. Storefront is public + uses `/offers/availability` for cart re-validation. Admin uses JWT (`POST /auth/login`).
- **API ↔ Workers** — Through DB tables (`scrape_jobs`, `intel_jobs`, `events`). `?wait=true` query param on enqueue endpoints blocks up to 90s/120s for a synchronous-looking experience.
- **Workers ↔ Workers** — None. They don't talk to each other. Coordination is via DB rows.
- **Workers ↔ External** — `searxng:8080` (intra-network), Playwright→websites, LLM API (Ollama / Anthropic / OpenAI-compat per `app_settings`).
- **gaming-store ↔ anything** — **None.** It's static. All product data is hardcoded in `gaming-store/assets/js/data.js`.

## 5. API surface — 18 route modules

All mounted under `/api/v1` (except `/healthz`, `/readyz`). Auth roles: `SUPER_ADMIN`, `ADMIN`, `OPERATOR`, `VIEWER`.

| File | Mount | Highlights |
|---|---|---|
| [api/routes/auth.py](api/routes/auth.py) | `/auth` | JWT login. Per-account lockout + per-IP fail tracker (⚠️ in-memory, not multi-replica safe) |
| [api/routes/catalog.py](api/routes/catalog.py) | `/` | Public facets: categories, brands, price-bounds, featured, graph |
| [api/routes/products.py](api/routes/products.py) | `/products` | Public list/detail + admin CRUD + offer CRUD |
| [api/routes/products_import.py](api/routes/products_import.py) | `/products/import` | CSV preview + commit |
| [api/routes/products_export.py](api/routes/products_export.py) | `/products` | **⚠️ Not mounted in `api/main.py`** — orphan router with `/export`, `/bulk-update`, `/bulk-status` |
| [api/routes/images.py](api/routes/images.py) | `/` | Image review queue, approve/reject |
| [api/routes/enrichment.py](api/routes/enrichment.py) | `/products` | Single + bulk rule-based and LLM enrichment |
| [api/routes/intel.py](api/routes/intel.py) | `/` | Enqueue intel jobs, query batches |
| [api/routes/scraper.py](api/routes/scraper.py) | `/` | Enqueue scrape jobs, query competitor prices, scraper settings |
| [api/routes/issues.py](api/routes/issues.py) | `/` | Catalog-quality issues (missing fields, low completeness) |
| [api/routes/jobs.py](api/routes/jobs.py) | `/jobs` | Unified console across scrape/event/sync queues |
| [api/routes/orders.py](api/routes/orders.py) | `/orders` | Public create + admin confirm/cancel/list/detail |
| [api/routes/public_orders.py](api/routes/public_orders.py) | `/` | `POST /offers/availability` (cart re-validate), `POST /orders/track` |
| [api/routes/events.py](api/routes/events.py) | `/events` | Trusted-upstream event ingest |
| [api/routes/settings.py](api/routes/settings.py) | `/settings` | LLM config, theme config (admin + storefront) |
| [api/routes/health.py](api/routes/health.py) | `/` | `/healthz`, `/readyz`, `/healthz/details` |

**Middleware (in [api/main.py](api/main.py))**: GZip ≥1KB, CORS, TrustedHost (prod), request-ID (`x-request-id`), per-IP+per-account rate limit (POST/PATCH/DELETE only), security headers (CSP/X-Frame/HSTS).

**Lifespan**: runs pending migrations from `db/migrations/*.sql` under an advisory lock (multi-replica safe).

## 6. Database — 13 tables, 5 spine

[db/schema.sql](db/schema.sql)

**Spine** (touch most often): `products`, `offers`, `orders`, `admin_users`, `events`.
**Inventory**: `inventory_reservations` (TTL holds via `fn_reserve_stock` / `fn_consume_reservation`).
**Audit/feed**: `observations` (one row per `(entity, field, source, time)` — used to merge conflicting signals from scrapers and admin).
**Queues**: `events`, `sync_queue`, `scrape_jobs`, `intel_jobs`, `scrape_sources`, `competitor_prices`.
**Financial**: `financial_transactions` (PAYMENT / REFUND / ADJUSTMENT / COD_COLLECTION, idempotent on key).

Seed files load in numeric order: `00-schema.sql`, `01-seed_admin.sql`, `02-seed_gaming.sql` (only on `gaming-store`).

## 7. Environment

Source of truth: [api/core/config.py](api/core/config.py) (`pydantic.BaseSettings`). See `.env.example` for defaults.

**Required to boot the API**: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`.
**Required for media uploads**: `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`.
**Required for scraping/intel**: LLM config (set via admin UI → `app_settings` row), SearXNG running.

## 8. Where common changes land

| If you want to… | Edit… |
|---|---|
| Add a public API endpoint | `api/routes/*.py` + register in `api/main.py` |
| Add an admin page | `admin/src/pages/*.tsx` + add a route in `admin/src/App.tsx` |
| Add a storefront page | `storefront/src/pages/*.tsx` + add a route in `storefront/src/App.tsx` |
| Change DB schema | Add `db/migrations/NNN_*.sql` (auto-runs on API startup) |
| Add a worker behavior | `workers/*_worker.py` |
| Tune the scraper | `api/services/scraper/{engine,fetcher,tiers/,retailers/}.py` |
| Change LLM/theme/scraper config at runtime | Admin UI → Settings (writes to `app_settings`) |

## 9. Known issues / open questions

Catalogued during the 2026-06-20 architecture seam audit (see §10):

1. **`products_export.py` is not mounted** — define-then-forget. Decide: mount it (and verify admin/storefront consume it) or delete it.
2. **`intel_worker` creates shadow `scrape_jobs` rows** for FK constraint satisfaction; `scraper_worker` never claims them. Unclear if cleaned up. Risk: queue stats pollution.
3. **`reservation_worker` is documented singleton but not enforced.** No external lock. Risk: double-call on `fn_expire_stale_reservations` and `fn_prune_observations` (functions are idempotent, but still).
4. **Per-process rate limiter in scraper** — multiple workers don't coordinate per-domain budget; effective rate doubles per replica.
5. **In-memory auth IP-fail tracker** — multi-replica deployments won't share state. Move to Redis or DB.
6. **Observations triple-writer** — `enrichment_runner._add_observation`, `llm_enrichment._add_observation`, and `scraper/engine._persist_*` all write `observations` rows with slightly different shapes. No canonical writer.
7. **No circuit breaker on bulk LLM enrichment** — a misconfigured LLM endpoint burns through a whole batch with no backoff.
8. **`gaming-store/` has no backend integration** — hardcoded JS data. If you want it to be a real customer surface, it needs to talk to `/api/v1`. If it's a marketing prototype, document that and stop expecting it to stay in sync.
9. **`main` branch is untested** — last MVP shipping commit is `b16f73c`. Verify it still boots or formally archive.

## 10. Existing deep-dive docs

These existed before this anchor — use them as references, not as the entry point:

- [docs/SYSTEM_AUDIT.md](docs/SYSTEM_AUDIT.md) — earlier audit with severity-coded findings
- [docs/SYSTEM_CONTEXT.md](docs/SYSTEM_CONTEXT.md) — system-wide context narrative
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / [docs/ARCHITECTURE_MAP.md](docs/ARCHITECTURE_MAP.md) — architecture diagrams + decisions
- [docs/API.md](docs/API.md) — API contract notes
- [docs/STRUCTURE.md](docs/STRUCTURE.md) — repo layout
- [docs/PROGRESS.md](docs/PROGRESS.md) — phase log
- [docs/ROADMAP.md](docs/ROADMAP.md) — roadmap
- [docs/GAMING_STORE.md](docs/GAMING_STORE.md) — GLAIVE prototype notes
- [docs/BRAND.md](docs/BRAND.md) — brand identity
- [docs/TUTORIALS.md](docs/TUTORIALS.md) — how-tos

> When a fact above contradicts a doc here, **trust this file** — it was reconciled against the live code on 2026-06-20. File a follow-up to fix the doc.

## 11. Quick start

```bash
# 1. backend stack (db + api + workers + searxng)
docker compose up -d

# 2. pick a frontend
preview_start storefront   # public catalog on :5173
preview_start admin        # admin dashboard on :5174
preview_start gaming-store # GLAIVE prototype on :8080
```

Default admin login is seeded in [db/seed_admin.sql](db/seed_admin.sql).

---

*Anchor written 2026-06-20 by a four-agent architecture-seam sweep (api routes / frontends / workers / data+env+branch). Re-run that sweep if any §3 service shape changes.*
