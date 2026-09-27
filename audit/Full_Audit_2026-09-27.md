# Full project audit — 2026-09-27

> Scope: everything on branch `gaming-store` at `6b80b3f` — backend, workers,
> database, both React apps, the static prototype, deployment, CI, tests,
> docs, git. Method: measured, not recalled. Every finding names a file and
> line so it can be checked. This file replaces the need to read the 17
> earlier files in this folder; §8 says what to do with them.

## 1. Verdict

The engineering underneath is better than the product on top of it. The
backend has real tenancy, real money handling and a well-designed financing
gate. But the shop **cannot take a real order safely today**: a shopper can
set their own discount, a confirmed order can silently skip stock, and there
is no shipping model at all. Around it sit three brand identities, an admin
that is not deployed anywhere, 39 % of backend code that cannot run on the
platform it deploys to, and ~150 MB of editor plugins and `node_modules`
committed to git.

## 2. Ship-stoppers — fix before any real order

### 2.1 Shoppers set their own discount → 0.00 DZD orders
`api/models/schemas.py:125-126` takes `shipping_cost` and `discount_amount`
from the client. `api/services/orders.py:131-133` only rejects `total < 0`.
`discount_amount == subtotal` yields a `0.00` COD order the courier is told to
collect. The storefront never sends the field; anyone with `curl` can.
**Do:** remove both fields from the public DTO (or force them to 0
server-side), add a FakeSession regression test.

### 2.2 Confirming an order after 30 minutes silently oversells
`orders.py:229-236` consumes only reservations still `ACTIVE`.
`fn_expire_stale_reservations` (`db/schema.sql:559-578`) releases the hold
after `RESERVATION_TTL_MINUTES=30` (`config.py:62`) and touches nothing on
`orders`. So the confirm loop runs zero times and the order is marked
`CONFIRMED` with its stock already back on the shelf. In a COD business the
operator confirms by phone hours later: on Docker this is most orders; on
Vercel it is every order confirmed after the 03:00 cron. This is a cart TTL
applied to placed orders, not a missing `if`.
**Do:** confirm must 409 (or re-reserve atomically) when any reservation is
not `ACTIVE`; choose a hold policy that matches the COD workflow; show
"stock released" as a state in the admin.

### 2.3 There is no shipping model, and the copy says there is
Nothing computes a fee from the wilaya; the storefront sends no
`shipping_cost`; `ProductDetail.tsx:386` says "livraison calculée à la
commande" (false) and `index.html:8` + `Footer.tsx:59,113` promise delivery
in all 58 wilayas (unverified, and outside `brand-copy.test.ts`). Either the
shop eats delivery on every order or the courier adds it off-system.
**Do:** decide the delivery policy (business), then a server-side wilaya fee
table, then fix the copy and extend the guard to `index.html`.

## 3. Identity — one product, three names, wrong branch

- README says the platform hosts **GLAIVE** and **Ghir Laffaire**; the
  storefront is **AMANTCOM**; the owner's business is Bouakil / El Yusr.
  Across README, DEPLOY, CLAUDE.md, docs/ and audit/: 22 files say Ghir
  Laffaire, 19 say GLAIVE, 7 say AMANTCOM.
- The production branch is literally named `gaming-store`; `origin/HEAD` is
  `main`, which cannot deploy. Ten remote branches, seven of them stale agent
  branches.
- `DEPLOY.md:59-88` still initialises the live DB as brand GLAIVE / prefix
  GLV with 15 invented products ACTIVE; `docker-compose.yml:13-14` mounts the
  SteelSeries-derived seed and the demo seed.
- `gaming-store/` (static prototype, 13 files) is still in the repo and in
  CLAUDE.md's quick start.
- The El Yusr = AMANTCOM question has been open since Phase D and decides
  `stores` seeding.
**Do:** answer the El Yusr question; pick one name; rename the branch to
`main` (or make `gaming-store` the default); delete `gaming-store/`, the two
seeds and `docs/GAMING_STORE.md`; rewrite README and DEPLOY for AMANTCOM.

## 4. The admin is not deployed
`vercel.json` builds only `storefront/` and `api/index.py`; `.vercelignore`
excludes `admin/`. `DEPLOY.md:342-352` tells the operator to run the admin
locally with Node and a terminal. There is no CI job for the admin either
(`.github/workflows/tests.yml` has pytest, bundle-import and storefront jobs;
nothing builds or tests `admin/`, which has zero tests).
Daily experience once it is hosted: the JWT lasts 60 minutes
(`security.py:36`), `/login` is the only auth route (`auth.py:99`),
`jwt_refresh_ttl_days` is dead config, so the operator is logged out hourly.
There is no way to add a user, change a password or reset one except
`scripts/create_admin.py` and SQL; the seeded credential is in the repo
(`db/seed_admin.sql`). Navigation is English, pages are French
(`Layout.tsx`, 13 labels).
**Do:** deploy the admin as a second Vercel project (or under `/admin`); add
an admin CI job; add refresh tokens or a longer TTL; add user management and
password change; rotate the seed; pick one language.

## 5. Repo hygiene
- `admin/node_modules` is tracked: 8,167 files, ~31 MB. `.obsidian/` is
  tracked: 100 files, ~120 MB of Copilot plugin binaries. The pack is 59 MB
  for 69 commits. Neither is in `.gitignore` (`node_modules/` is, but the
  files were committed first).
  **Do:** `git rm -r --cached admin/node_modules .obsidian`, add
  `.obsidian/`, commit. Rewriting history to shrink the pack is a separate,
  destructive decision for the owner.
- Never imported: `api/core/metrics.py`,
  `api/services/scraper/tiers/tier3_5_patchright.py`. `monitoring/` and
  `docker-compose.observability.yml` are wired to nothing. **Delete or wire.**
- Three migration paths: the startup runner (`api/main.py:49`),
  `scripts/migrate.py`, `scripts/deploy/{init_remote_db,apply_migrations}.py`.
  Migrations 010–014 have never run anywhere. **Keep one path; apply 010–014
  to a Neon branch.**

## 6. Security and abuse
- **No security headers anywhere.** CLAUDE.md claims "CSP/X-Frame/HSTS";
  `grep` finds none in `api/` or `vercel.json`. The admin JWT sits in
  `localStorage` (`admin/src/lib/auth.tsx:22`) with no CSP over it.
  **Do:** add a `headers` block to `vercel.json` and the middleware to the API.
- **Fake COD orders can drain stock.** `POST /orders/create` has no captcha,
  no per-phone cap on pending orders, and the per-IP limiter is per-process
  memory (`ratelimit.py:16`, `auth.py:80`) — on serverless that is nearly
  nothing. **Do:** Turnstile on checkout, a per-phone pending cap, a
  DB-backed limiter.
- **SSRF surface (Docker only).** Scrape-source URLs are free text and
  `searxng_url` is admin-settable (`scraper.py:431`); nothing rejects private
  addresses. **Do:** validate scheme and resolved IP before fetching.
- `react-router` GHSA-8x6r-g9mw-2r78 is flagged in both apps. It is the
  framework-mode `__manifest` endpoint; not reachable from a `BrowserRouter`
  SPA. **Bump anyway** (`npm audit fix`).
- No `robots.txt`, no sitemap, no analytics; `readyz` is permanently red on
  Vercel (`health.py:204` requires SearXNG) but nothing polls it; the daily
  cron clears at most 200 stale holds (`schema.sql:568`) and never passes
  `?prune=true`, so `fn_prune_identity` never runs. **Fix the cron query
  string; make the SearXNG probe optional.**

## 7. Dead in production, alive in the repo
The Vercel deployment runs no workers. The scraper engine (5,681 lines) and
the intel/LLM pipeline and workers (~8,400 lines together, **39 % of the
21,544-line backend**) cannot execute there. The admin ships a Jobs Console
(585 lines), a force-directed Catalog Graph (1,379 lines) and Image Review
that all depend on them. Rule-based enrichment works; LLM bulk enrichment
runs inside a request with no circuit breaker. Image Review has no upload
endpoint — only approve/reject of images the scraper never fetches — so
**there is still no way to put a product photo on the site in production.**
**Do:** decide whether the scraper/intel stack is part of this product. If
not, move it out of the deploy and out of the admin nav. Either way, add a
direct image upload.

## 8. Tests, CI, docs
- Backend: 956 passed, 6 skipped (lxml absent locally; CI installs it).
  ~40 % of backend test functions (221 of 540) read source text rather than
  behaviour; 6 of 30 files use FakeSession; none touch a real database, so
  the trigger bodies in 011–014 are unverified. Storefront: 302. Admin: 0.
- No linter or formatter anywhere: no ruff, no mypy, no ESLint config in
  either app, no `npm audit`/`pip-audit` gate.
  **Do:** ruff + ESLint in CI; an admin job; one integration test against a
  Postgres service.
- 68 Markdown files, ~12,000 lines in `docs/` + `audit/`. CLAUDE.md, the
  declared source of truth, says 13 tables (39), 18 route modules (28),
  "products_export is not mounted" (it is, `main.py:199`), "security headers"
  (none), and describes a gaming-gear store.
  **Do:** rewrite CLAUDE.md from the code; collapse `audit/` to this file,
  `Phase_F_Delta.md` and `Accessibility_Report.md`; delete the rest.

## 9. Product gaps the operator will hit first
No legal pages (CGV, privacy, legal notice). No Arabic. Home renders `null`
on API error (`Home.tsx:272,297`) — API down means a blank page. Contact
messages land in a table nobody is notified about. Phone sign-in answers 503
until an SMS provider exists. Financing is legally gated (see
`docs/compliance/financing-compliance-checklist.md`). No restore procedure
is documented for the database. Text contrast still fails AA.

## 10. What is solid — keep it
Store scoping with composite FKs and 404-never-403; the financing gate,
versioned rules and server-computed figures; hashed OTP and sessions with
fail-closed SMS and document storage; documents streamed, never linked; the
CI serverless-import guard and loud-skip guard; the static guards for credit
copy, brand copy and icon-button names; migrations under an advisory lock.

## 11. Order of work
1. §2.1 and §2.2 — **done 2026-09-27**: the public DTO no longer accepts a
   price component; confirm re-reserves an expired hold and answers 409 when
   the stock is gone; the order detail reports `stock_hold` and the admin
   shows it. Tests: `tests/test_orders_money_and_stock.py`.
2. Decide delivery policy; build the wilaya fee table (§2.3).
3. Untrack `node_modules` and `.obsidian` (§5).
4. Deploy the admin; add its CI job; fix session length (§4).
5. Settle the name and branch; purge GLAIVE/Ghir Laffaire; rewrite CLAUDE.md,
   README, DEPLOY (§3, §8).
6. Security headers, checkout abuse guards, cron fix (§6).
7. Direct image upload; decide the scraper's fate (§7).
8. Apply 010–014 to a Neon branch; run the signed-in flows end to end.
9. Then the compliance checklist's pre-launch list.
