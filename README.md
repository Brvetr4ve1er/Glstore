# Ghir Laffaire — Commerce Intelligence Platform

> *Fast. Reliable. Yours.*
> Inspired by Shibuya punk · Built for Algeria.

A unified e-commerce backend + admin console + intelligence engine for the Algerian consumer-electronics market. Ingests messy supplier CSVs, normalises them through a deterministic enrichment brain, and exposes the result through a punk-styled React 19 admin dashboard.

```
                     ┌─────────────────────────────────────┐
                     │   GHIR LAFFAIRE — CONSOLE (admin)   │
                     │   React 19 / Vite / Tailwind v4     │
                     └────────────┬────────────────────────┘
                                  │  /api/v1
       ┌──────────────────────────┴────────────────────────────┐
       │                  FASTAPI WRITE MODEL                  │
       │  ┌────────────┐  ┌──────────┐  ┌──────────────┐       │
       │  │ products   │  │ orders   │  │ enrichment   │       │
       │  │ + offers   │  │ + items  │  │ + observations       │
       │  └────────────┘  └──────────┘  └──────────────┘       │
       │  ┌────────────┐  ┌──────────────────────────┐         │
       │  │ csv import │  │ rule-engine enrichment   │         │
       │  └────────────┘  └──────────────────────────┘         │
       └────────────┬───────────────────────────┬──────────────┘
                    │                           │
        ┌───────────▼─────────┐         ┌───────▼─────────┐
        │   PostgreSQL 16     │         │  async workers  │
        │ (Write Model + obs) │◀────────│  (event +       │
        └─────────────────────┘         │   reservation)  │
                                        └─────────────────┘
```

---

## What it does today

| Capability | Status | Phase |
|---|---|---|
| **Auth** — admin login, JWT, role guard, lockout | ✅ Done | (foundation) |
| **Order pipeline** — reserve → confirm → ship → deliver | ✅ Done | (foundation) |
| **Manual product CRUD** — add / edit / archive products and offers | ✅ Done | Phase 0 |
| **Bulk CSV import** — universal parser, idempotent upsert, live preview | ✅ Done | Phase 1 |
| **Rule-based enrichment** — 60 brands × 65 categories + spec extraction | ✅ Done | Phase 2 (backend) |
| **Auto-enrich on import** — every imported row passes through the rule engine | ✅ Done | Phase 2 |
| **Completeness score** — weighted, recomputed live | ✅ Done | Phase 2 |
| **Enrichment UI** — "Enrich now" / "Enrich all" / Needs-Fix filter / Dashboard card | ✅ Done | Phase 2 |
| **Catalog Quality console** — per-product issue panel + bulk fix-by-issue triage | ✅ Done | Phase 3 |
| **LLM enrichment** — Ollama / OpenAI-compat / Anthropic, Settings page, bulk + per-product | ✅ Done | Phase 4 |
| **Multi-tier web scraper** (backend) — 4-tier cascade, 6 extractors, SearXNG search, confidence + cross-source consensus | ✅ Done | Phase 5 |
| **Public storefront** — full e-com surface (home / catalog / search / product / cart / checkout / confirm) | ✅ Done | Phase 6 |
| **Storefront polish** — SEO + OG · live stock re-validation · order tracking by phone+order# | ✅ Done | Phase 6 polish |
| **Jobs Console** — unified UI over scrape_jobs + events + sync_queue · auto-refresh · retry/cancel | ✅ Done | Phase 7 |
| **Catalog Graph** — D3-force brand × category visualisation · click-to-explore · zoom/pan | ✅ Done | Phase 8 |
| **Full Intel Pipeline** — scrape + LLM + tiered merge · per-product + bulk batch progress | ✅ Done | Phase 9 (Push 1) |
| **Obsidian-grade Catalog Graph** — products + brands + categories · auto SVG/Canvas · physics panel · search · drag-to-pin · localStorage layouts | ✅ Done | Phase 9 (Push 2) |
| **Image Review queue** — per-product + cross-catalog confirmation of scraped images · approve / set-as-primary / reject · live completeness recompute | ✅ Done | Phase 9 (Push 2) |
| **Admin theme customization** — 6 curated presets (Tokyo · Sakura · Matcha · Sunset · Paper · canon) · per-token color picker · server-persisted in `app_settings` | ✅ Done | Phase 9 (Push 2) |
| **Theme Studio** — full customization page (32 tokens · 11 presets · live preview · JSON import/export) · admin-controlled storefront theming via public `/storefront/theme` · sidebar quick-switcher | ✅ Done | Phase 9 (Push 3) |

See [docs/PROGRESS.md](docs/PROGRESS.md) for line-by-line progress and [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

---

## Quick start

```bash
# 1. One-time setup
cd C:\Users\ROG STRIX\Desktop\antigravity\playground\GLstore
copy .env.example .env       # already filled with dev defaults

# 2. Start the stack (migrations auto-apply on api start)
docker compose up -d

# Process liveness — returns instantly
curl http://localhost:8000/healthz   # {"status":"ok"}

# Readiness — DB + SearXNG must respond. Returns 503 if anything required is down.
curl http://localhost:8000/readyz | jq

# 3. Start the admin dashboard
cd admin
npm install
npm run dev                  # http://localhost:5174

# 4. Start the public storefront (separate terminal)
cd ../storefront
npm install
npm run dev                  # http://localhost:5173
```

**Default ports (host-side):**
| Port | Service |
|---|---|
| 8000 | API (FastAPI) |
| 5174 | Admin SPA (Vite dev) |
| 5173 | Storefront SPA (Vite dev) |
| 8088 | SearXNG (intra-network is `searxng:8080`; host moved to 8088 to avoid collisions) |
| 5432 | Postgres (loopback only) |

**Migrations run automatically** on API startup (Phase 9 Push 5). The runner uses a Postgres advisory lock so multiple replicas don't race, records every applied migration in the `_migrations` table with a SHA-256 checksum, and refuses to start if a previously-applied migration's content has changed (tamper detection).

To inspect or apply manually:

```bash
# Show every migration's status (applied / pending / tampered)
docker compose exec api python -m scripts.migrate --status

# Apply pending — same code path as the lifespan hook, useful for cron
docker compose exec api python -m scripts.migrate

# CI gate: exit 1 if any migration is pending
docker compose exec api python -m scripts.migrate --check
```

**Default admin credentials** (auto-seeded on fresh DB):

| Email | Password |
|---|---|
| `brvetr4veler@gmail.com` | `brveadmin` |

To re-seed an existing DB:
```bash
docker compose exec db psql -U glstore -d glstore -f /docker-entrypoint-initdb.d/01-seed_admin.sql
```

---

## Running the tests

```bash
pip install -r requirements.txt
python -m pytest tests/
```

**A bare `python -m pytest tests/` with no dependencies installed will SILENTLY
SKIP the tenancy suite** — `tests/test_store_context.py`, the 40+ assertions
guarding the multi-brand store-isolation boundary (`api/core/store_context.py`).
That file uses `pytest.importorskip("sqlalchemy")` / `importorskip("jwt")`, so
if those two packages aren't on `sys.path` the whole module degrades to a
single `skipped` result and the run still reports a comfortable
`N passed, 1 skipped` — a green build that tested **none** of the brand
boundary. This has already bitten the repo once: four `NOT NULL store_id`
crashes shipped past a suite that looked green for exactly this reason.

To get the real result — the one that actually exercises store isolation —
install `requirements.txt` first, or just run the file in isolation and read
the summary line:

```bash
pip install -r requirements.txt
python -m pytest tests/test_store_context.py -v
# look for "N passed" with N > 0 and NO mention of "skipped"
```

CI (`.github/workflows/tests.yml`) always installs `requirements.txt` before
testing, and has a dedicated step that fails the build outright if
`tests/test_store_context.py` reports any skip — see that workflow file for
the mechanism. Locally, a skip is easy to miss in the noise of a full
`tests/` run; watch for it explicitly if you're not using CI.

---

## Project structure

See [docs/STRUCTURE.md](docs/STRUCTURE.md) for the full file tree with annotations. Top level:

```
GLstore/                       # workspace root (kept as folder name; product is "Ghir Laffaire")
├── admin/                     # React 19 admin console
├── api/                       # FastAPI write model + enrichment + import
├── workers/                   # asyncio event + reservation pollers
├── db/                        # schema.sql + seed_admin.sql
├── docker/                    # Dockerfile.api + Dockerfile.worker
├── scripts/                   # CLI helpers (create_admin.py, etc.)
├── docs/                      # ← project documentation lives here
├── docker-compose.yml         # full stack (DB + API + workers)
├── requirements.txt           # Python deps
└── .env                       # dev secrets (gitignored)
```

---

## Documentation index

| Doc | What's inside |
|---|---|
| **[docs/SYSTEM_AUDIT.md](docs/SYSTEM_AUDIT.md)** | Brutally honest staff-engineer audit — risks, debt, anti-patterns, prioritized refactors. **Read first.** |
| **[docs/SYSTEM_CONTEXT.md](docs/SYSTEM_CONTEXT.md)** | Single source of truth — components, data lifecycle, design decisions, known limitations. |
| **[docs/ARCHITECTURE_MAP.md](docs/ARCHITECTURE_MAP.md)** | ASCII component + data-flow + state-machine diagrams. |
| **[docs/TUTORIALS.md](docs/TUTORIALS.md)** | Onboarding + how to test, debug, extend. |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Phase-by-phase log of everything that's been built, with file-level diffs. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Earlier architecture overview (superseded by `ARCHITECTURE_MAP` + `SYSTEM_CONTEXT`). |
| [docs/STRUCTURE.md](docs/STRUCTURE.md) | Annotated file tree of the entire repo. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's next — Phase 3 onward, ordered by value. |
| [docs/BRAND.md](docs/BRAND.md) | Ghir Laffaire visual identity tokens used across the admin console. |
| [docs/API.md](docs/API.md) | Endpoint reference (mirror of `/openapi.json` with notes). |

---

## Tech stack

| Layer | Tech | Notes |
|---|---|---|
| **DB** | PostgreSQL 16 | `pgcrypto`, `citext`, `pg_trgm`. Auto-seeded schema + admin on first boot. |
| **API** | FastAPI 0.115 + SQLAlchemy 2 async + asyncpg | All routes async. JWT (HS256) + bcrypt auth. |
| **Workers** | Python `asyncio` + `FOR UPDATE SKIP LOCKED` | Idempotent event + reservation pollers. |
| **Admin** | React 19 + Vite 6 + Tailwind v4 + TanStack Query 5 | Brand: Bold Blue / Electric Blue / Neon Yellow / Hot Pink (overridable in Settings). Framer Motion. d3-force graph with auto SVG↔Canvas swap. |
| **Intelligence** | Pure Python rule engine (`api/services/enrichment.py`) + Full Intel pipeline (`api/services/full_intel.py`) | 60 brands, 65 category regex patterns, spec extractors, ATTR_BUILDERS. Full Intel welds the multi-tier scraper + LLM into one background worker (`workers/intel_worker.py`) with per-product + bulk progress. |
| **Theme** | CSS custom properties on `:root` (32 tokens) | Live-applied via `admin/src/lib/theme.ts` and `storefront/src/lib/theme.ts`. Server-persisted at `app_settings.key='admin.theme'` and `'storefront.theme'`. 11 curated presets + full Theme Studio (`/settings/theme`) with sliders, JSON import/export, scope copy. Public `GET /api/v1/storefront/theme` lets the storefront fetch the admin-controlled theme without auth. |
| **Dev infra** | Docker Compose + bind mounts + `uvicorn --reload` | Code edits hot-reload — no rebuilds during dev. |

---

## Security checklist

See [docs/ARCHITECTURE.md#security](docs/ARCHITECTURE.md#security) for the full list. Highlights:

- bcrypt cost 12, admin-only accounts, role guard on every write
- JWT HS256 + `type=access` verification + 60-min default TTL
- Lockout after 5 failed logins (15 min)
- Parametrised SQL throughout (no string concat)
- Rate limit on mutating endpoints
- Containers run as non-root (`uid=10001`)
- Postgres bound to `127.0.0.1` in compose

---

## License & ownership

Private — all rights reserved. Built specifically for **Ghir Laffaire**.
