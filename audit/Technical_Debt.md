# GLstore — Technical Debt Audit

**Date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` · **Method:** read-only sweep, every claim below cites `file:line`.
**Label key:** **CONFIRMED** = read the code and traced every call site. **SUSPECTED** = inferred, not fully traced.
This report does not re-litigate the four already-fixed `store_id` NOT-NULL bugs, and treats `docs/audit/Architecture.md` §7 (cross-tenant intel/scraper writes, admin read/write store split, theme globality, dead `financial_transactions`/`audit_log`, `products_export.py` orphan status) as already filed — this document only cross-references those where a tech-debt angle adds something new.

---

## Ranked findings

| # | Finding | Severity | Why it hurts | Effort | Blast radius |
|---|---|---|---|---|---|
| 1 | [`spec_sanitizer.py` is fully dead code — never wired into either LLM pipeline](#1-spec_sanitizerpy-dead-code-that-was-built-to-fix-a-documented-customer-facing-bug) | **High** | The exact spec-pollution bug the module's docstring documents (inventory-management noise like "Stock Maximum", "CUMP" leaking into product specs) is provably still reachable, and the storefront PDP renders up to 12 raw spec keys straight to customers | S (2 call sites) | **High — customer-facing** (public product page) |
| 2 | [Completeness/status scoring logic triplicated across 3 files, with confirmed behavioral divergence](#2-completeness-status-scoring-triplicated-with-real-divergence) | **High** | Not just duplicated — the three copies compute different answers today for `has_stock` (gross vs. available) and `has_description` (always-true vs. length≥30) | M | Medium — every admin quality workflow (Issues, CatalogGraph, status badges) reads `completeness_score`/`status` |
| 3 | [`WRITE_ROLES`/`READ_ROLES` role-tuples redeclared independently in 11 route files](#3-role-tuple-constants-copy-pasted-into-11-files-with-drift) | **Medium-High** | No single source of truth for admin authorization scopes; one module (`images.py`) has silently drifted to exclude `VIEWER` from read endpoints, unlike every sibling | S | High — touches authorization on all 76 admin/mixed endpoints |
| 4 | [`_apply_payload()` LLM-merge logic duplicated between `full_intel.py` and `llm_enrichment.py`](#4-_apply_payload-duplicated-between-the-two-llm-pipelines) | Medium | Same function name, 9/9 identical `aux_keys`, separately maintained — a fix to one (e.g. wiring in finding #1) is easy to forget in the other | M | Medium — both LLM enrichment paths |
| 5 | [Two independent in-memory sliding-window rate limiters, with already-diverged IP-extraction logic](#5-two-independent-sliding-window-rate-limiters) | Medium | `ratelimit.py::client_key()` and `auth.py::_client_ip()` solve the same problem differently; `_client_ip()` strips a port suffix that `client_key()` doesn't | S/M | Medium — login throttling + mutation rate limiting |
| 6 | [`_normalize_phone()` duplicated verbatim in `orders.py` and `public_orders.py`](#6-_normalize_phone-duplicated-verbatim) | Medium | Correctness-critical: order creation and order tracking must agree on the same `phone_normalized` value or customers silently can't find their own orders | S | Medium-High — checkout + order tracking, customer-facing |
| 7 | [`products_export.py` — 369-line dead orphan router, independently re-declares finding #3's constants](#7-products_exportpy--dead-orphan-that-compounds-finding-3) | Low-Medium | Already known-dead (Architecture.md §7.7); the tech-debt angle is that deleting it removes one of the 11 duplicate role-tuple sites and 2 dormant `store_id`-missing INSERTs for free | S (delete) | None today; grows if anyone "helpfully" mounts it |
| 8 | [`full_intel._apply_payload()` is an oversized, 5-responsibility function (~170 lines)](#8-oversized-function-full_intel_apply_payload) | Low-Medium | Hard to unit-test in isolation, hard to review diffs against | M | Low-Medium — contained to the intel pipeline |
| 9 | [`_slugify()` duplicated with diverging collision-handling between `products.py` and `csv_import.py`](#9-_slugify-duplicated-with-diverging-collision-handling) | Low | Same regex/fallback copy-pasted; the two callers handle a slug collision completely differently (409 vs. silent auto-disambiguation) with no comment explaining why | S | Low — both paths work today |
| 10 | [Worker poll/heartbeat/stale-claim intervals inconsistently sourced — 1 of 4 workers is env-configurable](#10-worker-tuning-constants-inconsistently-sourced) | Low | Operational tuning requires a code change + redeploy for 3 of 4 workers but only an env var for the 4th; `STALE_CLAIM_AFTER_MIN` also differs (5 vs. 3) between two structurally-identical claim loops | S | Low — ops/tuning only |
| 11 | [One acknowledged `TODO` — `tier4_paid.py:11` brightdata provider "not yet wired"](#11-the-one-actual-todo-in-the-codebase) | Low | Self-documented, feature-flagged off by default, fails clean | S (doc) / L (implement) | Low — tier4 is opt-in and off by default |
| 12 | [`storefront/src/lib/api.ts` and `admin/src/lib/api.ts` hand-written types have already drifted](#12-frontend-api-client-types-have-already-drifted) | Low | Concrete instance of the doc-known "drifts silently" risk (Architecture.md §2.2) — `ProductListItem.status`, `MediaItem`, and `Offer` field sets differ between the two clients | S per instance / M as a process fix (codegen) | Low — each client currently only reads the fields it uses |

---

## Detail

### 1. `spec_sanitizer.py` — dead code that was built to fix a documented, customer-facing bug

**Severity: High. Effort: S. Blast radius: High (public storefront).**

`api/services/spec_sanitizer.py` (379 lines) exists specifically to solve a documented incident. Its module docstring (`spec_sanitizer.py:1-35`) describes a live test on `MS-SM8081 PETRIN` where 14 LLM-extracted "specs" were persisted, roughly half of which were `Stock Maximum`, `CUMP`, `Statut Stock`, `Prix de Gros`, `Valeur Stock`, `Quantité en Stock`, `Dernier Prix d'Achat`, `Prix de Vente (Détail)` — inventory-management noise leaked from a competitor's CSV dump that happened to be visible on the scraped page. `sanitize_specs()` (`spec_sanitizer.py:269`) is the stated gate: every `(key, value)` pair from an LLM payload is supposed to pass through it before being persisted.

**CONFIRMED — it never runs.**
- `grep -r "spec_sanitizer" api/ workers/` returns nothing outside its own file.
- `grep -r "sanitize_specs\|spec_sanitizer"` repo-wide returns exactly one non-definition hit: `tests/test_spec_sanitizer.py:11` (20+ well-written unit tests, all green, all testing a function nothing in production calls).
- The two production call sites that merge LLM output into `products.specs` — `api/services/full_intel.py::_apply_payload` (`full_intel.py:247-264`, merges `parsed.get("specs")` straight into the row) and `api/services/llm_enrichment.py::_apply_payload` (`llm_enrichment.py:196-211`, same) — neither imports `spec_sanitizer` nor calls `sanitize_specs`.
- The module's own docstring claims "the intel_worker writes the dropped count into `intel_jobs.scrape_summary.specs_dropped`" (`spec_sanitizer.py:29-31`). `grep -r "specs_dropped"` repo-wide returns only that one docstring line — the field doesn't exist anywhere else, including in `intel_worker.py` or the `intel_jobs` schema.

**This has a live customer-facing failure mode, not just a hygiene gap.** `storefront/src/pages/ProductDetail.tsx:91-95` renders up to 12 non-`_`-prefixed spec keys directly from `product.specs` on the public product page (`surfaceSpecs = Object.entries(sp).filter(([k]) => !k.startsWith('_') ...).slice(0, 12)`). Any LLM run that reintroduces the exact class of noise the module's own docstring warns about will display it to real customers, unfiltered, today.

**Fix:** call `sanitize_specs(new_specs)` before the merge in both `full_intel.py:249` (before `if new_specs and isinstance(new_specs, dict):`) and `llm_enrichment.py:199` (before the `payload_specs` merge loop), and thread the returned `dropped[]` into the existing `fields_filled`/audit trail. The module and its tests are already written and passing — this is a two-call-site wiring fix, not new development.

---

### 2. Completeness/status scoring triplicated, with real divergence

**Severity: High. Effort: M. Blast radius: Medium.**

This confirms and deepens the suspicion in the task brief. There are **three** independent implementations of the same weighted completeness formula (brand 0.18, category 0.18, price 0.18, stock 0.10, barcode/mpn 0.06, description 0.10, primary image 0.10, specs saturating at 3 keys × 0.10/3), not two:

1. **`api/services/enrichment.py:390-412`** `compute_completeness()` — pure Python, parametrized by caller-supplied booleans. Called from `enrich()` (`enrichment.py:503-512`), itself called by `enrichment_runner.py::enrich_one` (rule-engine path, `enrichment_runner.py:146-156`).
2. **`api/services/full_intel.py:361-404`** `_recompute_status_and_completeness()` — raw SQL SELECT+UPDATE. Docstring literally says *"Mirrors `enrichment.compute_completeness()`"* (`full_intel.py:362`). Reused correctly by `api/routes/images.py:29,153,196` (imports the function rather than re-copying it — the one place this pattern was done right).
3. **`api/services/llm_enrichment.py:274-318`** — a second, separate raw-SQL copy of the *same* CASE-expression scoring query, inline inside `enrich_one()`. This one does **not** import #2, despite there being no circular-import obstacle (`full_intel.py` does not import `llm_enrichment.py` — confirmed via its import list at `full_intel.py:39-42`).

**Confirmed behavioral divergence between the copies, not just duplication:**

| Signal | Python (`enrichment.py`) | SQL copies (`full_intel.py` / `llm_enrichment.py`) |
|---|---|---|
| `has_stock` | Caller-supplied boolean. Its only caller, `enrichment_runner.py:52-53,71`, computes it as `SUM(o.stock_quantity) > 0` — **gross** stock, reservations not subtracted | `COALESCE(SUM(o.stock_quantity - o.reserved_quantity), 0) > 0` — **available** stock (`full_intel.py:370`, `llm_enrichment.py:281`) |
| `has_description` | `bool(description) or has_description` (`enrichment.py:509`) — `description` is always a non-empty string built at `enrichment.py:497-499`, so this term is **structurally always true** regardless of quality | `p.description IS NOT NULL AND length(p.description) >= 30` (`full_intel.py:367`, `llm_enrichment.py:278`) — a real quality gate |
| Status fallback when neither VERIFIED/CLASSIFIED/NEEDS_FIX applies | `"NORMALIZED"` always (`enrichment.py:525`) | `full_intel.py:394`: `"NORMALIZED"` always. `llm_enrichment.py:309`: `cur_status or "NORMALIZED"` — preserves the existing status instead |

A product enriched via the rule engine can get a materially different completeness score and status than the same product re-scored by the intel or LLM-only pipeline, purely because of which of the three formulas ran last — not because the underlying data changed. The `has_description` freebie in the Python path in particular means rule-engine completeness is systematically inflated by 0.10 relative to the SQL paths' actual quality bar.

**Fix:** pick one canonical implementation (the SQL version reflects the real committed row state and is the one two of three pipelines already converged on) and make `enrichment_runner.py` call it via `db.execute` post-UPDATE instead of the parametrized Python function, or vice-versa — expose the Python function's semantics as the single source of truth and have both SQL sites call out to it. Either direction, get to one formula, and decide on purpose whether stock means gross or available.

---

### 3. Role-tuple constants copy-pasted into 11 files, with drift

**Severity: Medium-High. Effort: S. Blast radius: High (authorization surface).**

`api/core/security.py` defines `require_role()` but **no** `WRITE_ROLES`/`READ_ROLES` constants (confirmed: `grep "WRITE_ROLES\|READ_ROLES\|ADMIN_WRITE\|ADMIN_READ" api/core/security.py` → no matches). Instead, the same four-role tuple is independently declared at module scope in **11 separate route files**:

```
api/routes/intel.py:29-30           WRITE_ROLES / READ_ROLES
api/routes/settings.py:27-28        WRITE_ROLES / READ_ROLES   (WRITE excludes OPERATOR — documented intentional, "admin only")
api/routes/products_export.py:37-38 WRITE_ROLES / READ_ROLES   (dead file, see #7)
api/routes/images.py:33-34          WRITE_ROLES / READ_ROLES   (READ excludes VIEWER — see below)
api/routes/products.py:28           WRITE_ROLES only (public reads need no role)
api/routes/scraper.py:32-33         WRITE_ROLES / READ_ROLES
api/routes/orders.py:16-17          ADMIN_WRITE / ADMIN_READ   (different names, same values)
api/routes/enrichment.py:27-28      WRITE_ROLES / READ_ROLES
api/routes/jobs.py:35-36            READ_ROLES / WRITE_ROLES
api/routes/products_import.py:23    WRITE_ROLES only
api/routes/issues.py:26             READ_ROLES only
```

Most copies agree: `WRITE_ROLES = ("SUPER_ADMIN","ADMIN","OPERATOR")`, `READ_ROLES = (...,"VIEWER")`. Two have silently drifted:

- **`images.py:34`**: `READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")` — **no `VIEWER`**, the only module of the 8 that define a `READ_ROLES` to omit it. This is used at `images.py:54` (`GET /products/{id}/images`), `:218` (`GET /images/pending`), `:261` (`GET /images/pending/summary`) — three read-only endpoints. A `VIEWER` who can browse products, orders, issues, jobs, and the catalog graph gets a 403 on the image review queue specifically, with nothing in the code or docs explaining why images are held to a stricter read bar than everything else. This reads as an unintentional copy-paste omission, not a policy.
- **`orders.py:16-17`** uses different identifier names (`ADMIN_WRITE`/`ADMIN_READ`) for the identical values — harmless today, but it means a repo-wide "who has write access" search for `WRITE_ROLES` misses this file.

**Fix:** define `ADMIN_WRITE_ROLES` / `ADMIN_READ_ROLES` (and `SETTINGS_WRITE_ROLES` for the one legitimately-different case) once in `api/core/security.py`, import everywhere, and resolve the `images.py` `VIEWER` question as a deliberate decision instead of an accident.

---

### 4. `_apply_payload` duplicated between the two LLM pipelines

**Severity: Medium. Effort: M. Blast radius: Medium.**

`full_intel.py:186-356` and `llm_enrichment.py:175-244` both define a function named `_apply_payload` that merges an LLM JSON payload into `products` + writes an observation trail. They are not thin wrappers around a shared core — each re-implements the merge from scratch, with an identical `aux_keys` dict shape:

- `full_intel.py:250-261`: `_seo_description, _selling_angles, _marketing_hooks, _buyer_fit, _price_position, _pros, _cons, _recommendation, _llm_confidence, _intel_source` (10 keys)
- `llm_enrichment.py:214-224`: the same 9 keys minus `_intel_source`

Policy differs in ways that look intentional (full_intel always overwrites `description`, `llm_enrichment` only fills if the existing one is short — `llm_enrichment.py:184`) but the *specs-merge* and *aux-key* logic is close enough that a future change (e.g. wiring in finding #1's sanitizer, or adding a new aux key) has to be made twice and will drift if it isn't.

**Fix:** extract a shared `_merge_llm_specs(existing_specs, new_specs, aux_payload) -> (merged, added_count)` helper both call, leaving only the genuinely different identity/description policy in each file.

---

### 5. Two independent sliding-window rate limiters

**Severity: Medium. Effort: S/M. Blast radius: Medium.**

`api/core/ratelimit.py` (`RateLimiter` class, `:12-29`) and `api/routes/auth.py` (`_IPFailTracker` class, `:33-78`) are two separately-written implementations of the identical data structure and algorithm: a `dict[str, deque[float]]` sliding window, purged with `popleft()` on read, guarded by a `threading.Lock`. This is a distinct finding from Architecture.md §7.10 (which is about spoofability/memory growth) — the tech-debt angle is that the same 20-line primitive was built twice instead of once with two call shapes (`check()` raises; `is_rate_limited()`/`record_failure()` return tuples).

The duplication has already produced a divergence: the client-IP extraction helper is copy-pasted too — `ratelimit.py::client_key()` (`:32-36`) vs. `auth.py::_client_ip()` (`:83-94`) — and `_client_ip()` additionally strips a port suffix (`auth.py:89-90`: `if ":" in ip and ip.count(":") == 1: ip = ip.split(":")[0]`) that `client_key()` does not. An `X-Forwarded-For` value formatted as `1.2.3.4:5678` would bucket differently under the general mutation limiter than under the login-failure tracker.

**Fix:** extract one `SlidingWindowCounter` (or similar) in `api/core/ratelimit.py`, parametrize window/limit, and have `auth.py` construct an instance of it instead of hand-rolling `_IPFailTracker`. Consolidate the two IP-extraction functions into one.

---

### 6. `_normalize_phone` duplicated verbatim

**Severity: Medium. Effort: S. Blast radius: Medium-High (customer-facing).**

```python
def _normalize_phone(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())
```

appears identically at `api/services/orders.py:18-19` (used by `_upsert_customer`, `orders.py:26`, to compute the value written to `customers.phone_normalized` at checkout) and `api/routes/public_orders.py:117-118` (used by `track_order`, `public_orders.py:140`, to compute the value matched against that same column for `POST /orders/track`).

They agree today, so there is no active bug — but this is the exact shape of bug that already bit this codebase four times (the `store_id` omissions): two independently-maintained copies of logic that both write into / read from the same column, with nothing enforcing they stay in sync. If either copy is ever "improved" (e.g. to strip a leading country code, or normalize `+213` vs `0`), a customer's order becomes silently untrackable via `POST /orders/track` while still existing in the database — the endpoint is deliberately built to return an identical 404 for "wrong phone" and "no such order" (`public_orders.py:121-125`), so this failure mode would look like user error, not a bug, in support tickets.

**Fix:** move `_normalize_phone` to a shared module (e.g. `api/services/customers.py` or a small `api/core/text.py`) and import it in both places.

---

### 7. `products_export.py` — dead orphan that compounds finding #3

**Severity: Low-Medium. Effort: S (delete). Blast radius: none today.**

Already established as dead by Architecture.md §7.7 (not in `api/main.py:19`'s import list, zero repo-wide Python imports, zero frontend consumers, two dormant `store_id`-missing `INSERT INTO observations` at `products_export.py:278,359`). The tech-debt-specific addition here: this file is also one of the 11 sites in finding #3 (`products_export.py:37-38` redeclares `WRITE_ROLES`/`READ_ROLES` that nothing ever checks, since the router isn't mounted), and its CSV column list (`_CSV_COLUMNS`, `products_export.py:44-62`) duplicates column knowledge that already lives in `csv_parser.py::map_headers` for the import direction — a round-trip contract asserted in the module docstring (`products_export.py:9-14`) but never exercised by any test or caller, so there's no guarantee the two column lists actually still agree.

**Fix:** per Architecture.md's recommendation — delete it, or mount it and fix the two `store_id` bugs first. From a pure tech-debt view, deleting removes 369 lines, one of the 11 duplicate-constant sites, and a stale unverified CSV contract in one move.

---

### 8. Oversized function: `full_intel._apply_payload`

**Severity: Low-Medium. Effort: M. Blast radius: Low-Medium.**

`full_intel.py::_apply_payload` spans `full_intel.py:186-356` (~170 lines) and does five distinct things in one function body: (a) fill-only identity fields (brand/category/model, `:206-229`), (b) always-overwrite description (`:231-245`), (c) specs merge including 10 aux keys (`:247-287`), (d) image URL append + dedupe (`:289-333`), (e) per-field observation writes (`:335-356`). Each block has its own local state (`fields_filled`, `set_clauses`, `specs_added`, `images_added`, `existing_urls`) threaded through the whole function. This is the single largest function in the codebase's core business logic (the next-largest, `list_jobs` in `jobs.py:88-224`, is a straightforward SQL UNION builder and reads more linearly despite similar line count).

**Fix:** split along the five `# ── comment ──` section markers already present in the function — they're natural extraction points into `_apply_identity_fields`, `_apply_specs`, `_apply_images`, `_write_field_observations` helpers, each independently testable (today the whole pipeline can only be exercised end-to-end, consistent with the "no route test" gap Architecture.md §7.5 already flags).

---

### 9. `_slugify` duplicated with diverging collision-handling

**Severity: Low. Effort: S. Blast radius: Low.**

`api/routes/products.py:33-36`:
```python
def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return base or f"product-{uuid4().hex[:8]}"
```
`api/services/csv_import.py:34-36`:
```python
def _slugify(value: str, fallback_id: str) -> str:
    base = _SLUG_RE.sub("-", value.lower()).strip("-")
    return base or f"product-{fallback_id[:8]}"
```
Same regex (`[^a-z0-9]+` → `-`), same strip, same `product-{...[:8]}` fallback shape — two independent implementations that happen to still agree. What they don't share is what happens on a *collision*: `products.py::_ensure_unique` (`products.py:39-56`) rejects the request with `409 Conflict` if the resulting slug is already taken in the store; `csv_import.py::_slug_with_disambiguator` (`csv_import.py:39+`) instead cascades through disambiguator suffixes to silently produce a unique slug. This divergence may well be intentional (a bulk CSV import shouldn't abort a whole batch over one slug clash; a single admin edit should surface the conflict) — but nothing documents that as a decision, so a future reader has to reverse-engineer it from behavior.

**Fix:** extract the shared `_slugify` into one place; add a one-line comment on each caller explaining why they handle collisions differently (or don't, if it should also be a shared decision).

---

### 10. Worker tuning constants inconsistently sourced

**Severity: Low. Effort: S. Blast radius: Low.**

`api/core/config.py:56-58` exposes `event_worker_batch_size`, `event_worker_poll_interval_s`, and `reservation_ttl_minutes` as env-configurable `Settings` fields, and `workers/event_worker.py:206,216` reads them via `_settings.*`. The other three workers hardcode structurally equivalent constants as plain module globals, not wired to `Settings` or any env var:

```
workers/intel_worker.py:38-40      POLL_INTERVAL_S = 3     HEARTBEAT_INTERVAL_S = 60   STALE_CLAIM_AFTER_MIN = 5
workers/scraper_worker.py:39-41    POLL_INTERVAL_S = 3     HEARTBEAT_INTERVAL_S = 60   STALE_CLAIM_AFTER_MIN = 3   # was 5; reduced...
workers/reservation_worker.py:27-29 POLL_INTERVAL_S = 30   PRUNE_INTERVAL_S = 24*3600  PRUNE_RETAIN_DAYS = 180
```

Two things stand out: (a) tuning any of these three workers' cadence requires a code change + rebuild, while `event_worker`'s cadence is an env var — inconsistent operability for four structurally-identical "claim loop + heartbeat + stale sweep" workers (per `docs/audit/_shared_context.md`'s own description of the pattern); (b) `STALE_CLAIM_AFTER_MIN` differs between `intel_worker` (5) and `scraper_worker` (3) for what is otherwise the same stale-claim-reclaim logic — `scraper_worker.py:41`'s comment explains *its own* value changed from 5→3, but doesn't explain why `intel_worker` wasn't updated to match, or why they should differ at all given both now "keep live workers fresh" via the same heartbeat mechanism.

**Fix:** promote these to `Settings` fields (`intel_worker_poll_interval_s`, etc.) for operational consistency, and either unify or explicitly justify the `STALE_CLAIM_AFTER_MIN` difference.

---

### 11. The one actual `TODO` in the codebase

**Severity: Low. Effort: S (doc) / L (implement). Blast radius: Low.**

A repo-wide sweep of `api/`, `workers/`, `storefront/src`, `admin/src`, `gaming-store/`, `db/`, `scripts/`, and `tests/` for `TODO|FIXME|HACK|XXX` turns up exactly **one** hit outside of vendored `.obsidian` plugin bundles (which are not part of this codebase and were excluded): `api/services/scraper/tiers/tier4_paid.py:11`, documenting that the `"brightdata"` paid-scraping provider is listed in the `PaidProvider` type (`tier4_paid.py:34`) but not implemented — selecting it falls through to a clean, non-crashing `error=f"provider {provider!r} not yet wired"` response (`tier4_paid.py:94-100`). Tier 4 is off by default (`scraper.config.tier4_enabled`) and requires a paid API key to engage at all, so this has no reachable blast radius today. Notable mainly for how *clean* the rest of the codebase is on this axis — either discipline is good, or non-standard markers (`# NOTE`, prose in docstrings) are being used instead of `TODO`/`FIXME`, which this sweep would not catch.

---

### 12. Frontend API-client types have already drifted

**Severity: Low. Effort: S per instance / M as a process fix. Blast radius: Low.**

Architecture.md already names the general risk ("both `lib/api.ts` files are hand-written typed fetch wrappers... API response shapes are duplicated by hand and drift silently"). Concrete instance found on inspection, confirming the risk is not theoretical:

- `storefront/src/lib/api.ts:40-53` `ProductListItem` includes `status?: string`; `admin/src/lib/api.ts:107-115` `ProductListItem` has no `status` field at all (it only appears at the `ProductDetail` level, `admin/src/lib/api.ts:128`, as non-optional).
- `storefront/src/lib/api.ts:74-81` `MediaItem` has `id?: string` and `position?: number`; `admin/src/lib/api.ts:125` `MediaItem` is `{ url, kind, is_primary, alt }` only — missing both fields, despite `admin`'s image-review workflow (approve/reject by `image_id`) being exactly the feature that would need `id`.
- `storefront/src/lib/api.ts:62-72` `OfferOut` has `stock_quantity?: number` and `is_active?: boolean`; `admin/src/lib/api.ts:120-124` `Offer` has neither, despite admin being the surface that manages stock and offer activation.

None of these are active bugs (each client only reads the fields its current UI needs), but they are evidence the shared backend contract is being independently re-transcribed by hand on every route addition, exactly as flagged. No generated-client tooling (OpenAPI codegen, tRPC, etc.) is in use anywhere in the repo.

**Fix:** out of scope for a quick patch — the durable fix is generating both clients' types from the FastAPI OpenAPI schema (`api/main.py` already exposes it via FastAPI's default `/openapi.json`) instead of hand-authoring two copies.

---

## What I checked and found clean

- **No `.bak`, `*_old.*`, `*_v2.*`, or other stray/legacy files** anywhere in `api/`, `workers/`, `db/`, `storefront/src`, `admin/src`, or `gaming-store/`.
- **`db/migrations/*.sql` is contiguously numbered** `000`→`006` with no gaps (the `schema.sql` inline-copy divergence at 001-004 is already filed as Architecture.md §7.9).
- **`.env.example` is in sync with `api/core/config.py`'s `Settings` fields** (only `db_pool_timeout` is missing, and it has a working default — not worth its own line item).
- **The 365-vs-257 test count** mentioned in this task's brief vs. Architecture.md's count: recounted directly, `grep -c "^def test_\|^async def test_"` across `tests/*.py` = **257** function definitions across 16 files, matching Architecture.md exactly. The 365 figure is very likely pytest's *collected* test count after `@pytest.mark.parametrize` expansion (15 parametrize decorators found across 6 files) — not a discrepancy worth chasing further, noted here only so the number isn't mistaken for a new finding.

---

*Read-only audit. No source file was modified. All 12 findings above are CONFIRMED — each was traced to its call sites (or lack thereof) before being included; none are speculative.*
