# GLstore — Multi-Brand Readiness Review

**Question answered:** *if the owner adds a second brand tomorrow, what breaks or leaks?*

**Date:** 2026-08-02 · **Branch:** `gaming-store` · **Baseline:** `760b8b7` · **Head:** `06b3225`
**Scope:** the whole hardening effort (7 commits), not one task.
**Read-only:** nothing in this review was modified, staged or committed.

---

## 0. VERDICT — **GO, conditional**

**You can add brand #2.** The store boundary is real, it is applied on 68 of 71
store-relevant endpoints, and the three dependencies (`require_store`,
`require_admin_store_for`, `resolve_store`) are used correctly everywhere I traced.
Every store-scoped table has at least one verified scoped writer and one verified
scoped reader (§2). The anonymous storefront is intact (§4).

**But four things must be done before brand #2 goes live** (§8). One of them —
migration 007 has no application path on the documented Vercel deployment — is a
*visible regression on brand #1* that lands the moment this branch deploys, whether
or not you ever add a second brand.

**There is no Critical finding.** The one remaining cross-brand read
(`GET /events/{event_id}`) needs an attacker to already know a UUID, and every actor
in this system is the same owner.

### Evidence quality — read this before trusting any "verified" below

| Claim | What actually backs it |
|---|---|
| "365 passed" | `python -m pytest` → **`365 passed, 1 skipped in 0.89s`**. |
| The new tenancy tests | **The `1 skipped` IS the whole tenancy suite.** `tests/test_store_context.py` (478 lines, 40 tests) is collected as a single skip because `sqlalchemy` and `pyjwt` are absent from this interpreter (verified: both `ModuleNotFoundError`). It contributes **zero executed assertions here.** The tenancy-tests report discloses this honestly and proves the 40 tests pass in a venv with `requirements.txt` installed — I did not re-verify that venv. |
| Everything else in this document | **Static reading of the source**, plus two things I executed: the full pytest run, and a live FastAPI/Starlette experiment proving the `x-store` response header never fires (§7.3). |
| Runtime behaviour against Postgres | **Not exercised.** No database was available. Four `NOT NULL store_id` crashes already shipped past a green suite on this repo; "365 passed" proves **no regression**, never that new code works. |

---

## 1. What changed, in one paragraph

`2387bce` put a store predicate on 23 intel/scraper/jobs endpoints that had none —
that was a genuine cross-brand **write** hole (bulk intel could rewrite another
brand's descriptions, specs and images). `63bb94d` added `resolve_store` so an
admin's catalog **reads** land on the same brand its writes do. `2299a35` moved
storefront theming from one global `app_settings` row onto `stores.theme`, so two
brands can look different. `7355163` fixed 007's backfill predicate. Task 5 locked
platform-global scraper/LLM config to platform operators. Task 4 added
`add_store.py`, a `--store-host` smoke test, and a rewritten DEPLOY.md.

---

## 2. Q1 — Is there any remaining path where brand A reads or writes brand B?

### 2.1 Every store-scoped table, one writer + one reader traced

Migration 005 put `store_id` on 12 tables. Tracing each:

| Table | Writer (traced) | Reader (traced) | Verdict |
|---|---|---|---|
| `products` | `api/routes/products.py:274` INSERT carries `:store_id`; `:349` UPDATE has `AND store_id = :store_id`; `api/services/csv_import.py:257,286` | `api/routes/products.py:197` `WHERE id = :id AND store_id = :store_id`; `catalog.py:41,60,81,131,297` | ✅ clean |
| `offers` | `products.py:410` INSERT carries `:store_id`; `:497` UPDATE scoped | `public_orders.py:60` `AND o.store_id = :sid`; `services/orders.py:97` | ✅ clean |
| `product_media` | `services/full_intel.py` insert derives store from parent product | `images.py:58,117,133,142,183,192,232,268` all carry `store_id = :sid` | ✅ clean |
| `observations` | `images.py:157,199` explicit `:sid`; `services/enrichment_runner.py:91`, `llm_enrichment.py:133`, `full_intel.py:344` all `SELECT p.store_id … FROM products p WHERE p.id = :pid` | no API reader | ✅ clean — the "derive from parent" pattern is applied consistently in all 4 writers |
| `customers` | `services/orders.py:38` INSERT carries `:sid`; lookup at `:28` is `WHERE store_id = :sid AND phone_normalized = :p` | `public_orders.py:152` joined off an already-scoped order | ✅ clean |
| `orders` | `services/orders.py:132` INSERT; `:234,:273` UPDATE `AND store_id = :sid` | `orders.py:90` `WHERE store_id = :store_id`; `public_orders.py:153`; `services/orders.py:289` | ✅ clean |
| `order_items` | `services/orders.py:166` INSERT carries store | `products.py:367` hard-delete guard scoped; `public_orders.py:163` off a scoped order | ✅ clean |
| `inventory_reservations` | `fn_reserve_stock` (migration 006) derives `store_id` from the offer — structurally impossible to reserve across brands | `products.py:514` `AND store_id = :sid`; `services/orders.py:223,262` keyed on an already-scoped `order_id` | ✅ clean |
| `financial_transactions` | **no writer exists** (grep across `api/`, `workers/`, `scripts/`) | none | ⚠️ dead table — `store_id NOT NULL` on a table nothing touches |
| `events` | `routes/events.py:35` INSERT `:store_id`; `services/events.py:44` (all 3 callers pass `store_id` explicitly — `services/orders.py:195,239,277`) | `jobs.py:108,210,362` scoped … **but `routes/events.py:65` is NOT** → §7.1 |
| `sync_queue` | `workers/event_worker.py:42,59,76` all carry `event["store_id"]`, which the claim query returns (`:125`) | `jobs.py:111,228,400` all `store_id = :sid` | ✅ clean |
| `audit_log` | no writer | none | ⚠️ dead table (nullable, harmless) |

**Platform-level tables** (`scrape_jobs`, `scrape_sources`, `competitor_prices`,
`intel_jobs`) carry no `store_id` by design. Their owner is derived via
`product_id`, and every route now does that: `jobs.py:59-70`, `intel.py:53-64`,
`store_context.py:309-315`. `scrape_jobs.product_id` is `NOT NULL` with an FK, so
the inner `JOIN products` cannot silently drop a legitimate row. Verified on all 14
affected endpoints.

### 2.2 The one remaining cross-brand read

**`GET /api/v1/events/{event_id}`** — `api/routes/events.py:58-77`. Guarded by
`require_role("SUPER_ADMIN","ADMIN")` only; the SQL at `:65` is
`FROM events WHERE event_id = :id` with **no store predicate**. Any brand's ADMIN
who knows an event UUID reads another brand's `event_type`, `entity_type`,
`entity_id`, `status` and `last_error`. Its sibling `GET /jobs/event/{id}`
(`jobs.py:362`) *is* scoped — this is the textbook half-applied guard.
Already catalogued pre-effort as `audit/Security_Report.md` **F13** and
`audit/Backend_Audit.md` **M6**; **not fixed by this effort and not on the
adjudicated list.** Severity **Medium** (needs a known UUID; leaks metadata, not
payloads).

### 2.3 The dormant landmine

**`api/routes/products_export.py`** — three endpoints, **zero** store awareness:

- `:64` `GET /products/export` — CSV of **every store's** catalog
- `:218` `POST /products/bulk-update` — `UPDATE products` at `:259` with no `store_id`
- `:309` `POST /products/bulk-status` — same at `:345`

It is **not mounted** in `api/main.py` (confirmed), so it is unreachable today.
But it is worse than merely unscoped: its two audit writes
(`:278`, `:359`) are `INSERT INTO observations (entity_type, entity_id, …)` with
**no `store_id`** — the exact `NOT NULL` violation this project has already shipped
four times. Whoever mounts this router gets a cross-brand bulk-write **and** a 500.
Severity **High (dormant)** — it is one `include_router` line away from Critical.

### 2.4 The structural caveat

`admin_users.store_id` is the whole authorization model, and **there is still no
supported way to set it.** `add_store.py` creates stores, not scoped admins; there is
no `POST /admin_users`; `seed_admin.sql` seeds `NULL`. So in practice every account
is a platform operator (`audit/Security_Report.md` **F4**). For *one owner, several
brands* that is the intended shape — but it means the 403 branch in
`store_context.py:275` is dead in production, and the real protection against
touching the wrong brand is **the `x-store-id` header being correct**, not
authorization. Consequence: a mis-set store picker is a silent wrong-brand write,
not an error. DEPLOY.md (§"Who can manage which brand") documents both modes without
saying how to reach the scoped one.

---

## 3. Q2 — Are the three store dependencies used consistently?

I enumerated all 71 route declarations and their store dependency. Result:

| Dependency | Count | Correct? |
|---|---|---|
| `require_admin_store_for(...)` (admin, `x-store-id`) | 46 | ✅ every one is an admin-only route |
| `resolve_store` (dual-purpose read) | 7 | ✅ `catalog.py` ×5, `products.py` GET ×2 — exactly the storefront-and-admin reads |
| `require_store` (public, Host) | 5 | ✅ `orders/create`, `offers/availability`, `orders/track`, `storefront/theme` |
| `require_platform_operator` | 3 | ✅ `PUT /settings/scraper`, `/settings/scraper/probe`, `PUT /settings/llm` |
| explicit `admin.store_id` comparison | 2 | ✅ `stores.py:59,86` — correct, and deliberately not a store dep |
| role-only, no store | 8 | 5 justified (auth, health ×2, global-config reads), **1 wrong** (§2.2), 3 dormant (§2.3) |

**No endpoint uses the wrong dependency.** Specifically, no admin route resolves by
Host (which would be client-forgeable), and no public route consults `x-store-id`
without first proving an admin token.

Two design points worth recording because they are easy to break later:

- `resolve_store` (`store_context.py:366-381`) only looks at `x-store-id` **when the
  header is present AND `_optional_admin` returns a real admin**. `_optional_admin`
  (`:344-363`) swallows every token error and returns `None`, so a customer with a
  stale JWT in localStorage still shops. That is the correct call.
- `store_for_admin` (`:242-294`) is the single implementation shared by
  `require_admin_store_for` and `resolve_store`, so an admin's read and write can
  never disagree about which brand they touch. Keep it that way.

---

## 4. Q3 — Does the public storefront still work fully anonymously?

**Yes.** Traced every endpoint the storefront calls:

| Call | Path through the code | Anonymous? |
|---|---|---|
| `GET /products`, `/products/{id}` | `resolve_store` → no `x-store-id` → `require_store` → Host | ✅ |
| `GET /categories`, `/brands/public`, `/price-bounds`, `/products/featured` | same | ✅ |
| `POST /offers/availability`, `POST /orders/track`, `POST /orders/create` | `require_store` → Host | ✅ |
| `GET /storefront/theme` | `settings.py:501-518` → `require_store` → Host, no auth dependency, separate `public_router` | ✅ |

`storefront/src/lib/api.ts` never sends `x-store-id` or `Authorization`
(grep-verified). Even if a hostile page injected `x-store-id`, `resolve_store`
falls straight through to Host resolution because `_optional_admin` returns `None`.
**No regression. This box is green.**

One operational hazard, not a code regression: with `SINGLE_STORE_MODE=false` and
`ENVIRONMENT=production`, an unregistered Host is a hard 404 (`store_context.py:208-213`).
The seeded `store_domains` rows are only `localhost` and `127.0.0.1`
(`005_stores.sql`), so **the `<project>.vercel.app` URL 404s the instant you flip
that flag** unless you first register it. See §8.

---

## 5. Q4 — Migration 007: correct, idempotent, safe with 005?

**The SQL is correct and genuinely idempotent.** I walked the predicate:

- `NOT jsonb_exists(s.theme,'overrides')` is the right guard. `s.theme = '{}'` would
  match zero rows on every deployment that ran 005, because 005 seeds the default
  store with `{"preset":"dark","colors":{…}}` (`005_stores.sql`, the `INSERT INTO
  stores` block). Verified: `PUT /settings/theme` (`settings.py:469`) is the only
  writer of `stores.theme` and always persists an `overrides` key, so the guard
  cannot clobber an operator-authored theme.
- `AND s.theme IS DISTINCT FROM a.value` makes run #2 a zero-row no-op
  unconditionally, even in the hand-edited edge case.
- Interaction with 005: none. 007 adds no DDL — `stores.theme` already exists from
  005 with the right type and default. 005's own re-run is `ON CONFLICT (slug) DO
  NOTHING`, so it cannot overwrite a backfilled theme.
- Read-time fallback (`settings.py:388-400`) keeps a not-yet-backfilled store from
  rendering unstyled.

**But 007 cannot be applied on the documented production deployment.** This is the
finding that matters:

- `api/index.py:20` and `DEPLOY.md:96` both set `RUN_STARTUP_MIGRATIONS=false` on
  Vercel, so `api/main.py:50`'s startup runner is off.
- `scripts/deploy/init_remote_db.py:95-101` **refuses** to run against a database
  that already has a `products` table.
- There is no third script. `ls scripts/deploy/` → `add_store.py`,
  `init_remote_db.py`, `smoke_test_checkout.py`.
- DEPLOY.md's expected-output block (`:70`) still lists migrations only up to
  `006_store_scope_orders.sql`, and nothing in the document tells the operator to
  apply a new migration to an existing Neon database.

**Consequence on the live deployment, today, without brand #2:** `stores.theme`
still holds the 005 placeholder (non-empty, no `overrides`). New code's
`_load_store_theme` (`settings.py:368-385`) sees a truthy blob and returns it,
so the read-time fallback to `app_settings['storefront.theme']` **is never reached**
— the operator's saved Theme Studio palette is silently discarded and the storefront
reverts to `{preset:"dark", overrides:{}}`. `"dark"` is not a real preset
(`storefront/src/lib/theme.ts:94` — the map has `default`, `midnight`, `sakura`, …),
so it degrades to base tokens and stamps a bogus `data-theme-preset="dark"` on
`<html>`. Nothing is lost from the database; it just stops being read.
Severity **High** — visible regression on brand #1, on the documented deploy path.

---

## 6. Q5 — Do the new scripts do what DEPLOY.md claims?

Mostly yes. Verified claim by claim:

| DEPLOY.md claim | Reality |
|---|---|
| `add_store.py` validates before connecting | ✅ `:206-212`, `asyncpg` imported at `:223` |
| idempotent; refuses a slug with different details | ✅ `:264-279` via `_check_existing_matches` |
| warns instead of silently re-pointing a stolen domain | ✅ `:312-330`, exits 1 |
| first `--domain` becomes primary | ✅ `:289-303`, guarded by the 005 partial unique index |
| `--store-host` sets Host without changing the connection | ✅ `smoke_test_checkout.py:108-112`; `http.client` suppresses its automatic Host when the caller supplies one. Correct for Vercel (routes on Host); SNI still uses the URL host, which is fine. |
| order prefix proves the brand | ✅ `orders.py`/`services/orders.py:62` build the number from `stores.order_prefix` |
| per-store storefront theme, global admin theme | ✅ `settings.py:465-485` |
| platform-wide scraper/LLM settings restricted to platform operators | ✅ for all three **write/fetch** endpoints |

Three inaccuracies:

1. **`SINGLE_STORE_MODE=true` does *not* make "every hostname resolve to the store
   with slug `default`"** (DEPLOY.md, Step A). `store_context.py:191-201` resolves by
   Host **first**; the flag only controls the *fallback* for unrecognised hosts. A
   registered domain resolves correctly even with the flag on. The troubleshooting
   row "A new brand's domain serves the old brand's catalog → `SINGLE_STORE_MODE` is
   still `true`" will therefore send you down the wrong path when the real cause is a
   missing `store_domains` row. **Low**, but it is debugging guidance for exactly the
   failure you will hit.
2. **Adding a domain to an *existing* store is a footgun.** `--name` and `--prefix`
   are `required=True` (`add_store.py:195-198`), and a mismatch against the stored
   values makes the script exit 1 having done nothing (`:264-279`). To register your
   live domain on the `default` store you must re-type its exact name and prefix —
   which `init_remote_db.py --brand/--prefix` may have changed. The troubleshooting
   row ("Add it with `add_store.py --domain …` (same `--slug`)") does not say this.
   **Medium** as a deploy footgun, because it blocks the pre-flight in §8.
3. `init_remote_db.py`'s docstring still says migrations "000 → 006"; it actually
   globs (`:112`), so 007 does apply on a *fresh* database. Cosmetic.

---

## 7. Q6 — Half-applied patterns

### 7.1 `events.py`: POST scoped, GET not
Covered in §2.2. `POST /events` got `require_admin_store_for` in this effort;
`GET /events/{event_id}` (`events.py:58`) did not, while its own sibling in
`jobs.py:362` did. **Medium.**

### 7.2 Server-side-fetch guard applied to 1 of 2 siblings
`POST /settings/scraper/probe` (`scraper.py:512-515`) was hardened to
`require_platform_operator` because it makes the server fetch a globally-configured
URL. `POST /settings/llm/ping` (`settings.py:99`) has the identical shape — reads the
global `llm.config`, makes the server connect to whatever `endpoint` holds, returns
the model list — and still uses plain `require_role(*READ_ROLES)`. The task-5 report
flagged this deliberately (scope + it would break `admin/src/lib/api.ts:427`), so
this is a **known deferral, not a miss**. **Low** — no store data crosses; it leaks
the platform LLM endpoint hostname to a scoped operator and is an outbound-fetch
oracle.

### 7.3 The `x-store` debug header never fires — dead code
`api/main.py:141-143` reads `bound_store()` after `call_next` and sets an `x-store`
response header, commented as making *"why did I get the wrong catalog?"* answerable
from the response. **It never fires.** `@app.middleware("http")` is
`BaseHTTPMiddleware`, which runs the endpoint in a child task with a *copied*
context, so ContextVar writes inside the dependency do not propagate back up. I
proved this empirically against the installed FastAPI/Starlette:

```
@app.middleware("http") reading a ContextVar set in the endpoint
header: None
```

Severity **Medium** for readiness specifically: this is the single diagnostic you
would reach for the first time brand #2 shows brand #1's catalog, and it is silently
always absent. (Same mechanism also confirms ContextVars cannot leak between
requests — that part is safe.)

### 7.4 Platform-wide counts to any brand's VIEWER
`GET /healthz/details` (`health.py:115-118`) is `require_role(*ADMIN_ROLES)` — no
store dep — and `api/core/health.py:118-126` returns `products_active`,
`intel_in_flight`, `scrape_in_flight`, `events_pending`, `images_pending` summed
**across all stores**. Aggregates only, no rows. **Low**, pre-existing.

### 7.5 Admin session does not forget its store on logout
`admin/src/lib/api.ts:47-51` clears `gl_token` on a 401 but never clears
`gl.admin.store_id`. On the next login `store.tsx:50-60` renders with the *stale*
persisted id before `GET /stores` resolves, so the first burst of queries carries the
previous session's brand. It self-heals (`:52-55` discards an id not in the
operator's list) and the resolution-during-render comment shows the ordering was
thought about — but a scoped operator sees a flash of 403s, and a platform operator
sees one render of the wrong brand. **Low**, cosmetic today, annoying with two brands.

### 7.6 Smaller items
- `store_context.py:233-239` `resolve_store_by_id` has **no `status` filter**, while
  the Host resolver requires `status='ACTIVE'` (`:151`). An admin can therefore
  administer a SUSPENDED/ARCHIVED store. Probably intended (you suspend a store to
  take it off the internet, not to lock yourself out) — recording it so it is a
  decision, not an accident. **Informational.**
- `scraper.py:358-370` `market_alerts` builds its `latest`/`median` CTEs over
  **all** `competitor_prices` before joining to the store-scoped `ours` CTE.
  Correct, but it scans platform-wide. Already noted in the task-1 ledger.
  **Low (perf).**
- `GET /settings/scraper` (`scraper.py:471`) returns `searxng_url`, `user_agent`,
  `tier4_provider` in clear to any brand's VIEWER. Deliberate ("reading it is not the
  risk"). **Low**, recorded for completeness.
- On a **fresh** database 007 is a no-op (no `app_settings['storefront.theme']` to
  copy), so a brand-new deployment serves `preset:"dark"` — not a real preset
  (`storefront/src/lib/theme.ts:94`). Renders as base-dark, so harmless visually, but
  the admin's Theme Studio dropdown will show nothing selected. **Low.**

---

## 8. MUST FIX BEFORE BRAND #2

1. **[High] Get migration 007 applied to the live database — and decide how *any*
   future migration reaches it.** `RUN_STARTUP_MIGRATIONS=false` + an
   `init_remote_db.py` that refuses initialized databases means there is currently no
   path. Until it runs, brand #1's storefront silently loses its saved theme (§5).
   Minimum: run 007's single `UPDATE` by hand against Neon and record it in
   `_migrations`. Better: add a `scripts/deploy/apply_migrations.py` (or document
   flipping `RUN_STARTUP_MIGRATIONS=true` for one deploy) and say so in DEPLOY.md.

2. **[High] Register brand #1's real hostnames — including `<project>.vercel.app` —
   in `store_domains` *before* setting `SINGLE_STORE_MODE=false`.** Otherwise the
   only URL you have today starts returning
   `404 "No store is configured for this address."` (`store_context.py:208-213`; the
   only seeded domains are `localhost` / `127.0.0.1`). Note the §6.2 footgun: you must
   pass `add_store.py` the **exact** existing `--name` and `--prefix` for
   `--slug default` or it exits 1 without doing anything. Run
   `SELECT slug,name,order_prefix FROM stores;` first.

3. **[Medium] Scope `GET /events/{event_id}`** (`api/routes/events.py:58-77`).
   One `require_admin_store_for` + `AND store_id = :sid` at `:65`, 404 not 403 — the
   same shape `jobs.py:362` already uses. It is the last cross-brand read.

4. **[Medium] Make the store visible in the response, or delete the claim.**
   `api/main.py:141-143` is dead (§7.3). Either set the header from inside the
   dependency (`store_context.bind_store` → `request.state`, read it in the
   middleware) or drop the lines. Debugging brand #2 without it means guessing.

**Strongly recommended in the same pass (cheap, high leverage):**

- Run the tenancy suite for real once — `pip install -r requirements.txt && pytest`
  should read `399 passed`, not `365 passed, 1 skipped`. Right now the only automated
  guard on this boundary does not execute in the environment you actually use.
  Consider failing CI when `tests/test_store_context.py` skips.
- Run `scripts/deploy/smoke_test_checkout.py <url> --store-host <brand2-domain>` and
  confirm the order number comes back with brand #2's prefix. That is the only
  end-to-end evidence that any of this works against Postgres.

---

## 9. CAN WAIT UNTIL AFTER BRAND #2

| Item | Where | Severity | Why it can wait |
|---|---|---|---|
| `products_export.py` unmounted + unscoped + `NOT NULL` bug | `api/routes/products_export.py:64,218,278,309,359` | High **(dormant)** | Unreachable today. But put a comment at the top of the file — the next person to mount it gets a cross-brand bulk write *and* a 500. Decide: scope it or delete it. |
| No way to provision a store-scoped admin | `admin_users.store_id`; `add_store.py` doesn't; no API | High **(structural)** | Irrelevant while one person runs every brand. Blocks the moment you delegate one brand to someone else. |
| `POST /settings/llm/ping` not platform-operator-only | `api/routes/settings.py:99` | Low | Knowingly deferred by task 5; no store data crosses. |
| `GET /healthz/details` platform-wide counts | `api/routes/health.py:115` + `api/core/health.py:118` | Low | Aggregates only, admin-only. |
| Stale `gl.admin.store_id` after logout | `admin/src/lib/api.ts:47-51` | Low | Self-heals within one render. |
| DEPLOY.md: `SINGLE_STORE_MODE` described as overriding Host | DEPLOY.md Step A + troubleshooting | Low | Doc-only — but it misdirects the exact debug you will do. Fix with §8.2. |
| `market_alerts` scans `competitor_prices` platform-wide | `api/routes/scraper.py:358-370` | Low (perf) | Correct, just not selective. Matters at scale, not at 2 brands. |
| `resolve_store_by_id` ignores store status | `api/core/store_context.py:233-239` | Informational | Confirm it's intended, then comment it. |
| `financial_transactions` / `audit_log` have no writers | schema only | Informational | Dead tables carrying `store_id`. |
| Fresh-DB stores serve `preset:"dark"` | `005_stores.sql` seed vs `storefront/src/lib/theme.ts:94` | Low | Renders as base-dark; only the preset dropdown looks odd. |
| `init_remote_db.py` docstring says "000 → 006" | `scripts/deploy/init_remote_db.py:11` | Cosmetic | It globs; 007 does apply on fresh DBs. |

---

## 10. What I did not verify

- **Any runtime behaviour against Postgres.** No database was reachable. Every SQL
  claim above is a reading of the statement text, not an observed result.
- **The 40 tenancy tests passing in a venv with `requirements.txt`.** The
  tenancy-tests report shows that transcript; I did not reproduce it.
- **`add_store.py` and `smoke_test_checkout.py` executing.** Both need a live DB /
  API. I read them line by line and checked `http.client`'s Host-header semantics,
  but neither was run.
- **The admin console rendering with two stores.** No second store exists to switch to.
- **Vercel edge routing of a `Host` header that differs from the SNI name.** The
  `--store-host` mechanism is correct at the HTTP layer; whether Vercel accepts it
  depends on the domain being attached to the project.
