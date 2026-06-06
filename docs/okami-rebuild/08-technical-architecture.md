# 08 — Technical Architecture

## A. High-level shape

```
        ┌──────────────────────────────┐
        │     OKAMI Storefront (web)   │
        │     Next.js 15 (App Router)  │
        │     Vercel · Edge + Node     │
        └────────┬─────────────────────┘
                 │  REST / GraphQL
        ┌────────┴──────────┐
        │   BFF layer       │   — server actions + route handlers
        └─┬────────┬─────────┬─────────┬────────┬──────────┐
          │        │         │         │        │          │
          ▼        ▼         ▼         ▼        ▼          ▼
       Custom    Sanity   Algolia   Klaviyo   Stripe/CIB Postgres
       Commerce   (CMS)   (search)  (email)   (cards)    (drops,
       (existing                                          loyalty,
        backend)                                          reviews,
                                                          magic-link)
```

Storefront is **server-rendered**: Next.js takes over the current
React-SPA surface, the existing custom commerce backend continues to
own products, variants, inventory, orders, and the custom checkout.
Sanity (or Payload) owns editorial. A small Postgres (Neon / Supabase)
holds what the commerce backend does not — first-class drops, queue
tickets, reviews with media, loyalty ledger, magic-link tokens.

## B. Stack — choices and rationale

| Layer | Pick | Why |
|---|---|---|
| Front-end | **Next.js 15 (App Router)** on Vercel | Edge + RSC give us per-route ISR / SSR; image pipeline included; framework-supported i18n + middleware. |
| Styling | **Tailwind v4** + design tokens (§06) | Token-driven, low CSS bloat. |
| UI | **shadcn/ui** + custom | Headless primitives we own; no runtime lock-in. |
| Motion | **Framer Motion** for page reveals; pure CSS for micro | Predictable on mobile; reduced-motion respected. |
| Commerce | **Existing custom backend** (typed client in `packages/commerce`) | Already owns products, variants, inventory, orders, custom checkout; do not replace what works. |
| CMS | **Sanity v3** *(or Payload CMS on Postgres)* | Real-time editor, strong i18n, image pipeline; Payload is a viable self-hosted alternative. |
| Search | **Algolia** (with **Typesense** as self-hosted fallback) | Sub-50 ms suggest; typo tolerance critical in FR/AR. |
| Analytics | **PostHog** (product) + **Plausible** (privacy-friendly traffic) | EU-friendly defaults; cohorts + funnels in PostHog. |
| Email | **Klaviyo** | Best-in-class for drop notifications + flows. |
| SMS | **MessageBird / Vonage** | Algeria coverage. |
| Reviews | First-party (Postgres) + Judge.me-style schema | Photos + verified buyer; export-ready. |
| DB | **Postgres** on **Neon / Supabase** | Drops, loyalty, reviews. |
| Hosting | **Vercel** (Edge + Node) | Native Next.js; preview env per PR. |
| Image CDN | `next/image` (Vercel) + Sanity image pipeline | One AVIF/WebP + responsive `srcset`. |
| Observability | Vercel Analytics + Sentry + PostHog session replay (sampled) | Real user, errors, replays. |
| CI | GitHub Actions | Test + lint + visual + Lighthouse on PR. |

## C. Rendering strategy per route

| Route | Strategy | Cache key |
|---|---|---|
| `/` | ISR · 5 min · revalidate-on-publish webhook | `home_{locale}` |
| `/shop` (catalog) | ISR · 5 min · per-collection tag | `shop_{locale}` |
| `/shop?…filters` | Edge SSR (filtered subsets) | `shop_{filterHash}` (short TTL) |
| `/shop/[handle]` (PDP) | ISR · 1 h · webhook on stock or price change | `prod_{handle}` |
| `/drops/[slug]` | ISR + edge re-render at scheduled flip | `drop_{slug}_{state}` |
| `/journal/[slug]` | ISR · 1 day | `post_{slug}` |
| `/search` | Edge SSR (real-time) | none |
| `/cart`, `/checkout` | Dynamic (CSR + server actions) | none |
| `/account/**` | Dynamic | per-user |

Webhooks revalidate by tag (`revalidateTag('prod_{handle}')`). Drops
flip state via a cron + an `edge config` flag.

## D. i18n & routing

- App Router middleware reads the `lang` cookie or `accept-language`.
- Routes carry the locale segment except for default EN (`/`, `/fr/`,
  `/ar/`).
- AR uses `dir="rtl"`; component layouts are logical (`start`/`end`)
  not physical.
- Currency: locale-derived default + visible switch; pricing in DZD,
  display conversion only.

## E. Data flow

### E.1 Read paths
```
Page render → server fetch (Custom Commerce API + Sanity + Postgres)
            → React Server Component tree → streamed HTML
```

### E.2 Mutations (cart, wishlist, checkout, reviews)
```
Client → Server Action / Route Handler
       → external service (Commerce API, Klaviyo subscribe, Postgres insert)
       → revalidatePath / revalidateTag
       → optimistic UI rolled back on error
```

### E.3 Drops
- A drop record in Postgres: `id, slug, state, scheduledStart,
  scheduledEnd, productIds[], heroAsset, accentTokens`.
- A cron (Vercel cron or Upstash QStash) flips state at the scheduled
  start/end; calls `revalidateTag('drop_*')`.
- The drop hero `<Countdown>` reads `scheduledStart` directly so the
  countdown is correct at first paint.

## F. Authentication

- **Magic-link** primary (Klaviyo or Resend) → JWT cookie (HTTP-only,
  SameSite=Lax, Secure).
- Optional password-add for power users.
- The commerce-backend customer record is created on first purchase
  or first wishlist sync; storefront calls the commerce API with a
  scoped access token.
- The verified `admin.` subdomain (Inter-forced UI) continues to use
  its own role-based scheme, unchanged.

## G. Payments

- **COD** default — commerce-backend order placed with
  `paymentStatus = pending`, fulfilled offline.
- **Card** secondary — Stripe (where DZ card processing is available)
  or CIB integration via a local gateway.
- All card flows are PCI-SAQ-A (we never touch PAN).

## H. Search

- Algolia index per locale: `products_en`, `products_fr`, `products_ar`.
- Index attributes: `title`, `description`, `tags`, `drop`, `colour`,
  `character`, `material`.
- Synonyms: `hoodie ↔ sweat ↔ سويت` etc.
- Index updated via commerce-API webhook → ingestion worker.

## I. SEO + structured data

- Next.js generates the sitemap.
- Per route: `metadata` export sets canonical, OG, Twitter, hreflang.
- `<script type="application/ld+json">` rendered server-side per page:
  - Home: `Organization` + `WebSite` + `BreadcrumbList`.
  - PLP: `BreadcrumbList` + `ItemList`.
  - PDP: `Product` + `Offer` + `AggregateRating`.
  - Drop: `Event` + `Product[]`.
  - Journal: `Article`.

## J. Performance budgets — enforced

- Lighthouse CI runs on every PR; budgets fail the build:
  - Performance ≥ 90 mobile, ≥ 95 desktop.
  - LCP < 1.8 s 4G; CLS < 0.05; INP < 200 ms.
- Bundle size budget (Next.js): `≤ 120 KB gz` initial.
- Image budget: hero `< 100 KB`; PDP main `< 80 KB`.

## K. Observability

- **Sentry** for errors (frontend + Next.js node).
- **PostHog** for analytics + session replay (sampled 5 %; off in AR
  to avoid PII).
- **Vercel Analytics** for Web Vitals on real traffic.
- A "drop-day dashboard" (Grafana) shows: TTFB p95, error rate,
  cart-add rate, sellout times.

## L. Security

- CSP with strict allow-list; `script-src` is hash/nonce, no `unsafe-inline`.
- HSTS, `Referrer-Policy: strict-origin-when-cross-origin`, COOP/COEP
  where viable.
- Rate-limit on auth, order-tracking, review submission.
- Audit log for admin actions in Postgres.

## M. Data residency & privacy

- EU + DZ traffic — primary region Frankfurt for Vercel + DB.
- GDPR: cookie banner with category gating (necessary always on).
- DSAR endpoint (`/legal/data-request`) and one-click delete-account.

## N. Local development

- `pnpm` workspaces; one repo (`apps/web`, `apps/cms`, `packages/ui`,
  `packages/tokens`, `packages/commerce`).
- `docker-compose` brings up Postgres + Redis locally.
- Sanity hits a dev dataset; the commerce backend hits a dev origin;
  secrets in `.env.local`.
- `pnpm dev` runs Next + Sanity Studio + tokens watcher.

## O. Drop-day failure modes

| Failure | Detection | Mitigation |
|---|---|---|
| Origin overload | `ttfb > 1 s` p95 alert | Edge cache + queue page (5 s wait) |
| Oversell | Commerce-API webhook on stock < 0 | Stop add-to-cart; show sold-out |
| Cart write 5xx | Sentry + PostHog funnel drop | Retry with backoff; toast "try again" |
| Email blast bounces | Klaviyo rate-limit | Pre-warm with smaller cohorts (10 % → 50 % → 100 %) |
| CDN image misses | Vercel image-error rate | Pre-warm CDN by curling top URLs |

## P. Why this stack (and what we are giving up)

- We keep the existing commerce backend because: products, variants,
  inventory, orders, the custom checkout, and the `admin.` console
  are already running and tuned for the Algerian market.
- We give up: nothing on the commerce side.
- We pick Next.js over a static SSG (Astro/Eleventy) because: server
  actions, ISR, route-level streaming, and middleware are necessary
  for an account + drops + search storefront.
- We pick Sanity over Contentful because: real-time editor, strong
  i18n, image pipeline, cheaper at this scale. Payload is a serious
  Postgres-native alternative.

## Q. The OKAMI-specific bits the architecture exists for

- **Server-rendered countdowns** that are right on first paint.
- **Tagged revalidation** so a publish reflects in ≤ 5 s, not 15 min.
- **Postgres for drops + loyalty + reviews** so the product is not
  bound by what the commerce backend chooses to model.
- **Magic-link auth** so 40 %+ account creation is realistic.
- **Edge image pipeline** so the photography never bottlenecks LCP.
