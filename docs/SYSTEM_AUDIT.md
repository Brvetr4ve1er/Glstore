# System Audit — Ghir Laffaire

**Auditor:** staff-engineer review · brutally honest, no marketing tone.
**Date:** 2026-04-26.
**Scope:** entire repository (Foundation → Phase 6 storefront).
**Code surface:** ~3,900 lines Python (api + workers), ~5,000 lines TS (admin + storefront), 600 lines SQL.

---

## Executive Summary

### Maturity assessment

| Area | Maturity |
|---|---|
| Database schema | **Production-ready.** State machines, CHECK constraints, idempotent indexes, financial-safety constraints. |
| API write model | **Production-ready** for single-tenant, single-replica. Multi-replica needs Redis-backed rate limit + heartbeat. |
| Async workers | **Production-ready** patterns (FOR UPDATE SKIP LOCKED), but stale-claim recovery has a **race window**. |
| Rule-based enrichment | **Production-ready** for the Algerian DZ catalog targeted by the rules. |
| LLM enrichment | **Production-ready** for low-throughput. Lacks circuit breaker on bulk path. |
| Multi-tier scraper | **Functional prototype.** Tier escalation, robots/rate-limit, extractor cascade work. Not yet stress-tested. |
| Storefront | **Functional prototype.** Has a real sort/pagination bug (see C-1). Cart ↔ stock can drift. |
| Observability | **Structured logs + health endpoints (Phase 9 Pushes 4 + 6)** — JSON-on-stdout with request_id ContextVar; `/healthz`/`/readyz`/`/healthz/details` for liveness, readiness, and deep diagnostic. Metrics, traces, error reporting still pending. |
| Test coverage | **None.** Zero unit tests, zero integration tests, zero CI pipeline. |

**Overall verdict:** the system is structurally sound — better than the average "we'll fix it later" e-commerce starter — but it's at **"functional prototype"** maturity overall. It can run a small DZ store today (567-product-scale verified). It will hurt at multi-replica or 10K+ products without the C-list fixes below.

### Top 5 critical risks — ✅ ALL RESOLVED (fixes shipped 2026-04-26)

1. ✅ **C-1 · Catalog sort is per-page.** **FIXED** — `_SORT_CLAUSES` in `api/routes/products.py`. Backend handles `sort`, `in_stock`, `price_min`, `price_max`.
2. ✅ **C-2 · Scraper stale-claim race.** **FIXED** — `_heartbeat_loop` in `workers/scraper_worker.py` refreshes `claimed_at` every 60s. Threshold tightened to 3 min.
3. ✅ **C-3 · `observations` unbounded.** **FIXED** — `db/migrations/003_observations_retention.sql` + daily call from `reservation_worker`.
4. ✅ **C-4 · No frontend ErrorBoundary.** **FIXED** — class boundary on both admin + storefront, top-level + route-level (keyed on pathname).
5. ✅ **C-5 · Auth lockout DoS.** **FIXED** — `_IPFailTracker` sliding-window 10 fails / 5 min / IP. Returns 429 with `Retry-After`.

> Tests bootstrapped — **128/128 green** (110 pytest + 18 vitest).

---

## Architecture Analysis

### Strengths

| Strength | Evidence |
|---|---|
| **Pure functions where they matter** | `csv_parser.py`, `enrichment.py`, `validator.py`, `scraper/validators/normalization.py`, all `extractors/*` — none touch DB. Trivial to unit-test (we just don't have tests yet). |
| **State machine in the type system** | Order/payment/scrape statuses are PostgreSQL ENUMs. Invalid transitions cannot be represented. |
| **Concurrency-safe inventory** | `fn_reserve_stock` + `CHECK (reserved_quantity <= stock_quantity)`. Overselling is structurally impossible. |
| **Event sourcing for downstream sync** | `events` + `sync_queue` tables. Workers claim via `FOR UPDATE SKIP LOCKED`. |
| **Idempotency everywhere** | `idempotency_key UNIQUE` on orders. SKU-keyed upserts on import. Day-keyed unique on competitor_prices. Slug cascade fallback in csv_import. |
| **Tiered fallback in scraper** | Mirrors research-recommended cost ladder (httpx → playwright → stealth → paid). |
| **Cross-source consensus + tier-trust weighting** | `price_validator.consensus_of` + `TIER_TRUST` weights. Aligned with deep-research report. |
| **Hot reload dev infra** | docker-compose bind mounts + uvicorn `--reload` + Vite dev servers. No rebuild for code changes. |
| **Brand redesign clean** | Tokens in `index.css` (admin + storefront), reused via CSS variables. No magic values in components beyond Tailwind classes. |

### Weaknesses

| Weakness | Where | Severity |
|---|---|---|
| Catalog sort is page-local, not query-level | `storefront/src/pages/Catalog.tsx` lines ~52-66 | 🟥 critical UX bug |
| `/products` list does 3 correlated subqueries per row | `api/routes/products.py:list_products` | 🟧 fine at 567, slow at 10K |
| No GIN index on `products.name` despite `pg_trgm` extension | `db/schema.sql` | 🟧 search slows linearly with catalog size |
| `observations` no retention | `db/schema.sql` line 163 | 🟥 unbounded growth |
| Scraper rate limiter per-worker memory only | `api/services/scraper/utils/rate_limiter.py` | 🟧 multi-worker bypasses per-domain budget |
| Scraper `_release_stale` doesn't honor running workers | `workers/scraper_worker.py:_release_stale` | 🟥 race condition |
| Bulk LLM enrich has no circuit breaker, just count + break-on-connection-error | `api/routes/enrichment.py:enrich_llm_bulk` | 🟧 burns through quota on JSON-parse errors |
| No frontend ErrorBoundary | `admin/src/App.tsx`, `storefront/src/App.tsx` | 🟥 single render error = blank page |
| API keys stored as JSONB plaintext in `app_settings` | `app_settings.value` (Brave, tier4, LLM) | 🟧 dev acceptable, prod needs vault or env-only |
| Auth lockout per-account, not per-IP | `api/routes/auth.py` | 🟥 DoS vector |
| Cart ↔ live stock drift | `storefront/src/lib/cart.tsx` snapshots `available` at add-time | 🟧 add 5 of stock=1, fail at checkout |
| ~~Migration runner absent~~ → auto-applies on API startup with tamper detection + advisory lock (Phase 9 Push 5) | `api/core/migrations.py`, `db/migrations/000_migrations_table.sql` | 🟩 resolved |
| No tests anywhere | repo-wide | 🟥 future regressions invisible |
| ~~No structured logging~~ → JSON to stdout with request_id ContextVar (Phase 9 Push 4) | `api/core/logging.py` | 🟩 resolved · metrics still pending |

### Coupling map

```
                                ┌─────────────────┐
                                │  app_settings    │  shared config (LLM + scraper)
                                └────────┬────────┘
                                         │
        ┌───────────────────┬────────────┴────────────┬───────────────────────┐
        ▼                   ▼                         ▼                       ▼
   api/services/llm.py  api/services/      api/services/scraper/        api/services/
                        llm_enrichment.py  engine.py                    enrichment.py
                                │           │                           (rule-based;
                                │           │                            independent)
                                ▼           ▼
                          (couple) UPDATE products + INSERT observations
                                       │
                                       ▼
                                   products / observations / specs
```

**Healthy**: rule-engine (`enrichment.py`) is independent of LLM and scraper. Could be deleted without breaking the others.
**Healthy**: scraper engine is independent of products write-model except for `load_target` + `competitor_prices`.
**Concerning**: every enrichment path writes its own observations row — there is no single canonical observation-writer. Three places do it (`enrichment_runner._add_observation`, `llm_enrichment._add_observation`, `scraper/engine._persist_*`). Each has slightly different schema usage. **Suggested abstraction:** an `api/services/observations.py` with `record(db, *, entity, field, value, source, confidence)`.

### Hidden dependencies

1. **`scraper_worker` startup loads `scraper.config` once.** If you change config in admin while a worker is running, the worker keeps the old config until restart. Documented nowhere.
2. **The `app_settings` row for `llm.config` is auto-seeded** by the migration. If migration didn't run, `llm.load_config` defensively writes the default — but that means **the first LLM call after a fresh DB triggers an implicit write**. Surprising.
3. **Storefront cart `available` field is captured at add-time** and never refreshed. If the cart sits open for 24h, the displayed availability is stale.
4. **Admin and storefront both call the same `/api/v1/products`** but with different expectations: admin tolerates ARCHIVED visibility via `?status=...`; storefront assumes only ACTIVE. The default `WHERE status <> 'ARCHIVED'` happens to do the right thing for storefront but isn't documented.

---

## Data Flow Analysis

### Write paths

```
1. CSV Import (Phase 1)
   File → csv_parser.parse(text) [pure]
        → csv_import.preview_import(db, rows)   [no writes; returns report]
        → csv_import.commit_import(db, rows)    [SQL upsert by SKU]
        → optional: enrichment_runner.enrich_many() [updates products + observations]

2. Manual product (Phase 0)
   Admin form → POST /products → INSERT products + (optional) initial offer
              → PATCH /products/{id} → UPDATE products SET ... WHERE id
              → DELETE /products/{id}?hard=false → UPDATE status='ARCHIVED'

3. Rule enrichment (Phase 2)
   Trigger → enrichment_runner.enrich_one(db, product_id)
           → Load facts → enrich(name, ...) [pure]
           → UPDATE products + INSERT observations × N

4. LLM enrichment (Phase 4)
   Trigger → llm_enrichment.enrich_one(db, product_id)
           → load_facts → llm.chat(system, user) [external network]
           → JSON parse + repair
           → merge into products.specs (additive, never overwrite rule-engine keys)
           → UPDATE products.completeness_score (recomputed inline via SQL)
           → INSERT observations × N
           Failure modes: LLMError → 502, ValueError → 404

5. Scrape (Phase 5)
   POST /products/{id}/scrape → INSERT scrape_jobs (PENDING)
   ↓ scraper_worker polls
     → claim job (FOR UPDATE SKIP LOCKED)
     → engine.run_job:
         build queries × 3 intents
         search.search() → SearXNG → DDG fallback
         ranker.rank_and_diversify() → 6 URLs across tiers
         for each URL parallel sem=3:
             fetcher.fetch() → cache → robots → rate-limit → tier escalation
             extractors.extract() → json_ld → microdata → og → css
             price_validator.validate_one() → bounds + tier-weighting
         consensus_of(prices) → median + agreement
         INSERT scrape_sources × N
         INSERT competitor_prices × M (idempotent on day)
     → mark COMPLETED + summary

6. Order (storefront → backend)
   Cart (localStorage) → POST /orders/create
                       → upsert customer
                       → SELECT offers FOR UPDATE
                       → INSERT order + items
                       → fn_reserve_stock per item
                       → UPDATE orders SET status='RESERVED'
                       → emit_event('order.created')
   ↓ event_worker
     → INSERT sync_queue (n8n outgoing)
     → mark event COMPLETED
```

### Inefficiencies

| # | Path | Inefficiency | Cost today | Cost at 10× |
|---|---|---|---|---|
| D-1 | `GET /products?...` | 3 correlated subqueries per row (image, min_price, available) | <50ms @ 24 rows | seconds at 1K rows |
| D-2 | `csv_import.commit_import` | Per-row INSERT/UPDATE in a loop (no batch insert) | 567 products in ~3s | 10K in ~50s |
| D-3 | `enrichment_runner.enrich_many` | Per-product `enrich_one` round-trip | OK at 567 | 10K = ~5 min |
| D-4 | `Catalog.tsx` post-fetch sort | Sort client-side over page only | UX broken at any scale | UX broken at any scale |
| D-5 | `/orders/create` items loop | Per-item INSERT + reservation call | ~10ms × items | 100-item orders feel slow |
| D-6 | `scraper_worker` 1 job at a time | Sequential job processing | 90s × N jobs | scale workers, but per-domain rate limit fragments |

### Duplicated logic

| Logic | Where it lives |
|---|---|
| Price string parsing | `api/services/csv_parser.py:parse_number` AND `api/services/scraper/validators/normalization.py:parse_price` — two implementations, slightly different heuristics |
| Slugify | `api/routes/products.py:_slugify`, `api/services/csv_import.py:_slugify`, `storefront/src/lib/format.ts:slugify` (3 copies) |
| `fmtMoney` | `admin/src/lib/utils.ts` AND `storefront/src/lib/format.ts` (2 copies, identical) |
| Brand list / category patterns | `api/services/enrichment.py` only — **good**, single source |
| Domain tier classification | `api/services/scraper/utils/domain.py` — single source |
| Observation insertion | 3 places, slightly divergent schemas (see "Coupling map" above) |

### Inconsistent transformations

- `csv_parser.parse_number` accepts `89.900` as `89.9` (single dot, no thousands heuristic).
  `scraper.validators.normalization.parse_price` accepts `89.900` as `89900` (single-dot-+-3-digits → thousands).
  **They disagree.** csv_parser's heuristic is older. Should be unified.

---

## Risk Report

### Short-term risks (fix in the next 1-2 weeks)

| ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| S-1 | Catalog sort UX bug confuses customers | High | Medium | Move sort to backend (1h) |
| S-2 | Scraper double-runs same job during long fetches | Medium | Medium | Heartbeat in worker (1h) |
| S-3 | Frontend crashes on bad LLM JSON shape | Medium | High | ErrorBoundary (30 min) |
| S-4 | Auth lockout DoS targeting known admin emails | Medium | High | Per-IP rate limit on /auth/login (1h) |
| S-5 | observations table grows past 1M rows | High eventually | Low immediate, High eventual | Monthly partition + retention job (3h) |
| S-6 | Customer adds N to cart with stale availability | Medium | Low | Re-validate on cart visit + checkout (2h) |
| S-7 | Bulk LLM enrich hangs on a misconfigured endpoint | Medium | Medium | Add circuit breaker to /enrich-llm-bulk (1h) |
| S-8 | Storefront has no per-page SEO | Certain | Low (no traffic yet) | React Helmet per route (2h) |

### Long-term risks (12+ months)

| ID | Risk | Trigger |
|---|---|---|
| L-1 | `/products` list collapses past 50K SKUs | Add denormalized `catalog_read` table or `products_search` materialised view |
| L-2 | Single Postgres becomes contention point | Consider read replica + pgbouncer at 100K product / 1K concurrent |
| L-3 | In-process rate limiter fragments at multi-replica | Move to Redis + INCR/EXPIRE |
| L-4 | Playwright memory pressure on shared host | Move scraper_worker to dedicated node, pool browsers |
| L-5 | No tests = every refactor is dangerous | CI with pytest + vitest |
| L-6 | API keys in JSONB plaintext leak via DB backups | env-only or sealed-secrets |
| L-7 | observations queries get slow on 10M rows | Partition + per-partition indexes |
| L-8 | n8n integration assumes one tenant | If multi-tenant ever, sync_queue needs tenant_id |

---

## Technical Debt

### Active debt (will slow you within weeks)

1. **Three observation-writer implementations.** Refactor to single `services/observations.py`. ETA 1h, saves bug surface forever.
2. **Two price-parsers.** Unify `csv_parser.parse_number` and `scraper.validators.normalization.parse_price`. ETA 1h.
3. **No migration runner.** `db/migrations/` is just SQL files, manual `psql -f`. Worth ~3h to add a tiny version table + applier. Saves you the day someone forgets to run a migration in prod.
4. **No tests.** ETA 8-16h to bootstrap pytest + a few critical-path tests (csv parsing, price normalization, enrichment, order creation idempotency).
5. **Hardcoded thresholds** scattered (PAGE_SIZE in admin/storefront, margin alert pct, completeness weights). Move to a single `constants.py` per side.

### Latent debt (will bite at scale)

6. **Slug uniqueness fallback.** Cascade is `slug → slug-{sku} → slug-{uuid8}`. The first cascade can collide if two CSVs share an SKU prefix. Today's mitigation: SKU is unique. But if SKU policy changes (e.g. supplier-prefixed), this becomes fragile. ETA 30 min to switch to ID-suffix in all cases.
6. **No event idempotency on workers.** `event_worker` is idempotent on `event_id` (the row itself), but if a handler half-completes (insert sync_queue, fail to update events.status), the next claim re-runs the handler producing a duplicate sync row. Inserts in sync_queue need a unique key per (event_id).
7. **The CSV `--reload` watch in uvicorn picks up `.pyc` writes** and double-reloads. Minor, irritating in dev.
8. **scraper_worker restart drops in-memory rate-limit state.** Domains that were "cooling down" reset to "ready." Acceptable if rare.

### Cosmetic debt (don't bother yet)

9. SearchBox `Cmd-K` shortcut: works but conflicts with browser URL bar on some macOS Chrome versions.
10. Admin has duplicate brand catalog data (KNOWN_BRANDS in Python + brand catalog endpoint result). Different shapes, fine.
11. The `ScrollReveal` is a simple wrapper but its variant string union could be tightened.

---

## Anti-pattern scan

| Pattern | Found? | Where |
|---|---|---|
| God class | No | Largest service is `enrichment.py` (539 LOC) but it's split into clear sections |
| Implicit state | **Yes** — module-level singletons in `tiers/tier2_playwright.py` (`_pw`, `_browser`, `_unavailable_reason`). Acceptable for the worker process, but tests will need to reset them |
| Duplicated logic | **Yes** — see Technical Debt #1 + #2 |
| Hardcoded values | **Yes** — see #5 |
| Fragile selectors | **Mitigated** — domain extractors gracefully fall through to generic. New domains automatically use generic. |
| Missing abstractions | **Yes** — observation writer, see Technical Debt #1 |
| Magic strings | A few — issue codes (`'missing_brand'`, etc.) are constants in `validator.py` (good), but referenced as raw strings in TS frontend (`type IssueCode`). Keep in sync manually. |

---

## Scraper-Specific Risks

### Bot-detection vulnerability

**Current defenses:**
- Persistent Chromium browser in tier 2/3
- Stealth init script (hide webdriver, plugins, canvas noise)
- Realistic UA + Accept-Language `fr-DZ,fr;q=0.9,en;q=0.8`
- Resource blocking (images/media/fonts) reduces footprint
- Per-domain rate limit (default 2s)
- Robots.txt honored

**Gaps:**
- No `playwright-stealth` library (estimated +10% on Cloudflare survival)
- No fingerprint randomization (canvas/webgl always returns same noise)
- User-Agent is identifiable as our bot (`GhirLaffaireBot/1.0`). This is **deliberately polite** (research-aligned) but means we'll get blocked from sites that scope-filter UAs. Trade-off accepted.
- No proxy pool by default. The `ProxyPool` is implemented but `app_settings.scraper.config.proxies = []` out of the box.

**Honest expected success rates:**
- Static HTML retailers (Condor, Brandt, Batolis): **~95%**
- Server-rendered Magento (Jumia DZ): **~90%**
- Cloudflare-protected (Ouedkniss): **~70-80%** without proxies
- AliExpress / Amazon: **~50%** without proxies, **~85%** with residential proxy + stealth

### Cache poisoning

**Current state:**
- Failed scrapes cached for 1h in-memory only. This is **per worker** — restart resets cache.
- DB-side `competitor_prices` is idempotent on `(product_id, source_domain, observed_at)` (day granularity). A bad price entered today **overwrites** until tomorrow.
- A single-source bad price doesn't poison the median (other sources outweigh it via tier-trust).
- A multi-source bad price (e.g. Cloudflare returns the same blocked-page price string) **could** propagate. Mitigated by the absolute floor (`100 DZD`) and ceiling (`100M DZD`).

**Gap:** no per-source dispute / blacklist. If `extra-stores-dz.com` consistently returns garbage, we have no way to mute it short of re-deploying with the domain removed from the registry.

### Missing validation layers

- ✅ Price bounds (relative + absolute)
- ✅ Currency filter (DZD-only into `competitor_prices`)
- ✅ Tier-trust weighting
- ✅ Cross-source consensus
- ❌ **Image URL validation** — we store URLs without checking if the image actually loads or is a placeholder/logo
- ❌ **Spec sanity** — LLM-generated specs are merged additively without sanity check (e.g. `screen_size: "1000 inches"` would persist)
- ❌ **Title relevance** — we don't verify the scraped title is actually the same product. If Jumia search returns a related-but-different SKU, we'll happily store its price as competitor data.

---

## Recommended Refactors (prioritized)

### 🟥 Critical — fix before next phase

1. **C-1 → Backend sort on `/products`.** Add `ORDER BY` clauses for `min_price ASC|DESC`, `completeness_score DESC`, `updated_at DESC`. Storefront passes `?sort=`. ~30 min.
2. **C-2 → Heartbeat for scraper workers.** Worker UPDATEs `claimed_at = NOW()` every 60s during a job. Sweeper threshold goes from 5 min to 3 min stale-since-claimed_at. ~1h.
3. **C-3 → observations retention.** A `prune_observations.sql` job that deletes rows older than 180d UNLESS they're the latest per `(entity_id, field, source)`. Schedule via cron in the reservation_worker process. ~2h.
4. **C-4 → Frontend ErrorBoundary.** Class component that catches render errors, shows brand-styled "something went wrong" with reload button. Wrap each route. ~30 min.
5. **C-5 → Per-IP rate limit on /auth/login.** Track failures per (IP, email) hash. After 10 failed attempts from one IP in 5 min, return 429 regardless of credential validity. ~1h.

### 🟧 Important — fix in the next sprint

6. **Single observation writer** — `api/services/observations.py:record(...)`. Replace 3 inline implementations.
7. **Unify price parsing** — `api/services/format.py:parse_price` shared by csv_parser and scraper validator.
8. **Migration runner** — version table + idempotent applier script. ~3h.
9. **Stock re-validation on storefront** — refetch `/products/{id}` once on cart visit and on checkout submit. Show toast + adjust qty if mismatch.
10. **Bulk LLM circuit breaker** — port the orbital-perihelion `enrichment-queue.ts` pattern: 3 fatal failures → trip → require manual reset.
11. **GIN index** on `products.name` and `products.brand`:
    ```sql
    CREATE INDEX products_name_trgm  ON products USING gin (name gin_trgm_ops);
    CREATE INDEX products_brand_trgm ON products USING gin (brand gin_trgm_ops);
    ```
12. **SEO metadata per route** on storefront via `<head>` updates (React 19 supports document metadata natively now).

### 🟨 Optional — when you have downtime

13. Streaming CSV parser for >16 MiB files.
14. Foreign-currency conversion via daily FX rate.
15. Move admin auth to httpOnly cookie.
16. `playwright-stealth` lib integration.
17. Sentry / structured logging / Prometheus metrics.
18. Test bootstrap (pytest + vitest).
19. Materialise `catalog_read` view when `/products` p95 > 200ms.

---

## What I would NOT change

- **The CQRS-shaped Write Model.** Keep direct reads from authoritative tables until measured slowdown. Premature read-model is worse than premature optimisation.
- **The brand identity.** Visual system is cohesive. Don't soften the punk.
- **The 3-intent search (commercial/technical/review).** It's the right multi-axis approach. Don't collapse to single-query.
- **The tier-trust weighting + cross-source consensus.** Research-aligned, robust.
- **The localStorage cart.** Server-side cart adds complexity for nothing. Keep it browser-side.
- **The COD-only checkout.** Algerian market reality. Add card later via webhook only.

---

## Final note

This codebase is in better shape than its age suggests. The architectural decisions have been deliberate and the fail-soft patterns are real (tiered fallback, circuit breakers in some paths, idempotent upserts everywhere). The gaps are **operational** (no tests, no observability, no migration runner) and **cosmetic** (a few duplicated helpers, a UX bug in catalog sort) — not architectural.

Fix C-1 through C-5, add the migration runner and observation-writer abstraction, and this is genuinely production-ready for the target market and scale (single-tenant, 1K-10K SKU range).

---

## Phase 9 audit addendum (Push 2)

| Concern | Resolution |
|---|---|
| **C-3 retention test** ("scrape image URLs flow into the catalog without provenance or human gate") | **Resolved** — Phase 9 Push 1 already routes scraped URLs into `product_media` with `source='SCRAPED'` and `status='PENDING'`. Push 2 adds `/products/{id}/images` and `/images` review queues so a human approves every image before it hits the storefront. Approval calls the canonical completeness recompute (no parallel formula). |
| **Duplicate completeness formulas** | **Resolved** — `api/routes/images.py` calls `api.services.full_intel._recompute_status_and_completeness` instead of inlining its own SQL. There are now two recompute paths (full_intel, llm_enrichment) and these will be unified once the observation-writer abstraction lands. |
| **Catalog graph hides unclassified products** | **Resolved (Push 1)** — the SQL filter that excluded `'Electromenager'` was removed; the graph now reveals where re-classification is still needed. Push 2 adds `?include_products=true` so individual orphaned products show up as their own nodes. |
| **Image-validity check** ("we trust returned URLs") | **Mitigated** — UI marks broken-URL cards (img onError fires) so the reviewer rejects them. Server-side mime/HEAD validation is still TODO if we want to block early. |
| **Theme injection vector** | **Mitigated** — server whitelists 18 specific CSS variables and applies a colour regex (`^#[0-9a-fA-F]{3,8}$|rgba?(...)$`). Only those keys reach `document.documentElement.style.setProperty()`. No arbitrary CSS, no URL values, no expression contexts. |

Push 2 did **not** add new risks worth raising in this audit. The graph rebuild and image queue are net additions; the theme module is small and the server-side whitelist keeps it safe.
