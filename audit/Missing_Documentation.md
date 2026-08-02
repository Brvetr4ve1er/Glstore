# GLstore — Missing / Wrong Documentation

**Audit date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` · Read-only, no source file touched.
**Method:** every claim below was read from source. **CONFIRMED** = I opened the file and cite `path:line`. **SUSPECTED** = inferred, flagged as such.
**Scope:** README.md, CLAUDE.md, DEPLOY.md, `.env.example`, all 11 files in `docs/`, cross-checked against `api/core/config.py`, `api/main.py`, `vercel.json`, `docker-compose.yml`, and the route/service code they describe.

This file does not re-litigate architecture risk (cross-tenant writes, dead code, etc.) — see `audit/Architecture.md` for that. This file is specifically: **what does a doc claim, and does the code back it up.**

---

## 1. Environment variables — code vs. every doc that lists them

`api/core/config.py` is the actual settings surface (pydantic `BaseSettings`, uppercased field names = env var names). It declares **27 fields**. There is also a **28th, separate env var** that bypasses `config.py` entirely (§1.3).

### 1.1 Full comparison

| Env var | `config.py` | `.env.example` | CLAUDE.md §7 | DEPLOY.md Step 4 table |
|---|---|---|---|---|
| `ENVIRONMENT` | `:11` default `development` | ✅ | ❌ not listed | ✅ |
| `DEBUG` | `:12` | ✅ | ❌ | ❌ (has a default, fine) |
| `APP_NAME` | `:10` | ✅ | ❌ | ❌ (has a default, fine) |
| `DATABASE_URL` | `:15` **required** | ✅ | ✅ | ✅ |
| `DB_POOL_SIZE` | `:16` | ✅ | ❌ | ❌ (default, fine) |
| `DB_MAX_OVERFLOW` | `:17` | ✅ | ❌ | ❌ (default, fine) |
| `DB_POOL_TIMEOUT` | `:18` default `30`, **consumed at `api/core/db.py:36`** | ❌ **missing** | ❌ | ❌ |
| `DB_SERVERLESS` | `:22` | ✅ | ❌ | ✅ |
| `RUN_STARTUP_MIGRATIONS` | `:28` | ✅ | ❌ | ✅ |
| `SINGLE_STORE_MODE` | `:33` | ✅ | ❌ | ✅ |
| `ALLOWED_HOSTS` | `:36` | ✅ | ❌ | ✅ |
| `JWT_SECRET` | `:39` **required** | ✅ | ✅ | ✅ |
| `JWT_ALGORITHM` | `:40` | ✅ | ❌ | ❌ (default, fine) |
| `JWT_ACCESS_TTL_MINUTES` | `:41` | ✅ | ❌ | ❌ (default, fine) |
| `JWT_REFRESH_TTL_DAYS` | `:42` | ✅ | ❌ | ❌ (default, fine) |
| `BCRYPT_ROUNDS` | `:43` | ✅ | ❌ | ❌ (default, fine) |
| `CORS_ORIGINS` | `:46` | ✅ | ✅ | ✅ |
| `R2_ENDPOINT` | `:49` | ✅ | ✅ ("required for media uploads") | ❌ **not in the table at all** |
| `R2_ACCESS_KEY` | `:50` | ✅ | ✅ | ❌ |
| `R2_SECRET_KEY` | `:51` | ✅ | ✅ | ❌ |
| `R2_BUCKET` | `:52` | ✅ | ✅ | ❌ |
| `R2_PUBLIC_BASE` | `:53` | ✅ | ✅ | ❌ |
| `EVENT_WORKER_BATCH_SIZE` | `:56` | ✅ | ❌ | ❌ (default, fine) |
| `EVENT_WORKER_POLL_INTERVAL_S` | `:57` | ✅ | ❌ | ❌ (default, fine) |
| `RESERVATION_TTL_MINUTES` | `:58` | ✅ | ❌ | ❌ (default, fine) |
| `RATE_LIMIT_PER_MINUTE` | `:61` | ✅ | ❌ | ❌ (default, fine) |
| `GL_LOG_LEVEL` | **not in `config.py` at all** | ❌ | ❌ | ❌ |

### 1.2 Findings from the table

**F1 — `DB_POOL_TIMEOUT` is a real, consumed setting with zero documentation anywhere. (CONFIRMED, Low)**
Declared `api/core/config.py:18`, read at `api/core/db.py:36` (`pool_timeout=_settings.db_pool_timeout`) on every non-serverless engine. It is absent from `.env.example`, CLAUDE.md §7, and DEPLOY.md. It has a working default (30s) so nothing breaks — it's a silent knob, not a boot blocker. Add one line to `.env.example`.

**F2 — `R2_*` is documented as "required" but is dead code — no upload feature exists to require it. (CONFIRMED, Medium)**
CLAUDE.md:123 states plainly: *"Required for media uploads: `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`."* This describes a feature that does not exist in the code:
- Repo-wide grep for `r2_endpoint|r2_access_key|r2_secret_key|r2_bucket|r2_public_base` (case-insensitive) returns **exactly one file: `api/core/config.py`**. No route, no service, no worker, no admin/storefront TS file ever reads any `r2_*` setting.
- `api/routes/images.py` (the "image review" pipeline) only flips `product_media.status` between `PENDING`/`STORED`/`DELETED` on rows whose `url` already points at the *scraped source's own CDN* (`api/services/full_intel.py:295-338`) — there is no upload step, no presign endpoint, no S3/R2 client anywhere in `api/`.
- The admin frontend has exactly two `<input type="file">` usages in the whole app: `admin/src/pages/ProductImport.tsx` (CSV import) and `admin/src/pages/ThemeStudio.tsx` (theme JSON import/export). There is no product-image upload widget.
- The comment at `api/core/config.py:48` ("uploads go direct from admin via presigned URLs") describes a planned design, not a shipped one.

Net effect: a new engineer who reads CLAUDE.md and provisions an R2 bucket believing it's required has done unnecessary work; a new engineer who skips it because DEPLOY.md's env table (which *should* be the authoritative "what do I need to set" list) never mentions R2 at all will conclude — correctly, as it happens, but for the wrong reason — that it's optional. Either fix CLAUDE.md §7 to say "reserved for a not-yet-implemented upload feature," or delete the R2 settings/dead comment until the feature ships.

**F3 — `GL_LOG_LEVEL` is a second, undocumented env-var surface that bypasses `config.py` entirely. (CONFIRMED, Low-Medium)**
`api/core/logging.py:180`: `env_level = os.environ.get("GL_LOG_LEVEL", "INFO").upper()`. This is read directly from `os.environ`, **not** through the pydantic `Settings` class — so it is invisible to anyone who only audits `config.py` (as CLAUDE.md §7 explicitly directs: *"Source of truth: `api/core/config.py`"*). It's a genuinely useful operational lever — `db.py:17` even tells you to use it to trace SQL (`GL_LOG_LEVEL=DEBUG`) — but it appears in **zero** of: `.env.example`, CLAUDE.md, DEPLOY.md, README.md, `docs/*.md`. A new engineer debugging a noisy or too-quiet log stream has no way to discover this short of reading `logging.py` source.

**F4 — CLAUDE.md §7's "required" env-var list is itself incomplete relative to what actually changes API behavior. (CONFIRMED, Low — narrower restatement of Architecture.md D10)**
CLAUDE.md:118-124 lists only `DATABASE_URL` / `JWT_SECRET` / `CORS_ORIGINS` as "required to boot," plus R2 and LLM. It never mentions `DB_SERVERLESS`, `RUN_STARTUP_MIGRATIONS`, `SINGLE_STORE_MODE`, or `ALLOWED_HOSTS` — four flags that each change request-handling behavior (serverless pooling, whether migrations run at all, which store every request resolves to, and whether TrustedHost rejects the request outright). `.env.example` documents these correctly (with a comment block at the bottom); CLAUDE.md does not. Since CLAUDE.md is the file the repo tells you to "read first," this is the more damaging of the two omissions — a new engineer who trusts CLAUDE.md over `.env.example` won't learn these exist.

---

## 2. DEPLOY.md Step 5 — the requested curl bug (CONFIRMED, High — breaks copy-paste for anyone following the doc)

`DEPLOY.md:134-139`:
```bash
curl -s -X POST $BASE/api/v1/orders/create -H 'Content-Type: application/json' -d '{
  "customer_name":"Test","customer_phone":"0555123456",
  "items":[{"offer_id":"OFFER_ID","quantity":1}],
  "shipping_address":{"wilaya":"Alger","commune":"Alger Centre","address":"1 rue test"},
  "payment_method":"COD","shipping_cost":0,"discount_amount":0
}'
```
uses the shipping-address key **`"address"`**.

The actual Pydantic model, `api/models/schemas.py:108-112` (`ShippingAddress`), declares:
```python
wilaya:  str
commune: str
street:  str      # ← not "address"
...
```
line 111 specifically. `street` is a required field with no alias for `address`, so `POST /orders/create` with the documented body returns **`422 Unprocessable Entity`** — a validation error, not an order. Anyone copy-pasting DEPLOY.md's exact curl to smoke-test a fresh deploy will conclude checkout is broken when it isn't.

**Cross-check that confirms the bug is doc-only, not code-wide:** `scripts/deploy/smoke_test_checkout.py:151` builds the same request and correctly uses `"street": "1 rue test"` — that script passes. Only the human-facing markdown is wrong. **Fix:** change `DEPLOY.md:137`'s `"address"` key to `"street"`.

---

## 3. The multi-store model — documented almost nowhere a new engineer would look

This is the single largest documentation gap in the repo, not because it's undocumented in code (`api/core/store_context.py`'s docstring, lines 1-23, is accurate and good) but because **no markdown file anywhere explains it**, and the one file that claims to be current (CLAUDE.md) actively predates it.

**F5 — CLAUDE.md predates multi-store by 6 commits and says so nowhere. (CONFIRMED, High)**
CLAUDE.md's own footer (`:185`) says it was "written 2026-06-20." `git log` shows migrations 005/006, `store_context.py`, `stores.py`, and the whole Vercel deploy path landed in commits `48a1b79..760b8b7`, all *after* that date (confirmed via commit log; `760b8b7` is `HEAD`). Concretely, inside CLAUDE.md itself:
- `:9` "three frontends" and the branch description are still accurate.
- `:54` architecture diagram box says `Postgres (13 tables)` — actual count is **21 tables** (13 base + 4 from `002_scraper` + 1 from `004_intel_jobs` + 2 from `005_stores` + 1 `_migrations`; verified by listing `db/schema.sql` + `db/migrations/*.sql`).
- `:79` header says "**18 route modules**" but the table immediately under it (`:83-100`) lists only **16 rows**, and both numbers are wrong: there are **17 files** in `api/routes/`, of which **16 are mounted** — and the table is missing `api/routes/stores.py` entirely (a real, mounted, 2-endpoint router — `api/main.py:192`). So CLAUDE.md's own header and its own table disagree with each other, and both disagree with the code.
- `:106` "Database — **13 tables**, 5 spine" — same stale count as `:54`.
- `:114` presents `financial_transactions` as a live, functioning table ("PAYMENT / REFUND / ADJUSTMENT / COD_COLLECTION, idempotent on key"). Repo-wide grep confirms **zero Python or TypeScript code ever reads or writes this table** — it's dead schema (see §4 below for the doc trail that compounds this).
- The §4 architecture diagram (`:44-70`) has no tenancy/store concept in it at all — no `Host` resolution, no `x-store-id`, no `stores` table.
- **Nowhere in CLAUDE.md is DEPLOY.md, `vercel.json`, or the Vercel/Neon deploy path mentioned** — not in §3 Service map, not in §7 Environment, not in §11 Quick start, not in the §10 doc index (fair, since DEPLOY.md lives at repo root not `docs/`, but there's no cross-reference to it from anywhere in CLAUDE.md either). A second, fully-built deployment shape exists in the repo and the project's own "read this first" anchor never says so.

**F6 — No markdown doc explains the `store_id` NOT-NULL trap or the two store-resolvers, anywhere. (CONFIRMED, High)**
Grep for `require_store|require_admin_store_for|store_id.*NOT NULL` across `README.md`, `CLAUDE.md`, `DEPLOY.md`, and all of `docs/*.md`: **zero hits outside DEPLOY.md's one operational paragraph** (`DEPLOY.md:200-202`, which only says the admin's store-header wiring is "a known follow-up," without explaining *why* that matters or which endpoints are affected). The only accurate, current explanation of:
- which 11 tables require `store_id` on every INSERT,
- the two resolver dependencies (`require_store` via `Host` vs. `require_admin_store_for` via `x-store-id`) and which routes use which,
- the fact that `products.py` GETs and writes currently resolve *different* stores,

...exists only in code (`api/core/store_context.py` docstring) and in this audit's own `audit/Architecture.md` §3–§4 and §7.1–7.2. This is exactly the knowledge a new engineer needs before writing their first INSERT or their first admin-store-scoped route, and it is not in any doc a normal onboarding path would surface. (Addressed directly in `Developer_Onboarding.md` §5 of this audit.)

**F7 — `docs/*.md` actively assert the platform is single-tenant. (CONFIRMED, High — direct contradiction, not just staleness)**
- `docs/SYSTEM_CONTEXT.md:15`: *"The platform is **single-tenant** (one store, one brand)..."*
- `docs/SYSTEM_CONTEXT.md:337`: lists *"✘ No multi-tenant (one store, one brand)"* under known limitations.
- `docs/SYSTEM_AUDIT.md:17`: *"API write model | **Production-ready** for single-tenant, single-replica."*

All three are now false — migration `005_stores.sql` and `006_store_scope_orders.sql` are applied, `store_context.py` exists, and `stores.py` is a mounted router. These aren't vague "predates the feature" staleness; they are **flat factual claims that the current code contradicts**, sitting in files nothing marks as historical.

**F8 — `docs/ROADMAP.md` still lists multi-tenant (and the storefront itself) as *unbuilt future ideas*. (CONFIRMED, Medium — roadmap inversion)**
- `docs/ROADMAP.md:95`: `| Multi-tenant | Convert to multi-store SaaS if there's pull |` — filed under "ideas," i.e. not yet decided, let alone built. It has been built.
- `docs/ROADMAP.md:90`: `| Storefront app | Public-facing React site consuming the same API |` — also filed as a future idea. The storefront (`storefront/`) has existed since "Phase 6" per the project's *own* `docs/PROGRESS.md`, is the primary customer-facing surface today, and is one of the two things this very audit was asked to distinguish from `gaming-store`. The roadmap doc is behind the progress log in the same `docs/` folder.

---

## 4. `financial_transactions` — the doc trail for a table that is provably dead code

This isn't one stale line, it's a claim repeated across four files with escalating specificity, none of it true:

| Doc | Claim | Line |
|---|---|---|
| `CLAUDE.md` | Table described with its 4 transaction kinds, "idempotent on key" | `:114` |
| `docs/PROGRESS.md` | Listed in the "Foundation" schema table as shipped, alongside `products`, `orders` etc. | `:13` |
| `docs/ARCHITECTURE.md` | `financial_transactions  (idempotent payment records)` in the schema diagram | `:49` |
| `docs/ARCHITECTURE.md` | `\`financial_transactions\` \| Idempotent payment records — UNIQUE(order_id, kind, idempotency_key).` in the table-by-table breakdown | `:66` |
| `docs/ARCHITECTURE.md` | *"No payment SDK. `financial_transactions` is the integration point. Plug your gateway via a `/payments/webhook` route..."* | `:268` |
| `docs/ARCHITECTURE_MAP.md` | Appears in a data-flow diagram | `:572` |

**CONFIRMED dead** (independently re-verified for this file, not just cited from Architecture.md): repo-wide grep for `financial_transactions` outside `.git`/`node_modules`/`__pycache__` returns only `db/schema.sql`, `db/migrations/005_stores.sql`, the doc files above, and `.superpowers` report files — **no Python route, no service, no worker ever inserts or selects from this table.** The `/payments/webhook` route `docs/ARCHITECTURE.md:268` tells integrators to "plug into" **does not exist** — grep for `payments/webhook` or a `payments.py` route file returns only that one doc line. For a COD-first business this means: no doc anywhere flags that *no order ever produces a financial record*. A reader who takes `docs/ARCHITECTURE.md:268` at face value and tries to `POST /payments/webhook` will get a 404 against a route that was never built.

---

## 5. README.md — stale claims, line by line

README.md was last meaningfully updated for the *Ghir Laffaire* single-tenant, 2-worker, no-storefront era. Every claim below was checked against the current tree.

| # | README claim | Line | Reality | Evidence |
|---|---|---|---|---|
| R1 | Title: *"Ghir Laffaire — Commerce Intelligence Platform"* | `:1` | Active branch ships GLAIVE, a gaming-gear brand; README never mentions GLAIVE, gaming, or `gaming-store/` anywhere in its 195 lines (checked full file) | `README.md` (whole file) vs. `docs/GAMING_STORE.md`, `db/seed_gaming.sql` |
| R2 | ASCII diagram: `async workers (event + reservation)` — 2 boxes | `:26-29` | 4 workers exist: `event_worker`, `reservation_worker`, `scraper_worker`, `intel_worker` | `docker-compose.yml` service list; `workers/*.py` (4 files) |
| R3 | `GLstore/ # workspace root (kept as folder name; product is "Ghir Laffaire")` | `:132` | Same brand-name staleness as R1 | — |
| R4 | Quick start §"3. Start the admin dashboard" / "4. Start the public storefront" never mentions `gaming-store/` (the third frontend, has its own launch config) | `:79-88` | `.claude/launch.json` defines a `gaming-store` preview target on `:8080`; CLAUDE.md §11 documents it, README does not | `.claude/launch.json:5-9` |
| R5 | Quick start says `docker compose up -d` seeds the DB, with no mention of *which* catalog | `:71` | `docker-compose.yml:12` mounts `db/seed_gaming.sql` as `02-seed_gaming.sql` unconditionally — a fresh DB on this branch gets the **14-product GLAIVE gaming catalog**, not a Ghir Laffaire catalog. A reader following README literally gets gaming gear despite reading zero mentions of gaming anywhere | `docker-compose.yml:9-12` |
| R6 | "Documentation index" table lists 10 docs | `:149-160` | `docs/` contains **11** files — `docs/GAMING_STORE.md` exists on disk and is not listed in the index at all | `ls docs/` = 11 files; table has 10 rows |
| R7 | No mention of DEPLOY.md, `vercel.json`, or the serverless deploy path anywhere in the file | (whole file) | A second, fully-documented deploy shape exists at repo root | `DEPLOY.md`, `vercel.json` |
| R8 | License section: *"Built specifically for **Ghir Laffaire**."* | `:194` | Same brand mismatch as R1/R3 | — |

**Severity: Medium-High.** None of these break a build, but a new engineer's very first read of the repo (README is almost always read first, before CLAUDE.md) describes a different product than the one in their working tree, omits a whole frontend and a whole deploy path, and under-promises the seed data they're about to get.

---

## 6. `docs/*.md` — per-file staleness inventory

Per `audit/_shared_context.md` §8 and `audit/Architecture.md` §6, **all 10 pre-existing `docs/*.md` files predate multi-store**; this section adds the specific line-level receipts beyond what's already covered in §3–§4 above, plus staleness that has nothing to do with multi-store.

| File | Specific stale claim | Line | Reality |
|---|---|---|---|
| `docs/STRUCTURE.md` | *"Annotated file tree as of **Phase 2** (backend complete)"* | `:3` | Repo is now well past "Phase 9" per its own `docs/PROGRESS.md`; main tree (`:5-122`) shows only `event_worker.py` + `reservation_worker.py` under `workers/` (no scraper/intel worker in the primary tree — they only appear in a "Phase 5–9 delta" appendix at the bottom, `:177-183`, which most readers will not reach) |
| `docs/STRUCTURE.md` | Sizes table: `api/` ≈ **1,800 lines Python** | `:130` | Actual: **~9,900 lines** by `wc -l api/**/*.py`, **~15,800 lines** including all subdirectories (`find api -name '*.py' \| xargs wc -l`) — roughly an 8-9× understatement |
| `docs/STRUCTURE.md` | No mention of `gaming-store/`, `db/migrations/005_stores.sql`/`006_*`, `api/routes/stores.py`, `api/core/store_context.py`, `scripts/deploy/` | (whole file) | All exist and are load-bearing |
| `docs/TUTORIALS.md` | *"Python 3.12+ — only needed for running pytest locally (**none today**)"* | `:13` | 365 collected tests across 16 files exist today (`tests/*.py`), all passing per the task brief and independently re-run for this audit |
| `docs/TUTORIALS.md` | §1.2 "Apply pending migrations (only on existing DBs)" gives manual `psql < db/migrations/001_app_settings.sql` commands | `:39-48` | Superseded by the auto-migration runner (`api/core/migrations.py`, documented correctly in README `:99-112`) — following this section today would apply migrations by hand that the API already applies automatically on boot, and it stops at `002_scraper.sql`, never mentioning `003`–`006` |
| `docs/TUTORIALS.md` | §1.6 tells the reader to drop `C:\Users\ROG STRIX\Documents\SHOPIFOO\inventory-raw.csv` into the import dropzone | `:83` | That path is outside the repo, machine-specific, and does not exist in this checkout — unusable by any other engineer, and the file doesn't ship with the repo |
| `docs/ROADMAP.md` | See §3 F8 above | `:90, 95` | Storefront + multi-tenant both already shipped |
| `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, `docs/ARCHITECTURE_MAP.md` | See §4 above | various | `financial_transactions` presented as live; it's dead code |
| `docs/API.md` | Endpoint reference has no `store_id`/`x-store-id` concept anywhere in its request/response examples (checked first 150 lines; `POST /auth/login`, `GET /products`, import endpoints) | `:1-150` | Every one of those endpoints is now store-scoped in practice |
| `docs/BRAND.md` | Describes "Ghir Laffaire visual identity tokens" — **accurate**, since the admin app genuinely still ships Ghir Laffaire branding (`admin/index.html:7`, `admin/src/components/BrandLogo.tsx:32`) | n/a | **Not a bug** — flagged here only so it isn't mistakenly "fixed" to GLAIVE; the storefront reskin, not the admin, is what changed on this branch (`docs/GAMING_STORE.md:76-78` says this explicitly and is the one doc in `docs/` that is current) |

`docs/GAMING_STORE.md` is the **only file in `docs/` that is current** — it was written for this branch's reskin and its claims were spot-checked (14 products, 6 categories, admin left un-reskinned) and hold up.

---

## 7. Ranked summary

| # | Finding | Severity | Confidence |
|---|---|---|---|
| 1 | DEPLOY.md Step 5 curl uses `"address"`; schema requires `"street"` → 422 on copy-paste | **High** | CONFIRMED |
| 2 | CLAUDE.md (the mandated "read first" doc) predates multi-store: wrong table count (13 vs 21), self-contradicting route-module count (18 header / 16 table / 17 files, `stores.py` missing), `financial_transactions` presented as live, zero mention of the Vercel deploy path | **High** | CONFIRMED |
| 3 | No markdown doc anywhere explains the `store_id` NOT-NULL trap or the two store-resolvers — the exact knowledge that caused 4 already-fixed production bugs. Only in code docstrings and this audit | **High** | CONFIRMED |
| 4 | `docs/SYSTEM_CONTEXT.md` and `docs/SYSTEM_AUDIT.md` flatly assert "single-tenant" — not stale phrasing, a factual contradiction of shipped code | **High** | CONFIRMED |
| 5 | README describes a different product (Ghir Laffaire, 2 workers, no storefront-mention-of-GLAIVE) than what a fresh `docker compose up -d` actually seeds (GLAIVE gaming catalog); doc index also missing `docs/GAMING_STORE.md` | **Medium-High** | CONFIRMED |
| 6 | `financial_transactions` documented as live across 4 files including a nonexistent `/payments/webhook` integration point; table has zero code references | **Medium-High** | CONFIRMED |
| 7 | `R2_*` env vars documented as "required for media uploads" in CLAUDE.md; no upload feature exists anywhere in the code to require them | **Medium** | CONFIRMED |
| 8 | `docs/ROADMAP.md` lists the storefront and multi-tenant as unbuilt future ideas; both have shipped | **Medium** | CONFIRMED |
| 9 | `GL_LOG_LEVEL` (a real, useful debug lever) and `DB_POOL_TIMEOUT` (a real, consumed setting) are undocumented in every env-var-facing file | **Low-Medium** | CONFIRMED |
| 10 | `docs/STRUCTURE.md` self-dates to "Phase 2," understates `api/` size ~8-9×, and buries the 4-worker/multi-store reality in an easy-to-miss delta appendix | **Low-Medium** | CONFIRMED |
| 11 | `docs/TUTORIALS.md` claims zero tests exist (365 do) and references a machine-specific, non-repo file path for the CSV walkthrough | **Low** | CONFIRMED |

---

*Prepared as part of the documentation audit, 2026-07-31. Read-only — no source file was modified. Companion file: `audit/Developer_Onboarding.md`.*
