# GLstore — Performance Audit

**Scope:** backend query patterns, indexing, connection pooling, serverless cold-start · frontend bundle size, code-splitting, re-render risk, image/font loading.
**Branch:** `gaming-store` @ `760b8b7` · **Method:** static read of source + schema/migrations, plus measurement of the repo's existing `admin/dist` (built 2026-07-29 13:42) and `storefront/dist` (built 2026-07-29 01:07) build artifacts. No live database or browser profiler was available in this environment — costs are reasoned from the SQL/plan structure and index definitions, not from `EXPLAIN ANALYZE`. Every finding below is labelled **CONFIRMED** (read from source/schema/build output) or **SUSPECTED** (inferred, flagged as such). Read-only audit — no source file was modified.

---

## Ranked bottleneck list

### 1. HIGH — Jobs Console (`GET /jobs`, `GET /jobs/stats`) does two full-table scans every 5 seconds by default

**CONFIRMED.** `api/routes/jobs.py:45-80` (`jobs_stats`) runs three unfiltered aggregates:

```sql
SELECT status, COUNT(*) FROM scrape_jobs GROUP BY status
SELECT status, COUNT(*) FROM events GROUP BY status
SELECT status, COUNT(*) FROM sync_queue GROUP BY status
```

None of these three tables has a full (non-partial) index on `status`. Every index that touches `status` on these tables is a **partial index scoped to the in-flight statuses only**:
- `scrape_jobs_status_idx ON scrape_jobs(status, created_at) WHERE status IN ('PENDING','CLAIMED','RUNNING')` (`db/schema.sql:640-642`)
- `idx_events_pending ON events(status, next_retry_at NULLS FIRST, created_at) WHERE status IN ('PENDING','RETRYING')` (`db/schema.sql:384-385`)
- `idx_sync_pending ON sync_queue(status, next_retry_at NULLS FIRST, created_at) WHERE status IN ('PENDING','IN_PROGRESS')` (`db/schema.sql:391-392`)

Because `GROUP BY status` with no `WHERE` needs every status including `COMPLETED`/`SYNCED`/`FAILED`, none of these partial indexes can serve it — Postgres must sequential-scan all three tables. Worse, there is **no retention/pruning job for `scrape_jobs`, `events`, or `sync_queue`** (grep for `DELETE FROM events|DELETE FROM sync_queue|prune` across `api/` and `workers/` returns nothing; only `observations` has `fn_prune_observations`, per `db/migrations/003_observations_retention.sql`). These three tables are append-only and grow forever, so the cost of this endpoint strictly increases over the platform's lifetime.

`api/routes/jobs.py:87-223` (`list_jobs`) is worse when called with no `type`/`status` filter (the console's default view): it builds a `WITH u AS (... UNION ALL ...)` over all three full tables, where the `scrape` branch additionally runs a **per-row correlated subquery** for every `scrape_jobs` row:

```sql
('scrape · ' || COALESCE((SELECT sku FROM products WHERE id = product_id), 'product?')) AS label   -- jobs.py:124
```

then sorts the *entire* unioned result by `u.created_at DESC` before applying `LIMIT/OFFSET` (`jobs.py:192-193`). There is no index on any of the three tables covering `created_at` alone across all statuses (the only `created_at`-bearing indexes are the partial ones above, or `scrape_jobs_product_idx (product_id, created_at DESC)` — neither lets Postgres avoid sorting the full union). The `COUNT(*)` query (`jobs.py:210-216`) reuses the identical CTE text, so it pays the same union cost (though the unused `label` subquery is very likely pruned by Postgres 12+'s target-list elimination on CTE inlining — the item-list query is not so lucky, since it actually selects `label`).

**Frontend compounds this.** `admin/src/pages/JobsConsole.tsx:41,48-52,54-65`: `autoRefresh` defaults to `true`, and *both* `jobs-stats` and `jobs-list` queries carry `refetchInterval: 5_000`. Simply leaving the Jobs Console tab open triggers both expensive queries every 5 seconds, indefinitely, for as long as the tab has focus (React Query pauses on blur, but does not stop on a merely-idle-but-visible tab).

**Impact (reasoned):** cost scales with total lifetime job volume across the whole platform (these tables are deliberately unscoped by store — `005_stores.sql:11-14` — so it is a platform-wide, not per-store, scan), compounds daily since nothing prunes completed rows, and is paid twice every 5 seconds by every open admin tab.

**Fix:**
- Add non-partial covering indexes: `CREATE INDEX ON scrape_jobs(status)`, `events(status)`, `sync_queue(status)` (or make the existing partial indexes full) so `/jobs/stats` can index-scan instead of seq-scan.
- Add `created_at` btree indexes without a partial predicate on all three tables (or per-branch `ORDER BY … LIMIT` pushdown reformulated as three separate paginated queries merged in Python) so `/jobs` doesn't require a full sort of the union.
- Batch the SKU lookup: replace the per-row correlated subquery with a single `LEFT JOIN products` (or a `LEFT JOIN LATERAL`) on the *already-limited* page, not the whole table.
- Add a retention job (mirror `fn_prune_observations`) for `COMPLETED`/`SYNCED`/`CANCELLED` rows older than N days in all three tables.
- Frontend: raise `refetchInterval` (5s is aggressive for an admin console) or add `refetchIntervalInBackground: false` semantics explicitly / pause when `document.visibilityState !== 'visible'`.

---

### 2. HIGH — `GET /products` (storefront catalog + admin Products list): correlated subqueries scale with the filtered result set, not the page

**CONFIRMED — the "known suspect" flagged for this audit.** `api/routes/products.py:125-149`:

```sql
SELECT id, sku, slug, name, brand, category, specs, completeness_score, status,
       primary_image, min_price, available
  FROM (
    SELECT p.id, ..., p.updated_at,
           (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.is_primary
             AND m.status = 'STORED' LIMIT 1) AS primary_image,
           (SELECT MIN(COALESCE(o.sale_price, o.retail_price)) FROM offers o
             WHERE o.product_id = p.id AND o.is_active) AS min_price,
           (SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o
             WHERE o.product_id = p.id AND o.is_active) AS available
      FROM products p
     WHERE {where_sql}
  ) p
 WHERE TRUE {extra_where_sql}
 ORDER BY {order_clause}
 LIMIT :limit OFFSET :offset
```

The three correlated subqueries live in the **inner** derived table's target list, evaluated once per row of `products p WHERE {where_sql}` — i.e. for *every product matching the store/status/category/brand/search filter*, not just the 24 (default `page_size`) actually returned. The `ORDER BY`/`LIMIT` are on the *outer* query, so Postgres cannot defer the inner subquery evaluation past the limit the way it could if the sort key were a plain column already known before projection. At `sort=price_asc|price_desc` this is unavoidable by construction (the sort key *is* one of the subqueried columns); at the default `sort=recent` it is still paid because the inner subquery layer computes all three columns unconditionally regardless of whether the outer query needs them for ordering.

The `total_row` count query (`products.py:163-176`) **independently re-runs the same `min_price`/`available` subqueries** for the *entire* filtered set even when neither `in_stock`, `price_min`, nor `price_max` is supplied (i.e., even when the subquery results are never read by `extra_having`). This is pure waste on the common case: a plain `SELECT COUNT(*) FROM products p WHERE {where_sql}` would suffice whenever `extra_having` is empty, but the code always emits the subqueried form.

Each individual correlated subquery *is* index-backed (`idx_media_product(product_id)` + `idx_media_status(status)` for the image lookup; `idx_offers_active(product_id, is_active)` for the price/stock ones — `db/schema.sql:349-355`), so per-row cost is low, but the total cost is `O(matching products) × 3`, twice (once for items, once for count), on every catalog page view and every filter change.

**A second, compounding gap: `q=` search has no index for two of its three OR'd columns.** `products.py:97`:

```sql
(p.name ILIKE :q OR p.sku ILIKE :q OR p.brand ILIKE :q)
```

Only `products.name` has a trigram GIN index (`idx_products_name_trgm ON products USING GIN (name gin_trgm_ops)`, `db/schema.sql:346`). `sku` and `brand` have no trigram index, so a leading-wildcard `ILIKE '%x%'` on those columns cannot use an index at all — the planner can no longer restrict via `idx_products_store_status`/`idx_products_store_category` either, because the `OR` needs a row-level filter it can't push through a partial index path. In practice this means any search query forces a scan proportional to the store's product count (**CONFIRMED** by index inspection; exact plan choice is **SUSPECTED** without `EXPLAIN`).

**Frontend has no debounce on the admin search box**, which multiplies the cost above. `admin/src/pages/Products.tsx:66-69`:

```tsx
const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  setQ(e.target.value)
  setPage(1)
}, [])
```

`setQ` is wired directly to the `<input onChange>` with **no debounce/throttle**, and `q` is part of the `useQuery` key (`Products.tsx:32`), so every keystroke fires a brand-new `GET /products?q=...` request — each one paying the full-catalog correlated-subquery cost above. (Contrast with the storefront's `SearchBox.tsx:18-25`, which correctly debounces 220ms before firing — the admin page is the outlier.)

**Impact (reasoned):** for a catalog of a few thousand products this is not yet catastrophic per-request, but it is the dominant cost driver on the platform's two hottest read paths (storefront catalog browsing, admin product search), it re-runs on every filter/page/sort change, and the admin search box turns "typing a 7-letter brand name" into 7 sequential full-catalog scans.

**Fix:**
- Only include `primary_image`/`min_price`/`available` in the inner subquery when they are actually needed by the requested `sort`/`extra_having`; otherwise compute them only for the final LIMIT-ed page (e.g. two-step: fetch matching `id`s cheaply, then hydrate the page's 24 rows with the subqueries / a batched `LEFT JOIN`).
- Drop the subqueries entirely from the `total_row` count query when `extra_having` is empty — `SELECT COUNT(*) FROM products p WHERE {where_sql}`.
- Add trigram indexes on `sku` and `brand` (`CREATE INDEX ... USING GIN (sku gin_trgm_ops)`, same for `brand`), or restrict `q` search to `name` + exact/prefix match on `sku`.
- Debounce the admin search input the same way the storefront already does (`Products.tsx:66-69`).

---

### 3. HIGH — Approved product images are hotlinked from the original scraper source forever — never re-hosted, resized, or cached

**CONFIRMED.** `api/services/full_intel.py:315-329` inserts scraped image rows with the raw external URL as-is:

```sql
INSERT INTO product_media (id, store_id, product_id, url, kind, position, is_primary, status, source, alt_text)
SELECT :id, p.store_id, :pid, :url, 'image', 0, false, 'PENDING', 'SCRAPED', :alt
  FROM products p WHERE p.id = :pid
-- :url is url[:2000] — the literal URL scraped from Jumia/Ouedkniss/Batolis/Condor/etc.
```

`api/routes/images.py:1-15` confirms the review flow only ever **flips `status`** (`PENDING → STORED` on approve, `→ DELETED` on reject) — there is no re-upload/re-host step anywhere in the approve path. `r2_public_base` is defined in config (`api/core/config.py:53`) but a repo-wide grep for `r2_public_base`/`R2_PUBLIC_BASE` across `.py`/`.ts`/`.tsx` finds **only the config declaration itself** — it is never read to construct a URL anywhere in the codebase (**CONFIRMED dead** for this purpose). So the URL the storefront ultimately renders in `<img src>` for most catalog images is a direct hotlink to a third-party retailer's CDN, indefinitely.

`api/routes/products.py:133-135` (`primary_image` subquery), `catalog.py:284-286,207-212`, and every storefront product card render this URL directly with no proxy/cache layer in front of it.

**Impact (reasoned, not measured):** the storefront's single largest per-page visual payload (product images, shown at multiple sizes: card thumbnail, gallery, hero) depends entirely on a competitor's server response time, uptime, and hotlink/referrer policy — any of Jumia/Ouedkniss/Batolis/Condor changing CORS/referrer rules, rate-limiting the storefront's traffic, or simply going down breaks product images platform-wide with no fallback. There is also no opportunity to serve responsive sizes (no `srcset`) or a modern format (WebP/AVIF) since the origin's file dictates format/size — the browser downloads whatever resolution the source retailer originally used, even for a 32×32 thumbnail.

**Fix:** re-upload approved images to R2 at approval time (or via an async job), serve from `r2_public_base`, and generate 2-3 responsive sizes at upload time (or front R2 with Cloudflare Image Resizing) so `<img srcset>` can be used.

---

### 4. MEDIUM-HIGH — Heavy animation libraries are eagerly bundled into the always-loaded entry chunk, despite otherwise-correct route-level code splitting

**CONFIRMED** (both by source inspection and by measuring the existing build output). Both apps correctly `lazy()`-load every route (`admin/src/App.tsx:17-31`, `storefront/src/App.tsx:14-22`), and the built `dist/` output proves it — each page is its own chunk (e.g. `admin/dist/assets/CatalogGraph-DW-E6ISU.js` 45KB, `ThemeStudio-Cfx8dDpx.js` 26KB; `storefront/dist/assets/ProductDetail-BnjjasdE.js` 20KB, `Catalog-DeVBoXyO.js` 11KB). The problem is what's *not* split: the main entry chunk is still

| App | Entry chunk (raw) | gzip | Vite's >500KB warning threshold |
|---|---|---|---|
| `admin/dist/assets/index-BIe5kSgg.js` | 528 KB | 165 KB | exceeded |
| `storefront/dist/assets/index-ChhocE0T.js` | 456 KB | 144 KB | (close) |

This is not incidental — `framer-motion` is imported at module scope by components that are **not** lazy-loaded and sit in every route's render tree from first paint:
- Admin: `admin/src/components/Layout.tsx:2` (`import { motion } from 'framer-motion'`) — `Layout` is imported directly (not `lazy()`) in `App.tsx:10` and wraps every authenticated route.
- Storefront: `storefront/src/components/Navbar.tsx:4` (`import { motion, AnimatePresence } from 'framer-motion'`) and `storefront/src/App.tsx:5` (`import { MotionConfig } from 'framer-motion'`) — `Navbar` renders on every page (`App.tsx:40` inside the always-mounted `RoutedShell`).
- Admin only: `admin/src/App.tsx:5-6` also eagerly imports all of `aos` + its CSS (`import AOS from 'aos'; import 'aos/dist/aos.css'`) for scroll-triggered animation, again from the entry module.

Because these are static (non-dynamic) imports reachable from the entry point, Rollup's default chunking has no choice but to fold the full `framer-motion` (and, for admin, `aos`) bundle into the entry chunk — it ships on **every** route, including ones with almost no motion (e.g. `NotFound`, `OrderTracking`). Neither `vite.config.ts` (admin or storefront) defines `build.rollupOptions.output.manualChunks`, so there is also no separate long-term-cacheable vendor chunk — any app-code change invalidates the same ~500KB blob users have to redownload.

**Impact (reasoned):** on a cold visit, the browser must fetch and parse ~144-165KB (gzip) of vendor JS before the app can render *anything*, on every single route, purely because two eagerly-mounted shell components (`Layout`/`Navbar`) import the full animation library instead of a trimmed subset.

**Fix:**
- Switch `framer-motion`'s full API to `LazyMotion` + the `m` component with `domAnimation` (or `domMax` only where needed) — this is documented to shrink framer-motion's footprint from ~34KB to ~6KB gzip for the common case, since `Layout`/`Navbar` only need simple hover/tap/AnimatePresence transitions, not the full feature set that heavier pages (`ThemeStudio`, `CatalogGraph`) may want.
- Defer `AOS.init()` (and its CSS) behind a dynamic `import('aos')` triggered after first paint, or drop it from the entry and only load it on pages that actually use scroll-reveal.
- Add `build.rollupOptions.output.manualChunks` to split `react`/`react-dom`/`react-router-dom` into a stable `vendor` chunk separate from app code, improving cache hit rate across deploys.

---

### 5. MEDIUM — Connection-pool ceiling across API + 4 workers sits at exactly Postgres's default `max_connections`, with zero headroom

**CONFIRMED.** `api/core/config.py:16-18`: `db_pool_size: int = 10`, `db_max_overflow: int = 10` (defaults, not overridden by `.env.example` inspection needed — these are the values used unless explicitly set). `api/core/db.py:32-39` applies these to the SQLAlchemy engine on the non-serverless (Docker Compose) path — i.e. **every process that imports `api.core.db`** gets its own pool sized `10 + 10 = 20` connections at the ceiling.

`workers/event_worker.py:21`, `workers/reservation_worker.py:21`, `workers/scraper_worker.py:27`, `workers/intel_worker.py:29` all `from api.core.db import SessionLocal` — each worker is its **own OS process** (`docker-compose.yml:37,62,80,113,134` run `api`, `event_worker`, `reservation_worker`, `scraper_worker`, `intel_worker` as five separate `command:` entries under `restart: unless-stopped`, no shared process), so each gets an independent engine/pool instance, not a shared one.

Five processes × 20-connection ceiling = **100 connections**, and `docker-compose.yml:3` runs plain `image: postgres:16-alpine` with no `command:`-level `max_connections` override, i.e. Postgres 16's compiled default of **100**. The configured pool ceilings alone can reach the server's entire connection budget, leaving zero headroom for `psql`, health checks, or a migration runner connecting concurrently — a burst of concurrent admin + storefront traffic hitting overflow on the API process at the same time a worker is mid-overflow could produce `FATAL: too many connections` platform-wide.

**Impact (reasoned, not observed under load):** in steady state, actual open connections are far below the ceiling (each worker mostly holds 0-1 connections at a time via short-lived `async with SessionLocal()` blocks), so this is a *latent capacity* risk rather than a live incident — but it is one bad traffic spike away from taking down every process at once, and the current numbers give no safety margin to detect the problem before it's total.

**Fix:** lower `db_pool_size`/`db_max_overflow` for the four worker processes specifically (they don't need 20 connections each — they process one claim batch at a time), or raise Postgres `max_connections` in `docker-compose.yml`, and add monitoring/alerting on `pg_stat_activity` connection count before it's needed in anger.

---

### 6. MEDIUM — Admin Orders list has no index for its own default (unfiltered) view; polled every 20s

**CONFIRMED.** `api/routes/orders.py:68-96` (`list_orders`): with no `status` query param — the console's default landing state — the query is `SELECT ... FROM orders WHERE store_id = :store_id ORDER BY created_at DESC LIMIT :limit OFFSET :offset`. The only relevant index is the composite `idx_orders_store_status ON orders(store_id, status, created_at DESC)` (`db/migrations/005_stores.sql:203`) — this index is sorted by `created_at` *within each `status` bucket*, so it cannot be walked to satisfy a store-wide `ORDER BY created_at DESC` across all statuses without a separate sort step. There is no `(store_id, created_at DESC)` index. `admin/src/pages/Orders.tsx:25` polls this endpoint every 20 seconds (`refetchInterval: 20_000`), so the unfiltered/default view of the Orders page pays an in-memory sort of the store's full order history on every poll rather than a pure index walk.

**Impact (reasoned):** low severity today (order volume per store is presumably in the hundreds/low-thousands), but it's the *default* landing view of the most business-critical admin page, and it will degrade linearly with order-history growth since (unlike jobs) orders are never archived either.

**Fix:** add `CREATE INDEX idx_orders_store_created ON orders(store_id, created_at DESC)`.

---

### 7. LOW-MEDIUM — Same correlated-subquery-in-`ORDER BY` pattern repeats in `catalog.py`'s `featured_products`

**CONFIRMED**, smaller blast radius than #2. `api/routes/catalog.py:274-312` (`GET /products/featured`) sorts by a correlated `EXISTS` check for a primary image:

```sql
ORDER BY (
    (CASE WHEN EXISTS (
        SELECT 1 FROM product_media m
         WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED'
    ) THEN 1 ELSE 0 END)
) DESC, p.completeness_score DESC, p.updated_at DESC
LIMIT :lim
```

Because the `EXISTS` is part of the sort key, Postgres must evaluate it for every `ACTIVE` product in the store before it can determine the top `:lim` (default 12) — same class of issue as #2, but bounded to `status = 'ACTIVE'` products only (smaller working set) and this endpoint is the storefront homepage hero, which is a good caching candidate since it changes rarely.

`catalog_graph` (`catalog.py:87-271`) has the same subquery-per-row shape for its `include_products=true` path (`catalog.py:203-217`), but there the `ORDER BY` is on plain columns (`p.completeness_score ASC, p.updated_at DESC`), not the subquery itself, and the endpoint hard-caps at `product_limit ≤ 4000` (`catalog.py:25,90,217`) — the correlated subquery there is much more likely to be evaluated only for the already-limited rows, since Postgres's planner can push `Limit` past a `Sort` on real columns. This one is **SUSPECTED low-impact**, listed only because it shares the same code pattern as #2/#7 and is worth fixing at the same time.

**Fix:** cache `GET /products/featured` (it's a homepage hero, changes infrequently) with a short TTL; replace the `EXISTS`-in-`ORDER BY` with a materialized `has_primary_image` boolean maintained by a trigger, or just drop primary-image presence from the sort key.

---

### 8. LOW — Google Fonts loaded render-blocking with more weights than the app actually uses

**CONFIRMED.** Both `storefront/index.html:12` and `admin/index.html:12` load an identical Google Fonts stylesheet synchronously in `<head>` (with `preconnect` hints, but still a blocking third-party stylesheet fetch before first paint):

```
Inter:wght@300;400;500;600;700;800;900                              (7 weights)
Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800;12..96,900  (5 weight instances)
JetBrains+Mono:wght@400;500;700                                     (3 weights)
```

15 weight declarations across 3 families. A grep of actually-used Tailwind font-weight utility classes in each app's source:

```
storefront: font-bold(63) font-black(50) font-semibold(5) font-medium(4)   — 4 distinct weights
admin:      font-bold(101) font-black(46) font-semibold(28) font-medium(13) — 4 distinct weights
```

Weights `300` and `800` for Inter do not appear as any Tailwind utility class in either app's `.tsx`/`.css` (only `font-medium`/`400→500` mapping caveat aside — this is a grep of class *names*, not a proof that weight 300/800 is unreachable via some arbitrary inline style, but no such usage was found either). `display=swap` is already correctly set, so this isn't causing invisible text, but it is downloading font weight variants that the grep evidence suggests are unused, and doing so via a render-adjacent third-party request that a self-hosted `@fontsource` package or `next/font`-style subsetting would avoid entirely.

**Fix:** trim the Google Fonts URL to the 4 weights actually used per family (or self-host the specific static/variable subset via `@fontsource-variable`), and consider `font-display: optional` for the display/mono faces if a flash of restyled text is undesirable.

---

### 9. Reviewed, not a bottleneck — serverless cold start / `NullPool`

**CONFIRMED as a deliberate, correctly-implemented trade-off, not a bug.** `api/core/db.py:18-30` uses `NullPool` + `statement_cache_size=0` only when `db_serverless=true` (Vercel), which is the documented-correct pattern for Neon's pgbouncer-style transaction pooling (`db.py:19-23` docstring is accurate). `api/index.py:7-13` correctly avoids importing the Playwright/worker-heavy code path at API load time — verified: `api/routes/scraper.py` and `api/routes/intel.py` (the two routers that eventually reach the scraper engine) only import `httpx`/`fastapi`/`sqlalchemy` at module scope (grep confirms no `playwright` import anywhere under `api/routes/` or transitively from `api/main.py`'s 16 router imports); the actual Playwright-dependent code lives in `api/services/scraper/` and `api/services/full_intel.py`, imported only by the worker processes, which Vercel never runs. So the serverless function's cold-start import graph stays lean by design.

The one real (and already-documented) cost: every serverless invocation opens a fresh TCP+TLS+auth connection to Neon (no pooling reuse across invocations by construction) and disables asyncpg's prepared-statement cache, so every query pays a full parse/plan round trip instead of reusing a cached plan. This is the necessary price of the NullPool/pgbouncer combination and isn't fixable without introducing a connection pooler Vercel can share across invocations (e.g. Neon's own pooled connection string, PgBouncer-as-a-service) — worth flagging as inherent, not as something to "fix" in this codebase.

---

## What's already right (worth preserving)

- Both frontends do correct route-level `lazy()` code splitting — confirmed by the per-page chunks in the built `dist/` output.
- `admin/src/pages/Products.tsx` and `admin/src/pages/Orders.tsx` use `@tanstack/react-virtual` for their row lists — large tables don't render off-screen DOM.
- `storefront/src/components/SearchBox.tsx:25` correctly debounces (220ms) before querying — the admin equivalent (finding #2) does not.
- Most catalog `<img>` tags already carry `loading="lazy"` (`ProductCard.tsx:35`, `ProductGallery.tsx:111`, `SearchBox.tsx:118`, several admin list views), and image containers use CSS `aspect-square`/`aspect-[4/3]` classes to reserve layout space, avoiding CLS even without explicit `width`/`height` attributes.
- `POST /offers/availability` (`api/routes/public_orders.py:30-105`, the cart re-validation endpoint hit on every cart visit) is a single batched query keyed on `= ANY(:ids)` capped at 100 items — no N+1 here despite superficially looking like a candidate for one.
- `admin/src/pages/CatalogGraph.tsx` (the heaviest single page, force-directed graph over up to 4000 nodes) renders via `<canvas>` with a manually-throttled re-render tick (`force(v => v+1)` only every 2nd simulation tick, `CatalogGraph.tsx:257-260`) rather than one React node per graph element — the right architecture for this workload.
- React Query defaults (`staleTime: 30s`, `refetchOnWindowFocus: false` in both apps) are sensible and avoid unnecessary background refetch chatter outside the specific polling cases called out above.

---

*Performance audit prepared 2026-07-31. Read-only — no source file modified. All file:line citations were read directly from source; bundle sizes were measured from the repository's existing build output rather than a fresh rebuild.*
