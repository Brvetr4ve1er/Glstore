# Architecture Map — Ghir Laffaire

ASCII diagrams. Source-of-truth for "where does X live and what calls it."

---

## 1. Component diagram (process boundaries)

```
                                    ╔══════════════════════════════════════╗
                                    ║         BROWSER (no auth)             ║
                                    ║  storefront/  React 19 · Vite · TS   ║
                                    ║  · localStorage cart                 ║
                                    ║  · TanStack Query                    ║
                                    ║  · Framer Motion                     ║
                                    ╚══════════════════╤═══════════════════╝
                                                       │ /api/v1/* (no auth)
                                                       │ /products, /categories,
                                                       │ /products/featured,
                                                       │ /orders/create,
                                                       │ /price-bounds, /brands/public
                                                       │
                                                       │
   ╔═══════════════════════════╗                       │           ╔═══════════════════════════╗
   ║  BROWSER (admin)           ║                       │           ║   FILE STORAGE             ║
   ║  admin/  JWT-protected     ║                       │           ║   Cloudflare R2 (planned)  ║
   ║  · TanStack Query          ║                       │           ║   product images           ║
   ║  · Framer Motion           ║                       │           ╚═════════╤═════════════════╝
   ╚═════════════╤══════════════╝                       │                     │
                 │  Bearer JWT                          │                     │ image URLs only
                 │  /api/v1/*                           │                     │ stored in DB
                 │  (all admin paths)                   │                     │
                 │                                       │                     │
                 ▼                                       ▼                     │
   ╔═══════════════════════════════════════════════════════════════════════════════════════╗
   ║                              FastAPI service  (api/)                                   ║
   ║  ─────────────────────────────────────────────────────────────────────────────────    ║
   ║  middleware: request-id · rate-limit · CORS · GZip · security headers                  ║
   ║  routes/                                                                               ║
   ║    auth · products · products_import · orders · events · enrichment · issues          ║
   ║    settings · scraper · catalog                                                         ║
   ║  services/                                                                             ║
   ║    orders · events · csv_parser · csv_import                                           ║
   ║    enrichment · enrichment_runner · validator                                          ║
   ║    llm · llm_enrichment                                                                 ║
   ║    scraper/{engine, search, ranker, fetcher, tiers/, extractors/, validators/, utils/} ║
   ║  core/                                                                                  ║
   ║    config · db · security · ratelimit                                                   ║
   ╚═════════════════════════════╤═════════════════════════════════════════════════════════╝
                                 │ asyncpg
                                 │
                ┌────────────────┼─────────────────┐
                ▼                ▼                  ▼
     ╔═══════════════════╗  ╔══════════════════╗  ╔══════════════════════╗
     ║   PostgreSQL 16    ║  ║   SearXNG         ║  ║  External LLM         ║
     ║   ─────────────────║  ║   ────────────    ║  ║  (Ollama / OpenAI /   ║
     ║   products         ║  ║   self-hosted      ║  ║   Anthropic / etc.)   ║
     ║   offers           ║  ║   meta-search      ║  ║                       ║
     ║   product_media    ║  ║   :8080            ║  ║   url, model, key in  ║
     ║   observations     ║  ╚══════════════════╝  ║   app_settings        ║
     ║   customers        ║                          ╚══════════════════════╝
     ║   orders           ║                                    ▲
     ║   order_items      ║                                    │ chat()
     ║   inventory_       ║                                    │
     ║     reservations   ║                                    │
     ║   events           ║                                    │
     ║   sync_queue       ║                                    │
     ║   admin_users      ║                                    │
     ║   app_settings     ║                                    │
     ║   scrape_jobs      ║                                    │
     ║   scrape_sources   ║                                    │
     ║   competitor_      ║                                    │
     ║     prices         ║                                    │
     ║   scrape_domain_   ║                                    │
     ║     state          ║                                    │
     ╚═════════╤═════════╝                                    │
               │                                                │
               │ FOR UPDATE SKIP LOCKED  (workers claim work)   │
               │                                                │
   ┌───────────┴────────────┬───────────────┬────────────────┬───────────────────┘
   ▼                        ▼               ▼                ▼
╔═══════════════════╗  ╔═══════════════════╗  ╔══════════════════════════════════╗  ╔═══════════════════════════════╗
║ event_worker      ║  ║ reservation_      ║  ║ scraper_worker                    ║  ║ intel_worker                   ║
║ ────────────────  ║  ║ worker            ║  ║ ────────────────────────────────  ║  ║ ──────────────────────────────  ║
║ polls events      ║  ║ ────────────────  ║  ║ polls scrape_jobs                ║  ║ polls intel_jobs (Phase 9)     ║
║ runs handlers     ║  ║ every 30s:        ║  ║ runs ScraperEngine.run_job()      ║  ║ runs full_intel.enrich_full_   ║
║ writes sync_queue ║  ║   fn_expire_      ║  ║ uses Playwright + httpx          ║  ║   intel(): scrape→LLM→merge    ║
║                   ║  ║   stale_          ║  ║ talks to SearXNG + external LLMs ║  ║ tiered overwrite + img PENDING ║
╚═══════════════════╝  ║   reservations()  ║  ║ heavier image (Chromium)         ║  ║ heartbeat 60s · stale 5m       ║
                       ╚═══════════════════╝  ╚══════════════════════════════════╝  ╚═══════════════════════════════╝
```

**Process boundaries:**
- 1 × `api`               (uvicorn, can scale horizontally except for in-process rate limiter)
- 1 × `db`                (PostgreSQL 16, single primary)
- 1 × `searxng`           (federated meta-search)
- N × `event_worker`      (default 1, scale via `--scale`)
- 1 × `reservation_worker` (single instance enough — only releases stale holds)
- N × `scraper_worker`    (default 1, scale via `--scale`)
- N × `intel_worker`      (default 1, scale via `--scale` — claims `intel_jobs` with `FOR UPDATE SKIP LOCKED`)

---

## 2. Data flow — write path (CSV import → product live)

```
[Admin opens /products/import]
                │
                ▼
       Drag CSV onto drop zone
                │
                ▼
   POST /api/v1/products/import/preview  (multipart)
                │
                ▼
   csv_parser.parse(text)               ← pure
                │
                ▼
   csv_import.preview_import(db, rows)  ← read-only DB
                │
                ▼
       JSON: diagnostic + report + 20-row sample
                │
                ▼
       Admin reviews → clicks "Commit"
                │
                ▼
   POST /api/v1/products/import/commit?auto_enrich=true
                │
                ▼
   csv_import.commit_import(db, rows)
                │
                │  for each row:
                │    SELECT product by sku
                │    if exists → UPDATE
                │    else → INSERT (with slug cascade)
                │    upsert offer by variant_sku
                │
                ▼
   db.commit()       ← single transaction for the batch
                │
                ▼
   if auto_enrich:
     enrichment_runner.enrich_many()
                │
                │ for each product (RAW/NORMALIZED/NEEDS_FIX):
                │   load facts (brand, category, specs, has_price, has_stock, has_image)
                │   enrich(name, ...)                          ← pure rule engine
                │   UPDATE products SET brand, category, specs, status, completeness
                │   INSERT observations × N
                ▼
       JSON: { diagnostic, report, enrichment }
                │
                ▼
       Admin sees:
       - 567 created · 0 updated · 0 blocked
       - 412 CLASSIFIED · 89 VERIFIED · 66 NEEDS_FIX
       - avg completeness 0.30 → 0.68
```

---

## 3. Data flow — read path (storefront browse → buy)

```
[Customer opens https://ghirlaffaire.dz/]
                │
                ▼
   GET /api/v1/categories                       ← navbar mega-menu
   GET /api/v1/products/featured?limit=12        ← hero strip
                │
                ▼
   Customer types in SearchBox (Cmd-K)
                │ debounced 220ms
                ▼
   GET /api/v1/products?q=samsung&page_size=6
                │
                ▼
   Autocomplete dropdown shows 6 hits with thumbs
                │
                ▼
   Customer clicks a result → navigates to /p/{slug}
                │
                ▼
   GET /api/v1/products/{slug}
                │
                │  returns:
                │   - product header
                │   - active offers (variant + price + stock)
                │   - media (image URLs)
                │   - specs (incl. _seo_description, _pros, _cons,
                │            _selling_angles, _buyer_fit, _recommendation
                │            from LLM enrichment)
                ▼
   ProductDetail.tsx renders:
   ├── ProductGallery (hover-lens zoom + click-fullscreen)
   ├── Buy box (variant picker · qty stepper · "Ajouter" + "Commander")
   ├── Editorial body (description · pull-quote hooks · pros/cons)
   └── Related products (same category, exclude self)
                │
                ▼
   Customer clicks "Commander" → cart pre-validated → /cart
                │
                ▼
   Cart page (localStorage state) → /checkout
                │
                ▼
   Form: name · phone · email? · wilaya · commune · street · notes
                │
                ▼
   POST /api/v1/orders/create
   { customer_*, items:[{offer_id, quantity}], shipping_address, idempotency_key }
                │
                ▼
   ┌───────────────────────────────────────────────────────────┐
   │ services/orders.py:create_order                            │
   │                                                             │
   │ upsert_customer (dedupe by phone_normalized)               │
   │   ↓                                                         │
   │ SELECT offers WHERE id = ANY(ids) FOR UPDATE  ← row-lock   │
   │   ↓                                                         │
   │ INSERT orders (status='PENDING')                           │
   │ INSERT order_items × N                                     │
   │ fn_reserve_stock × N                                       │
   │   ↓ atomic UPDATE offers SET reserved_quantity += qty      │
   │   ↓ CHECK (reserved <= stock) — fails if oversold          │
   │ UPDATE orders SET status='RESERVED'                        │
   │ emit_event('order.created') → INSERT events                │
   │ COMMIT                                                      │
   └───────────────────────────────────────────────────────────┘
                │
                ▼
   200 OK { id, order_number, status='RESERVED', items, total, ... }
                │
                ▼
   Storefront clears cart + navigates to /order/confirmation/{id}
                │
                ▼
   Confirmation page shows order # + items + "agent vous appellera"
                │
                ▼
   (asynchronously)
   event_worker polls events table:
     handles 'order.created' → INSERT sync_queue (n8n outgoing)
     mark event COMPLETED
                │
                ▼
   (operations side)
   Admin sees new order in /orders, calls customer, marks PACKED → SHIPPED → DELIVERED
   On DELIVERED, fn_consume_reservation reduces stock_quantity (final)
   On CANCEL, fn_release_reservation returns the stock
```

---

## 4. Scraper pipeline (single job, end-to-end)

```
POST /api/v1/products/{id}/scrape
        │
        ▼
INSERT scrape_jobs (status='PENDING', expected_price, intents=[commercial, technical, review])
        │
        │  202 Accepted { job_id, status: PENDING }
        │
        │  (storefront / admin polls or wait=true)
        │
        ▼  scraper_worker._claim_one()
        │
   ┌────────────────────────────────────────────────────────────────────┐
   │  UPDATE scrape_jobs SET status='CLAIMED', claimed_by=worker_id      │
   │  WHERE id IN (                                                       │
   │      SELECT id FROM scrape_jobs                                      │
   │       WHERE status='PENDING'                                         │
   │       FOR UPDATE SKIP LOCKED LIMIT 1                                 │
   │  ) RETURNING ...                                                     │
   └────────────────────────────────────────────────────────────────────┘
        │
        ▼  engine.run_job(db, job_input)
        │
        ├── load_target(product_id)
        │     → ProductTarget (id, sku, name, brand, model, category, expected_price)
        │
        ├── for intent in [commercial, technical, review]:
        │       q = build_query(target, intent)
        │       results.extend(search.search(q))
        │
        │     ┌──────────────────────────────────────────┐
        │     │  search.search() backend cascade:        │
        │     │    1. SearXNG  (primary)                  │
        │     │    2. Brave    (if api_key configured)    │
        │     │    3. DDG-HTML (free fallback)            │
        │     └──────────────────────────────────────────┘
        │
        ├── selected = ranker.rank_and_diversify(results, max=6)
        │     ┌──────────────────────────────────────────┐
        │     │  Quotas (configurable):                   │
        │     │    1 official (Condor/Brandt/Samsung…)    │
        │     │    3 retailer (Jumia/Batolis/El Hamiz…)   │
        │     │    1 aggregator (PrixAlgérie/Diardzair)   │
        │     │    1 classified (Ouedkniss)               │
        │     │    1 review                                │
        │     │    + general fillers up to max_total      │
        │     └──────────────────────────────────────────┘
        │
        ├── for url in selected (parallel sem=3):
        │       fetched = fetcher.fetch(url, tier)
        │
        │       ┌────────────────────────────────────────────┐
        │       │ fetcher.fetch() decision tree:               │
        │       │                                              │
        │       │  cache hit?      → return                    │
        │       │  robots disallow → return failed             │
        │       │  rate-limit cooldown? → wait or skip         │
        │       │                                              │
        │       │  start_tier:                                 │
        │       │    PROTECTED_DOMAINS (Ouedkniss) → tier 3    │
        │       │    JS_HEAVY_DOMAINS  (Aliexpress) → tier 2   │
        │       │    else                            → tier 1   │
        │       │                                              │
        │       │  for tier in [start..4]:                     │
        │       │    r = run_tier(url)                         │
        │       │    if r.ok && r.confidence_hint >= 0.6:      │
        │       │        return r                              │
        │       │    if r.ok && tier >= 2 && hint >= 0.4:      │
        │       │        return r  (good enough)               │
        │       │    if tier == 3 && !tier4_enabled:           │
        │       │        return r  (no further escalation)     │
        │       │  return last  (all tiers exhausted)          │
        │       └────────────────────────────────────────────┘
        │
        │       extracted = extractors.extract(fetched.html, url)
        │
        │       ┌────────────────────────────────────────────┐
        │       │ extractors.extract() pipeline:              │
        │       │                                              │
        │       │  domain registry hit?                        │
        │       │    YES → use jumia/ouedkniss/condor/batolis  │
        │       │    NO  → use generic                         │
        │       │                                              │
        │       │  generic runs 4 passes, picks best:          │
        │       │    1. JSON-LD (schema.org Product) conf 0.92 │
        │       │    2. Microdata                    conf 0.80 │
        │       │    3. OpenGraph                    conf 0.65 │
        │       │    4. CSS heuristics + regex       conf 0.42 │
        │       │                                              │
        │       │  Domain extractor calls generic first,       │
        │       │  then overrides title/price/specs as needed. │
        │       └────────────────────────────────────────────┘
        │
        │       verdict = price_validator.validate_one(extracted, tier, expected)
        │       if accepted: collect price into consensus pool
        │       INSERT scrape_sources (job_id, url, domain, tier, ...)
        │
        ├── consensus = price_validator.consensus_of(prices)
        │     → median, low, high, agreeing_count
        │
        ├── for each source: adjust confidence ±10% based on consensus agreement
        │
        ├── for each accepted source:
        │     INSERT competitor_prices (idempotent on (product, domain, day))
        │
        └── UPDATE scrape_jobs SET
              status='COMPLETED',
              completed_at=NOW(),
              summary={ sources_attempted, prices_found, median_price,
                        our_price, vs_market_pct, margin_alert, by_tier, ... }
        │
        ▼
   Admin sees Market tab on ProductDetail (when implemented):
   - median competitor price
   - delta vs ours (with hot-pink alert if > 10% above)
   - per-source list with confidence
   - sparkline of last 30d (uses competitor_prices time series)
```

---

## 5. State machines

### 5.1 Product status

```
   ┌───┐  csv_import (default)
   │RAW│ ────────────┐
   └─┬─┘             │
     │               │
     │ enrich()      │
     │ no brand or   │
     │ no category   │
     ▼               │
  ┌─────────┐        │
  │NEEDS_FIX│◄───────┘
  └────┬────┘
       │
       │  user fixes via admin
       │  (PATCH /products/{id})
       │  or re-runs enrichment
       ▼
  ┌──────────────┐
  │NORMALIZED    │  rule engine has run, brand+category present
  └──────┬───────┘
         │ enrich() finds brand AND category
         ▼
  ┌─────────────┐
  │CLASSIFIED   │
  └─────┬───────┘
        │ completeness ≥ 0.85 (or LLM enrich pushes it there)
        ▼
  ┌────────────┐
  │VERIFIED    │
  └─────┬──────┘
        │ admin manually flips to ACTIVE (storefront-visible)
        ▼
  ┌─────────┐
  │ ACTIVE  │  ← appears in storefront /products?status=ACTIVE
  └────┬────┘
       │
       │ admin DELETE (soft archive)
       ▼
  ┌──────────┐
  │ ARCHIVED │  terminal (not deleted, just hidden)
  └──────────┘
```

### 5.2 Order status

```
                                     ┌──────────────────────┐
                                     │ release reservation  │
   ┌───────┐                         │ (TTL expired or      │
   │PENDING│ ────[reserve_stock]────▶│  admin cancelled)    │
   └───┬───┘                         └─────────┬────────────┘
       │                                        │
       │ INSERT order_items + reservations       │
       │ fn_reserve_stock per item              │
       ▼                                         │
   ┌────────┐                                    │
   │RESERVED│ ─────────[admin clicks            │
   └───┬────┘            "Cancel"]──────────────┤
       │                                        │
       │  admin clicks "Confirm"                │
       │  fn_consume_reservation                │
       ▼                                        │
   ┌──────────┐                                 │
   │CONFIRMED │  reservations consumed,         │
   └──────┬───┘  stock_quantity reduced          │
          │                                      │
          ▼                                      │
   ┌──────────┐  ┌─────────┐  ┌─────────────┐   │
   │  PACKED  │→ │ SHIPPED │→ │  DELIVERED  │   │
   └─┬────────┘  └────┬────┘  └──────┬──────┘   │
     │                │                │          │
     │                │                │ rare:    │
     │                │                ▼          │
     │                │         ┌──────────────┐  │
     │                │         │   RETURNED    │  │
     │                │         └───────────────┘  │
     │                │                            │
     ▼                ▼                            ▼
   ┌────────────────────────────────────────────────────┐
   │                   CANCELLED                         │
   │  (before DELIVERED. release_reservation if active.) │
   └────────────────────────────────────────────────────┘
```

### 5.3 Scrape job status

```
   ┌───────┐
   │PENDING│  newly inserted
   └───┬───┘
       │ scraper_worker._claim_one()
       │ FOR UPDATE SKIP LOCKED
       ▼
   ┌────────┐
   │CLAIMED │  worker has the row
   └───┬────┘
       │ engine.run_job() begins
       ▼
   ┌────────┐
   │RUNNING │  search → fetch → extract in progress
   └───┬────┘
       │
       ├── OK ──▶ ┌──────────┐
       │          │COMPLETED │  summary written
       │          └──────────┘
       │
       └── exception ──▶ ┌────────┐
                         │ FAILED │  error_message + retry_count++
                         └────────┘

   (separate path)
   stale-claim sweeper:
     CLAIMED with claimed_at older than 5 min
     → reset to PENDING (race risk — see SYSTEM_AUDIT.md C-2)
```

---

## 6. Module dependency graph

```
                      ┌────────────────────┐
                      │   api/main.py       │
                      └─────────┬──────────┘
                                │ imports
                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ api/routes/                                                     │
   │  auth · products · products_import · orders · events            │
   │  enrichment · issues · settings · scraper · catalog              │
   └────────┬───────────────────────────────────────────────────────┘
            │ depends on
            ▼
   ┌──────────────────────────────────┐         ┌──────────────────────┐
   │ api/services/                     │         │ api/core/             │
   │  orders · events                  │         │  config · db          │
   │  csv_parser · csv_import          │         │  security · ratelimit │
   │  enrichment · enrichment_runner   │         └──────────────────────┘
   │  validator                         │
   │  llm · llm_enrichment              │
   │  scraper/{engine, search,          │
   │    ranker, fetcher, tiers/,        │
   │    extractors/, validators/,       │
   │    utils/}                          │
   └──────────────────────────────────┘
                        ▲
                        │ uses (worker side)
                        │
   ┌──────────────────────────────────┐
   │ workers/                          │
   │  event_worker                     │
   │  reservation_worker                │
   │  scraper_worker (uses scraper/)   │
   └──────────────────────────────────┘
```

**Forbidden imports (would break the layering):**
- `routes/` cannot import `workers/`
- `services/` cannot import `routes/`
- `services/scraper/` is self-contained — no other service may import from it
- `core/` cannot import anything from `services/` or `routes/`

The current code respects this layering. Don't break it.

---

## 7. Database ER (simplified)

```
admin_users
   │
   │ created_by  (informational)
   ▼
products ────┐
   │         │
   │ 1:N     │ 1:N
   ▼         ▼
offers    product_media
   │
   │ N:1 (rare — most stays at offer level)
   ▼
inventory_reservations
   │
   │ N:1
   ▼
order_items ─── M:N ───▶ orders ──── N:1 ──▶ customers
                            │
                            │ 1:N
                            ▼
                       financial_transactions

products  ◀──── N:1 ──── observations  (entity_id polymorphic)
offers    ◀──── N:1 ──── observations

products ─── 1:N ─── competitor_prices
products ─── 1:N ─── scrape_jobs ─── 1:N ─── scrape_sources

events           (event sourcing — no FK to anything; correlation_id strings)
sync_queue        (downstream outbox)

app_settings     (key-value JSONB; no FKs)
scrape_domain_state  (per-domain history; no FKs)
```

---

## 8. Ports / network surface

| Port | Service | Bind | Purpose |
|---|---|---|---|
| 5432 | postgres | 127.0.0.1 only | DB access (host-loopback only) |
| 8000 | api      | 0.0.0.0   | REST API |
| 8088 | searxng  | 127.0.0.1 only | meta-search (intra-network at `searxng:8080` — host-side moved to 8088 to avoid conflicts) |
| 5174 | admin (vite dev)      | host machine | admin SPA |
| 5173 | storefront (vite dev) | host machine | public SPA |

In production, only the storefront port + API port are exposed publicly (behind Caddy/Nginx + TLS).

---

## 9. Where to add new things

| You want to add... | Put it here |
|---|---|
| A new scraper extractor for `domain.tld` | `api/services/scraper/extractors/domain_tld.py` + register in `extractors/__init__.py` |
| A new scrape tier (e.g. residential proxy) | `api/services/scraper/tiers/tier5_residential.py` + extend `fetcher.py:_escalate` |
| A new admin route | `api/routes/yournew.py` + mount in `api/main.py` |
| A new background job type | `db/migrations/00X_yourjob.sql` (new job table) + `workers/yourjob_worker.py` |
| A new public storefront endpoint | `api/routes/catalog.py` (it's the public API surface) |
| A new product-issue rule | `api/services/validator.py:derive_issues` + matching frontend in `IssuePanel.tsx` |
| A new LLM backend | `api/services/llm.py` add `_yourbackend_chat()` + `_yourbackend_models()` + dispatch in `chat()` and `ping()` |
| A new admin page | `admin/src/pages/YourPage.tsx` + lazy-route in `admin/src/App.tsx` + nav entry in `Layout.tsx` |
| A new storefront page | `storefront/src/pages/YourPage.tsx` + lazy-route in `storefront/src/App.tsx` |
| A new brand to recognise | `api/services/enrichment.py` add to `KNOWN_BRANDS` tuple |
| A new domain tier mapping | `api/services/scraper/utils/domain.py` add to `_DOMAIN_TIERS` list (priority order matters) |

---

## 10. The one diagram for the meeting

```
                                  GHIR LAFFAIRE
                            ─────────────────────────

   Customer ──HTTP──▶ Storefront ──API──▶ FastAPI ──SQL──▶ Postgres
                                              │              ▲
                                              │              │
                       Admin ──API+JWT──▶ ────┤              │
                                              │              │
                                              │  enqueue jobs│
                                              ▼              │
                                       ┌──────────────────┐  │
                                       │  Workers (4)      │──┘
                                       │  events · reserv. │
                                       │  scraper · intel  │   ← intel = scrape+LLM+merge
                                       └──┬────────┬──────┘
                                          │        │
                                          ▼        ▼
                                    SearXNG   External LLMs
                                              (Ollama / OpenAI / …)
```

That's the system. Everything else is detail.

---

## 11. Phase 9 dataflows

### Full Intel pipeline (Push 1)

```
[Admin clicks "Full Intel" on a product]
            │
            ▼
   POST /api/v1/products/{id}/intel?wait=false
            │
            ▼ (route: api/routes/intel.py)
   INSERT INTO intel_jobs (product_id, status='PENDING', batch_id?)
            │
            ▼  ←── intel_worker polls (FOR UPDATE SKIP LOCKED)
   intel_worker._claim_one()
            │
            ▼   heartbeat task: every 60s UPDATE claimed_at = NOW()
   full_intel.enrich_full_intel():
       ├─ scraper.engine.run_job(product)   → up to 4 tiers
       ├─ llm.chat(extracted_html)          → JSON payload
       ├─ _apply_payload(merge_policy):
       │     · brand/category    : fill-only (preserve manual edits)
       │     · description       : overwrite if ≥20 chars
       │     · specs             : per-key merge (LLM keys with `_` prefix kept as aux)
       │     · images            : APPEND unique URLs as PENDING/SCRAPED
       │     · observations      : one row per filled field for audit
       └─ _recompute_status_and_completeness()
            │
            ▼
   UPDATE intel_jobs SET status='COMPLETED', completeness_after, fields_filled, images_added
            │
            ▼
   Admin UI polls /intel-jobs/{id} OR /intel-batches/{batch_id}
   (TanStack Query refetchInterval keyed off `is_terminal`)
```

### Image review (Push 2)

```
   intel_worker INSERTs scraped image URLs
            ▼
   product_media (status='PENDING', source='SCRAPED')
            │
            ▼
   Admin opens /products/{id}/images   OR  /images (global queue)
            │
            ▼
   POST /products/{id}/images/{img_id}/approve { is_primary: bool }
            │
            ▼   (route: api/routes/images.py)
   UPDATE product_media SET status='STORED', is_primary=...
   _recompute_status_and_completeness(product_id)        ← +10pt media credit
   INSERT INTO observations (field='image_approved', source='admin_review')
            │
            ▼
   Storefront immediately renders the image (queries `WHERE status='STORED'`)
```

### Health checks (Push 6)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  Three-tier health endpoint stack — k8s / ALB / Cloud Run convention │
   └──────────────────────────────────────────────────────────────────┘

   GET /healthz               GET /readyz                  GET /healthz/details
   (liveness, no auth)        (readiness, no auth)         (deep, admin JWT)
       │                          │                              │
       ▼                          ▼                              ▼
   { status: ok }              run readyz_checks(db, searxng)   run details_checks(...)
                                  │  asyncio.gather             │  asyncio.gather
                                  ▼                              ▼
                        ┌─────────┴─────────┐         ┌──────────┴───────────┐
                        │  db_probe (1s)    │         │  db_probe (1.5s)     │
                        │  searxng_probe    │         │  db_extended_probe   │
                        │      (2.5s)       │         │  searxng_probe (3s)  │
                        └─────────┬─────────┘         │  llm_probe (10s)     │
                                  │                    └──────────┬───────────┘
                                  ▼                                ▼
                          overall_ok():               { status, checks: [...] }
                              all required ok?           includes:
                                  │                       · queue depths
                                  ▼                       · migrations applied
                          200 OK | 503                    · LLM backend status

   docker-compose:
     api  ──healthcheck via /healthz──▶ "service_healthy"
                                              │
                              ┌───────────────┴───────────────┐
                              ▼               ▼                ▼
                        event_worker    scraper_worker    intel_worker
                            ↑                ↑                  ↑
                            └────────────────┴──────────────────┘
                            depends_on: api: service_healthy
                            (so migrations finish before workers
                             query schema-dependent tables)
```

### Theme persistence (Push 2 → expanded in Push 3)

```
   ┌─────────────────────────  TWO SCOPES  ─────────────────────────┐
   │  app_settings.key='admin.theme'      (admin console)            │
   │  app_settings.key='storefront.theme' (public storefront)        │
   └─────────────────────────────────────────────────────────────────┘

   Admin app first paint:
      admin/main.tsx ──▶ loadCachedTheme('admin') ──▶ applyTheme(cached, 'admin')
                                                     │
                                                     ▼
                              documentElement.style.setProperty('--color-…', …)
                                                     │
                                                     ▼
                              window.dispatch('gl:theme-changed')  ← canvas re-reads

   Admin on auth:
      App.tsx useEffect ──▶ fetchTheme('admin')   GET /api/v1/settings/theme?scope=admin
                                                     │  (admin-only, JWT)
                                                     ▼
                                               applyTheme(server, 'admin')

   Admin saves theme:
      ThemeStudio ──▶ saveTheme(cfg, scope)       PUT /api/v1/settings/theme?scope=…
                                                     │ (server validators per token kind)
                                                     ▼
                                       UPSERT app_settings (key=…)


   Storefront first paint:
      storefront/main.tsx ──▶ loadCached() ──▶ applyTheme(cached)
                                                     │
                                                     ▼
                              refreshThemeFromServer()  GET /api/v1/storefront/theme
                                                     │  (PUBLIC — no auth)
                                                     ▼
                                              applyTheme(server) + cache(server)


   Token registry (32):
      colors  : 6 palette + 5 surface + 3 text + 4 status + 3 bg-glow
      typo    : --font-{sans,display,mono}
      radii   : --radius-{sm,md,lg,xl,2xl,full}
      glass   : --glass-{blur,saturate,opacity}
      motion  : --duration-{fast,base,slow}
```
