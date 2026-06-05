# 13 — Platform Reconciliation

> Written **after** the ground-truth extraction in
> [00-extracted-design-system.md](./00-extracted-design-system.md)
> contradicted an earlier inference that the live site was on Shopify.
>
> This file reconciles the rebuild strategy with the verified stack
> (React SPA + TailwindCSS v4 + custom headless commerce) and lists
> the decisions whose answers change as a result.

## A. What we now know is real

| Item | As-is |
|---|---|
| Front-end | React SPA mounted on `#root` |
| Routing | Client-side (no SSR) |
| Styling | TailwindCSS v4 with custom extensions |
| Type | Three self-hosted fonts (OKAMI, Streetwear, Inter) |
| Commerce backend | Custom headless API |
| Pricing | Currency switcher `US` / `DA` (Algerian Dinar) |
| Hosting / CDN | Unknown from extraction; assume static host + CDN |

## B. What this changes in the strategy

1. **The migration is not a platform migration.** There is no Shopify
   to "pull off". The choice is now:
   - **(A) Evolve in place** — keep the custom backend, replace the
     React SPA with a Next.js (App Router) front-end, ship SSR/ISR
     for SEO and drops, reuse the existing API.
   - **(B) Rebuild end-to-end** — Next.js front + Medusa.js / our own
     Ghir-Laffaire-style FastAPI back, fully owned.
   - **(C) Migrate onto Shopify** — only if the brand wants Shopify
     Checkout + apps ecosystem; carries cost and surrenders the
     custom commerce flexibility already in place.

   **Recommendation: (A).** The owner already has a custom commerce
   backend that works for the Algerian market (DA pricing, currency
   toggle). The win is at the surface: SSR for SEO, a drops engine,
   a proper PDP, faster mobile. We do not throw away working backend
   plumbing to chase a platform.

2. **Drop the Shopify-Storefront-API-shaped sections** of
   [08-technical-architecture.md](./08-technical-architecture.md).
   Replace with a typed client to the existing custom API. If the
   commerce API is missing a capability (search, scheduled drops,
   subscribers), we add it server-side rather than via a Shopify
   metafield.

3. **The drops engine still lives in our backend.** It does not need
   to ride on top of someone else's commerce. The Prisma schemas in
   [10-data-and-cms-schemas.md](./10-data-and-cms-schemas.md) for
   `Drop`, `DropSubscription`, `NotifyEvent`, `Review`,
   `WishlistItem`, `LoyaltyLedger`, `MagicLinkToken` map cleanly onto
   the existing custom-backend pattern.

4. **Auth is simpler.** Magic-link can be added to the existing
   backend; no Shopify customer-token dance.

5. **Checkout stays headless.** Without Shopify-hosted checkout, the
   COD-first / wilaya-cascade / card-secondary flow we described
   becomes the **only** checkout — we ship it in v1, no Phase-2
   "headless checkout when on Plus" wait.

6. **CMS choice still stands.** Sanity (or Payload) overlays editorial
   on top of the custom commerce, joined on the product slug.

## C. Updated stack summary

```
        ┌────────────────────────────────────┐
        │   OKAMI Storefront (web)           │
        │   Next.js 15 (App Router)          │
        │   Vercel · Edge + Node             │
        └────────┬───────────────────────────┘
                 │
        ┌────────┴───────┐
        │   BFF layer    │   server actions, route handlers
        └─┬──────┬─────┬─┬─────────┬──────────┐
          │      │     │ │         │          │
          ▼      ▼     ▼ ▼         ▼          ▼
     Custom   Sanity  Algolia  Klaviyo   Stripe / CIB
     Commerce (CMS)   (search) (email)   (cards)
     (existing)
                                   ┌─────────────────┐
                                   │ Postgres        │
                                   │  drops          │
                                   │  reviews        │
                                   │  wishlist sync  │
                                   │  loyalty        │
                                   │  magic-links    │
                                   └─────────────────┘
```

- Shopify is **not** in the diagram.
- The existing "custom headless commerce" continues to own
  products, variants, prices, orders, inventory.
- Postgres holds what that commerce backend may not model: drops,
  reviews-with-media, wishlist sync, loyalty ledger, auth.
- Algolia + Klaviyo are derived (indices and contact lists),
  populated by webhooks from the commerce backend.

## D. Migration / cutover path (revised)

| Step | Action |
|---|---|
| 1 | Read & document the existing commerce API. Generate a typed client (`packages/commerce`). |
| 2 | Stand up Next.js scaffold with `packages/commerce` (replaces `packages/shopify`). |
| 3 | Recreate every public route in Next.js, reading from the existing API. The customer experience is the only thing that changes. |
| 4 | Add Sanity for editorial overlay (drops, lookbook, journal). |
| 5 | Add Postgres for drops / reviews / loyalty / magic-link. |
| 6 | Add Algolia + Klaviyo via webhooks. |
| 7 | Run new front-end + old SPA side by side under different domains, switch DNS when KPIs hold. |

This is faster than a platform migration: there is no Shopify export,
no metafield gymnastics, no app re-purchasing.

## E. Document patches needed

Carried out in this commit:

- [README.md](./README.md): note that the as-is doc supersedes the
  earlier inferences; remove the "Shopify likely" line.
- [02-audit-and-sitemap.md](./02-audit-and-sitemap.md): platform table
  now reflects React SPA + Tailwind v4 + custom headless; sitemap
  re-shaped around `/shop`, `/about`, `/contact`, `/cart` rather than
  `/collections/*` + `/products/*`.
- [06-design-system.md](./06-design-system.md): brand tokens swapped
  to the OKAMI palette + custom font trio + halftone background +
  marquee + logoPulse keyframes. The forward-looking rules
  (contrast invariants, 4 px spacing, motion budget, etc.) carry over.
- [08-technical-architecture.md](./08-technical-architecture.md):
  Shopify references replaced with "custom commerce backend";
  `packages/shopify` renamed to `packages/commerce` in the folder
  structure where applicable.

Where a section was already platform-agnostic (UX critique, accessibility
budgets, component contracts, launch checklist), nothing changes.

## F. Open questions for the owner

These are the few things the extraction did not fully resolve and which
the next conversation should pin down:

1. What does the existing commerce backend expose? (REST? GraphQL?
   What are the product / order / inventory shapes?)
2. Is there an admin / CMS surface today, or is the catalog hand-coded
   in the SPA?
3. What is the actual hosting (static + API origin, single VPS,
   serverless)?
4. Email provider in use today? (Klaviyo? Mailchimp? Custom?)
5. What payment rails are live? COD only, or COD + card?
6. Are there real numbers for: monthly orders, average order value,
   mobile share, top-3 traffic sources? (We size the system to those.)
7. What languages are actively being served? (Currency switcher is
   `US` / `DA`; is the copy already bilingual or EN-only?)
8. Who owns the custom fonts' licences and brand assets?
