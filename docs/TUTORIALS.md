# Tutorials — Ghir Laffaire

Hands-on guides. Read these in order if you've never touched the codebase before. Skip to the section you need if you have.

> All commands assume `cwd = C:\Users\ROG STRIX\Desktop\antigravity\playground\GLstore` (Windows) or the equivalent absolute path on your machine.

---

## 0. Prerequisites

- **Docker Desktop** — for db + workers + scraper. Must be running before any `docker compose` command.
- **Node.js 20+** + **npm** — for `admin/` and `storefront/` dev servers.
- **Python 3.12+** — only needed for running `pytest` locally (none today). API + workers run inside Docker.
- **Ollama** *(optional)* — only if you want local LLM enrichment. https://ollama.ai
- A terminal that handles UTF-8 properly. On Windows, prefer Windows Terminal over `cmd.exe`.

---

## 1. Getting Started

### 1.1 First-time bootstrap (5 minutes)

```bash
# 1. Start the stack
docker compose up -d

# Wait for the DB to become healthy
docker compose logs -f db
# (Ctrl-C when you see "database system is ready to accept connections")
```

The first start runs `db/schema.sql` and `db/seed_admin.sql` automatically (via `docker-entrypoint-initdb.d`). Default admin credentials:

```
email:    brvetr4veler@gmail.com
password: brveadmin
```

### 1.2 Apply pending migrations (only on existing DBs)

If you already had a DB before Phase 4 / Phase 5 landed, the auto-applied schema is out of date. Apply migrations manually:

```bash
docker compose exec -T db psql -U glstore glstore < db/migrations/001_app_settings.sql
docker compose exec -T db psql -U glstore glstore < db/migrations/002_scraper.sql
```

Each migration is `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — safe to re-run.

### 1.3 Verify the API

```bash
curl http://localhost:8000/healthz
# {"status":"ok"}

curl http://localhost:8000/api/v1/categories
# {"items":[],"total":0}    ← empty until you import some products
```

### 1.4 Start the admin console

```bash
cd admin
npm install        # first time only
npm run dev        # http://localhost:5174
```

Log in with the credentials above.

### 1.5 Start the public storefront

```bash
# In a NEW terminal
cd storefront
npm install        # first time only
npm run dev        # http://localhost:5173
```

The storefront is anonymous — no login required.

### 1.6 Import the seed catalog

In the admin → **Products** → **Import CSV**. Drop `C:\Users\ROG STRIX\Documents\SHOPIFOO\inventory-raw.csv` (or any DZ supplier CSV) into the dropzone. Click **Commit 567 rows**. Auto-enrichment runs immediately.

You should now see ~567 products on the storefront homepage and category pages.

---

## 2. How Scraping Works (step by step)

This is the most complex pipeline in the system. Read it once, the rest is mechanical.

### 2.1 Conceptual model

A **scrape job** is one product's market-research run. Given a product, we:
1. Issue **3 search queries** (commercial, technical, review) against multiple search engines.
2. **Rank + diversify** results so we don't just hit Jumia six times.
3. **Fetch** the top 6 URLs in parallel.
4. **Extract** structured data from the HTML.
5. **Validate** prices (bounds + cross-source agreement).
6. **Persist** prices + sources + summary.

### 2.2 The tier ladder

For each URL, the fetcher decides at what tier to start:

```
needs_stealth(url) → start at Tier 3      (Ouedkniss, Cloudflare-protected)
needs_browser(url) → start at Tier 2      (Aliexpress, Amazon)
otherwise          → start at Tier 1      (most static / WP / WooCommerce sites)
```

Then escalates if the current tier returns `ok=False` or `confidence_hint < 0.6`.

| Tier | Module | What | Latency | Cost |
|---|---|---|---|---|
| 1 | `tier1_http.py`       | httpx + realistic headers + block-marker check | ~1s | free |
| 2 | `tier2_playwright.py` | persistent Chromium, resource-blocked | ~5s | free (CPU/RAM) |
| 3 | `tier3_stealth.py`    | tier 2 + stealth init + networkidle | ~10s | free |
| 4 | `tier4_paid.py`       | ScraperAPI / ScrapingBee / Zyte | ~5-15s | $0.001-0.01/req |

Tier 4 is **off by default**. Set `scraper.config.tier4_enabled = true` and provide an api_key to enable.

### 2.3 The extractor cascade

For each successfully-fetched HTML page:

```
extractors.extract(html, url):
    domain registry hit?
        YES → use {jumia|ouedkniss|condor|batolis}.extract()
        NO  → fall through to generic.extract()

    generic.extract() runs 4 passes, picks the highest-confidence one:
        1. JSON-LD (schema.org Product)              0.92
        2. Microdata (itemtype="…/Product")           0.80
        3. OpenGraph (og:price:amount, og:title, …)   0.65
        4. CSS heuristics + currency regex            0.42
```

If a domain extractor crashes, we silently fall back to generic with a note in `notes`. **Errors in one extractor never break the whole job.**

### 2.4 Confidence math

Per-source confidence after all stages:

```
confidence_final = extractor_self_rating  # 0.42 to 0.92
                 × tier_trust              # 0.40 (review) to 1.00 (official)
                 + close_to_expected_bonus # +0.05 if within 10% of our retail
                 ± consensus_adjustment    # +0.10 if within ±20% of median
                                             # -0.20 if outlier
```

Only sources with `confidence_final ≥ scraper.config.min_confidence_for_price` (default 0.6) flow into `competitor_prices`.

### 2.5 What happens when things fail

Read this. Internalise it. It will save you debugging time.

| Failure | Where it surfaces | What you see |
|---|---|---|
| Tier 1 returns 403 | `fetcher._escalate` | Auto-escalates to tier 2/3 |
| Tier 3 hits Cloudflare challenge | `tier2_playwright._is_blocked` | `blocked=True`, returns last result; if tier4 enabled, retry there |
| Robots.txt disallow | `fetcher.fetch` early return | `engine='robots_disallow'`, source persisted with the reason |
| Domain rate-limit cooldown | `RateLimiter.acquire` returns `(False, reason)` | Source persisted with `engine='rate_limited'` |
| Extractor crashes | `extractors.extract` try/except | Falls back to generic, notes recorded |
| Search returns 0 results | `search.search()` cascade exhausted | Job completes with `summary.sources_attempted=0` |
| All fetches time out | `engine.run_job` 90s wait_for | Job marked `RUNNING → FAILED` with `error_message='per-job timeout'` |
| Worker process killed mid-job | DB row stuck `CLAIMED` | `_release_stale` resets to PENDING after 5 min (⚠ race risk — see SYSTEM_AUDIT.md C-2) |

---

## 3. How to Test a Scraper

### 3.1 Test the parsers without network/DB (fastest)

```python
# C:\Users\ROG STRIX\Desktop\antigravity\playground\GLstore\scratch_test.py
from api.services.scraper.validators.normalization import parse_price
from api.services.scraper.extractors import generic
from api.services.scraper.utils.domain import classify_url

# Price normalization
print(parse_price("89.900 DZD"))   # → (Decimal('89900'), 'DZD')
print(parse_price("1.234,56 EUR")) # → (Decimal('1234.56'), 'EUR')

# Domain classification
print(classify_url("https://condor.dz/p"))      # → SourceTier.OFFICIAL
print(classify_url("https://www.ouedkniss.com")) # → SourceTier.CLASSIFIED

# Generic extractor
html = '''<html><head>
  <script type="application/ld+json">
  {"@type":"Product","name":"Test","offers":{"@type":"Offer","price":"42999","priceCurrency":"DZD"}}
  </script></head><body></body></html>'''
print(generic.extract(html, 'https://example.com/p'))
```

Run it inside the api container:

```bash
docker compose exec api python scratch_test.py
```

### 3.2 Test against the live API (no worker needed)

```bash
# Get a JWT
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"brvetr4veler@gmail.com","password":"brveadmin"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Pick any product ID from your catalog
PRODUCT_ID=$(curl -s "http://localhost:8000/api/v1/products?page_size=1" \
  | python -c "import sys,json;print(json.load(sys.stdin)['items'][0]['id'])")

# Enqueue a scrape; ?wait=true blocks up to 90s and returns the inline result
curl -X POST "http://localhost:8000/api/v1/products/$PRODUCT_ID/scrape?wait=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intents":["commercial","technical"],"max_sources":4}'
```

### 3.3 Test a single tier in isolation

If you suspect Tier 2 specifically, you can force it from a Python REPL inside the scraper container:

```bash
docker compose exec scraper_worker python
```

```python
import asyncio
from api.services.scraper.tiers import tier2_playwright

result = asyncio.run(tier2_playwright.fetch(
    "https://www.jumia.dz/refrigerateur-samsung-rt38k5400/",
    user_agent="GhirLaffaireBot/1.0",
))
print(result.ok, result.engine, result.fetch_ms, len(result.html))
```

### 3.4 Watch the worker live

```bash
docker compose logs -f scraper_worker
```

Useful log lines:
- `starting scraper worker host:pid` — worker booted
- `engine ready: searxng=… tier4=…` — config loaded
- `job <uuid>: searched 18 → selected 6 (target=Samsung 55…)` — search ran
- `fetch <url> tier=1 engine=httpx ok=True status=200 hint=0.95` — Tier 1 success
- `job <uuid> done: prices=4 median=89500 vs_market=0.039 alert=False in 12340ms` — completed

---

## 4. How to Add a New Extractor

Worked example: adding an extractor for `https://www.elhamizonline.com/` (a DZ retailer with custom Magento markup).

### 4.1 Decide if you actually need one

**Don't write a domain extractor unless the generic one demonstrably fails.** Run the generic on a real page first:

```python
# Inside scraper_worker container
import httpx, asyncio
from api.services.scraper.extractors import generic

async def test():
    async with httpx.AsyncClient() as c:
        r = await c.get("https://www.elhamizonline.com/some-product",
                        headers={"User-Agent": "GhirLaffaireBot/1.0"})
    return generic.extract(r.text, str(r.url))

print(asyncio.run(test()))
```

If price + title come out correctly with confidence ≥ 0.7, **stop here**. The generic is enough.

### 4.2 If generic fails — write the extractor

Create `api/services/scraper/extractors/elhamiz.py`:

```python
"""
El Hamiz Online extractor — research confidence 80 (DZ retailer).

Generic JSON-LD pickup misses their custom price wrapper. This override
pulls the price from .price-final-amount and the spec table from
section.product-specs.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from api.services.scraper.extractors import generic
from api.services.scraper.types import ExtractedData
from api.services.scraper.validators.normalization import parse_price


def extract(html: str, url: str) -> ExtractedData:
    base = generic.extract(html, url)
    soup = BeautifulSoup(html, "lxml")

    # Override price if generic missed it
    if not base.has_price():
        el = soup.select_one(".price-final-amount, .product-info-price .price")
        if el:
            p, c = parse_price(el.get_text(" ", strip=True))
            if p:
                base.price = p
                base.currency = c
                base.method = "domain_specific"

    # Pull spec table
    for tr in soup.select("section.product-specs tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) == 2:
            k = cells[0].get_text(strip=True).lower().replace(" ", "_")[:50]
            v = cells[1].get_text(strip=True)[:200]
            if k and v and k not in base.specs:
                base.specs[k] = v

    if base.has_price():
        base.confidence = max(base.confidence, 0.85)
        base.notes.append("source:elhamiz_custom")
    return base
```

### 4.3 Register it

Edit `api/services/scraper/extractors/__init__.py`:

```python
from api.services.scraper.extractors import elhamiz   # add import

DOMAIN_REGISTRY: dict[str, ExtractFn] = {
    "jumia.dz":          jumia.extract,
    "ouedkniss.com":     ouedkniss.extract,
    "condor.dz":         condor.extract,
    "batolis.com":       batolis.extract,
    "elhamizonline.com": elhamiz.extract,   # ← add
}
```

### 4.4 (Optional) Tag the domain

If El Hamiz isn't already in `utils/domain.py`, add it so the ranker tiers it correctly:

```python
# api/services/scraper/utils/domain.py
_DOMAIN_TIERS: list[tuple[str, SourceTier]] = [
    ...
    ("elhamizonline.com",   SourceTier.RETAILER),
    ...
]
```

### 4.5 Hot-reload + test

The scraper container has source bind-mounted, so you just need to restart the worker (Playwright doesn't hot-reload):

```bash
docker compose restart scraper_worker
docker compose logs -f scraper_worker
```

Trigger a scrape on a product whose top result is on elhamizonline.com (force one by editing the product name to match a known El Hamiz listing) and watch the logs. You should see:

```
fetch https://elhamizonline.com/... tier=1 engine=httpx ok=True
```

And in the resulting `scrape_sources` row, `extracted.method = "domain_specific"`.

---

## 5. How to Debug Failures

### 5.1 The job stays PENDING forever

**Cause 1:** Worker isn't running.
```bash
docker compose ps scraper_worker
# State should be "Up". If "Exit", check logs:
docker compose logs --tail 100 scraper_worker
```

**Cause 2:** Worker is stuck on a previous job (no concurrency yet — one job at a time per worker).
```bash
docker compose exec -T db psql -U glstore -c "
  SELECT id, status, claimed_by, claimed_at,
         NOW() - claimed_at AS age
    FROM scrape_jobs
   WHERE status IN ('CLAIMED','RUNNING')
   ORDER BY claimed_at DESC LIMIT 5;
"
```
If a row's age is > 5 min, the sweeper will release it on the next pass. If you can't wait, manually reset:
```sql
UPDATE scrape_jobs SET status='PENDING', claimed_by=NULL, claimed_at=NULL WHERE id='<UUID>';
```

### 5.2 The job completed but `prices_found = 0`

```bash
# Inspect the job
curl -s "http://localhost:8000/api/v1/scrape-jobs/<JOB_UUID>" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

Look at each `sources[*].extracted` and `sources[*].error_message`:
- `error_message: 'http 403 …'` → site blocked us. Check tier escalation: did we go all the way to tier 3? If yes, it's a hard block; consider enabling tier 4.
- `extracted.method = 'css_heuristic'` and `confidence < 0.6` → generic extractor found *something* but not confidently. Add a domain-specific extractor.
- All sources `error_message: 'connection: ...'` → SearXNG might be down. Probe it: `POST /settings/scraper/probe`.

### 5.3 LLM enrichment fails with "LLM HTTP 502"

```bash
# Probe the LLM endpoint
curl -s -X POST http://localhost:8000/api/v1/settings/llm/ping \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

Common causes:
- Ollama not running → `ollama serve` on the host
- Endpoint URL wrong → if api in Docker, use `http://host.docker.internal:11434` not `localhost`
- Model not pulled → `ollama pull llama3.1:8b`
- Anthropic key revoked → re-paste in admin Settings

### 5.4 CSV import says "no rows extracted"

```bash
# Run the parser standalone
docker compose exec api python -c "
from api.services.csv_parser import parse, diagnose
text = open('/tmp/your.csv').read()
d = diagnose(text)
print('delimiter:', repr(d.delimiter))
print('headers  :', d.headers)
print('mapped   :', d.mapped_fields)
print('unmapped :', d.unmapped_headers)
"
```

Then mount the CSV: `docker compose cp ./your.csv api:/tmp/your.csv` first.

If `mapped_fields` is missing `name`, the parser couldn't find the product-name column. Look at `unmapped_headers` and either:
- Rename your CSV column to one of the known variants (see `csv_parser.COLUMN_MAP`)
- Add a new variant to `COLUMN_MAP['name']` for future imports

### 5.5 Frontend shows "Network Error" or 401 unexpectedly

```bash
# Confirm API is up
curl http://localhost:8000/healthz

# Confirm Vite proxy is working
# (look for /api requests in browser devtools Network tab)
# admin/vite.config.ts and storefront/vite.config.ts both proxy /api → :8000
```

If you get **401** mid-session: JWT expired. Default TTL is 60 minutes (`JWT_ACCESS_TTL_MINUTES` env). Re-login.

If you get **CORS errors**: only happens if you bypass the Vite proxy. Don't hit `:8000` directly from the browser.

### 5.6 Reading logs efficiently

```bash
# Tail just one service
docker compose logs -f api

# Past N lines
docker compose logs --tail 200 scraper_worker

# Filter by request_id (if structured logging is wired in — currently it's prefixed)
docker compose logs api | grep "req=ab12cd34"

# All services together (handy for tracing a request through the stack)
docker compose logs -f --tail 50
```

### 5.7 Inspecting the DB

```bash
docker compose exec -T db psql -U glstore glstore
```

Useful queries:

```sql
-- How many products by status?
SELECT status, COUNT(*), AVG(completeness_score)::numeric(4,3)
  FROM products GROUP BY status ORDER BY status;

-- What's the slowest scrape source?
SELECT domain, AVG(fetch_ms) AS avg_ms, COUNT(*) AS n
  FROM scrape_sources
 GROUP BY domain
 ORDER BY avg_ms DESC LIMIT 10;

-- Where did this fact come from?
SELECT field, value, source, confidence, observed_at
  FROM observations
 WHERE entity_id = '<PRODUCT_UUID>'
 ORDER BY observed_at DESC LIMIT 20;

-- Are we priced above market on anything?
SELECT p.sku, p.name,
       (SELECT MIN(retail_price) FROM offers WHERE product_id = p.id) AS our_price,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
          FROM competitor_prices WHERE product_id = p.id) AS median
  FROM products p
 WHERE p.status='ACTIVE'
 ORDER BY ((SELECT MIN(retail_price) FROM offers WHERE product_id = p.id)
            - (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
                FROM competitor_prices WHERE product_id = p.id)) DESC NULLS LAST
 LIMIT 10;
```

---

## 6. How to Extend the System

### 6.1 Add a new tier (e.g. residential proxy)

1. **Create the tier module** at `api/services/scraper/tiers/tier5_residential.py` mirroring `tier4_paid.py`'s shape — must return `FetchResult`.
2. **Update `fetcher._escalate`** to call your new tier when appropriate. Decide: is it after tier 3? before tier 4? Add the conditional.
3. **Update `scraper.config`** with whatever knob enables it.
4. **Document it** in `docs/SYSTEM_CONTEXT.md` under the tier ladder table.

### 6.2 Add a new search backend

Open `api/services/scraper/search.py`. The cascade is already in place — add a third backend between SearXNG and DDG:

```python
async def _search_yourbackend(query: str, cfg: SearchConfig) -> list[SearchResult]:
    # ... your implementation
    pass

async def search(...):
    if cfg.searxng_url:        results = await _search_searxng(q, cfg)
    if not results and cfg.your_api_key:
                               results = await _search_yourbackend(q, cfg)
    if not results and cfg.ddg_fallback:
                               results = await _search_ddg_html(q, cfg)
```

Add `your_api_key` to the `SearchConfig` dataclass and to `scraper.config` JSONB.

### 6.3 Add a new admin page

```bash
# 1. Create the page
# admin/src/pages/MyPage.tsx

# 2. Lazy-route it
# admin/src/App.tsx:
const MyPage = lazy(() => import('@/pages/MyPage'))
# in <Routes>:
<Route path="my-page" element={<MyPage />} />

# 3. (Optional) add a sidebar entry
# admin/src/components/Layout.tsx:
const NAV = [
  ...,
  { to: '/my-page', label: 'My Page', icon: SomeLucideIcon },
]
```

Run `npx tsc --noEmit` to confirm.

### 6.4 Add a new product-issue rule (Phase 3 extension)

Issues are derived in `api/services/validator.py`. To add (e.g.) "missing weight":

```python
# 1. Define the code
CODE_MISSING_WEIGHT = "missing_weight"

# 2. Add to derive_issues()
def derive_issues(facts: ProductFacts) -> list[Issue]:
    out: list[Issue] = []
    # ... existing checks ...
    if not facts.specs.get('weight_kg') and not facts.specs.get('weight_lbs'):
        out.append(Issue(
            code=CODE_MISSING_WEIGHT,
            field="specs.weight",
            severity="warning",
            message="Weight not specified.",
            fix_hint={"action": "open_editor"},
        ))
    return sorted(out, key=...)
```

Then update the frontend dispatch in `admin/src/components/IssuePanel.tsx:FixerFor`:

```tsx
case 'missing_weight':
  return <FixWithEditor productId={productId} reason="Add weight in specs (kg)." />
```

And add it to the tabs in `IssueExplorer.tsx`:

```tsx
const TABS: ... = [
  ...,
  { code: 'missing_weight', label: 'No weight', icon: AlertTriangle, severity: 'warning' },
]
```

### 6.5 Add a new LLM backend

In `api/services/llm.py`:

1. Add to the `LLMKind` Literal: `kind: LLMKind = "ollama" | "openai_compat" | "anthropic" | "yourbackend"`
2. Implement `_yourbackend_chat(cfg, system, user)` and `_yourbackend_models(cfg)`.
3. Dispatch in `chat()` and `ping()`.
4. Update the frontend tile picker in `admin/src/pages/Settings.tsx`:

```tsx
const KIND_OPTIONS = [
  ...,
  { value: 'yourbackend', label: 'Your backend', hint: 'https://api.yours.io' },
]
```

### 6.6 Add a new column to `products`

1. Write a migration `db/migrations/00X_yourchange.sql` with `ALTER TABLE products ADD COLUMN ... IF NOT EXISTS`.
2. Append the same statement to `db/schema.sql` so fresh deploys get it.
3. Update `api/models/schemas.py:ProductBase` and `ProductPatch` Pydantic models.
4. Update `api/routes/products.py` SELECT/INSERT/UPDATE statements to include the new column.
5. Update the admin form in `admin/src/pages/ProductEditor.tsx`.
6. (Optional) update the storefront's `ProductDetail` if it should be visible publicly.

Run the migration on the dev DB:

```bash
docker compose exec -T db psql -U glstore glstore < db/migrations/00X_yourchange.sql
```

### 6.7 Add new domain-aware behavior to scraper

Two types:

**Type A — site is JS-heavy or protected.**
Edit `api/services/scraper/utils/domain.py`:

```python
JS_HEAVY_DOMAINS = (..., "yoursite.com")
# or
PROTECTED_DOMAINS = (..., "yoursite.com")
```

**Type B — site is in a new market tier.**
Same file, edit `_DOMAIN_TIERS`:

```python
_DOMAIN_TIERS: list[tuple[str, SourceTier]] = [
    ...,
    ("yoursite.com", SourceTier.RETAILER),
]
```

Order matters — more specific patterns first.

---

## 7. Operational runbook

### 7.1 Deploying a code change

Today: edit code → hot-reload via bind-mount + uvicorn `--reload`. Containers don't need rebuild.

For Playwright/Chromium upgrades, you do need to rebuild:

```bash
docker compose build scraper_worker
docker compose up -d scraper_worker
```

### 7.2 Backing up the DB

```bash
docker compose exec -T db pg_dump -U glstore glstore | gzip > backup_$(date +%F).sql.gz
```

Restore:
```bash
gunzip -c backup_2026-04-26.sql.gz | docker compose exec -T db psql -U glstore glstore
```

### 7.3 Resetting the dev environment from scratch

```bash
docker compose down -v       # ⚠ DESTROYS the DB volume
docker compose up -d         # fresh start, schema + admin auto-seeded
```

### 7.4 Bulk re-enrich the catalog after a rule change

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"brvetr4veler@gmail.com","password":"brveadmin"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -X POST "http://localhost:8000/api/v1/products/enrich-all?limit=20000" \
  -H "Authorization: Bearer $TOKEN"
```

### 7.5 Clearing the Playwright cache

Playwright caches Chromium downloads at `/ms-playwright` inside the scraper container. They're baked into the image, so nuking them = rebuild.

In-process fetch cache (per-worker memory) clears on restart:

```bash
docker compose restart scraper_worker
```

### 7.6 Handling a "lost worker"

If `scraper_worker` is up but no jobs are progressing:

```bash
# 1. Check it's not stuck on a single job
docker compose exec -T db psql -U glstore -c "
  SELECT id, claimed_at, started_at, NOW() - claimed_at AS age
    FROM scrape_jobs WHERE status IN ('CLAIMED','RUNNING')
    ORDER BY claimed_at DESC LIMIT 5;
"

# 2. If a job is stuck > 5 min, restart the worker
docker compose restart scraper_worker

# 3. The stale-claim sweeper will release the orphaned CLAIMED job within 60s
```

### 7.7 Scaling

```bash
# Three event workers (idempotent — they each claim different events)
docker compose up -d --scale event_worker=3

# Two scraper workers (each handles one job at a time)
docker compose up -d --scale scraper_worker=2
```

⚠ **Don't scale `reservation_worker`** — it's a singleton sweeper. Multiple instances would double-release the same expired reservations.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Tier escalation** | The scraper's strategy of starting cheap and only paying more when needed. |
| **Source tier** | Quality/trust classification of a domain: official > retailer > aggregator > classified > review > general. |
| **Confidence hint** | A tier's self-rating of how good its result is. Used by the orchestrator to decide whether to escalate. |
| **Cross-source consensus** | The validator step that boosts/drops confidence based on agreement with the median price across sources. |
| **Idempotency key** | A client-supplied unique string that lets retries safely re-submit the same operation. Used on orders + import. |
| **Heartbeat** | (TBD — see SYSTEM_AUDIT.md C-2) A worker periodically updating its claim's timestamp to prove it's alive. Not yet implemented. |
| **Soft archive** | Status='ARCHIVED' instead of DELETE — preserves order history. The default for `DELETE /products/{id}`. |
| **Stale claim** | A `scrape_jobs` row in `CLAIMED` state for too long because the worker died. Released back to PENDING by the sweeper. |
| **CPO** | Canonical Product Object — the conceptual schema we extract toward (from the orbital-perihelion source project). |
| **Observation** | A single fact-with-provenance row: "source X said field Y had value Z at time T with confidence C." |
| **Reservation** | A temporary stock hold linked to a PENDING/RESERVED order. Released on cancel or expired by the sweeper. |
| **Diversification quota** | The ranker's tier budget when picking the 6 URLs to scrape (e.g. 1 official + 3 retailer + 1 review). |

---

## 8.bis Phase 9 — Full Intel · Image Review · Theme

### How to enrich a single product end-to-end (Full Intel)

```bash
# UI
1. Go to /products/{id} in the admin
2. Click "Full Intel" (accent button, top-right)
3. Watch the toast: enqueue → RUNNING (~30-90s) → results
   The fields_filled summary tells you which fields were updated.
4. Open the "Validate images" button to confirm/reject scraped images.

# API equivalent (single)
curl -X POST -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/products/${PID}/intel?wait=true"

# API equivalent (bulk: all products missing a brand)
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"missing_brand": true, "limit": 200}' \
  "http://localhost:8000/api/v1/products/intel-bulk"
# Returns { "batch_id": "...", "queued": 187, ... }

# Poll batch progress
curl -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/intel-batches/${BATCH_ID}"
# { "percent_done": 23.5, "completed": 44, "running": 6, "is_terminal": false, ... }
```

### How to review scraped images

```
Per-product:   /products/{id}/images
Global queue:  /images           ← shows pending count + top products by pending
```

For each pending image card you have three buttons:
- **Reject** — flips status to DELETED, will not be suggested again
- **Approve** — flips status to STORED (visible to customer in the gallery)
- **Principale** — same as Approve + sets `is_primary=true` (demotes the previous primary)

Backend:
```bash
# List pending images for a product
curl -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/products/${PID}/images?status=PENDING"

# Approve as primary
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"is_primary": true}' \
  "http://localhost:8000/api/v1/products/${PID}/images/${IID}/approve"

# Reject
curl -X POST -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/products/${PID}/images/${IID}/reject"
```

### How to change the admin theme

Three increasingly-fine entry points:

**(a) Sidebar quick switcher.** Bottom of the sidebar, the "Thème" tile shows
the active preset. Click → 11-preset dropdown → click a preset → it saves
+ applies immediately for every admin user.

**(b) Settings overview.** `/settings` → the "Apparence" card shows both
admin and storefront themes side-by-side. Click "Ouvrir le studio" for the
full editor.

**(c) Theme Studio.** `/settings/theme` — six tabs:

| Tab | What it controls |
|---|---|
| Presets | Click a preset card → preset + dark/light mode |
| Couleurs | All 18 colour tokens grouped (palette, surface, text, status, bg-glow). `<input type="color">` + hex/rgba field for each. |
| Typo | Sans / Display / Mono font families. Live preview block below each field. |
| Rayons | 5 sliders for radius scale + a swatch row showing the resulting corners. |
| Effets | Glass blur/saturate/opacity sliders + motion duration sliders. |
| Storefront | Switch scope to storefront. Full preset switcher + "copy admin → storefront" button + open-storefront link. |
| JSON | Copy/download the full theme. Paste/import a saved theme JSON. |

Click "Sauvegarder" to persist. Writes to `app_settings.key='admin.theme'`
(or `'storefront.theme'` depending on the active scope tab).

### How to change the storefront theme

Same Theme Studio, switch scope to **Storefront** (the pill at the top right).

The storefront fetches its theme on bootstrap from
`GET /api/v1/storefront/theme` (no auth) and caches it in
`localStorage[gl.storefront.theme.v2]`. Customers see the new palette on
their next page load — no auth, no admin login on the public site.

To preview without saving: click the "Storefront" tab → pick a preset.
The studio's draft is local until you click "Publier sur la vitrine".

The theme is cached in localStorage (per scope) so the next page load
paints in the right palette before React even mounts (no FOUC). After
login, the authoritative copy is re-fetched.

### How to import / export a theme

1. Open Theme Studio → JSON tab
2. Export panel → "Copier" or "Télécharger" (file is `gl-theme-{scope}-{preset}.json`)
3. Import panel → paste JSON or drop a file → "Appliquer" → "Sauvegarder"

The schema is `{ "preset": "midnight", "mode": "dark", "overrides": { "--color-electric-blue": "#56CCF2" } }`.
Unknown keys are silently dropped server-side; unknown values fail the per-kind regex.

### How to use the Obsidian-grade catalog graph

```
/graph
─────
Default: brands × categories aggregated (~60 nodes, SVG renderer)

Toggle "Produits" in the page header to add product nodes:
  - Backend opt-in: ?include_products=true&product_limit=N
  - >220 nodes → automatic Canvas renderer (60fps with 4 000 nodes)
  - Lowest-completeness products picked first — graph shows the work queue

Keyboard shortcuts:
  /        — open search overlay (substring match on label + SKU)
  Ctrl+,   — open physics settings panel
  Esc      — close any overlay

Mouse:
  drag empty area    → pan the viewport
  drag a node        → reposition + auto-pin (yellow dot indicator)
  Ctrl+wheel         → zoom in/out
  click a node       → open detail drawer (products preview / pin toggle / quick links)

Settings panel (Ctrl+,):
  Charge, link distance, collision, alpha decay, label mode, product opacity,
  edge opacity, "linger" (continuous physics) — all live-tweakable.

Persistence:
  - Settings  → localStorage[gl.graph.settings.v1]
  - Layout    → localStorage[gl.graph.layout.{tiers,full}.v1] (pinned nodes only)
```

---

## 8.cinq Phase 9 Push 6 — Health-check endpoints

Three layers, mapping to the canonical k8s / Cloud Run / ALB conventions:

| Endpoint | Purpose | Auth | Latency budget |
|---|---|---|---|
| `GET /healthz` | Liveness — "the process is up" | none | < 50 ms |
| `GET /readyz` | Readiness — "ready to serve traffic" (DB + SearXNG up) | none | < 3 s |
| `GET /healthz/details` | Deep diagnostic — DB, SearXNG, LLM, queue depths, migrations applied | admin JWT | < 15 s |

### Quick recipes

```bash
# Smoke test the local stack
curl -sf http://localhost:8000/healthz | jq
# → { "status": "ok" }

# Is everything ready?
curl -sf http://localhost:8000/readyz | jq
# → { "status": "ok", "checks": [
#       { "name": "db",      "ok": true,  "duration_ms": 8,  "required": true },
#       { "name": "searxng", "ok": true,  "duration_ms": 71, "required": true }
#   ] }

# Anything degraded?
curl -fS http://localhost:8000/readyz || echo "NOT READY"

# Deep view (needs admin JWT)
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
   -H 'Content-Type: application/json' \
   -d '{"email":"brvetr4veler@gmail.com","password":"brveadmin"}' | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/healthz/details | jq
```

### Status-code semantics

| Endpoint | 200 | 503 |
|---|---|---|
| `/healthz` | always (process is alive) | only if FastAPI itself is broken |
| `/readyz` | every required probe ok | any required probe failed |
| `/healthz/details` | every required probe ok | any required probe failed; optional probes (LLM, db_extended) being down doesn't 503 |

A non-200 from `/readyz` is the cue for an orchestrator (k8s, Cloud Run, ALB) to pull this instance out of the load-balancer rotation. Required probes are **DB** and **SearXNG**; **LLM** is optional (rule-engine enrichment + scraper still work without it).

### Probe shape

Each probe returns:

```jsonc
{
  "name":        "searxng",
  "ok":          true,
  "duration_ms": 71,
  "detail":      { "url": "http://searxng:8080/", "status_code": 200 },
  "error":       null,
  "required":    true
}
```

### docker-compose integration

The `api` service now has its own healthcheck (uses `/healthz`). Every worker depends on `api` being healthy before it starts, which gives migrations the chance to run before workers query schema-dependent tables. So `docker compose up -d` is now a clean one-command boot — no race.

```bash
docker compose up -d
docker compose ps
# all services should be "healthy" once start_period=30s elapses
```

### Adding a new probe

```python
# api/core/health.py
async def my_new_probe() -> ProbeResult:
    started = time.monotonic()
    # do something
    return ProbeResult(
        name="my_thing",
        ok=...,
        duration_ms=int((time.monotonic() - started) * 1000),
        detail={...},
        required=False,   # optional vs required = whether failing 503s readyz
    )

# Register in details_checks() (or readyz_checks() if it's a hard dependency).
```

Per-probe timeout, name, and `required=` flag are mandatory — they map directly to the structured-log fields (`event=health.readyz.degraded`, `failing=[...]`) so dashboards group by component automatically.

---

## 8.quat Phase 9 Push 5 — Database migrations

### TL;DR

```bash
docker compose up -d              # migrations run automatically on api startup
```

That's it on the happy path. The API container boots, applies any pending
migrations (in filename order), and only then starts serving. If a
migration fails the container crashes loud and orchestration alerts.

### Inspecting state

```bash
# Show every migration with its applied status
docker compose exec api python -m scripts.migrate --status

  002_scraper.sql                          applied    2026-04-25 10:14:32+00:00
  003_observations_retention.sql           applied    2026-04-26 08:01:11+00:00
  004_intel_jobs.sql                       applied    2026-04-27 07:33:45+00:00
  005_my_new_thing.sql                     PENDING    —
```

A `TAMPERED` status means the file's checksum no longer matches what was recorded
when it was first applied — the API will refuse to start. **Once a migration is
applied, never edit it; create a new migration file instead.**

### Adding a new migration

```bash
# Pick the next available 3-digit prefix
ls db/migrations/                  # → 000, 001, 002, 003, 004 → next is 005

# Create the file
cat > db/migrations/005_my_new_thing.sql <<'SQL'
-- ============================================================================
-- Migration 005: my new thing
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS my_new_thing (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ...
);
SQL

# Apply right away (or just bounce the api container)
docker compose exec api python -m scripts.migrate
```

Conventions:
- **Zero-padded 3-digit prefix** (`005_`, not `5_`) so lexical sort = numeric sort.
- **Idempotent SQL** — `IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`,
  `ON CONFLICT DO NOTHING`. The runner records what's been applied and skips,
  but defense-in-depth never hurts.
- **One transaction per migration** — wrapped automatically by the runner.
  Inside, the SQL can do whatever it wants (multi-statement, DDL, DML mixed).
- **Never edit a migration that's already applied** — tamper detection will
  refuse to start. Create a new migration instead.

### Multi-replica safety

The runner uses `pg_try_advisory_lock` so when you scale the API to N replicas
(`docker compose up -d --scale api=3`) only one of them runs migrations at a
time. The others wait up to 30s for the lock; if the holder is still working
after that they log a warning and proceed (the schema will already be current
from the holder's work).

### CI gating

```yaml
# .github/workflows/deploy.yml
- run: python -m scripts.migrate --check  # exit 1 if anything pending
- run: docker push …
```

Use `--check` to fail your deploy pipeline if a migration was authored but
forgotten — better to find out before shipping new code that depends on it.

---

## 8.ter Phase 9 Push 4 — Debugging with structured logs

Every Python process now emits **JSON, one object per line** on stdout.

### Quick recipes

```bash
# Tail every API line, pretty-printed
docker compose logs -f api | jq -c '.'

# Just errors from any component, last 100
docker compose logs --tail 1000 | grep -v '^[a-z_]*  *|' | jq 'select(.level=="ERROR")' | head -100

# Follow a single request end-to-end across api + workers
RID=abc12345
docker compose logs -f api intel_worker scraper_worker event_worker \
  | jq --arg rid "$RID" 'select(.request_id == $rid)'

# Find every Full Intel job that failed in the last hour
docker compose logs --since 1h intel_worker \
  | jq 'select(.event == "intel.failed") | {ts, job_id, exc_message}'

# Group scrape jobs by duration bucket
docker compose logs --tail 5000 scraper_worker \
  | jq 'select(.event == "scrape.done") | .duration_ms' \
  | awk '{ b = int($1/1000); cnt[b]++ } END { for (k in cnt) print k"s\t"cnt[k] }' \
  | sort -n
```

### What's in every line

| Field | Always | Notes |
|---|---|---|
| `ts` | ✅ | ISO 8601 UTC with millisecond precision |
| `level` | ✅ | `INFO`, `WARNING`, `ERROR`, `DEBUG`, `CRITICAL` |
| `logger` | ✅ | Python logger name (e.g. `glstore.intel`, `httpx`) |
| `component` | ✅ | `api`, `intel-worker`, `scraper-worker`, `event-worker`, `reservation-worker` |
| `msg` | ✅ | Human-readable rendered message |
| `request_id` | ✅ (may be null) | HTTP request ID for `api`; `intel:<short>` / `scrape:<short>` / `event:<short>` for workers |
| `event` | ⚠️ | Stable event name for hot-path logs: `intel.completed`, `intel.failed`, `intel.scrape.complete`, `scrape.done`, `event_worker.completed`, `event_worker.failed`, `startup`, `shutdown` |
| `exc_type` / `exc_message` / `exc_traceback` | ⚠️ | Only present on `log.exception(...)` lines |
| Anything else | ⚠️ | Whatever was passed in `extra={...}` — promoted to top-level |

### Adjusting verbosity

```bash
# In .env or docker-compose.yml
GL_LOG_LEVEL=DEBUG      # for a noisy debugging session
GL_LOG_LEVEL=WARNING    # for prod-quiet
```

Default is `INFO`. Third-party libraries (uvicorn.access, httpx, httpcore, asyncio, watchfiles) are clamped to `max(level, WARNING)` so they don't drown out application logs.

### Adding a new structured log call

```python
import logging
log = logging.getLogger(__name__)

# Bad — values buried in the message string, hard to grep
log.info("processed %d items in %dms for job %s", n, ms, job_id)

# Good — values as fields, message stays a stable string
log.info(
    "processed batch",
    extra={
        "items":    n,
        "duration_ms": ms,
        "job_id":   str(job_id),
        "event":    "batch.processed",
    },
)
```

The `event` field is your friend: pick a stable enum-like value (`<area>.<verb>` — e.g. `intel.completed`, `scrape.done`) so dashboards and alerting rules can match on it without depending on the message text.

---

## 9. When to ask for help

If something doesn't work after walking through this guide:

1. **Read the relevant section of `SYSTEM_AUDIT.md`** — there might be a known issue.
2. **Check `docs/PROGRESS.md`** for what shipped recently.
3. **Re-run the type checks**:
   ```bash
   cd admin     && npx tsc --noEmit
   cd ../storefront && npx tsc --noEmit
   docker compose exec api python -m py_compile api/main.py
   ```
4. **Capture the failing request_id** from response headers (`x-request-id`) and grep logs for it.
5. **`docker compose logs --tail 200 api scraper_worker event_worker`** is your friend.

That's everything. Welcome.
