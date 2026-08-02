# GLstore — Testing Report

**Audit date:** 2026-07-31 · **Branch:** `gaming-store` · **Tree:** clean at `760b8b7`
**Scope:** read-only. No source file, config, or dependency was modified. `python -m pytest tests/ --collect-only -q` was run to verify counts; no other code was executed.
**Labels:** every claim is **CONFIRMED** (read from source, cited `file:line`) unless marked **SUSPECTED** (inferred).

---

## 0. The one-sentence finding

The 365-test suite is real, well-written, and checks **zero** lines of the 4,436 lines in `api/routes/`, **zero** of the 892 lines in `workers/`, and **zero** of the 5,917 lines of DB-touching service/core code (`orders.py`, `full_intel.py`, `store_context.py`, `security.py`, `events.py`, …) — it tests pure functions and mocked/local logic only. No test opens a socket, imports `api.main`, or touches a real Postgres connection. That is mechanically why four `NOT NULL store_id` crashes shipped with a fully green run: the suite has no code path capable of observing them.

---

## 1. Test inventory — what the 365 tests actually are

```
python -m pytest tests/ --collect-only -q   →  365 tests, 16 files, 0 errors, 0 skips
```

| File | Tests | Module(s) exercised | What kind of test |
|---|---:|---|---|
| `tests/test_spec_sanitizer.py` | 59 | `api/services/spec_sanitizer.py` | Pure-function unit |
| `tests/test_ouedkniss_adapter.py` | 50 | `api/services/scraper/retailers/ouedkniss.py` | Pure-function unit (HTML fixtures in, dataclass out) |
| `tests/test_retailer_adapters.py` | 48 | `retailers/base.py`, `retailers/classifier.py`, `retailers/images.py` | Pure-function unit |
| `tests/test_dz_adapters.py` | 40 | `retailers/condor.py`, `retailers/facebook.py`, `retailers/midtier.py` | Pure-function unit |
| `tests/test_enrichment.py` | 28 | `api/services/enrichment.py` | Pure-function unit |
| `tests/test_csv_parser.py` | 18 | `api/services/csv_parser.py` | Pure-function unit (string/row parsing only — not `csv_import.py`, which is the DB-writing half) |
| `tests/test_validator.py` | 16 | `api/services/validator.py` | Pure-function unit |
| `tests/test_logging.py` | 16 | `api/core/logging.py` | Pure-function unit |
| `tests/test_bulk_operations.py` | 14 | **Nothing in the repo.** Locally re-declared Pydantic models + hardcoded constants standing in for `api/routes/products_export.py` | Contract-shadow unit — see §6 |
| `tests/test_health.py` | 14 | `api/core/health.py` — `ProbeResult`, `overall_ok`, `_run_with_timeout` only | Pure-async-logic unit (file's own docstring: "Live-DB integration of the routes themselves… a future Push", `tests/test_health.py:7-8`) |
| `tests/test_migrations.py` | 14 | `api/core/migrations.py` — `discover_migrations`, checksum, `Migration` dataclass only | Pure-function unit (file's own docstring: "The live-DB path… is exercised in integration tests… a future Push", `tests/test_migrations.py:5-7`) |
| `tests/test_scraper_normalization.py` | 15 | `scraper/validators/normalization.py` | Pure-function unit |
| `tests/test_scraper_domain.py` | 14 | `scraper/utils/domain.py`, `scraper/types.py` | Pure-function unit |
| `tests/test_scraper_validator.py` | 13 | `scraper/validators/price_validator.py` | Pure-function unit |
| `tests/test_extractors_generic.py` | 6 | `scraper/extractors/generic.py` | Pure-function unit |
| **Total** | **365** | 16 modules out of ~63 in `api/`+`workers/` | **100% unit-level, 0% integration, 0% E2E** |

**CONFIRMED, repo-wide:**
- `grep -rn "api.main\|api\.routes\|TestClient\|AsyncClient\|httpx" tests/*.py` → **zero matches.** No test imports the FastAPI app, any route module, or an HTTP client.
- `grep -rln "store_id\|store_context\|require_store\|Store(" tests/*.py` → **zero matches.** The entire multi-store tenancy layer — the newest and most load-bearing abstraction in the codebase, and the exact source of the four already-fixed bugs — has no test referencing it anywhere.
- No `conftest.py` exists anywhere in the repo (`find . -iname conftest.py` → empty). There is no shared DB fixture, no app fixture, no auth-token fixture, no factory. Every test file is fully self-contained.
- `pyproject.toml:[tool.pytest.ini_options]` sets `testpaths = ["tests"]`, `asyncio_mode = "auto"`, `addopts = ["-q","--tb=short","--strict-markers"]` — a normal, well-configured pytest setup with nothing DB- or app-related wired in.
- Two files (`test_health.py`, `test_migrations.py`) **explicitly document in their own docstrings** that they are the pure-logic half of a pair whose DB-integration half doesn't exist yet ("a future Push"). `test_bulk_operations.py` documents the same thing for HTTP-level tests (`tests/test_bulk_operations.py:1-14`). The gap this report quantifies is **already known and named in the code** — it just was never closed, and the router `test_bulk_operations.py` shadows (`products_export.py`) isn't even mounted (§6).
- **Tooling is not the blocker.** `requirements.txt` already pins `fastapi==0.115.0`, `httpx[http2]==0.27.2`, `sqlalchemy[asyncio]==2.0.35`, `asyncpg==0.29.0`, `pytest-asyncio==0.24.0`. Everything needed for both `httpx.AsyncClient(transport=ASGITransport(app))` route tests and real-Postgres integration tests is already an installed dependency — nobody has to add a package to start closing this gap. `docker-compose.yml:1-20` already stands up Postgres 16 with `db/schema.sql` + seeds auto-loaded on `127.0.0.1:5432`, so a local integration-test DB is one `docker compose up -d db` away.

---

## 2. Coverage-by-module table

LOC counts are `wc -l`, source-only (no blank-line/comment stripping) — read as "how much code exists here," not statement coverage (no coverage tool is installed in this environment: `pip show pytest-cov` → not found, `import coverage` → `ModuleNotFoundError`). "Tested" means at least one `tests/*.py` file imports the module; it does **not** mean every function in it is exercised (see the health/migrations caveat in §1).

### 2.1 `api/routes/` — 17 files, 4,436 LOC, **0 tested**

| File | LOC | Store scoping (per Architecture.md) | Tested? |
|---|---:|---|---|
| `products.py` | 527 | ⚠️ split — GETs use `Host`, writes use `x-store-id` | ❌ |
| `scraper.py` | 506 | ❌ zero store scoping | ❌ |
| `jobs.py` | 428 | ❌ zero store scoping | ❌ |
| `products_export.py` | 369 | n/a — **not mounted**, dead code | ❌ (shadow-tested, see §6) |
| `settings.py` | 359 | ❌ global, cross-tenant writes | ❌ |
| `intel.py` | 318 | ❌ zero store scoping (Critical finding, Architecture.md §7.1) | ❌ |
| `catalog.py` | 312 | ✅ `require_store` | ❌ |
| `images.py` | 288 | ✅ `require_admin_store_for` | ❌ |
| `issues.py` | 276 | ✅ `require_admin_store_for` | ❌ |
| `public_orders.py` | 195 | ✅ `require_store` | ❌ |
| `auth.py` | 174 | n/a | ❌ |
| `enrichment.py` | 174 | ✅ `require_admin_store_for` + `_assert_product_in_store` | ❌ |
| `health.py` | 128 | n/a | ❌ (routes untested; underlying pure logic in `api/core/health.py` is) |
| `orders.py` | 110 | ✅ `require_store` / `require_admin_store_for` | ❌ |
| `products_import.py` | 100 | ✅ `require_admin_store_for` | ❌ |
| `stores.py` | 95 | scopes via `admin.store_id` | ❌ |
| `events.py` | 77 | ✅ `require_admin_store_for` | ❌ |

### 2.2 `workers/` — 4 files, 892 LOC, **0 tested**

| File | LOC | What it does | Tested? |
|---|---:|---|---|
| `intel_worker.py` | 276 | claims `intel_jobs`, runs `full_intel`, heartbeat, stale sweep | ❌ |
| `scraper_worker.py` | 268 | claims `scrape_jobs` (incl. shadow rows from `full_intel`) | ❌ |
| `event_worker.py` | 244 | claims `events`, fans out to `sync_queue` — **this is where one of the four fixed bugs lived** | ❌ |
| `reservation_worker.py` | 104 | expires stale reservations every 30s, prunes observations daily; documented singleton, **not lock-enforced** | ❌ |

None of the `SELECT … FOR UPDATE SKIP LOCKED LIMIT n` claim-loop idiom shared by all four workers has ever been exercised by a test — not even with a mocked connection.

### 2.3 `api/services/` — 42 files, ~10,261 LOC, **16 tested (38%), 26 untested**

**Tested (unit-level, no DB):**

| File | LOC | Tests |
|---|---:|---|
| `spec_sanitizer.py` | 379 | 59 |
| `enrichment.py` | 539 | 28 |
| `csv_parser.py` | 359 | 18 |
| `validator.py` | 176 | 16 |
| `scraper/retailers/ouedkniss.py` | — | 50 |
| `scraper/retailers/{base,classifier,images}.py` | — | 48 |
| `scraper/retailers/{condor,facebook,midtier}.py` | — | 40 |
| `scraper/validators/normalization.py` | — | 15 |
| `scraper/utils/domain.py` + `scraper/types.py` | — | 14 |
| `scraper/validators/price_validator.py` | — | 13 |
| `scraper/extractors/generic.py` | — | 6 |

**Untested — includes every DB-writing service:**

| File | LOC | Why it matters |
|---|---:|---|
| `enrichment.py`(sibling) `full_intel.py` | 525 | LLM merge pipeline; **2 of the 4 fixed store_id bugs lived here** (`product_media` insert `full_intel.py:315`, `observations` insert `full_intel.py:344`) |
| `enrichment_runner.py` | 282 | wraps `enrichment.py` with the correct store_id-derivation pattern (`enrichment_runner.py:91`) — the pattern itself is untested |
| `orders.py` | 332 | **the entire order lifecycle** — idempotency, stock locking, `fn_reserve_stock`, confirm/cancel, event emission. Zero tests, not even of `_normalize_phone()` or the total/negative-total guard, both pure functions |
| `llm.py` | 336 | LLM client (Ollama/Anthropic/OpenAI-compat) |
| `llm_enrichment.py` | 331 | LLM-only enrichment path, observation write at `:133` |
| `csv_import.py` | 339 | the DB-writing half of CSV import (carries `store_id` at `:256,302` per Architecture.md) |
| `events.py` | 66 | `emit_event()` — the `bound_store()` fallback described as a "latent trap" (Architecture.md §7.13); zero tests of the fallback branch |
| `scraper/engine.py` | — | tier-cascade orchestrator, `_persist_sources`/`_persist_price` |
| `scraper/{fetcher,ranker,search}.py` | — | fetch/rank/search orchestration |
| `scraper/tiers/*.py` (5 files) | — | httpx → Playwright → stealth → patchright → paid cascade |
| `scraper/extractors/{batolis,condor,jumia,ouedkniss}.py` | — | 4 of 5 extractors untested (only `generic.py` is) |
| `scraper/retailers/{batolis,jumia}.py` | 109 + 138 | 2 of 9 retailer adapters untested (`BatolisAdapter`, `JumiaAdapter` — confirmed present, confirmed zero test imports) |
| `scraper/utils/{cache,proxy_manager,rate_limiter,robots}.py` | — | rate limiting, robots.txt compliance, proxy rotation — untested despite being how the scraper avoids getting banned |

### 2.4 `api/core/` — 9 files, **3 partially tested (33%), 6 untested**

| File | Tested? | Note |
|---|---|---|
| `logging.py` | ✅ | full unit coverage |
| `migrations.py` | ⚠️ partial | discovery/checksum/ordering tested; the actual advisory-locked apply-in-transaction path is not (file's own docstring admits it) |
| `health.py` | ⚠️ partial | `ProbeResult`/`overall_ok`/timeout-wrapper tested; the real DB/SearXNG/LLM probes are not |
| `config.py` | ❌ | pydantic `BaseSettings` — the single source of truth for every env var; zero validation tests (e.g., what happens with a malformed `DATABASE_URL`, or `single_store_mode` interacting with `environment`) |
| `db.py` | ❌ | engine construction, `NullPool` branch for `db_serverless=true` — untested, and this is exactly the kind of branch that silently diverges between Docker Compose and Vercel deploys |
| `metrics.py` | ❌ | — |
| `ratelimit.py` | ❌ | the spoofable-XFF, unbounded-`defaultdict` limiter (Architecture.md §7.10) — zero tests of the vulnerable logic itself, even though it's pure enough to unit test without a DB |
| `security.py` | ❌ | **JWT encode/decode, bcrypt hash/verify, `CurrentAdmin` construction, `require_role`.** All of it is pure or near-pure (no DB call in `create_access_token`/`decode_token`/`verify_password`) and none of it is tested — an expired-token, wrong-algorithm, or malformed-payload regression would ship silently |
| `store_context.py` | ❌ | **the tenancy boundary.** `normalize_host()` is a pure function (IPv6-bracket handling, port stripping, lowercasing — `store_context.py:87-101`) with edge cases and zero tests. `require_admin_store_for`'s 403-vs-400 branching (`store_context.py:262-284`) is exactly the logic that decides whether a store-scoped operator can touch another brand's data — also zero tests |

### 2.5 Everything else

| Path | LOC | Tested? |
|---|---:|---|
| `api/main.py` | — | ❌ — app assembly, middleware order, router mount list (16 of 17). No test would catch a router silently failing to mount, which is the exact state `products_export.py` is already in |
| `api/index.py` | — | ❌ — Vercel serverless entrypoint |
| `api/models/schemas.py` | — | ❌ — every request/response Pydantic DTO (`OrderCreate`, `EventIn`, etc.); zero direct validation tests despite being the layer that would catch a malformed-request regression before it reaches a route |

### 2.6 Rollup

| Bucket | LOC | Tested |
|---|---:|---|
| `api/routes/` (17 files) | 4,436 | 0% |
| `workers/` (4 files) | 892 | 0% |
| `api/services/` untested files (26 of 42) | 5,231 | 0% |
| `api/core/` untested files (6 of 9) | ~686 | 0% |
| **Zero-coverage total** | **~11,245** | — |
| `api/services/` + `api/core/` + scraper subtree tested files | ~5,344 | unit-only, no DB/HTTP |
| **Grand total, `api/`+`workers/`** | **~16,670** | **~32% touched by some test; 0% touched by a live route or live DB** |

The 32% figure is generous — it counts a file as "touched" if any function in it is imported, even when (as in `health.py` and `migrations.py`) the file's own DB-facing functions are explicitly excluded. **The number that matters is the second one: 0%.** No test in this repository has ever observed what happens when a real HTTP request reaches a real route backed by a real Postgres connection.

---

## 3. Quantifying the central fact — why 4 store_id crashes shipped green

All four fixed bugs (`api/routes/events.py`, `workers/event_worker.py`, `api/services/full_intel.py` ×2) share one shape: an `INSERT` into one of the 11 `store_id NOT NULL` tables that omitted the column. Trace each one against the coverage table above:

| Bug location | Covered by any test? | Why the suite couldn't catch it |
|---|---|---|
| `api/routes/events.py` — `ingest_event` INSERT | No | `api/routes/` has 0% coverage (§2.1) |
| `workers/event_worker.py` — `sync_queue` INSERT (×3 call sites) | No | `workers/` has 0% coverage (§2.2) |
| `api/services/full_intel.py:315` — `product_media` INSERT | No | in the untested 26-of-42 services bucket (§2.3) |
| `api/services/full_intel.py:344` — `observations` INSERT | No | same file, same reason |

This is not "the tests happened to miss an edge case" — it is that **the class of bug (a raw-SQL `INSERT` missing a column the schema now requires) is only observable by a test that executes the `INSERT` against a schema that enforces the constraint.** Pydantic validates request shape, not SQL text; there is no ORM to reflect the schema back into Python (Architecture.md §2.2, `CLAUDE.md` §9 confirms "no ORM anywhere"). The only two ways this bug class is catchable pre-deploy are:

1. **Integration test**: run the actual `INSERT` (via the actual route or the actual service function) against a real Postgres with the real schema loaded, and assert it doesn't raise.
2. **E2E test**: drive the full request from HTTP in, and observe a 2xx instead of a 500.

Zero tests in `tests/` do either. `scripts/deploy/smoke_test_checkout.py` does (2) for exactly one path (checkout) and is not part of the automated suite (§5). **Two more dormant instances of the identical bug class already exist and are provably unreachable by any current test**: `api/routes/products_export.py:278,359` (`INSERT INTO observations` without `store_id`) — dormant only because the router isn't mounted (`api/main.py:19` doesn't import it); mounting it as-is reproduces the exact bug a fourth time, and `test_bulk_operations.py` — the one file that nominally covers this router — tests locally re-declared constants, not the router (§6), so it would stay green.

---

## 4. Highest-risk untested paths, ranked by likelihood × blast radius

"Likelihood" = how often this code executes or how often it's touched by ongoing work. "Blast radius" = what breaks if it's wrong (crash / data corruption / cross-tenant leak / silent financial loss). All ranked items are **CONFIRMED untested** per §2.

| # | Path | Likelihood | Blast radius | Why | Test kind needed |
|---|---|---|---|---|---|
| 1 | `api/services/orders.py` `create_order` (`orders.py:70-204`) | **High** — every checkout, the system's core revenue path | **Critical** — stock double-sell, wrong totals, broken idempotency, or a repeat of the store_id crash class (11 columns to get right across 3 INSERTs) | Integration-with-DB (real Postgres, real `fn_reserve_stock`), plus E2E for the HTTP contract |
| 2 | `api/core/store_context.py` `require_admin_store_for` (`:235-293`) and `require_store` (`:168-209`) | **High** — evaluated on literally every request | **Critical** — this is the entire multi-tenant security boundary; Architecture.md §7.1/§7.2 already found a confirmed cross-tenant write vulnerability reachable because nothing tests the boundary itself | Unit (pure branches: 403-vs-400, Host fallback logic, `normalize_host`) + integration (does a foreign `x-store-id` really 403 against real data) |
| 3 | `api/routes/intel.py:48` / `api/routes/scraper.py:60-62` unscoped product validation | **Medium** (needs an authenticated OPERATOR, but any store's OPERATOR qualifies) | **Critical** — confirmed cross-tenant catalog overwrite (Architecture.md §7.1); a regression test would need only two stores and one cross-store call to catch this today, and none exists | Integration-with-DB — needs two seeded stores |
| 4 | `api/core/security.py` `create_access_token`/`decode_token`/`get_current_admin` (`:30-83`) | **High** — every authenticated request | **Critical** — auth bypass or lockout; e.g. an algorithm/library upgrade that silently accepts `alg=none`, or a `store_id` UUID-parse regression in `get_current_admin` that fails open | Unit (pure — no DB needed for encode/decode) |
| 5 | `api/services/events.py` `emit_event` store_id fallback (`:29-38`) | **Medium** — triggers whenever a caller omits `store_id` outside a request context (worker code, future refactors) | **High** — silent `None` swallowed by a bare `except Exception: pass`, then a hard NOT NULL crash at INSERT time; this is the *exact mechanism* that produced bug #1 of the four already fixed | Unit (mock `db.execute`, assert the params dict) + integration (real INSERT with `store_id=None` should be caught by a test, not by production) |
| 6 | `api/services/full_intel.py` `apply_payload`/merge logic + the two INSERTs at `:315,344` | **Medium** — every intel job run | **High** — already burned twice; also the LLM merge policy (brand/category fill-only, description always, tiered specs) is a business rule with zero regression protection | Unit (merge policy logic, mockable) + integration (the INSERTs) |
| 7 | `workers/*.py` claim loops (`FOR UPDATE SKIP LOCKED`) | **Low-Medium** — only matters under concurrency | **High** — `reservation_worker` is a documented-but-unenforced singleton (Architecture.md §7.12); two replicas racing on `fn_expire_stale_reservations`/`fn_prune_observations` is currently "probably fine because the SQL is idempotent," which is an assumption, not a test result | Integration-with-DB, concurrent invocation |
| 8 | `api/routes/products.py` GET-vs-write store resolver split (`:83,185` vs `:261,313,357`) | **High** — every admin catalog interaction, once a second store exists | **High** — confirmed silent wrong-store reads (Architecture.md §7.2); a test with two stores hitting GET and PATCH would catch this in one run | E2E (two stores, one JWT, compare GET vs PATCH resolution) |
| 9 | `api/services/csv_import.py` bulk commit path (`:256,302`) | **Medium** — every catalog import | **High** — a single missing `store_id` or a partial-failure mid-batch corrupts or cross-contaminates a store's catalog in bulk, not one row at a time | Integration-with-DB |
| 10 | `api/core/ratelimit.py` `client_key()` XFF trust + unbounded `_hits` dict | **Medium** — every non-GET request | **Medium-High** — confirmed spoofable and confirmed unbounded (Architecture.md §7.10); this is pure logic, cheap to test, and currently has zero coverage of either defect | Unit (no DB needed — feed it forged headers and assert the bypass/growth) |

Items 1–4 are the ones worth fixing first: they combine the highest likelihood of being touched by *any* future change with the worst outcome if they're wrong, and none require anything beyond what's already in `requirements.txt`.

---

## 5. `scripts/deploy/smoke_test_checkout.py` — what it is and isn't

**What it covers (CONFIRMED, read the whole 180-line file):**

| Step | Request | What it proves |
|---|---|---|
| 1/4 | `GET /healthz` | process is up |
| 2/4 | `GET /api/v1/products?page=1&page_size=1` | catalog list route resolves against a real store + real DB, returns at least one product |
| 3/4 | `GET /api/v1/products/{id}` | product detail resolves, at least one offer exists |
| 4/4 | `POST /api/v1/orders/create` | a real order is created — customer upsert, offer lock, order insert, order_items insert, `fn_reserve_stock` call, status flip to `RESERVED`, `emit_event('order.created')` — end to end against a live DB |

This is, correctly, the only piece of the repo that would have caught the store_id class of bug *for the checkout path specifically* — it is a genuine E2E proof, standard-library-only by design (`urllib.request`), and its own docstring says exactly why it exists (`smoke_test_checkout.py:1-11`): "the real proof store-scoped checkout works," because the unit suite "cannot catch a route that crashes the instant it touches a real Postgres connection."

**What it misses:**

- **Not part of the automated suite.** It is not invoked by `pytest`, has no `.github/workflows` (none exists in this repo — `.github` does not exist) or any other CI to run it, and is documented in `DEPLOY.md:154-156` as a manual step a human runs after deploying. A regression in the checkout path between deploys is invisible until someone remembers to run it.
- **No admin/auth path at all.** No login, no JWT, no `require_admin_store_for`, no CRUD, no image review, no enrichment, no intel/scraper enqueue, no settings, no `/stores` — i.e. everything in `api/routes/` except `orders.py`'s public creation path and the two public product GETs.
- **No negative paths.** Every step asserts a success status; there is no assertion for out-of-stock, invalid wilaya, malformed phone, inactive offer, negative total, or duplicate idempotency key — several of which are exactly the `HTTPException` branches inside `create_order` (`orders.py:104-109,125-126`) that a unit test could cover far more cheaply than this script does.
- **No multi-store / tenancy coverage.** It hits exactly one `base_url`, i.e. exactly one resolved store. It cannot catch the cross-tenant write bug in `intel.py`/`scraper.py` (§4 item 3), the GET-vs-write store-resolver split in `products.py` (§4 item 8), or a `require_admin_store_for` 403/400 regression, because it never sends `x-store-id` or authenticates as anything.
- **No DB-state assertions.** It trusts the HTTP response only — it never queries the database directly to confirm the `orders`/`customers`/`order_items`/`inventory_reservations` rows actually landed with correct `store_id` values, correct `line_total`, or that `offers.reserved_quantity` incremented correctly. A route that returns a plausible-looking 201 with a subtly wrong `store_id` would pass.
- **No cleanup, and it says so.** Every successful run leaves a real "Smoke Test" order in the target database (`smoke_test_checkout.py:18-22`, explicit in the docstring) — fine for a deliberate manual check, unusable as a repeatable CI assertion without a teardown step.
- **Depends on pre-seeded data it doesn't control.** It assumes at least one product with at least one active offer and available stock already exists at `base_url`; it has no fixture/setup phase of its own, so it can silently degrade from "proving checkout works" to "proving the seed data still has stock" depending on how many times it's been run.
- **No worker verification.** It never confirms `event_worker` actually drained the `events` row it caused, or that `reservation_worker` would expire the reservation — it only proves the synchronous request/response half of the order flow.

**Bottom line:** it is a correct, well-built manual E2E probe for one path (public checkout, single store, happy path) and is explicitly documented as filling the gap this report describes — but it fills roughly 5% of that gap (4 of ~76 endpoints, 0% of admin/auth, 0% of tenancy, 0% of negative paths) and isn't wired into anything that runs it automatically.

---

## 6. `test_bulk_operations.py` — a second instance of the same failure mode

Worth calling out on its own because it looks like route coverage and isn't. Its own docstring (`tests/test_bulk_operations.py:1-14`) states the tests "don't import the route module directly," and instead re-declare `BulkUpdateRequest`/`BulkStatusRequest` as local Pydantic classes and assert against a hand-copied `EXPECTED_COLUMNS` list. Two compounding problems:

1. **It tests a copy of the contract, not the contract.** If `api/routes/products_export.py`'s real `BulkUpdateRequest` schema drifts from the 14 tests' local re-declaration, the tests stay green and the route is wrong (or vice versa).
2. **The router it shadows isn't mounted.** `api/main.py:19` does not import `products_export`, so none of these 14 tests protect anything reachable in production today. If someone mounts it to "turn on" the bulk/export features, they inherit two dormant `store_id`-missing INSERTs (`products_export.py:278,359`) that this test file — despite 14 tests and a name suggesting it covers exactly this router — would not catch, because it never touches the route's actual SQL.

---

## 7. What kind of test each gap needs — a taxonomy, not just a list

| Gap category | Test kind | Why this kind specifically | Representative targets |
|---|---|---|---|
| Pure logic with no DB/HTTP dependency, currently untested | **Unit** | Cheapest, fastest, no infra — there is no excuse for these being at 0% | `store_context.normalize_host()`, `security.create_access_token/decode_token/verify_password`, `ratelimit.client_key()` window logic, `orders._normalize_phone()` and the total/negative-total guard, `events.emit_event`'s fallback branch (mock `db.execute`) |
| A raw-SQL `INSERT`/`UPDATE` that must satisfy real schema constraints (NOT NULL, CHECK, UNIQUE, FK) | **Integration-with-DB** | The bug class this report exists to explain is only observable when the constraint is real; a mock can't enforce a schema it doesn't model | `orders.create_order`, `full_intel.apply_payload`'s two INSERTs, `csv_import`'s bulk writer, `enrichment_runner._add_observation`, any future `INSERT` into one of the 11 `store_id NOT NULL` tables |
| Request-shape → route → response contract, including auth/role/store resolution | **Integration-with-DB (route-level, via `httpx.AsyncClient` + `ASGITransport`)** | Needs the real FastAPI dependency graph (`require_store`, `require_admin_store_for`, `require_role`) wired up, but not necessarily a full deployed stack | Every route in `api/routes/` — starting with `orders.py`, `auth.py`, `products.py` |
| Cross-cutting, multi-request business flows spanning route + worker + DB | **E2E** | Needs the actual process boundary (worker polling, `?wait=true` polling, event fan-out) exercised, not just the synchronous request/response | checkout → reservation expiry, intel enqueue → worker claim → LLM merge → media insert, CSV import → catalog visible on storefront |
| Concurrency / locking correctness | **Integration-with-DB, concurrent** | `FOR UPDATE SKIP LOCKED` semantics can't be verified without two real transactions racing | worker claim loops, `orders.create_order`'s offer row-lock, `reservation_worker` singleton assumption |

---

## 8. Testing roadmap — the first 5 tests to write, and why these 5

Ordered by (cheapest to write) × (closest to the exact failure mode that already shipped four times), so each one both closes a real gap and proves out the harness the next ones need.

### Test 1 — Unit: `store_context.normalize_host()` edge cases
**Why first:** zero setup (pure function, already importable with no optional deps beyond what `test_migrations.py` already proves works via lazy-import), and it is the single function every request's tenancy resolution starts from (`store_context.py:87-101`). IPv6-bracket stripping, port stripping, case-folding, and the empty/`None` input path are all real edge cases with zero current coverage. Costs almost nothing, protects the front door of the multi-store boundary.

### Test 2 — Unit: `api/core/security.py` token lifecycle
**Why second:** also zero DB dependency (`create_access_token`/`decode_token` only touch `pyjwt` + `_settings`), and it is the entire authentication boundary for every admin route (all 4,436 lines of `api/routes/` except the public paths sit behind it). Cases to cover: round-trip encode→decode preserves `sub`/`role`/`store_id`; expired token raises 401 via `decode_token`'s `ExpiredSignatureError` branch; tampered/garbage token raises 401 via `InvalidTokenError`; `get_current_admin` rejects a non-`"access"` token type (`security.py:69-70`); malformed `store_id` in the payload raises the `Malformed token` 401 (`security.py:82-83`) rather than crashing. This is the highest blast-radius module in §4 that costs a unit test's worth of effort.

### Test 3 — Integration-with-DB: `orders.create_order` happy path + the store_id-omission regression class, directly
**Why third:** this is the test that would have caught 3 of the 4 already-fixed bugs' *shape* (not the exact files, but the exact defect class) had it existed as a template to copy for `events.py`/`event_worker.py`/`full_intel.py`. Stand up Postgres via the existing `docker-compose.yml` `db` service (schema + seed already auto-load), call `orders.create_order(db, dto, store)` directly against it (no HTTP layer needed yet — this is a service-level integration test), and assert: the row lands in `orders` with the right `store_id`; `order_items` and `inventory_reservations` are consistent with `dto`; a second call with the same `idempotency_key` returns the same order instead of creating a duplicate; an out-of-stock offer raises the expected `HTTPException` instead of a raw asyncpg constraint error. This single test file establishes the DB-fixture pattern (spin up, seed a store+product+offer, tear down) that every later integration test reuses.

### Test 4 — E2E (route-level): `POST /api/v1/orders/create` through the real FastAPI app
**Why fourth:** once Test 3 proves the service function is correct against a real DB, this promotes the same scenario one layer up — through `api.main.app` via `httpx.AsyncClient(transport=ASGITransport(app=app))`, so it also exercises `require_store` resolution from the `Host` header, response serialization, and the middleware stack (GZip, CORS, request-ID, rate limiting) for the first time in this suite's history. This is literally the assertion `scripts/deploy/smoke_test_checkout.py` step 4/4 makes manually against a deployed instance — turning it into an automated, repeatable, CI-runnable test (with DB teardown, unlike the smoke script) closes the exact gap named in this report's central fact and in the smoke script's own docstring.

### Test 5 — Integration-with-DB, two-store: cross-tenant isolation on `intel.py`/`scraper.py` enqueue
**Why fifth:** this is the highest-severity *currently exploitable* gap in §4 (item 3) — a confirmed cross-tenant write (Architecture.md §7.1), not a hypothetical. Seed two stores with one product each, authenticate as store A's `OPERATOR`, `POST` an intel/scrape job targeting store B's product UUID, and assert it is rejected (404/403) instead of accepted. Today this test would **fail** — that's the point: it turns a documented architecture-audit finding into an executable regression gate, and it's the natural next target once Tests 3–4 have proven out the two-store DB-seeding fixture that Test 5 also needs.

**After these 5:** the natural next wave is (a) the same route-level pattern applied to `auth.py` (login, lockout) and the `products.py` GET-vs-write store-resolver split (§4 item 8), (b) a worker-level integration test for `event_worker`'s `sync_queue` fan-out (the exact file one of the four fixed bugs lived in) using the same DB fixture, and (c) wiring `smoke_test_checkout.py`'s scenario into CI as a scheduled or pre-deploy gate rather than a manual step, now that Test 4 proves the in-process equivalent is fast enough to run on every commit.

---

## 9. Summary table — the gap in one view

| Metric | Value |
|---|---|
| Total tests, all passing | 365 (16 files) |
| Tests that import `api.main` or any `api.routes.*` module | **0** |
| Tests that use `TestClient`/`AsyncClient`/`httpx` as a test client | **0** |
| Tests referencing `store_id`, `store_context`, `require_store`, or `Store(...)` | **0** |
| `conftest.py` files (shared fixtures) | **0** |
| `api/routes/` files with any test coverage | 0 of 17 |
| `workers/` files with any test coverage | 0 of 4 |
| `api/services/` files with any test coverage | 16 of 42 (38%) — unit-level only |
| `api/core/` files with any test coverage | 3 of 9 (33%) — partial, pure-logic-only |
| Lines of `api/`+`workers/` code touched by zero tests | ~11,245 of ~16,670 (~67%) |
| Lines of `api/`+`workers/` code exercised against a live route or live DB | **0** |
| Already-shipped `store_id` NOT NULL crashes the suite could have caught | 0 of 4 |
| Dormant instances of the identical bug class, currently unreachable only because the router is unmounted | 2 (`products_export.py:278,359`) |
| CI workflow that runs `pytest` or the smoke script automatically | none found (`.github` does not exist in this repo) |
| Automated E2E coverage of the checkout path | 0 in `tests/`; 1 manual script (`scripts/deploy/smoke_test_checkout.py`), not wired to run automatically |

---

*Prepared by the testing-coverage audit, 2026-07-31. Read-only: no source file, test, dependency, or configuration was modified. All findings above are labeled CONFIRMED because every claim was verified by reading the cited file/line or running `pytest --collect-only` / `grep` against the actual tree — no claim in this report is inferred without a citation.*
