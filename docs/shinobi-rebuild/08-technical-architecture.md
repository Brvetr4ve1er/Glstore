# 08 — Technical Architecture

## A. High-level shape

The single most important architectural decision: **SHINOBI rides
on the existing Glstore FastAPI commerce backend that lives in this
repo**. We do not rebuild what already solves COD, 58-wilaya
addresses, order tracking, admin console, scraper, URL import.

```
        ┌────────────────────────────────────┐
        │   SHINOBI Storefront (web)         │
        │   Next.js 15 (App Router)          │
        │   Vercel · Edge + Node             │
        └────────┬───────────────────────────┘
                 │  REST  (/api/v1/*)
        ┌────────┴──────────┐
        │   BFF layer       │   — server actions + route handlers
        └─┬────────┬─────────┬─────────┬────────┬──────────┐
          │        │         │         │        │          │
          ▼        ▼         ▼         ▼        ▼          ▼
       Glstore   Sanity    Algolia   Klaviyo   Stripe /   Postgres
       FastAPI   (CMS)     (search)  (email)   CIB        (custom orders,
       backend                                              drops state,
       (this repo)                                          reviews + media,
                                                            loyalty,
                                                            magic-link)
```

The Glstore backend owns products, variants, inventory, orders, the
custom checkout, the admin console, the URL importer, and the
multi-tier scraper.

Sanity (or Payload) overlays editorial — drops, lookbook, journal,
home composition, founder lines, per-product copy and SEO overrides.

A small Postgres (Neon / Supabase) sits **alongside** the backend's
DB and holds the SHINOBI-specific concepts that don't belong in the
generic catalog: custom-order configurations, drop state, reviews
with media, loyalty ledger, magic-link tokens, queue tickets.

## B. Stack — choices and rationale

| Layer | Pick | Why |
|---|---|---|
| Front-end | **Next.js 15 (App Router)** on Vercel | RSC + edge + ISR; framework-supported i18n + middleware; image pipeline. |
| Styling | **Tailwind v4** + design tokens | Token-driven; low CSS bloat. |
| UI | **shadcn/ui** + custom | Headless primitives we own; no runtime lock-in. |
| Motion | **Framer Motion** for page reveals; CSS for micro | Predictable on mobile; reduced-motion respected. |
| Commerce | **Glstore FastAPI** (already in this repo) | COD, 58 wilayas, order tracking, admin — already solved. |
| CMS | **Sanity v3** *(or Payload on Postgres)* | Real-time editor, strong i18n, image pipeline. |
| Search | **Algolia** (Typesense as self-hosted fallback) | Sub-50 ms suggest; typo tolerance critical in FR/AR. |
| Analytics | **PostHog** (product) + **Plausible** (privacy traffic) + **Meta Pixel** + **TikTok Pixel** | Funnels + retargeting. |
| Email | **Klaviyo** | Best-in-class for drops + restock. |
| SMS | **MessageBird / Vonage** | DZ coverage. |
| Reviews | First-party (Postgres) + Judge.me schema | Photos + verified buyer; export-ready. |
| DB (SHINOBI-side) | **Postgres on Neon / Supabase** | Drops, reviews, loyalty, magic-link, custom-order configs. |
| Hosting | **Vercel** (Edge + Node) | Native Next.js; preview env per PR. |
| Image CDN | `next/image` + Sanity image pipeline | AVIF / WebP `srcset`. |
| Observability | Sentry + PostHog session replay (sampled) + Vercel Analytics | Errors + Web Vitals + sampled replays. |
| CI | GitHub Actions | Lint + test + visual + Lighthouse on PR. |

## C. Rendering strategy per route

| Route | Strategy | Cache key |
|---|---|---|
| `/` | ISR · 5 min · revalidate-on-publish webhook | `home_{locale}` |
| `/shop` | ISR · 5 min · per-collection tag | `shop_{locale}` |
| `/shop/{handle}` | ISR · 1 h · webhook on stock or price change | `prod_{handle}` |
| `/custom` | ISR · 1 day | `custom_landing_{locale}` |
| `/custom/quote/{id}` | Dynamic | per-quote |
| `/drops/{slug}` | ISR + scheduled edge re-render | `drop_{slug}_{state}` |
| `/journal/{slug}` | ISR · 1 day | `post_{slug}` |
| `/boutique` | ISR · 1 day | `boutique_{locale}` |
| `/search` | Edge SSR | none |
| `/panier`, `/checkout` | Dynamic (CSR + server actions) | none |
| `/compte/**` | Dynamic | per-user |

Webhooks revalidate by tag (`revalidateTag('prod_{handle}')`).

## D. i18n & routing

- App Router middleware reads the `lang` cookie or
  `Accept-Language`.
- **FR is default** (no prefix). EN routes carry `/en/`. AR carries
  `/ar/` and `dir="rtl"` in v1.1.
- Component layouts use logical (`start` / `end`) not physical
  (`left` / `right`) styles.
- Currency: DZD primary; EUR display option; payment in DZD.
- URL strategy: `hreflang` per route; `x-default` to FR.

## E. Data flow

### E.1 Read paths
```
Page render → server fetch (Glstore /api/v1/* + Sanity + Postgres)
            → React Server Component tree → streamed HTML
```

### E.2 Mutations
```
Client → Server Action / Route Handler
       → Glstore /api/v1/* OR Postgres (custom-order, review, loyalty)
       → revalidatePath / revalidateTag
       → optimistic UI rolled back on error
```

### E.3 Custom orders
- A `customOrder` row in Postgres carries `baseId`, `designId`,
  `doubleSide`, `size`, `colour`, `notes`, `quotedPrice`,
  `customerEmail`, `customerPhone`, `state`.
- When added to cart, an opaque "custom line" is sent to the
  Glstore cart with `meta.customOrderId`.
- Owner-facing admin "Print Queue" page reads from Postgres,
  grouped by `base × design`, with status states (`new → printed
  → ready → handed_off`).

### E.4 Drops
- `Drop` record in Postgres: `state`, `scheduledStart`,
  `scheduledEnd`, `productSlugs[]`, `heroAsset`, `accentTokens`.
- Cron flips state at scheduled boundaries and calls
  `revalidateTag('drop_*')`.

## F. Authentication

- **Magic-link** primary (Klaviyo or Resend) → JWT cookie
  (HTTP-only, SameSite=Lax, Secure).
- Optional password set later.
- The Glstore backend's customer record is mapped 1:1 with the
  magic-link user.
- Admin (the owner) uses the Glstore admin console's role-based
  scheme, unchanged.

## G. Payments

- **COD** default — Glstore order created with
  `paymentStatus = PENDING`, fulfilled offline.
- **Card** secondary — Stripe (where DZ card processing is
  available) or CIB integration via a local gateway. We are
  PCI-SAQ-A (never touch PAN).

## H. Search

- Algolia index per locale: `products_fr`, `products_en`,
  `products_ar` (v1.1).
- Indexed attrs: `title`, `description`, `tags`, `anime`,
  `character`, `colour`, `size_available`.
- Synonyms: `tee ↔ tshirt ↔ t-shirt`, `pull ↔ hoodie ↔ sweat`, anime
  romanisations (Naruto ↔ ナルト, …).
- Indexer fed by Glstore webhooks on product update.

## I. SEO + structured data (Phase 1)

- Per-route `metadata` exports.
- `<script type="application/ld+json">` rendered server-side per
  page: see [05-rebuild-strategy.md §I](./05-rebuild-strategy.md#i-seo-architecture-highlights).
- **`/boutique` uses `LocalBusiness`** with address, openingHours,
  geo, priceRange — biggest local-SEO unlock for the brand.
- **`/custom` uses `Service`** with `Offer` and the price range.

## J. Performance budgets (CI-enforced)

- Lighthouse: Performance ≥ 90 mobile, ≥ 95 desktop on Home, /shop,
  PDP, /custom, /drops, /boutique.
- LCP < 1.8 s 4G; CLS < 0.05; INP < 200 ms.
- Initial JS ≤ 120 KB gz.
- Image budget: hero < 100 KB; PDP main < 80 KB.

## K. Observability

- **Sentry** for errors (frontend + Next node).
- **PostHog** funnels + sampled (5 %) session replay; off in AR
  (PII).
- **Vercel Analytics** for Web Vitals on real traffic.
- **Print-queue dashboard** (Grafana) for owner-side ops: orders by
  state, p95 turnaround, queue depth.

## L. Security

- Strict CSP with nonce/hash; no `unsafe-inline`.
- HSTS, `Referrer-Policy: strict-origin-when-cross-origin`,
  COOP/COEP where viable.
- Rate-limits on auth, tracking, review submission, custom-builder
  save-quote.
- Audit log in Postgres for admin actions (already in Glstore).
- File uploads (custom design upload) go through size + type
  validation, virus scan, and human moderation before becoming
  printable.

## M. Data residency + privacy

- Primary region: Frankfurt (Vercel + DB).
- GDPR for EU diaspora — cookie banner with category gating
  (necessary always on).
- DSAR endpoint (`/mentions/donnees`) and one-click account
  deletion.

## N. Local development

- pnpm workspaces:
  `apps/web` (Next.js), `apps/cms` (Sanity), `packages/ui`,
  `packages/tokens`, `packages/commerce` (typed Glstore client),
  `packages/db` (Prisma).
- `docker-compose` brings up Postgres + Redis + the Glstore FastAPI
  + the Glstore admin (already in this repo).
- Sanity hits a dev dataset; Glstore hits the local API.
- `pnpm dev` runs Next + Sanity Studio + tokens watcher.

## O. Owner-side print queue (Phase 2)

A new admin page in the Glstore admin (`/admin/print-queue`)
showing every `customOrder` grouped by base × design:

```
┌────────────────────────────────────────────────────────────────┐
│  PRINT QUEUE — 12 open, 4 ready                                │
├────────────────────────────────────────────────────────────────┤
│  • [T-shirt black M]  Gojo recto+verso × 3      [Mark printed] │
│  • [Sweat black L]    Sukuna recto      × 1      [Mark printed]│
│  • [Mug white]        Luffy recto       × 2      [Mark ready]  │
│  …                                                             │
└────────────────────────────────────────────────────────────────┘
```

Status transitions update the buyer-facing tracking page in real
time.

## P. Why this stack

- The Glstore backend is the single biggest piece of leverage we
  have. Re-implementing it would burn 6+ months for zero customer
  win.
- Next.js gives SSR (which the SPA pattern lacks), an image
  pipeline, and server actions in one tool.
- Sanity for editorial keeps the owner from learning code. Payload
  is a Postgres-native alternative.
- Postgres for SHINOBI-specific concepts keeps the Glstore catalog
  clean and the data model honest.

## Q. What this architecture exists for (the SHINOBI specifics)

- A **Custom Builder** whose price is server-side-verified before
  cart-write.
- An owner-facing **print queue** that batches identical orders.
- **In-store pickup** as a first-class fulfilment option.
- A **`LocalBusiness`** SEO surface for the Bab Ezzouar shop.
- Fast, accessible mobile pages so the IG-to-web jump feels
  instant.
