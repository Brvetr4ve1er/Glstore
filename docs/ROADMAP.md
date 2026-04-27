# Roadmap

What's next, ordered by value. Each phase is shippable on its own — stop whenever it's "enough."

---

## ✅ Done so far

- **Foundation:** schema, auth, orders, workers, brand redesign.
- **Phase 0:** manual product CRUD + offers.
- **Phase 1:** bulk CSV import (preview → commit, idempotent).
- **Phase 2 (backend):** rule-based enrichment + auto-trigger on import.
- **Phase 2 (UI):** "Enrich now" / "Enrich all" / Needs-Fix filter chip / Dashboard intel card with avg completeness + status histogram + URL-synced filtering.
- **Phase 3:** Validator service + per-product issue panel with inline fixers + Catalog Quality triage page (`/products/issues`) with tabbed bulk views.
- **Phase 4:** Pluggable LLM client (Ollama / OpenAI-compat / Anthropic). Settings page with backend picker, model autocomplete-from-ping, generation knobs. Per-product `/enrich-llm` + bulk `/enrich-llm-bulk`. "Draft with LLM" button in the description fixer.

---

## ⏳ Phase 5 — Web scraping (was Phase 4 in old plan)

Pluggable LLM client + bulk enrichment queue. Port of `orbital-perihelion`'s `services/llm.ts` + `enrichment-queue.ts`.

| Item | Notes |
|---|---|
| `api/services/llm.py` | OpenAI-compatible client (LM Studio local OR Anthropic/OpenAI hosted). JSON-mode with retry+repair. |
| Settings page | `admin/src/pages/Settings.tsx` — endpoint + model + key + presets, ping test, status indicator |
| `workers/enrichment_worker.py` | New worker that consumes `enrichment_jobs` table or `events` rows |
| `POST /products/{id}/enrich-llm` | Async job kick |
| `POST /products/enrich-llm-all` | Bulk pass with circuit breaker |
| Frontend queue panel | Live progress, ETA, pause/resume/cancel — port of `EnrichmentQueuePanel.tsx` |
| Cost tracking | Per-job token + estimated cost stored on the job row |

Estimated effort: **~3-4 hours.**

---

## ⏳ Phase 5 — Web scraping

Port `orbital-perihelion/scraper/sidecar.py` as a server-side worker (no CORS, no proxy needed). Real competitor prices from Algerian e-com sites.

| Item | Notes |
|---|---|
| `workers/scraper_worker.py` | SearXNG + DuckDuckGo + Crawl4AI + httpx + Playwright cascade |
| `competitor_prices` table | New schema addition |
| `POST /products/{id}/scrape` | Kick job |
| Per-product "Market" tab | Chart of competitor prices over time, margin alerts |
| Robots.txt + politeness | Built-in rate limiting per domain |
| Domain ranking | Tier-aware diversification (official > retailer > review) |

Estimated effort: **~3 hours.**

---

## ⏳ Phase 6 — Job console

UI surface over the existing `events` + future `enrichment_jobs` + `scrape_jobs` tables. Already 70% built — `events` table is the foundation.

| Item | Notes |
|---|---|
| `/jobs` page | Live table of import / enrichment / scraping jobs |
| Cancel / retry / inspect | Server-Sent Events for live updates |
| Filter by type / status | Use existing `events.event_type` |
| Detail panel with logs | From `events.last_error` + new `events.log_lines JSONB` |

Estimated effort: **~1-2 hours.**

---

## ⏳ Phase 7 — Catalog graph

Port `orbital-perihelion/src/graph/` D3 components. Visual relationship explorer: brand ↔ category ↔ product.

| Item | Notes |
|---|---|
| `GET /products/graph` | Aggregate endpoint returning nodes + edges |
| `admin/src/pages/Graph.tsx` | Hosts the D3 canvas |
| Port renderer + simulation engine | LOD rendering, persistent positioning, force-directed layout |
| Click node → side panel | Reuse ProductDetail body |

Estimated effort: **~2-3 hours.**

---

## 🔮 Beyond Phase 7 (future)

| Idea | Why |
|---|---|
| Read Model (`catalog_read` materialised view) | When direct reads on `products` exceed ~50 ms p95 |
| Redis-backed rate limiter | When API moves to multi-replica |
| Storefront app | Public-facing React site consuming the same API |
| n8n integration | Push `sync_queue` rows out to shipping / accounting |
| Mobile app (RN / Expo) | Same API. Offline-first. |
| Order analytics dashboard | Revenue, AOV, conversion funnel |
| Customer messages / WhatsApp Business API | Confirm orders by SMS/WA |
| Multi-tenant | Convert to multi-store SaaS if there's pull |

---

## Prioritisation rule

If you're not sure what to do next, do **Phase 2 UI** — finish what's already started. It costs an hour and unlocks the visible payoff of all the Phase 2 backend work.
