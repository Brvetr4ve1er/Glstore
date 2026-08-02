# GLstore — Developer Onboarding (Day One)

**Written:** 2026-07-31, from source, `gaming-store` branch @ `760b8b7`. Every claim here was checked against code, not copied from another doc — where an existing doc got something wrong or stale, see `audit/Missing_Documentation.md` for the receipts. This file assumes you've done nothing yet: no containers running, no `.env`, nothing installed beyond Docker Desktop / Node / Python.

---

## 1. What this is, in one paragraph

GLstore is a **catalog-intelligence platform with an e-commerce front door**, built for the Algerian consumer-electronics market (DZD currency, wilaya/commune shipping, cash-on-delivery). It is not primarily "a webshop" — the harder, larger half of the system is: *take messy supplier CSVs and scattered competitor web data, and turn them into a clean, priced, image-complete catalog.* One FastAPI backend + Postgres + 4 background workers serves **three frontends**:

| Frontend | What it is | Talks to the API? |
|---|---|---|
| `storefront/` | React 19 public shop — the real customer surface | Yes, `/api/v1/*` |
| `admin/` | React 19 ops console (JWT login) — catalog, orders, scraper, enrichment, jobs | Yes, `/api/v1/*` |
| `gaming-store/` | Static HTML/CSS/vanilla-JS design study, the "GLAIVE" brand prototype | **No — zero API calls, ever.** All data is hardcoded in `gaming-store/assets/js/data.js`. Don't go looking for a backend integration; there isn't one. |

As of a few commits ago, the platform is also **multi-tenant** ("superstore"): one deployment can serve N isolated store brands, routed by the `Host` header. This is the newest, least-obvious, and most bug-prone part of the codebase — §5 below is required reading before you touch any SQL.

---

## 2. Run it locally, end to end (15 minutes)

### 2.1 Prerequisites
- Docker Desktop running (for `db` + `api` + 4 workers + `searxng`).
- Node.js 20+ / npm (for `admin/` and `storefront/`).
- Python 3.12+ if you want to run the test suite outside Docker (recommended — it's fast and needs no DB, see §7).

### 2.2 Backend stack

```bash
cd "C:\Users\ROG STRIX\Desktop\antigravity\playground\GLstore"
copy .env.example .env
docker compose up -d
```

`.env.example` ships with working values for local dev (default Postgres creds, a placeholder `JWT_SECRET` that is fine for local use — **rotate it before anything is ever public**). Wait for the DB healthcheck, then confirm:

```bash
curl http://localhost:8000/healthz    # {"status":"ok"} — process is alive
curl http://localhost:8000/readyz     # DB + SearXNG must respond; 503 if not
```

What happens on that first boot, in order:
1. Postgres runs `db/schema.sql` (mounted as `00-schema.sql`) — base tables.
2. `db/seed_admin.sql` (`01-seed_admin.sql`) — one `SUPER_ADMIN` account.
3. `db/seed_gaming.sql` (`02-seed_gaming.sql`) — **this branch's catalog**: 14 GLAIVE gaming products across 6 categories (Headsets, Keyboards, Mice, Mousepads, Controllers, Accessories), all `status='ACTIVE'` so they're visible immediately. No product photos are seeded on purpose — that's what the scraper + Image Review pipeline is for.
4. The API's lifespan hook then applies everything under `db/migrations/*.sql` (000 through 006 today) under a Postgres advisory lock, including `005_stores.sql` and `006_store_scope_orders.sql` — the multi-store schema. This is why a fresh compose DB is already a multi-store-shaped DB even though `schema.sql` predates that migration.

Default admin login (seeded, change it before this ever leaves your machine):
```
email:    brvetr4veler@gmail.com
password: brveadmin
```

### 2.3 Frontends

```bash
# admin — ops console
cd admin && npm install && npm run dev     # http://localhost:5174

# storefront — public shop, separate terminal
cd storefront && npm install && npm run dev  # http://localhost:5173

# gaming-store — static prototype, separate terminal, no npm needed
python -m http.server 8080 --directory gaming-store   # http://localhost:8080
```

If you're driving this through Claude Code's browser tooling, all four are pre-wired in `.claude/launch.json` — `preview_start api|admin|storefront|gaming-store`.

### 2.4 Sanity-check the whole loop

1. Open `http://localhost:5173` — you should see the GLAIVE storefront with a live catalog (14 products, no images yet — that's expected).
2. Open `http://localhost:5174`, log in with the credentials above, and confirm the Dashboard loads stats.
3. Add something to cart on the storefront and check out (COD). Confirm the order appears in the admin's Orders page. **This is the single best "is everything actually wired" smoke test** — it touches the DB, the reservation function, the event pipeline, and both frontends. There's also a scripted version of exactly this: `python scripts/deploy/smoke_test_checkout.py` (stdlib-only, no `pip install` needed) — point it at `http://localhost:8000` locally or a deployed URL; it hits `/healthz`, grabs a real product/offer, places a COD order, and exits 0/1.

---

## 3. The mental model

```
storefront ──┐                                         gaming-store
             │        /api/v1                          (static, NO API —
  admin ─────┤──► FastAPI (api/main.py) ──► Postgres    do not "fix" it to
             │        │                                  call the backend
             │        ▼                                  unless that's an
             │   api/services/*  ◄── all business logic  explicit decision)
             │        │
             │        ▼
             │   scrape_jobs / intel_jobs / events  (queue tables)
             │        │  polled by
             │        ▼
             │   4 workers (event / reservation / scraper / intel)
             │        │
             │        ▼
             │   searxng, competitor sites, LLM API
```

**There is no ORM.** `api/models/` has exactly one file (`schemas.py`, Pydantic request/response DTOs). Every database access is raw SQL via `sqlalchemy.text("""...""")` with named binds (`:sid`, `:pid`, `:oid`, …). This is deliberate, not debt-in-progress — but it means **a schema change has zero compile-time consequence.** If you add a `NOT NULL` column, nothing will fail until a query hits it at runtime. Four production bugs already happened exactly this way (§5). Write your SQL carefully and test it against a real DB, not just by reading it.

**Routes are thin, services are fat.** A route file does: auth dependency → store dependency → parse params → call into `api/services/*` → `db.commit()`. The actual logic — e.g. the whole order lifecycle — lives in `api/services/orders.py`, not `api/routes/orders.py`. When you're trying to understand *how* something works, go straight to `api/services/`.

**Workers are schedulers, not owners of logic.** `workers/intel_worker.py` is pure claim/heartbeat/complete lifecycle — the actual scrape+LLM pipeline it runs is `api/services/full_intel.py`, imported from the API package. If you're changing scraper or intel *behavior*, you're almost always editing something under `api/services/`, not `workers/`.

**Coordination is exclusively through DB rows.** No Redis, no message broker, no worker-to-worker calls. Every worker claims work with the same idiom:
```sql
UPDATE t SET status='CLAIMED' WHERE id IN (
  SELECT id FROM t WHERE status='PENDING' ORDER BY created_at
  FOR UPDATE SKIP LOCKED LIMIT n
) RETURNING …
```
If you're adding a new background job type, copy this pattern rather than inventing one.

**Two deploy shapes exist and behave differently — know which one you're touching.**

| | Docker Compose (what you're running locally) | Vercel + Neon (`DEPLOY.md`) |
|---|---|---|
| DB | Local Postgres 16 | Neon serverless (`DB_SERVERLESS=true`) |
| Migrations | Auto-applied on every API boot | Applied **once**, manually, by `scripts/deploy/init_remote_db.py`; the running app never re-applies them (`RUN_STARTUP_MIGRATIONS=false`) |
| Store resolution | `Host` header → `store_domains` table | `SINGLE_STORE_MODE=true` → always resolves to the one `default` store, any hostname |
| Workers | All 4 run as containers | **None run at all** — nothing calls `fn_expire_stale_reservations`, so on Vercel abandoned-cart stock holds never release |
| Frontends shipped | none (you run them locally) | **storefront only** — the admin app has no deploy path there today |

If you're asked to "fix a bug in prod" without qualification, ask which of these two it's running on — the answer changes what's even possible to happen.

---

## 4. Where things live

```
api/
  main.py               FastAPI app, middleware stack, router mounting (16 routers)
  core/
    config.py            ★ the ONE source of truth for env vars — pydantic BaseSettings
    db.py                 async engine (NullPool when db_serverless=true)
    security.py           bcrypt + JWT + require_role(*roles)
    store_context.py     ★★ the tenancy boundary — read its module docstring before writing SQL
    migrations.py         advisory-locked runner, checksums migrations for tamper detection
    ratelimit.py, logging.py, health.py, metrics.py
  models/schemas.py      the ONLY model file — Pydantic DTOs, no ORM
  routes/                17 files, 76 endpoints — thin: auth + store dep + delegate
  services/               ALL business logic — orders / csv_import / enrichment_runner /
                          llm_enrichment / full_intel / events / validator
  services/scraper/       engine.py + search/ranker/fetcher + tiers/(1-4 escalating) +
                          retailers/(jumia, ouedkniss, batolis, condor, facebook, midtier)
workers/                event_ / reservation_ / scraper_ / intel_worker.py — lifecycle only
db/
  schema.sql              base 13 tables + inlined copies of migrations 001-004 (NOT 005/006 —
                          those live only in db/migrations/, see the trap in §6)
  migrations/             000..006, auto-applied on API startup (compose) — the real source of truth
  seed_admin.sql          one SUPER_ADMIN account
  seed_gaming.sql         this branch's 14-product GLAIVE catalog
storefront/src/          pages/ + lib/api.ts (hand-written typed fetch client) + lib/cart.tsx (localStorage cart)
admin/src/                pages/(14) + lib/api.ts + lib/auth.tsx (JWT) + lib/store.tsx (store picker)
gaming-store/             static HTML/CSS/JS — assets/js/data.js is the entire "database"
scripts/deploy/           init_remote_db.py (one-time Vercel/Neon setup) ·
                          smoke_test_checkout.py (the only end-to-end proof in the repo)
tests/                    16 files, 365 tests — all pure-function / service-layer tests.
                          NONE import api.main or api.routes.* (see §7 — this matters)
CLAUDE.md                 the project anchor at repo root — read it, but see the caveats in
                          audit/Missing_Documentation.md §3 before trusting its table/tenant counts
DEPLOY.md                 the Vercel/Neon deploy path — has one known bug, see §6 below
```

**Common changes and where they land:**

| You want to… | Edit… |
|---|---|
| Add a public API endpoint | `api/routes/*.py`, register it in `api/main.py`, decide `require_store` vs none |
| Add an admin-only endpoint | same, but use `require_admin_store_for(require_role(...))` — see §5 |
| Add an admin page | `admin/src/pages/*.tsx` + route in `admin/src/App.tsx` |
| Add a storefront page | `storefront/src/pages/*.tsx` + route in `storefront/src/App.tsx` |
| Change the DB schema | new `db/migrations/NNN_*.sql` — never hand-edit `schema.sql` for anything past migration 004 (it's frozen at that point, see §6) |
| Change worker behavior | `workers/*_worker.py` for scheduling, `api/services/*` for the actual logic |
| Tune the scraper | `api/services/scraper/{engine,fetcher,tiers/,retailers/}.py` |
| Change LLM / theme / scraper runtime config | Admin UI → Settings (writes to the `app_settings` table — no redeploy needed) |

---

## 5. ★★ THE TRAP: store scoping — read this before your first SQL change

The platform went multi-tenant recently. **11 tables now have `store_id NOT NULL`:** `products`, `offers`, `product_media`, `observations`, `customers`, `orders`, `order_items`, `inventory_reservations`, `financial_transactions`, `events`, `sync_queue`. (Nullable on purpose: `admin_users` — NULL means "platform operator, sees every store" — and `audit_log`. Deliberately *unscoped*, on purpose, because the scraper researches the whole market, not one store's catalog: `scrape_jobs`, `scrape_sources`, `competitor_prices`, `scrape_domain_state`, `intel_jobs`, plus the global `app_settings` k/v table.)

**Every INSERT into one of the 11 must supply `store_id`. There are exactly two correct patterns and no others:**

1. **You already hold a `Store`** (from a route dependency) — pass `store.id` straight into the INSERT. This is how `api/services/orders.py` does it everywhere.
2. **You're inserting a child row and only have the parent's ID** — derive the store by joining to the parent inside the INSERT itself:
   ```sql
   INSERT INTO observations (store_id, entity_type, entity_id, …)
   SELECT p.store_id, 'product', :pid, …
   FROM products p WHERE p.id = :pid
   ```
   (real examples: `api/services/enrichment_runner.py:91`, `api/services/llm_enrichment.py:133`, `api/services/full_intel.py:315` and `:344`, and inside the `fn_reserve_stock` Postgres function.)

**This is not theoretical.** Four bugs of exactly this shape (an INSERT missing `store_id`) were already found and fixed in this codebase's recent history — in `api/routes/events.py`, `workers/event_worker.py`'s `sync_queue` insert, and twice in `api/services/full_intel.py`. **The 365-test unit suite caught none of them**, because no test in `tests/` starts the FastAPI app or hits a real database (§7). If you add a new INSERT into one of the 11 tables, treat "does this have `store_id`" as a mandatory self-review item — nothing else will catch it for you.

**There are two different ways a request's store gets resolved — use the right one:**

| Dependency | Resolves from | Use for |
|---|---|---|
| `require_store` (`api/core/store_context.py:168`) | The `Host` header, via a 60-second-cached lookup in `store_domains` | **Public routes only.** `Host` is client-controlled — treat it as routing, never as authorization. |
| `require_admin_store_for(require_role(...))` (`store_context.py:235`) | The `x-store-id` header + the admin's own `admin_users.store_id` | **All admin routes**, always. A store-scoped operator sending a foreign `x-store-id` gets 403; a platform operator (`store_id IS NULL`) *must* send `x-store-id` or gets 400. |

If you're adding an admin route, use `require_admin_store_for`. If you're adding a storefront-facing route, use `require_store`. Mixing them up is a live bug in this codebase today — `api/routes/products.py`'s GET endpoints use `require_store` (Host) while its POST/PATCH/DELETE use `require_admin_store_for` (`x-store-id`), even though the admin app sends `x-store-id` on every single request. The correct guard to copy when you're unsure is `_assert_product_in_store()` at `api/routes/enrichment.py:31-38`.

**Local dev note:** the seeded `store_domains` maps both `localhost` and `127.0.0.1` to the one `default` store (`db/migrations/005_stores.sql:87-95`), so `require_store` "just works" without you doing anything on a fresh compose stack. You won't notice a Host-vs-`x-store-id` mismatch locally unless you deliberately create a second store — which is exactly why this bug shipped in the first place. If you're testing anything store-scoping-related, create a second store and a second admin scoped to it before you trust that your change works.

---

## 6. Other traps worth knowing before you hit them

- **`db/schema.sql` is frozen at migration 004.** It inlines copies of `001`–`004` at lines 580/609/742/778, but **not** `005_stores.sql` or `006_store_scope_orders.sql`. A fresh compose DB gets the full picture because the API's migration runner applies `005`/`006` separately at boot — but if you ever read `schema.sql` alone to understand "the schema," you'll miss the entire multi-store layer. Always cross-check `db/migrations/*.sql` too.
- **DEPLOY.md's Step 5 curl has a bug.** It uses `"address"` for the shipping-address key; the real field (`api/models/schemas.py:111`) is `"street"`. Copy-pasting the doc gets you a 422, not an order. Use `scripts/deploy/smoke_test_checkout.py` instead if you want a working end-to-end check — it uses the right field name and does the same four checks with pass/fail output.
- **Router mount order matters.** `api/main.py` registers routers in a specific order because static paths must come before dynamic `/products/{id}`-style catchers — `catalog` and `images` are mounted before `products`. If you add a new literal path under `/products/...`, mount it before `products.router` or you'll get a 422 from FastAPI trying to coerce your literal segment into a UUID.
- **`api/routes/products_export.py` exists on disk but is not mounted anywhere in `api/main.py`.** It's dead code with two of the exact `store_id`-missing INSERT bugs described in §5, dormant only because nothing ever calls it. Don't assume a file existing under `api/routes/` means it's live — check `api/main.py`'s import list and `include_router` calls.
- **`app_settings` (LLM config, theme, scraper config) is global, not store-scoped**, even though `stores.theme` exists as a column and looks like it should drive per-store branding. It doesn't yet — every store on the platform renders the same theme today. If you're asked to make theming per-store, that's new work, not a config flag you flip.
- **The admin app's brand is still "Ghir Laffaire"** (`admin/index.html:7`) even on this GLAIVE-branded storefront branch — only the storefront was reskinned (`docs/GAMING_STORE.md` explains this and is accurate). Don't "fix" the admin branding without checking whether that's actually in scope.
- **Every intel job silently triggers a second, duplicate scrape.** `api/services/full_intel.py` inserts a shadow `scrape_jobs` row to satisfy a foreign key, and `workers/scraper_worker.py` will pick it up and run a full scrape against it that nothing ever asked for. If you're debugging "why did we hit Jumia twice for one product," this is why.

---

## 7. How to verify your change actually works

**Run the unit test suite — fast, no Docker/DB required:**
```bash
python -m pytest tests/ -q
```
365 tests, all pure-function or service-logic tests (CSV parsing, the rule-enrichment engine, scraper extractors/adapters, spec sanitization, migration/health/logging plumbing). This is a good regression check for logic changes, but **know its blind spot**: zero tests in this suite import `api.main` or any `api.routes.*` module. Nothing here starts the FastAPI app, hits a real route, or touches a real database. A green run tells you your pure functions didn't regress — it tells you nothing about whether a route boots, whether your SQL is syntactically valid, or whether you remembered `store_id` on a new INSERT.

**Therefore, for anything that touches a route, a migration, or an INSERT into a store-scoped table, you must also verify against a real running stack:**
1. `docker compose up -d`, confirm `/readyz` is 200.
2. Hit your changed endpoint with `curl` (or through the admin/storefront UI) against the local API and read the actual response, not just the status code.
3. If you touched checkout, order confirmation, or reservations specifically: run `python scripts/deploy/smoke_test_checkout.py` against `http://localhost:8000` — it exercises the full path (`/healthz` → real product → real offer → `POST /orders/create`) and prints which step failed if something broke. This is the closest thing this repo has to an integration test; treat it as the minimum bar before calling a checkout-path change done.
4. If you touched anything store-scoped, test with **two** stores, not one — see the local-dev note in §5. A single-store test will not catch a `Host`/`x-store-id` mismatch or a missing `store_id` filter, because with only one store in the DB every query "accidentally" returns the right rows.
5. If you touched a migration, run `docker compose exec api python -m scripts.migrate --status` to confirm it applied cleanly, and check the API logs for the tamper-detection warning (a changed checksum on an already-applied migration blocks startup on purpose).

**Frontend changes:** `npx tsc --noEmit` in `admin/` or `storefront/` before you consider it done — both are hand-written `lib/api.ts` fetch clients with no codegen, so a backend response-shape change won't be caught by TypeScript unless you also update the client types by hand, and a stale client type won't be caught by the backend at all.

---

## 8. Conventions actually used (not aspirational)

- **Raw SQL only**, `sqlalchemy.text()` with named binds. No ORM, no autogenerated migrations. Bind names are terse and consistent: `:sid` = store_id, `:pid` = product_id, `:oid` = order_id, `:eid` = entity_id.
- **Roles** are module-level constants: `WRITE_ROLES`, `READ_ROLES`, `ADMIN_WRITE`, `ADMIN_READ`. Reuse them; don't inline role tuples in a new route.
- **Events are dotted strings**: `order.created`, `order.confirmed`, `order.cancelled`. `emit_event()` (`api/services/events.py`) is the only writer of the `events` table — always pass `store_id` explicitly when you call it; its `bound_store()` fallback silently produces `None` outside a request context and then blows up on the NOT NULL constraint.
- **Routes commit, services don't.** The one exception is `api/services/full_intel.py`, which commits mid-pipeline to satisfy a foreign key before the shadow scrape job insert (see §6's "duplicate scrape" trap — this commit is *why* that bug exists).
- **`?wait=true`** on scrape/intel enqueue endpoints blocks up to 90s/120s so the caller gets a synchronous-feeling response instead of having to poll. Use it for anything UI-triggered; skip it for bulk/background triggers.
- **Python:** `from __future__ import annotations` at the top of modules, type hints throughout, async-first. **TypeScript:** strict mode, `npx tsc --noEmit` clean before commit.

---

## 9. If you get stuck

- Start with `CLAUDE.md` at repo root (the project anchor) — but cross-check its table/route/tenant counts against `audit/Missing_Documentation.md` §3 first; it predates the multi-store work by 6 commits and gets several numbers wrong.
- `api/core/store_context.py`'s module docstring is accurate and current — trust it over any markdown doc for tenancy questions.
- `audit/Architecture.md` (this audit's companion file) has a full as-built architecture map with file:line citations for every major subsystem, plus a ranked list of the real structural risks in the codebase today.
- When a doc and the code disagree, **the code wins**, always. File a note (or fix the doc) rather than propagating the stale claim into new work.

---

*Prepared as part of the documentation audit, 2026-07-31. Read-only — no source file was modified. Companion file: `audit/Missing_Documentation.md`.*
