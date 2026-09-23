# Plan: AMANATKOM — merchandising features + platform rebrand

## Working assumption (correct me if wrong)

**AMANATKOM is the PLATFORM name, not a replacement for GLAIVE.**

This repo already hosts several brands you own: one row in `stores` per brand,
each with its own domain, catalog, theme, order numbering and orders. AMANATKOM
becomes the umbrella over those brands — the admin console, `app_name`, the
README, the deployment. GLAIVE stays exactly as it is: brand #1, gaming gear,
its own storefront identity. Ghir Laffaire stays queued as brand #2.

Nothing GLAIVE-facing gets renamed — not the hero copy, not the logo, not the
brand tokens. If you actually meant "rename the storefront to AMANATKOM too",
say so before Phase 0 and it is a small change to this plan, not a large one.

## Source of the feature list

`https://glaivestore.netlify.app` — the static prototype in `gaming-store/`,
published to Netlify by a bot in June. It is the design reference for WHAT to
build. It is explicitly **not** a source of content:

- Its catalog is SteelSeries' real product line by name (Arctis Nova Elite,
  Apex Pro TKL Gen 3, Aerox 3 Wireless Gen 2, Prime Wireless, QcK Heavy,
  Rival 3 Gen 5).
- Its "GLAIVE GG" section describes **Sonar**, **Engine Apps** and **Moments** —
  the three real modules of SteelSeries GG.
- It claims "more championships than any other brand" and "25 years · world's
  #1 gaming brand".

None of that ports. We archived the same class of content in `553e8dd` for the
same reason. Structure and layout port; names, claims and copy do not.

> Separately: that Netlify site is live on the public internet with the full
> clone. Worth unpublishing or pointing at the real store. Not this plan's work.

## What "restyle lightly" means here

The two design systems are already the same system. Measured, not assumed:

| Token | Prototype | React storefront |
|---|---|---|
| background | `#0a0a0b` | `#0A0A0B` — identical |
| text | `#f5f5f6` | `#F5F5F6` — identical |
| success | `#36d399` | `#36d399` — identical |
| `radius-sm` | `6px` | `6px` — identical |
| brand orange | `#ff5101` | `#FF5A1F` — near-identical |

The React storefront is the **superset** — it adds accent yellow, punk pink,
glass tokens, a motion scale and a full radius ramp (43 tokens vs 48, but
broader). The prototype contributes only two things worth taking: a fluid
`clamp()` type scale, and `--sh-glow`.

So "restyle" is **not** a visual overhaul. It is exactly two things:

1. Adopt a fluid `clamp()` type scale.
2. Fix the 55 hardcoded `text-[10px]` instances and the 18 `w-[1400px]`
   instances — an audit finding (below readable minimum, and they bypass the
   token system that already exists).

Everything else visual stays. The audit's "what passes — don't fix these" list
is a **no-touch list**: the French copy, the hero, the `alt` coverage, the
error/empty/loading states.

## Global constraints

These get lost across subagents. They are not optional.

- **Additive only.** "Don't remove anything useful." Existing components
  (`ProductCard`, `Home`, `Navbar`, `Footer`) gain props and sections; they are
  not rewritten. Grep for callers before changing any signature. No deletion
  without proving non-use.
- **French + DZD everywhere.** The prototype is English/USD/US-market. Porting
  layout must not drag copy, currency or shipping claims across. 58 wilayas,
  COD-first, stays.
- **`store_id NOT NULL` on every new table.** Four separate `store_id` bugs were
  found this session that 365 green tests missed. `reviews` carries `store_id`.
- **404, never 403, for cross-store access.** Same rule as every other resource.
- **`python -m pytest tests/` must not drop below 414 passed.**
- Stay on `gaming-store`. No force git ops. Stage explicit paths, never `-A`.
- Conventional commit subject ≤72 chars + body. No AI/tool attribution.
- **Close `htmlFor` on any form you touch.** `htmlFor` currently appears **zero**
  times across 6 inputs — a Critical finding in `audit/Accessibility_Report.md`.
  The newsletter form and the review form are new forms; they ship correct.

## Phase 0 — Rebrand layer

Cheap, self-contained, independent of every feature below. One commit.

- `api/core/config.py:10` — `app_name: str = "GLstore API"` → AMANATKOM.
- `admin/index.html:7-8` — title and meta currently say "Ghir Laffaire — Admin
  Console". That is brand #2's name sitting on the platform console.
- `README.md`, `CLAUDE.md` §1, `DEPLOY.md` header.
- Leave every `--color-*` token, the GLAIVE logo, and all storefront copy alone.

**Verify:** `python -m pytest tests/` ≥414; grep shows no GLAIVE-facing string
changed.

## Phase 1 — Migration 008 + endpoints (serialized, foundational)

One migration, not three: one advisory-lock cycle, one checksum, one
`apply_migrations.py --dry-run` for the operator.

`db/migrations/008_merchandising.sql`:

1. **`reviews`** — `id`, `store_id NOT NULL REFERENCES stores`, `product_id`,
   `customer_name`, `rating` (`CHECK 1..5`), `title`, `body`,
   `status review_status_enum NOT NULL DEFAULT 'PENDING'`, timestamps.
   `status` is not optional: a COD-market shop with unmoderated public reviews
   is a spam target on day one.
2. **`product_badge_enum`** (`NEW`/`BEST_SELLER`/`PRO`/`SALE`) + a nullable
   `badge` column on `products`. An enum, not three booleans — one badge shows
   at a time, and the DB should say so. `SALE` is derivable from `sale_price`
   but merchants expect to set it explicitly.
3. Indexes: `(store_id, product_id)` on reviews, partial index on
   `status='APPROVED'`.

Endpoints:

- `POST /products/{id}/reviews` — public, store from **Host**, lands `PENDING`.
- `GET /products/{id}/reviews` — public, `APPROVED` only.
- `GET /reviews?status=PENDING` + `PATCH /reviews/{id}` — admin, store from
  `x-store-id`, 404 across stores.
- `PATCH /products/{id}` — extend to accept `badge`.
- Add `avg_rating` + `review_count` (APPROVED only) to the product list and
  detail responses.

**Verify:** mutation-tested tenancy tests for `reviews` in the style of
`tests/test_store_context.py`; ≥414 tests; migration is pure SQL, no
`api/core/migrations.py` edits.

## Phase 2 — Storefront sections (parallelizable — 10 units)

Each is one component plus its wiring, independently reviewable. This is where
parallel implementers earn their cost.

| # | Unit | Backend need |
|---|---|---|
| 1 | Category grid ("find your weapon") | `GET /catalog/categories` — exists |
| 2 | Hero stat callouts | static copy |
| 3 | Fluid `clamp()` type scale + `text-[10px]`/`w-[1400px]` cleanup | none |
| 4 | Newsletter capture (with `htmlFor`) | new tiny endpoint or stub |
| 5 | Sale-price treatment (strike + % off) | `offers.sale_price` — exists |
| 6 | Badges on `ProductCard` | Phase 1 `badge` |
| 7 | Ratings display + review form | Phase 1 reviews |
| 8 | Compare | localStorage only |
| 9 | Quick-view modal | existing product data |
| 10 | "Find your gear" quiz | filters `products.specs` jsonb |
| 11 | Wishlist | localStorage only — see decision below |

**Verify-first on #6:** `ProductCard` already imports `deriveTags()` from
`lib/tags.ts` and renders a `Tag` component. Badges likely **extend** that
helper rather than replace it. Read it before writing.

### Wishlist — decision, not an open question

Wishlist needs customer identity. This platform has none: `customers` is a
COD-order record (name, phone, address) — no login, no session, no password
reset. Three options were considered:

- **(a) localStorage, client-side only — CHOSEN.** Matches Compare. Zero
  backend, zero auth, works, and does not pretend to be an account.
- (b) Phone-number-keyed with an OTP flow. Actually the right Algerian-market
  pattern — phone is identity, email is not a habit — but it is SMS infra that
  does not exist here.
- (c) Full customer accounts. A separate epic. Out of scope for "restyle
  lightly".

(b) is the correct future. Revisit when SMS exists.

## Phase 3 — Admin

- Review moderation queue (approve/reject, store-scoped).
- Badge assignment in `ProductEditor`.

## Phase 4 — Prove "prod-ready" moved

Re-run the 10-dimension audit from this session against the changed storefront
and publish the delta. The baseline to beat:

| Dimension | Before |
|---|---|
| Brand specificity | 4 |
| Copy specificity | 8 |
| Visual identity | 7 |
| UX logic | 7 |
| Content quality | 3 |
| Responsiveness | 6 |
| Accessibility | 3 |
| Performance | 6 |
| Engineering | 8 |
| Business understanding | 9 |

Accessibility (3) and Content quality (3) are the two that should move most —
reviews and badges are content, and every new form ships with labels.

## Known open items (flagged, not actioned here)

- The Netlify clone is still live and public.
- `.python-version` / Vercel build: pinned but never verified against a real
  Vercel build.
- Local Postgres download parked (curl exit 4, probably transient) — retry when
  a live DB is next needed. **Migration 008 has never run anywhere**, same
  caveat as 005–007.
- Storefront dev server on :5173 is the visual-check surface for Phase 2.
- Zero product images remains unaddressed; badges and ratings will make the
  placeholder tiles more obvious, not less.
