# 09 — Folder Structure

A pnpm monorepo. Each app is independently deployable; packages are
private workspace dependencies.

```
okami/
├─ apps/
│  ├─ web/                          # The Next.js storefront (Vercel)
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  │  ├─ (marketing)/                 # routes that share the marketing layout
│  │  │  │  │  ├─ page.tsx                  # /          home
│  │  │  │  │  ├─ about/page.tsx
│  │  │  │  │  ├─ journal/
│  │  │  │  │  │  ├─ page.tsx
│  │  │  │  │  │  └─ [slug]/page.tsx
│  │  │  │  │  └─ lookbook/
│  │  │  │  │     ├─ page.tsx
│  │  │  │  │     └─ [slug]/page.tsx
│  │  │  │  ├─ (shop)/                       # commerce shell (top-nav + cart slot)
│  │  │  │  │  ├─ shop/page.tsx              # /shop  (all)
│  │  │  │  │  ├─ collections/[slug]/page.tsx
│  │  │  │  │  ├─ products/[handle]/page.tsx
│  │  │  │  │  ├─ drops/
│  │  │  │  │  │  ├─ page.tsx                # current + upcoming + archive index
│  │  │  │  │  │  ├─ [slug]/page.tsx
│  │  │  │  │  │  └─ archive/page.tsx
│  │  │  │  │  ├─ search/page.tsx
│  │  │  │  │  ├─ cart/page.tsx
│  │  │  │  │  └─ checkout/
│  │  │  │  │     ├─ page.tsx
│  │  │  │  │     └─ confirm/[id]/page.tsx
│  │  │  │  ├─ (account)/
│  │  │  │  │  ├─ account/page.tsx
│  │  │  │  │  ├─ account/orders/page.tsx
│  │  │  │  │  ├─ account/orders/[id]/page.tsx
│  │  │  │  │  ├─ account/wishlist/page.tsx
│  │  │  │  │  └─ account/addresses/page.tsx
│  │  │  │  ├─ (legal)/
│  │  │  │  │  ├─ legal/privacy-policy/page.tsx
│  │  │  │  │  ├─ legal/terms/page.tsx
│  │  │  │  │  ├─ legal/refunds/page.tsx
│  │  │  │  │  └─ legal/shipping/page.tsx
│  │  │  │  ├─ help/
│  │  │  │  │  ├─ page.tsx
│  │  │  │  │  ├─ size-guide/page.tsx
│  │  │  │  │  ├─ shipping/page.tsx
│  │  │  │  │  ├─ returns/page.tsx
│  │  │  │  │  ├─ faq/page.tsx
│  │  │  │  │  └─ contact/page.tsx
│  │  │  │  ├─ order/
│  │  │  │  │  └─ track/page.tsx
│  │  │  │  ├─ api/
│  │  │  │  │  ├─ cart/route.ts              # POST/PATCH/DELETE
│  │  │  │  │  ├─ wishlist/route.ts
│  │  │  │  │  ├─ reviews/route.ts
│  │  │  │  │  ├─ subscribe/route.ts         # newsletter + notify-me
│  │  │  │  │  ├─ track/route.ts             # order tracking
│  │  │  │  │  └─ revalidate/route.ts        # webhook → revalidateTag
│  │  │  │  ├─ layout.tsx
│  │  │  │  ├─ globals.css                   # imports tokens.css
│  │  │  │  ├─ robots.ts
│  │  │  │  ├─ sitemap.ts
│  │  │  │  └─ not-found.tsx
│  │  │  ├─ components/                      # storefront-local (page-shaped)
│  │  │  │  ├─ home/
│  │  │  │  ├─ pdp/
│  │  │  │  ├─ plp/
│  │  │  │  ├─ cart/
│  │  │  │  ├─ checkout/
│  │  │  │  ├─ drops/
│  │  │  │  └─ navigation/
│  │  │  ├─ lib/
│  │  │  │  ├─ shopify/                      # storefront API client
│  │  │  │  ├─ sanity/                       # CMS client + queries
│  │  │  │  ├─ algolia/
│  │  │  │  ├─ klaviyo/
│  │  │  │  ├─ db/                           # postgres prisma client
│  │  │  │  ├─ analytics/
│  │  │  │  ├─ session/                      # auth + cart-id cookie helpers
│  │  │  │  ├─ format/                       # currency, date, i18n helpers
│  │  │  │  └─ env.ts                        # zod-validated env
│  │  │  ├─ middleware.ts                    # i18n routing + edge auth
│  │  │  ├─ types/                           # ambient types
│  │  │  └─ i18n/
│  │  │     ├─ en.json
│  │  │     ├─ fr.json
│  │  │     └─ ar.json
│  │  ├─ public/
│  │  │  ├─ favicon.svg
│  │  │  ├─ apple-touch-icon.png
│  │  │  └─ og/                              # static OG fallbacks
│  │  ├─ tests/
│  │  │  ├─ unit/
│  │  │  └─ e2e/                             # Playwright
│  │  ├─ next.config.ts
│  │  ├─ tailwind.config.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  │
│  └─ cms/                            # Sanity Studio (or Payload)
│     ├─ schemas/
│     │  ├─ document/
│     │  │  ├─ home.ts
│     │  │  ├─ drop.ts
│     │  │  ├─ collection.ts
│     │  │  ├─ product.ts             # editorial overlay; commerce data in Shopify
│     │  │  ├─ lookbook.ts
│     │  │  ├─ chapter.ts
│     │  │  ├─ post.ts                # journal article
│     │  │  ├─ founder-line.ts
│     │  │  └─ page.ts                # static pages
│     │  ├─ object/
│     │  │  ├─ hero.ts
│     │  │  ├─ media.ts
│     │  │  ├─ cta.ts
│     │  │  ├─ section.ts
│     │  │  └─ seo.ts
│     │  └─ index.ts
│     ├─ desk/
│     ├─ sanity.config.ts
│     ├─ sanity.cli.ts
│     └─ package.json
│
├─ packages/
│  ├─ ui/                              # presentational components (Storybook)
│  │  ├─ src/
│  │  │  ├─ button.tsx
│  │  │  ├─ input.tsx
│  │  │  ├─ card.tsx
│  │  │  ├─ modal.tsx
│  │  │  ├─ drawer.tsx
│  │  │  ├─ countdown.tsx
│  │  │  ├─ product-card.tsx
│  │  │  ├─ quick-add-sheet.tsx
│  │  │  ├─ size-recommender.tsx
│  │  │  ├─ gallery.tsx
│  │  │  ├─ price-tag.tsx
│  │  │  ├─ stock-signal.tsx
│  │  │  ├─ filter-bar.tsx
│  │  │  ├─ search-overlay.tsx
│  │  │  └─ index.ts
│  │  ├─ stories/
│  │  ├─ tests/                        # axe + RTL
│  │  └─ package.json
│  ├─ tokens/                          # design tokens (source of truth)
│  │  ├─ source/
│  │  │  ├─ colour.json
│  │  │  ├─ type.json
│  │  │  ├─ space.json
│  │  │  ├─ radius.json
│  │  │  ├─ shadow.json
│  │  │  └─ motion.json
│  │  ├─ build/                        # generated: do not edit
│  │  │  ├─ tokens.css
│  │  │  ├─ tokens.ts
│  │  │  ├─ tailwind.preset.cjs
│  │  │  └─ figma.json
│  │  ├─ scripts/build.ts              # Style-Dictionary glue
│  │  └─ package.json
│  ├─ shopify/                         # typed Shopify Storefront client + queries
│  │  ├─ src/
│  │  │  ├─ client.ts
│  │  │  ├─ queries/
│  │  │  │  ├─ product.ts
│  │  │  │  ├─ collection.ts
│  │  │  │  ├─ cart.ts
│  │  │  │  └─ customer.ts
│  │  │  └─ types.ts
│  │  └─ package.json
│  ├─ db/                              # Prisma schema + migrations (drops, reviews, loyalty)
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  └─ migrations/
│  │  ├─ src/
│  │  │  └─ index.ts                   # exported PrismaClient
│  │  └─ package.json
│  ├─ analytics/                       # PostHog + Plausible wrappers, typed events
│  ├─ icons/                           # lucide / phosphor wrapped
│  ├─ utils/                           # date, currency, slug
│  ├─ wilayas/                         # the 58 wilayas + communes dataset
│  └─ tsconfig/                        # shared tsconfig presets
│
├─ tools/
│  ├─ eslint-config/
│  ├─ prettier-config/
│  ├─ commitlint.config.cjs
│  └─ scripts/
│     ├─ check-tokens.ts               # asserts contrast invariants
│     ├─ check-a11y.ts                 # axe-core in CI
│     └─ lighthouse-budget.ts
│
├─ docs/                                # this folder
│  └─ okami-rebuild/
│     └─ … (this set)
│
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                        # lint + test + typecheck + build
│     ├─ visual.yml                    # Chromatic
│     ├─ lighthouse.yml
│     └─ deploy-preview.yml
├─ .changeset/
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
├─ README.md
└─ LICENSE
```

## Notes on the layout

- **Route groups** `(marketing)`, `(shop)`, `(account)`, `(legal)` let
  each group own a layout (header variant, cart slot present/absent)
  without cluttering the URL.
- **`packages/ui`** holds reusable presentational components with no
  app-specific logic. `apps/web/src/components` holds page-shaped
  compositions that compose `packages/ui`.
- **Tokens** are the only source of truth for design values; the
  storefront imports the generated CSS, never the source JSON.
- **Shopify queries** live in a typed package so the storefront does
  not see GraphQL strings; the package generates types via
  `graphql-codegen`.
- **`packages/db`** owns Prisma. Drops, reviews, wishlist sync, and
  the loyalty ledger live in Postgres so the storefront isn't
  bottlenecked by what Shopify exposes.
- **`tools/scripts/check-tokens.ts`** enforces colour-contrast
  invariants — if a token change drops a critical pair below 4.5 : 1,
  CI rejects.

## Naming conventions

- File names: `kebab-case.tsx` for components, `camelCase.ts` for libs.
- Component exports: PascalCase named export (no default in `packages/ui`).
- Server actions: live next to the page that owns them, file
  `actions.ts`.
- Tests: `*.test.ts(x)` (unit) and `*.spec.ts` (e2e).
