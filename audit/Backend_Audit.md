# GLstore — Backend Audit

**Date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` (clean) · **Scope:** `api/routes/*`, `api/services/*`, `api/core/*`, `workers/*`, `db/schema.sql`, `db/migrations/*`
**Method:** every file in scope was read. Every claim cites `file:line`. Labels: **CONFIRMED** = I read the code that proves it. **SUSPECTED** = inferred, not proven.
**Read-only:** no source file was modified, staged, or committed.

Companion documents: `audit/_shared_context.md`, `audit/Architecture.md`. Where this report overlaps the Chief Architect's findings, it says so explicitly and adds a mechanism or a deeper consequence rather than restating.

---

## 0. Executive summary

The store-scoping sweep that was the #1 priority came back **cleaner than expected on INSERTs and dirtier than expected on SELECTs**. All 20 `INSERT INTO <scoped-table>` statements in live code now carry `store_id` (§1.1) — the four fixed bugs were the last of that class in mounted code. But scoping was applied *per-INSERT*, not *per-module*, and three whole route modules (`intel.py`, `scraper.py`, `jobs.py` — 23 endpoints) were never scoped at all. §2 documents two cross-tenant paths the architecture audit did not reach: a **bulk** cross-tenant write and a **bulk** cross-tenant catalog+pricing read.

The more surprising result is that the **highest-severity defects are not in the multi-store layer at all** — they are in auth and in the order lifecycle, both of which predate migration 005 and have never had a test touch them:

- Any admin account can be **permanently** locked out by 5 unauthenticated requests (§C1). There is no code path that unlocks it.
- The **public checkout accepts the discount amount from the client** (§C2). An anonymous caller can order anything for 0 DZD.
- Confirming an order whose reservation has expired **silently skips stock consumption** (§H2); cancelling a confirmed order **never returns stock** (§H3). Both are silent inventory drift on a COD business.
- Approving a scraped image on a live product **removes it from the storefront** (§H4).

Counts: 4 Critical · 9 High · 14 Medium · 6 Low.

---

## 1. Store-scoping completeness (priority #1)

### 1.1 Every INSERT into the 11 `store_id NOT NULL` tables — CONFIRMED complete

The 11 tables (`005_stores.sql:150-160`): `products`, `offers`, `product_media`, `observations`, `customers`, `orders`, `order_items`, `inventory_reservations`, `financial_transactions`, `events`, `sync_queue`.

Exhaustive enumeration (`grep -rn "INSERT INTO" api workers scripts`, 20 hits into scoped tables). Verdict per site:

| # | Site | Table | Pattern | Verdict |
|---|---|---|---|---|
| 1 | `api/routes/events.py:33-41` | events | pass-in (`store.id`) | ✅ |
| 2 | `api/routes/images.py:157-163` | observations | pass-in | ✅ |
| 3 | `api/routes/images.py:199-205` | observations | pass-in | ✅ |
| 4 | `api/routes/products.py:273-282` | products | pass-in | ✅ |
| 5 | `api/routes/products.py:409-418` | offers | pass-in | ✅ |
| 6 | `api/services/csv_import.py:255-272` | products | pass-in | ✅ |
| 7 | `api/services/csv_import.py:301-314` | offers | pass-in | ✅ |
| 8 | `api/services/enrichment_runner.py:90-101` | observations | derive-from-parent | ✅ |
| 9 | `api/services/events.py:41-65` | events | pass-in, `bound_store()` fallback | ⚠️ see §L3 |
| 10 | `api/services/full_intel.py:314-328` | product_media | derive-from-parent | ✅ |
| 11 | `api/services/full_intel.py:343-354` | observations | derive-from-parent | ✅ |
| 12 | `api/services/llm_enrichment.py:132-140` | observations | derive-from-parent | ✅ |
| 13 | `api/services/orders.py:38-40` | customers | pass-in | ✅ |
| 14 | `api/services/orders.py:131-141` | orders | pass-in | ✅ |
| 15 | `api/services/orders.py:165-172` | order_items | pass-in | ✅ |
| 16-18 | `workers/event_worker.py:42-52, 59-69, 76-86` | sync_queue | pass-in (`event["store_id"]`, sourced from `_claim_batch` RETURNING at `:125`) | ✅ |
| 19 | `db/migrations/006_store_scope_orders.sql:53-58` (`fn_reserve_stock`) | inventory_reservations | derive-from-offer | ✅ |
| 20-21 | `api/routes/products_export.py:278, 359` | observations | **missing store_id** | ❌ dormant — router unmounted (§M12) |

`financial_transactions` has **zero** INSERT sites repo-wide (confirms `Architecture.md:§7.6`).

**CONFIRMED: no new instance of the fixed bug class exists in mounted code.** The remaining two are in `products_export.py`, which is provably unmounted (§M12), and mounting it would fail on more than just NOT NULL.

### 1.2 UPDATE / DELETE on scoped tables — CONFIRMED, one gap class

Every `UPDATE`/`DELETE` in mounted routes carries `AND store_id = :sid`: `products.py:345, 372, 381, 389, 493, 521`; `images.py:133, 142, 192`; `csv_import.py:286, 326`. `orders.py:191, 234, 273` scope by the just-verified `order_id` (`:209`, `:248` do the `FOR UPDATE` existence check with `store_id`).

The **service layer** does not: `full_intel.py:243, 283, 397`, `llm_enrichment.py:186, 239, 312`, `enrichment_runner.py:164` all update `products` by bare `WHERE id = :id`. This is *currently* safe only because every caller pre-validates via `_assert_product_in_store` (`enrichment.py:31-38`) — except `intel.py` and `scraper.py`, which do not (§C3, §2.1). See §L4.

### 1.3 SELECTs — this is where scoping is incomplete

Per-module state, read from source (supersedes the table in `_shared_context.md:§4` with endpoint-level detail):

| Module | Endpoints | Store scoping |
|---|---|---|
| `catalog.py` | 4 | ✅ `require_store` (public) |
| `public_orders.py` | 2 | ✅ `require_store` |
| `orders.py` | 5 | ✅ 1 public + 4 `require_admin_store_for` |
| `images.py` | 5 | ✅ all `require_admin_store_for` |
| `enrichment.py` | 5 | ✅ + `_assert_product_in_store` on singles |
| `issues.py` | 4 | ✅ |
| `products_import.py` | 2 | ✅ |
| `stores.py` | 2 | ✅ scopes on `admin.store_id` |
| `products.py` | 8 | ⚠️ 2 GETs use `require_store` (Host), 6 writes use `x-store-id` — see `Architecture.md:§7.2` |
| `events.py` | 2 | ⚠️ POST ✅ / `GET /events/{id}` ❌ (§M6) |
| `intel.py` | 5 | ❌ **zero** |
| `scraper.py` | 9 | ❌ **zero** |
| `jobs.py` | 9 | ❌ **zero** |
| `settings.py` | 7 | ❌ global config, cross-tenant writes |

---

## 2. CRITICAL findings

### C1 — Any admin account can be permanently locked out by 5 unauthenticated requests

**CONFIRMED.** `api/routes/auth.py:132-134`:

```python
# Account locked
if u[5] is not None:                       # u[5] = locked_until
    raise HTTPException(status.HTTP_423_LOCKED, "Account locked, retry later")
```

The check is `IS NOT NULL`, **not** `locked_until > NOW()`. `locked_until` is set to `NOW() + INTERVAL '15 minutes'` on the 5th failure (`auth.py:143-146`). The only statement that clears it is the success path (`auth.py:155-160`), which sits **below** the lock check and is therefore unreachable once the column is non-NULL. Grep for `locked_until` across `api/`, `workers/`, `scripts/` returns exactly four hits — `auth.py:118, 143, 158` and `scripts/create_admin.py:38`. **No admin route, no worker, and no scheduled job ever compares `locked_until` to the current time or resets it.**

Consequences:
- The 15-minute window in the module docstring (`auth.py:5-6`) is fiction. The lock is permanent.
- An unauthenticated attacker who knows an admin email address locks that account forever with 5 POSTs to `/api/v1/auth/login`. `SUPER_ADMIN` included.
- Recovery requires shell access to run `scripts/create_admin.py` or manual SQL. On the Vercel deployment (`vercel.json` ships no worker/CLI surface) there is no in-product recovery at all.
- The per-IP tracker (`auth.py:41` `MAX_FAILS = 10`) permits two account lockouts per IP per 5-minute window, and it keys on a spoofable `X-Forwarded-For` (`auth.py:85-91`), so the budget is unlimited in practice.

Aggravating: `423 LOCKED` (line 134) vs `401` (line 129) is a clean **account-existence oracle** — the response code tells an attacker which addresses are real admins before they spend the lockout.

**Severity: Critical** — unauthenticated, permanent, unrecoverable denial of the entire admin surface.

**Fix shape:** `if u[5] is not None and u[5] > now(): raise 423` and clear `locked_until`/`failed_attempts` when the window has passed. Return `401` for the locked case too.

### C2 — The public checkout accepts the order discount from the client

**CONFIRMED.** `api/models/schemas.py:122-123`:

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

`POST /api/v1/orders/create` is **unauthenticated** (`api/routes/orders.py:20-24`, `Depends(require_store)` only). There is no coupon table, no promotion service, and no server-side validation of `discount_amount` against anything — the only guard is that the result must not go negative. An anonymous caller posts `discount_amount` equal to `subtotal`, and `create_order` writes an order with `total = 0`, reserves the stock, emits `order.created`, and the fulfilment/COD flow proceeds against a zero-value invoice. The `orders_total_matches` CHECK (`db/schema.sql:205-207`) is satisfied — it validates arithmetic, not authority.

The same applies to `shipping_cost`: the server never computes it. `storefront/src/pages/Checkout.tsx:93-105` does not send either field, so **every real order today has `shipping_cost = 0`** — shipping is silently never charged, and the field exists purely as an attack surface.

**Severity: Critical** — direct, unauthenticated revenue loss on the primary business path.

### C3 — `POST /products/intel-bulk` is a bulk cross-tenant write

**CONFIRMED.** `Architecture.md:§7.1` covers the single-product case (`intel.py:48`). The bulk endpoint is materially worse and is not covered there.

`api/routes/intel.py:125-154`:

```python
where: list[str] = ["p.status <> 'ARCHIVED'"]
...
rows = await db.execute(
    text(f"SELECT p.id FROM products p WHERE {where_sql} ORDER BY p.completeness_score ASC LIMIT :lim"),
    params,
)
```

No `store_id` predicate anywhere in the module (`grep store_context api/routes/intel.py` → 0 hits). The endpoint is gated only by `require_role(*WRITE_ROLES)` (`intel.py:117`), which any `OPERATOR` of any store holds. `limit` accepts up to 2000 (`intel.py:111`).

Difference from the single-product case: the attacker **needs no product IDs**. One request with `{"only_status": ["RAW"], "limit": 2000}` enqueues intel jobs across the entire platform. `intel_worker` then runs `full_intel.enrich_full_intel` on each, which overwrites `description` and `specs` (`full_intel.py:232-287`), inserts `product_media` rows (`:314`), writes `observations` (`:343`), and rewrites `status` + `completeness_score` (`:396-403`) — in every store. Because §H4 also applies, the side effect includes de-listing every `ACTIVE` product it touches.

Also unscoped in the same module and not previously noted: `POST /intel-jobs/{id}/cancel` (`intel.py:303-311`, cross-tenant pipeline DoS) and `GET /intel-jobs/{id}` (`intel.py:203-237`), which returns `raw_payload` — the full LLM output including another store's product description and specs — to any `VIEWER`.

**Severity: Critical.**

### C4 — `GET /products/market/alerts` dumps every store's catalog and prices

**CONFIRMED.** `api/routes/scraper.py:328-365`:

```sql
ours AS (
    SELECT p.id AS product_id, p.sku, p.name, p.brand, p.category,
           p.completeness_score,
           (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
             WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0) AS our_price,
           (SELECT url FROM product_media m ...) AS primary_image
      FROM products p
     WHERE p.status <> 'ARCHIVED'
)
```

No `store_id` filter in the CTE or the outer query. The endpoint requires only `READ_ROLES` (`scraper.py:318`), i.e. **`VIEWER`**. A read-only account on store A pages through `?page_size=200` and receives store B's SKUs, product names, brands, categories, primary image URLs and **selling prices** — the single most commercially sensitive dataset a competing tenant on the same platform could want.

`GET /products/{id}/competitor-prices` (`:224-231`), `GET /products/{id}/market-summary` (`:255-281`) and `GET /products/{id}/scrape-jobs` (`:186-192`) are equally unscoped, but require knowing a product ID; `market/alerts` requires nothing.

**Severity: Critical** — bulk cross-tenant disclosure of catalog and pricing to the lowest privilege level.

---

## 3. HIGH findings

### H1 — Order-number generation races; concurrent checkouts 500

**CONFIRMED.** `api/services/orders.py:59-67`:

```python
row = await db.execute(
    text("SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number,'-',3) AS INTEGER)),0)+1 "
         "FROM orders WHERE store_id = :sid AND order_number LIKE :prefix"),
    {"sid": store.id, "prefix": f"{prefix}-{year}-%"},
)
```

No `FOR UPDATE`, no sequence, no `pg_advisory_xact_lock`. Migration 005 created `orders_store_number_key ON orders(store_id, order_number)` (`005_stores.sql:184`). Two checkouts in the same store that interleave between this SELECT and the `INSERT INTO orders` (`orders.py:128`) both compute `N`; the second INSERT raises `UniqueViolation`, which nothing catches — it propagates to the middleware handler (`api/main.py:126-135`) and the customer gets `{"error": "internal_error"}` with a 500. The whole order, its customer row and its reservations roll back.

The window is wide: between the SELECT and the INSERT the code runs `_upsert_customer` and a `FOR UPDATE` load of every offer in the cart (`orders.py:89-102`). A flash sale is a guaranteed reproduction.

**Severity: High** — lost orders on the revenue path, no retry, no error surfaced to the operator.

### H2 — Confirming an order after its reservation expired silently skips stock consumption

**CONFIRMED.** `api/services/orders.py:221-229`:

```python
res_rows = await db.execute(
    text("SELECT id FROM inventory_reservations "
         "WHERE order_id = :o AND status = 'ACTIVE' FOR UPDATE"),
    {"o": order_id},
)
for (rid,) in res_rows.all():
    await db.execute(text("SELECT fn_consume_reservation(:r)"), {"r": rid})
```

`reservation_ttl_minutes` defaults to 30 (`api/core/config.py:58`). `reservation_worker` runs `fn_expire_stale_reservations()` every 30s (`workers/reservation_worker.py:27,37`), which releases the hold and flips the row to `EXPIRED` (`db/schema.sql:559-573`). After that, this query returns **zero rows**, the loop body never runs, and the code proceeds unconditionally to `UPDATE orders SET status = 'CONFIRMED'` (`orders.py:231-237`).

Result: an order confirmed 31+ minutes after creation — the norm for a COD call-centre workflow — is marked `CONFIRMED` with **`offers.stock_quantity` never decremented**. The item stays sellable. Over a day of call-backs the catalog oversells by exactly the number of late confirmations, and nothing logs it. There is no check that `len(res_rows) == len(order_items)`, no re-reservation attempt, and no error.

**Severity: High** — silent oversell on the core inventory guarantee, on the most common operational path.

### H3 — Cancelling a CONFIRMED order never returns the stock

**CONFIRMED.** `api/services/orders.py:254-268`. `cancel_order` explicitly permits cancellation from any status except `DELIVERED`/`CANCELLED`/`RETURNED` — so `CONFIRMED`, `PACKED` and `SHIPPED` are all cancellable. It then releases only `status = 'ACTIVE'` reservations (`:262-263`).

But `confirm_order` already moved every reservation to `CONSUMED` (`fn_consume_reservation`, `db/schema.sql:496-527`), which decrements `stock_quantity`. `fn_release_reservation` (`db/schema.sql:531-556`) returns early on anything that is not `ACTIVE`:

```sql
IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RETURN;  -- idempotent no-op
END IF;
```

So cancelling a confirmed order decrements nothing back. **The stock is gone permanently.** There is no `fn_unconsume_reservation` anywhere in `db/` (grep: the only four inventory functions are reserve/consume/release/expire).

**Severity: High** — silent, unrecoverable inventory loss on a routine operation, in the opposite direction from §H2.

### H4 — Enrichment, intel and image approval silently un-publish `ACTIVE` products

**CONFIRMED**, three independent copies of the same defect.

`api/services/full_intel.py:387-394`:
```python
if has_brand and has_cat and score >= 0.85:  new_status = "VERIFIED"
elif has_brand and has_cat:                  new_status = "CLASSIFIED"
elif not has_brand or not has_cat:           new_status = "NEEDS_FIX"
else:                                        new_status = "NORMALIZED"
```
Identical logic at `api/services/llm_enrichment.py:299-307` and `api/services/enrichment.py:518-525`. **None of the three can ever emit `ACTIVE`, and none reads the current status to preserve it.** The write is unconditional (`full_intel.py:396-403`, `llm_enrichment.py:311-318`, `enrichment_runner.py:164-183`).

`ACTIVE` is the only status the storefront renders — `catalog.py:37, 58, 78, 293`, and `public_orders.py:80` computes `buyable` as `is_active and product_status == "ACTIVE"`.

So:
- `POST /products/{id}/enrich` on a live product → status becomes `VERIFIED`/`CLASSIFIED` → **product vanishes from the storefront**.
- Any intel run does the same.
- Worst of all, `api/routes/images.py:153` and `:196` call `full_intel._recompute_status_and_completeness` on approve *and* reject. **Approving a scraped image on a live, selling product removes it from the shop.** That is the intended, documented daily workflow for the image review queue.

Symmetrically, `ARCHIVED` is not preserved either: `POST /products/{id}/enrich` on an archived product resurrects it to `CLASSIFIED`, undoing the soft delete from `products.py:381`. `POST /products/enrich-all` accepts an arbitrary `only_status` list from the caller (`enrichment.py:57`), so `?only_status=ARCHIVED` un-archives in bulk.

Minor corroborating detail: the `else: new_status = "NORMALIZED"` branch is unreachable in all three copies — if the first two conditions fail, `has_brand and has_cat` is false, so `not has_brand or not has_cat` is always true.

**Severity: High** — routine admin actions silently de-list revenue-generating inventory, with no warning and no audit record.

### H5 — `events` has no stale-claim reaper; a worker restart strands events forever

**CONFIRMED.** `workers/event_worker.py:107-129` claims by flipping `PENDING`/`RETRYING` → `PROCESSING`, committing (`:206-207`), then processing in a **separate** session (`:144`). If the worker dies between those points — SIGKILL, container restart, OOM, or a pool timeout inside the `asyncio.gather` at `:222` — the row is stuck in `PROCESSING`.

`_claim_batch` selects only `WHERE status IN ('PENDING','RETRYING')` (`:117`). Nothing else in the repo updates `events.status` away from `PROCESSING` except the success/failure handlers inside the very task that died. Grep for `PROCESSING` across `workers/` returns exactly one hit: `event_worker.py:112`, the claim itself.

Both sibling workers have the recovery this one lacks — `scraper_worker.py:75-91` and `intel_worker.py:74-89` implement `_release_stale`, swept every 60s (`scraper_worker.py:217-224`, `intel_worker.py:227-234`). The event worker has neither a sweeper nor a heartbeat.

Consequence: `order.created` / `order.confirmed` events for real orders are permanently orphaned. No `sync_queue` row is written, so the order never reaches n8n / the shipper. The only visible symptom is a growing `PROCESSING` count on the jobs dashboard, and `jobs.py:68` classifies `PROCESSING` as **neither active nor failed nor completed** (`active_keys` omits it), so it does not even appear in the totals.

**Severity: High** — silent permanent loss of order fan-out with no alarm.

### H6 — `jobs.py`: nine unscoped endpoints, and "retry" re-fires terminal work

**CONFIRMED.** No store dependency anywhere in the module (`grep store_context api/routes/jobs.py` → 0). Two distinct problems:

**(a) Cross-tenant read.** `GET /jobs` (`:184-194`) UNIONs `scrape_jobs`, `events` and `sync_queue` platform-wide. `GET /jobs/event/{id}` (`:285-291`) and `GET /jobs/sync/{id}` (`:320-325`) return the full `payload` JSONB. For `order.created` that payload is `{"order_number", "total"}` (`orders.py:200`); for `sync_queue` it is the outbound order document (`event_worker.py:50`). Any `VIEWER` of any store reads any other store's order numbers and values.

**(b) Retry re-executes completed work — cross-tenant.** `POST /jobs/event/{id}/retry` (`:397-407`) resets to `PENDING` from `('FAILED','RETRYING','COMPLETED')`. Re-processing a `COMPLETED` `order.created` re-runs `handle_order_created` (`event_worker.py:37-52`), whose INSERT into `sync_queue` has **no `ON CONFLICT` and no idempotency key** — so a **duplicate outbound order** is queued. `POST /jobs/sync/{id}/retry` (`:416-423`) does the same from `SYNCED`. `POST /jobs/scrape/{id}/retry` (`:354-365`) re-runs from `COMPLETED`.

Because none of the three is store-scoped, an operator of store A can force duplicate shipments for store B's customers.

**Severity: High** — cross-tenant data exposure plus a cross-tenant write with real-world (shipping/accounting) side effects.

### H7 — SSRF: globally-writable outbound URLs, probed by VIEWER and by unauthenticated `/readyz`

**CONFIRMED.** Two admin-controlled URLs are used as outbound request targets with no scheme/host/IP validation:

| Config key | Written by | Validation | Fetched by |
|---|---|---|---|
| `scraper.config.searxng_url` | `PUT /settings/scraper` — `ADMIN` (`scraper.py:430`) | `min_length=4, max_length=500` (`scraper.py:384`) | `POST /settings/scraper/probe` (**VIEWER**, `scraper.py:462,475-479`) and **`GET /readyz` — unauthenticated** (`health.py:89-92` → `core/health.py:144-161`) |
| `llm.config.endpoint` | `PUT /settings/llm` — `ADMIN` (`settings.py:49`) | `min_length=4, max_length=500` (`settings.py:33`) | `POST /settings/llm/ping` (**OPERATOR**, `settings.py:83-86`) and every enrichment/intel run |

Neither key is store-scoped (`app_settings` is a global k/v — `_shared_context.md:§5`), so an `ADMIN` of *any* store rewrites the platform's outbound targets. `readyz_checks` marks the SearXNG probe `required=True` (`core/health.py:161`), so its success/failure is reflected in the `/readyz` response body and status code — giving an **unauthenticated** caller a repeatable oracle for "can the API reach `http://169.254.169.254/…`".

The LLM endpoint is the more serious of the two: it is where every product's scraped content and the LLM prompt are sent (`api/services/llm.py`), so redirecting it is a bulk **data-exfiltration** channel for the whole platform's catalog, not merely a request forgery.

**Severity: High.**

### H8 — No token revocation: `is_active`, role and store are never re-checked

**CONFIRMED.** `api/core/security.py:67-83` builds `CurrentAdmin` purely from JWT claims. There is no DB lookup, no `jti`, no blocklist. Grep for `is_active` across `api/` returns only `auth.py:118,127` (the login query) and unrelated `offers.is_active` hits — **no request-time authorization path ever reads `admin_users.is_active`**.

Consequences for the full `jwt_access_ttl_minutes` window (default 60, `config.py:41`):
- Deactivating or deleting a compromised admin has no effect. There is also no endpoint to deactivate one — `admin_users` is only writable by `scripts/create_admin.py`.
- Demoting `SUPER_ADMIN` → `VIEWER` does not take effect.
- Re-assigning an operator's store does not take effect (this one *is* documented, `security.py:72-74` — the other two are not).

**Severity: High** — an authenticated-session revocation gap on the only privileged surface in the system.

### H9 — Idempotency on checkout fails in exactly the case it exists for

**CONFIRMED**, two compounding halves.

**Server:** `api/services/orders.py:72-79` does a plain `SELECT … WHERE store_id AND idempotency_key`, then falls through to `INSERT`. Two concurrent requests with the same key both miss the SELECT and both INSERT; the second violates `orders_store_idempotency_key` (`005_stores.sql:186-187`) → unhandled `UniqueViolation` → 500. There is no `ON CONFLICT DO NOTHING … RETURNING` and no retry. Double-submit is by definition concurrent, so the guard fails precisely under its design load.

**Client:** `storefront/src/pages/Checkout.tsx:105` generates the key inside `onSubmit`:
```ts
idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
```
A second click produces a *different* key, so the server-side dedupe is never even consulted — the customer simply gets **two orders and two stock holds**. The key must be minted once per cart, not once per click.

**Severity: High** — duplicate COD orders reach fulfilment; the mitigation that exists does not fire.

---

## 4. MEDIUM findings

### M1 — Unvalidated enum filters return 500

**CONFIRMED.** Four endpoints bind a caller-supplied string straight into a comparison against a Postgres enum column:

| Site | Parameter |
|---|---|
| `api/routes/products.py:90-92` | `?status=` → `p.status = :st` |
| `api/routes/orders.py:79-81` | `?status=` → `status = :s` |
| `api/routes/enrichment.py:57,61` and `:119,128` | `?only_status=` → `status = ANY(:statuses)` |
| `api/routes/catalog.py:124,129-131` | `?only_status=` → `status = ANY(:statuses)` |

Any label outside `product_status_enum` / `order_status_enum` raises at the driver/Postgres boundary; nothing catches it, so the middleware returns a 500 (`api/main.py:126-135`) and the transaction is aborted. `GET /api/v1/products?status=x` is a one-request unauthenticated 500.

The correct pattern is already in the codebase twice — `images.py:37,61-63` (`_ALLOWED_STATUS` set) and `intel.py:107` (`Literal[...]`) — it was simply not applied to these four.

**Severity: Medium** — trivially reachable unhandled error, one of them anonymous; noise that masks real 500s.

### M2 — `_ensure_unique` is a TOCTOU check that degrades a 409 into a 500

**CONFIRMED.** `api/routes/products.py:39-56` runs `SELECT 1 … WHERE {field} = :v AND store_id = :store_id` and raises 409 on a hit. It is called at `:266, :267, :328, :330, :404, :476` and is always followed by an unguarded INSERT/UPDATE. Concurrent creates with the same SKU both pass the check; the loser hits `products_store_sku_key` (`005_stores.sql:173`) and gets a 500 instead of the 409 the code was written to produce. Same for `slug` and `offers.variant_sku`. The right shape is to let the constraint be the arbiter and translate `IntegrityError` → 409.

### M3 — `competitor_prices` ON CONFLICT is a permanent no-op; the time series grows without bound

**CONFIRMED.** `db/migrations/002_scraper.sql:81-84`:
```sql
-- Idempotent on (product, domain, day): re-runs collapse, time series stays clean.
CONSTRAINT competitor_prices_unique_per_day
    UNIQUE (product_id, source_domain, observed_at)
```
`observed_at` is `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (`:79`) — microsecond precision, not a day. `api/services/scraper/engine.py:396-406` targets that constraint with `ON CONFLICT … DO UPDATE`. Since every insert carries a distinct `NOW()`, **the conflict can never fire**. The comment, the constraint name and the docstring at `engine.py:388` all claim an idempotency that does not exist.

Compounding: `competitor_prices` and `scrape_sources` (which stores page titles and 1000-char snippets, `002_scraper.sql:53-54`) have **no retention job**. Only `observations` is pruned (`fn_prune_observations`, `003_observations_retention.sql`; called from `reservation_worker.py:50`). With the duplicate-scrape bug (`Architecture.md:§7.3`) each product accumulates two rows per domain per run, forever.

### M4 — Event worker can deadlock its own connection pool

**CONFIRMED.** `workers/event_worker.py:222` fans out the whole batch at once:
```python
await asyncio.gather(*(_process_one(e) for e in batch), return_exceptions=True)
```
`event_worker_batch_size` defaults to **50** (`config.py:56`); the pool is `db_pool_size=10 + db_max_overflow=10` = **20** (`config.py:16-17`). Thirty tasks queue on `pool_timeout=30s`. Worse, the failure path at `:175` opens a **second** session (`db2`) while the first (`:144`) is still inside its `async with` — so each failing task holds one connection and demands another. Under a batch of correlated failures this is a classic self-deadlock: 20 tasks each hold a connection and wait 30s for a second one that only they could release.

Neither sibling worker has this shape — both process strictly one job at a time (`scraper_worker.py:243`, `intel_worker.py:252`).

### M5 — CSV import reports success for offer updates it silently skipped

**CONFIRMED.** `api/services/csv_import.py:318-330`:
```sql
UPDATE offers SET purchase_price = :pp, retail_price = :rp, stock_quantity = :stk, ...
 WHERE id = :id AND store_id = :sid AND reserved_quantity <= :stk
```
followed unconditionally by `offers_updated += 1` (`:330`). When the guard rejects the row (new stock below the active reservation count — exactly the case worth reporting), zero rows change but the operator is told the offer was updated. The `CommitReport` returned to the UI (`:332-339`) therefore overstates the import, and the skipped rows appear in no `issues` list.

Related, same function: `commit_import` never touches `sale_price`. If an existing offer has a `sale_price` and the CSV lowers `retail_price` below it, the `offers_sale_below_retail` CHECK (`db/schema.sql:133`) fires and the **entire import** 500s and rolls back — no partial-failure handling.

### M6 — `GET /events/{event_id}` is not store-scoped

**CONFIRMED.** `api/routes/events.py:58-68` uses bare `Depends(require_role("SUPER_ADMIN","ADMIN"))` and queries `WHERE event_id = :id` with no store predicate — the only endpoint in the module that skips `require_admin_store_for`, which its sibling POST at `:20` uses correctly. Returns `event_type`, `entity_id`, `status` and `last_error` for any store's event.

### M7 — `GET /products` runs the correlated subqueries twice per page

**CONFIRMED.** `api/routes/products.py:125-149` computes three correlated subqueries per product (primary image, min price, available). `api/routes/products.py:163-176` then re-runs the **same** subqueries over the whole store inside a `COUNT(*)`, with no `LIMIT`. The count therefore evaluates the `offers` aggregates for every non-archived product in the catalog on every page view of the storefront listing — the hottest public endpoint in the system. `catalog.py:281-303` (`/products/featured`) has the same subquery-per-row shape plus an `EXISTS` inside `ORDER BY`.

The comment at `products.py:108-110` ("indexes cover the per-product subqueries acceptably at < 50K rows") acknowledges the first query but not the count.

### M8 — Order numbering scans the store's whole order table on every checkout

**CONFIRMED.** `api/services/orders.py:59-65` filters with `order_number LIKE 'GL-2026-%'`. `orders_store_number_key` (`005_stores.sql:184`) is a default-collation btree, which Postgres cannot use for a prefix `LIKE` without `text_pattern_ops`. Every checkout therefore aggregates over every order the store has ever placed. Cost grows linearly with lifetime order count, on the latency-sensitive path. (A per-store sequence would fix §H1 and this together.)

### M9 — Scraper worker's stale sweep misses `RUNNING`

**CONFIRMED.** `workers/scraper_worker.py:84`: `WHERE status = 'CLAIMED' AND claimed_at < :t`. But `_process_one` immediately promotes the job to `RUNNING` (`:96, :163`). A worker killed mid-`run_job` — the common case, since a job takes up to `per_job_timeout_seconds` = 90s and drives Playwright — leaves the row in `RUNNING` forever. `intel_worker.py:82` gets this right: `WHERE status IN ('CLAIMED','RUNNING')`. The heartbeat (`scraper_worker.py:137-141`) already updates rows in both states, so the sweeper is simply out of step with its own claim lifecycle.

### M10 — Rate limiter: spoofable key over an unbounded dict (verified, deepened)

**CONFIRMED**, extends `Architecture.md:§7.10`. `api/core/ratelimit.py:32-36` returns the first `X-Forwarded-For` element whenever the header is present, with no trusted-proxy allowlist. `:16` is a `defaultdict(deque)`; `check()` at `:22` does `q = self._hits[key]`, which **materializes an entry on every distinct key**, and the sliding window only `popleft()`s timestamps — the key itself is never deleted.

The two combine into a cheap memory-exhaustion primitive: one POST per forged `X-Forwarded-For` value adds a permanent dict entry and a permanent deque, and the limiter never triggers because each forged key starts a fresh bucket. `api/main.py:110-122` applies this to every non-GET, including the unauthenticated `POST /orders/create` and `POST /auth/login`. The identical XFF flaw governs the auth tracker (`auth.py:85-91`), whose `_buckets` dict (`auth.py:44`) is likewise never evicted.

### M11 — Public catalog status filter (verified, deepened)

**CONFIRMED**, extends `Architecture.md:§7.8`. `products.py:89-94` lets an anonymous caller override the archive filter with `?status=RAW`. Additional detail not previously noted: **`GET /products/{product_id}` (`products.py:187-197`) applies no status filter at all** — an anonymous caller with a product UUID reads any unpublished product's full record including `specs`, `completeness_score`, every offer's `purchase_price` (cost!) at `:207`, and `reserved_quantity`. `products.py:216-226` returns `purchase_price` on the public detail endpoint unconditionally. That is margin data on an unauthenticated route.

### M12 — `products_export.py` is dead, and mounting it would do more than crash

**CONFIRMED dead, with proof.** `grep -rn "products_export" --include=*.py --include=*.ts --include=*.tsx --include=*.json .` returns **zero** hits outside the file itself. It is absent from the import list at `api/main.py:19` and from all mounts at `:174-193`. Nothing in `admin/src` or `storefront/src` calls `/export`, `/bulk-update` or `/bulk-status`.

Extending `Architecture.md:§7.7`: the file contains **four** latent defects, not two.
- Missing `store_id` on `INSERT INTO observations` — `:277-284` and `:358-362` (NOT NULL violation).
- `UPDATE products SET … WHERE id = ANY(CAST(:ids AS UUID[])) AND status <> 'ARCHIVED'` — `:258-263`, **no store filter**: an unscoped bulk cross-tenant product overwrite.
- `UPDATE products SET status = :new_status WHERE id IN (SELECT id FROM products WHERE {where} …)` — `:344-352`, **no store filter**: unscoped bulk status change across every tenant.

Mounting it as-is is not a fix-the-INSERT job; it is a rewrite.

### M13 — `api/core/metrics.py` is dead (246 lines)

**CONFIRMED.** `grep -rn "core.metrics\|import metrics" --include=*.py .` returns **zero** hits. `setup_metrics(app)` (`metrics.py:217`) is never called; `api/main.py:13-19` does not import it. `record_scrape_tier` (`:130`), `observe_intel_duration` (`:143`) and `refresh_db_metrics` (`:153`) have no callers. There is no `/metrics` route in any mounted router. The system has structured logging (`core/logging.py`, wired) but **no metrics at all**, despite a complete module sitting in `core/`.

### M14 — CSV import is row-at-a-time

**CONFIRMED.** `api/services/csv_import.py:247-330` issues one INSERT/UPDATE for the product and one for the offer per row, inside a Python loop. With the 16 MiB upload cap (`products_import.py:25`) a large supplier file is tens of thousands of round trips in a single transaction, and `POST /products/import/commit` then optionally chains a full `enrich_many(limit=20000)` pass in the same request (`products_import.py:89-93`). No batching, no `executemany`, no timeout guard.

---

## 5. LOW findings

### L1 — Provably dead helpers in the store layer
**CONFIRMED**, zero callers each (`grep -rn --include=*.py`, excluding `__pycache__`):
- `api/core/store_context.py:81` `clear_domain_cache()` — the 60s domain cache (`:51`) has no invalidation path, which is consistent: **no endpoint mutates `stores` or `store_domains`** (`stores.py` is read-only, 2 GETs). Store provisioning is SQL-only today.
- `api/core/store_context.py:212` `current_store_id()`.
- `api/core/security.py:62-64` `CurrentAdmin.is_platform_operator` — `stores.py:59,72` re-implements the check inline as `admin.store_id is None`.

### L2 — Unreachable `else` branch in all three status calculators
**CONFIRMED.** `full_intel.py:393-394`, `llm_enrichment.py:306-307`, `enrichment.py:524-525`. Given the preceding `elif has_brand and has_cat`, the third condition `not has_brand or not has_cat` is a tautology and the `else` can never execute. Harmless today; it hides the fact that `NORMALIZED` is never assigned by any code path.

### L3 — `emit_event`'s optional `store_id` is a loaded gun
**CONFIRMED**, matches `Architecture.md:§7.13`. `api/services/events.py:18,29-38`: the parameter defaults to `None` and falls back to `bound_store()` inside `try/except Exception: pass`. Outside a request (any worker) the fallback yields `None` and the INSERT then violates `events.store_id NOT NULL`. All three current callers (`orders.py:195-203, 239-242, 277-281`) pass it, so nothing breaks today — but the signature invites exactly the omission that produced four of the recently fixed bugs. Make it keyword-required.

### L4 — Child queries rely entirely on parent scoping
**CONFIRMED**, defense-in-depth only. These read scoped tables with no `store_id` predicate, correct today because the parent id was verified first:
`products.py:210` (offers), `:233` (product_media), `:137-139` and `:168-170` (subqueries); `orders.py:223, 262` (inventory_reservations), `:313` (order_items); `public_orders.py:164` (order_items); `full_intel.py:294-297, 500-503`; `enrichment_runner.py:44-58`; `llm_enrichment.py:97-110`; `scraper/engine.py:106-116`.
Given that four `store_id` bugs already shipped, adding the predicate is cheap insurance — a single mis-scoped parent check silently widens all of these at once.

### L5 — `reservation_worker` singleton is documented, not enforced
**CONFIRMED**, matches `Architecture.md:§7.12`. `workers/reservation_worker.py:10-12` asserts "we do NOT scale this worker"; the module takes no advisory lock and `docker-compose.yml:71-80` sets no `deploy.replicas` (unlike the explicit scale hints on `scraper_worker` at `:103` and `intel_worker` at `:124`). `fn_expire_stale_reservations` uses `FOR UPDATE SKIP LOCKED` (`db/schema.sql:564-568`) so concurrency is safe; the exposure is duplicated work, not corruption. Note that `pg_try_advisory_lock` is already used correctly elsewhere (`core/migrations.py:177-190`) — the pattern is in the codebase.

### L6 — Login side channels
**CONFIRMED.** `auth.py:127-129` returns 401 **before** running bcrypt for an unknown or inactive email, while a known-active email pays the full `bcrypt_rounds=12` cost (~250ms, `config.py:43`). Response time is a clean user-enumeration oracle. Combined with the 423-vs-401 status difference (§C1) an attacker can enumerate admin addresses without any timing analysis at all.

---

## 6. Transactions and commit boundaries

**Where commit happens — CONFIRMED.** `get_db` (`api/core/db.py:44-50`) yields a session, rolls back on exception, and **never commits**. Every route commits explicitly. Services do not — with one exception.

**The exception is the only real partial-write window.** `api/services/full_intel.py:460` calls `await db.commit()` **in the middle of the pipeline**, on the caller's session, to make the shadow `scrape_jobs` row visible to the `scrape_sources` FK. Everything after that (`se.run_job` at `:471`, the LLM call at `:484`, `_apply_payload` at `:492`, the status rewrite at `:497`) runs in a fresh implicit transaction. When the LLM raises — the single most likely failure in the pipeline — `intel_worker.py:207` rolls back, but the shadow row is already durable and still `PENDING`. This is the precise mechanism behind the duplicate-scrape finding in `Architecture.md:§7.3`: `scraper_worker.py:46-61` claims any `PENDING` row, so **every** intel job (successful or not) leaves a second full scrape behind. Nothing in `full_intel.py` or `engine.py` ever updates `scrape_jobs` (grep confirms only the INSERT at `:443` and a stale docstring at `engine.py:18`).

**Reservation flow — assessed.** The three-function protocol is sound in isolation: `fn_reserve_stock` row-locks the offer with `FOR UPDATE` before reading availability (`006_store_scope_orders.sql:34-38`) and derives `store_id` from the locked row, which makes cross-store reservation structurally impossible — good design. `fn_consume_reservation` and `fn_release_reservation` both re-lock the reservation (`db/schema.sql:504-508, 539-543`). `fn_expire_stale_reservations` uses `FOR UPDATE SKIP LOCKED LIMIT 200` (`:564-568`), so concurrent expiry passes are safe.

The **defects are at the Python boundary, not inside the functions**: §H2 (confirm silently no-ops on expired holds) and §H3 (cancel-after-confirm never restores stock). Both are missing state-machine coverage — there is no path from `CONSUMED` back to available, and no path that detects a reservation that vanished under a pending order. Note also that expiry releases the stock but leaves `orders.status = 'RESERVED'` (`fn_expire_stale_reservations` touches only `inventory_reservations`), so the orders table permanently disagrees with the inventory table about which orders hold stock.

`create_order` is otherwise correctly atomic: offers are loaded `FOR UPDATE OF o` in one statement (`orders.py:89-102`), and order + items + reservations + event all land in one transaction committed by the route (`api/routes/orders.py:32`).

---

## 7. Auth / authz matrix — every mounted endpoint

**CONFIRMED** by reading every decorator. No mounted endpoint is missing an auth guard *by accident*. The unauthenticated set is deliberate and correct in shape:

| Endpoint | Guard | Assessment |
|---|---|---|
| `GET /healthz` | none | fine |
| `GET /readyz` | none | fine as liveness; but it triggers an outbound fetch to an admin-controlled URL — §H7 |
| `POST /auth/login` | none | §C1, §L6 |
| `GET /storefront/theme` | none | fine (whitelisted CSS only, `settings.py:349-359`) |
| `catalog.py` ×4, `public_orders.py` ×2 | `require_store` | correct |
| `GET /products`, `GET /products/{id}` | `require_store` | public by design — but §M11 |
| `POST /orders/create` | `require_store` | public by design — but §C2 |

Everything else carries `require_role(...)`. The real authz problems are **not missing guards but guards that are too coarse**:

- `READ_ROLES` includes `VIEWER` on `GET /products/market/alerts` (§C4), `GET /intel-jobs/{id}` (raw LLM payload), `GET /jobs/*` (§H6) and `POST /settings/scraper/probe` (§H7). A "read-only" role can trigger outbound requests and read every tenant's commercial data.
- `WRITE_ROLES` includes `OPERATOR` on `POST /products/intel-bulk` (§C3) and every `jobs.py` retry (§H6) — platform-wide side effects at the lowest write privilege.
- `require_admin_store_for` (`store_context.py:235-293`) is correct where used: scoped operator + foreign `x-store-id` → 403 (`:272-275`); platform operator with no header → 400 (`:279-283`). The design is sound; the coverage is not (§1.3).
- **404-vs-403 discipline is good where scoping exists.** `products.py:199-202` documents and implements "another store's product reads as 404". `public_orders.py:122-125` uses a single constant-shape 404 for order tracking. `stores.py:86-87` raises 403 *before* the lookup, so it leaks nothing either. The existence leaks are not status-code leaks — they are endpoints that return the foreign row outright (§C4, §H6, §M6).

---

## 8. Test coverage gap — the root cause

**CONFIRMED.** 16 test files, 257 `def test_` declarations. `grep -rln "api.main\|api\.routes" tests/` returns **nothing**. Every import is `api.services.*` or `api.core.{logging,migrations,health}`.

The consequence is structural, not incidental. This codebase has:
- no ORM and no model layer (`api/models/` is one file of Pydantic DTOs),
- 100% raw SQL via `sqlalchemy.text()`,
- therefore **zero compile-time or import-time consequence for any schema change**.

A `NOT NULL` column addition, a renamed column, a dropped index, a changed enum — none of it is detectable without executing the SQL against a real database. The suite never does. This is why four `store_id` bugs shipped, why the two in `products_export.py` are still there, and why §M1 (a one-request 500 on the public catalog) is undetected.

Worse, `tests/test_bulk_operations.py` (14 tests) covers `products_export.py` — **a router that is not mounted** — and does so by re-declaring the constants and Pydantic models locally rather than importing them, so it validates a copy of a contract that no running code uses.

**Minimum viable fix:** one `httpx.AsyncClient(app=api.main.app)` fixture against a throwaway Postgres, plus a smoke test per router that exercises one write and one read. `scripts/deploy/smoke_test_checkout.py` already proves the checkout path end-to-end with stdlib only — it just is not part of the suite.

---

## 9. Dead code — proven

| Item | Proof |
|---|---|
| `api/routes/products_export.py` (369 lines) | zero hits for `products_export` in any `.py`/`.ts`/`.tsx`/`.json`; absent from `main.py:19` imports and `:174-193` mounts; no frontend consumer of `/export`, `/bulk-update`, `/bulk-status` |
| `api/core/metrics.py` (246 lines) | zero hits for `core.metrics` / `import metrics` repo-wide; `setup_metrics` never called |
| `store_context.clear_domain_cache` | zero callers; consistent — no endpoint mutates `stores`/`store_domains` |
| `store_context.current_store_id` | zero callers |
| `CurrentAdmin.is_platform_operator` | zero callers; `stores.py:59,72` inlines the check |
| `financial_transactions` table | zero INSERT/SELECT sites in `api/`, `workers/`, `scripts/` (confirms `Architecture.md:§7.6`) |
| `audit_log` table | same |
| `config.jwt_refresh_ttl_days` | zero references outside `config.py:42`; no refresh-token endpoint exists |
| `else: new_status = "NORMALIZED"` ×3 | logically unreachable (§L2) |
| `competitor_prices … ON CONFLICT` clause | can never fire (§M3) |

---

## 10. Duplicate logic

| Duplicated | Copies | Risk |
|---|---|---|
| Completeness-score SQL (8-term weighted CASE) | `full_intel.py:363-379`, `llm_enrichment.py:276-292`, plus a Python reimplementation in `enrichment.py` (`compute_completeness`) and a fourth partial in `issues.py:32-45` | Four sources of truth for the number the whole admin UI ranks on. A weight change must land in four places or the ranking silently disagrees with itself. |
| Status auto-bump if/elif chain | `full_intel.py:387-394`, `llm_enrichment.py:299-307`, `enrichment.py:518-525` | §H4 is the same bug three times; fixing one copy fixes one third of the paths. |
| `observations` writer | `enrichment_runner.py:77-101`, `llm_enrichment.py:124-140`, `full_intel.py:343-354`, `images.py:156-163`+`:198-205`, `scraper/engine.py` | Five shapes, no canonical writer. This is exactly why two of the four `store_id` bugs were in this table. |
| `_normalize_phone` | `services/orders.py:18-19`, `routes/public_orders.py:117-118` | Identical; if they ever diverge, order tracking stops matching the customer that checkout created. |
| Per-source scrape-job detail query | `scraper.py:127-155` and `jobs.py:232-261` — byte-identical SQL and response assembly | Two endpoints, one contract, no shared function. |
| `_load_scraper_config` / `_mask_keys` | `scraper.py:404-421` vs `llm.load_config`/`to_safe_dict` in `services/llm.py` | Parallel implementations of the same `app_settings` JSONB read + key-masking pattern. |

---

## 11. Prioritised remediation

**Do first (hours, high blast radius):**
1. §C1 — one-line comparison fix in `auth.py:132`, plus clear the counters when the window lapses. Currently a 5-request permanent DoS.
2. §C2 — drop `discount_amount` and `shipping_cost` from `OrderCreate`; compute both server-side. Currently free goods.
3. §C4 / §C3 — add `p.store_id = :sid` to `scraper.py:352` and `intel.py:152`; apply `_assert_product_in_store` (`enrichment.py:31-38`) to `intel.py:48` and `scraper.py:60`.
4. §H4 — preserve `ACTIVE` and `ARCHIVED` in all three status calculators. One condition, three files, stops silently de-listing live stock.

**Do next (days):**
5. §H1 + §M8 — replace `MAX+1` with a per-store sequence or `pg_advisory_xact_lock(store_id)`.
6. §H2 + §H3 — assert reservation count matches item count on confirm; add a stock-restore path for cancel-after-confirm.
7. §H5 — copy `_release_stale` from `intel_worker.py:74-89` into `event_worker.py`, sweeping `PROCESSING`.
8. §H6 — add `require_admin_store_for` to all nine `jobs.py` endpoints; remove `COMPLETED`/`SYNCED` from the retryable sets, or make `handle_order_created` idempotent.
9. §H8 — re-check `is_active` (and ideally role) against the DB in `get_current_admin`.

**Then (structural):**
10. **A single route-level integration test fixture.** This is the highest-leverage item in the report: none of §C1–§C4, §H1, §H2, §H4, §M1 or §M5 can be caught by the current suite, and all of them would be caught by a smoke test per endpoint against a real database.
11. §M12 — delete `products_export.py` and `tests/test_bulk_operations.py`, or rewrite both with store scoping.
12. Extract one canonical `write_observation()` and one canonical completeness function (§10).
13. §H7 — validate `searxng_url` and `llm.endpoint` against a scheme+host allowlist; move `PUT /settings/*` behind `SUPER_ADMIN`, or scope config per store.

---

## 12. What surprised me

1. **The store-scoping sweep came back clean on writes.** Every INSERT in mounted code carries `store_id`. The remaining tenancy holes are all *reads* and *unscoped modules* — the fix that was applied was per-statement, not per-module, so the three modules nobody touched (`intel`, `scraper`, `jobs` — 23 endpoints) stayed at zero.
2. **The worst bug in the backend has nothing to do with multi-store.** `locked_until IS NOT NULL` instead of `> NOW()` is a five-character defect that permanently bricks every admin account, and it has presumably been there since the auth module was written.
3. **The public checkout takes the discount from the client.** In a COD business, on an unauthenticated endpoint, with a `CHECK` constraint that validates the arithmetic and therefore makes the fraud look internally consistent.
4. **Approving an image de-lists the product.** The image review queue is the flagship feature of the intel pipeline, and using it as designed removes the product from the shop. Three copies of the same status calculator, none of which can emit `ACTIVE`.
5. **`competitor_prices` has a uniqueness constraint whose name, comment and `ON CONFLICT` handler all describe behaviour it cannot have** — `UNIQUE (product_id, source_domain, observed_at)` where `observed_at` defaults to `NOW()`.
6. **The event worker is the only one of the three job workers without a stale-claim reaper**, and it is the one that handles orders.
7. **A complete, well-written metrics module sits in `api/core/` with zero imports.** The system has no metrics at all, and the code to have them was already written.

---

*Backend audit, 2026-07-31. Read-only — no source file was modified, staged, or committed.*
