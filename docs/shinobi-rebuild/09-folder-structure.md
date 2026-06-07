# 09 — Folder Structure

A pnpm monorepo, sibling to (and partly sharing packages with) the
parent Glstore repo. Each app is independently deployable; packages
are private workspace dependencies.

```
shinobi/
├─ apps/
│  ├─ web/                                       # Next.js storefront (Vercel)
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  │  ├─ (marketing)/
│  │  │  │  │  ├─ page.tsx                       # /  Home (FR default)
│  │  │  │  │  ├─ a-propos/page.tsx              # /a-propos
│  │  │  │  │  ├─ journal/
│  │  │  │  │  │  ├─ page.tsx
│  │  │  │  │  │  └─ [slug]/page.tsx
│  │  │  │  │  └─ boutique/page.tsx              # /boutique  (the Bab Ezzouar shop page)
│  │  │  │  ├─ (shop)/
│  │  │  │  │  ├─ shop/page.tsx                  # /shop  all products
│  │  │  │  │  ├─ shop/[category]/page.tsx       # /shop/t-shirts, /shop/hoodies …
│  │  │  │  │  ├─ shop/[category]/[handle]/page.tsx  # PDP
│  │  │  │  │  ├─ custom/
│  │  │  │  │  │  ├─ page.tsx                    # Custom Builder landing
│  │  │  │  │  │  └─ quote/[id]/page.tsx         # Saved quote
│  │  │  │  │  ├─ drops/
│  │  │  │  │  │  ├─ page.tsx
│  │  │  │  │  │  ├─ [slug]/page.tsx
│  │  │  │  │  │  └─ archive/page.tsx
│  │  │  │  │  ├─ search/page.tsx
│  │  │  │  │  ├─ panier/page.tsx                # /panier
│  │  │  │  │  ├─ checkout/
│  │  │  │  │  │  ├─ page.tsx
│  │  │  │  │  │  └─ confirm/[id]/page.tsx       # /checkout/confirm/{order}
│  │  │  │  │  └─ commande/
│  │  │  │  │     └─ suivi/page.tsx              # /commande/suivi
│  │  │  │  ├─ (account)/
│  │  │  │  │  ├─ compte/page.tsx
│  │  │  │  │  ├─ compte/commandes/page.tsx
│  │  │  │  │  ├─ compte/commandes/[id]/page.tsx
│  │  │  │  │  ├─ compte/favoris/page.tsx
│  │  │  │  │  └─ compte/adresses/page.tsx
│  │  │  │  ├─ aide/
│  │  │  │  │  ├─ page.tsx
│  │  │  │  │  ├─ personnalisation/page.tsx
│  │  │  │  │  ├─ livraison/page.tsx
│  │  │  │  │  ├─ retours/page.tsx
│  │  │  │  │  ├─ tailles/page.tsx
│  │  │  │  │  ├─ faq/page.tsx
│  │  │  │  │  └─ contact/page.tsx
│  │  │  │  ├─ mentions/
│  │  │  │  │  ├─ cgv/page.tsx
│  │  │  │  │  ├─ confidentialite/page.tsx
│  │  │  │  │  └─ cookies/page.tsx
│  │  │  │  ├─ api/
│  │  │  │  │  ├─ cart/route.ts
│  │  │  │  │  ├─ wishlist/route.ts
│  │  │  │  │  ├─ reviews/route.ts
│  │  │  │  │  ├─ subscribe/route.ts                  # newsletter / notify-me
│  │  │  │  │  ├─ track/route.ts                      # order tracking
│  │  │  │  │  ├─ custom/
│  │  │  │  │  │  ├─ quote/route.ts                   # POST save-quote
│  │  │  │  │  │  └─ submit/route.ts                  # POST commit to cart
│  │  │  │  │  ├─ webhooks/
│  │  │  │  │  │  ├─ glstore/route.ts                 # product / inventory / order
│  │  │  │  │  │  └─ sanity/route.ts                  # CMS publish
│  │  │  │  │  └─ revalidate/route.ts
│  │  │  │  ├─ layout.tsx
│  │  │  │  ├─ globals.css                            # imports tokens.css
│  │  │  │  ├─ robots.ts
│  │  │  │  ├─ sitemap.ts
│  │  │  │  └─ not-found.tsx
│  │  │  ├─ components/                               # storefront-local compositions
│  │  │  │  ├─ home/
│  │  │  │  ├─ pdp/
│  │  │  │  ├─ plp/
│  │  │  │  ├─ cart/
│  │  │  │  ├─ checkout/
│  │  │  │  ├─ custom/                                # the Custom Builder lives here
│  │  │  │  ├─ drops/
│  │  │  │  ├─ boutique/
│  │  │  │  └─ navigation/
│  │  │  ├─ lib/
│  │  │  │  ├─ commerce/                              # typed Glstore client
│  │  │  │  ├─ sanity/
│  │  │  │  ├─ algolia/
│  │  │  │  ├─ klaviyo/
│  │  │  │  ├─ db/                                    # Prisma client
│  │  │  │  ├─ analytics/
│  │  │  │  ├─ session/
│  │  │  │  ├─ format/                                # money (DZD), date, anime tag colours
│  │  │  │  ├─ anime-colors.ts                        # Map<animeSlug, hex>
│  │  │  │  └─ env.ts                                 # zod-validated env
│  │  │  ├─ middleware.ts                             # i18n routing + edge auth
│  │  │  ├─ types/
│  │  │  └─ i18n/
│  │  │     ├─ fr.json                                # primary
│  │  │     ├─ en.json
│  │  │     └─ ar.json                                # v1.1
│  │  ├─ public/
│  │  │  ├─ favicon.svg
│  │  │  ├─ apple-touch-icon.png
│  │  │  ├─ seigaiha.svg                              # the wave-pattern asset
│  │  │  └─ og/                                       # static OG fallbacks
│  │  ├─ tests/
│  │  │  ├─ unit/
│  │  │  └─ e2e/                                      # Playwright (incl. Custom Builder happy path)
│  │  ├─ next.config.ts
│  │  ├─ tailwind.config.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  │
│  └─ cms/                                            # Sanity Studio (or Payload)
│     ├─ schemas/
│     │  ├─ document/
│     │  │  ├─ home.ts
│     │  │  ├─ drop.ts
│     │  │  ├─ collection.ts
│     │  │  ├─ product.ts                             # editorial overlay; commerce data in Glstore
│     │  │  ├─ post.ts                                # journal article
│     │  │  ├─ founder-line.ts
│     │  │  ├─ boutique.ts                            # the Bab Ezzouar shop page
│     │  │  ├─ design.ts                              # a printable anime design (Custom Builder)
│     │  │  └─ page.ts
│     │  ├─ object/
│     │  │  ├─ hero.ts
│     │  │  ├─ media.ts
│     │  │  ├─ cta.ts
│     │  │  ├─ section.ts
│     │  │  └─ seo.ts
│     │  └─ index.ts
│     ├─ desk/
│     ├─ sanity.config.ts
│     └─ package.json
│
├─ packages/
│  ├─ ui/                                             # presentational components (Storybook)
│  │  ├─ src/
│  │  │  ├─ button.tsx
│  │  │  ├─ input.tsx
│  │  │  ├─ card.tsx
│  │  │  ├─ modal.tsx
│  │  │  ├─ drawer.tsx
│  │  │  ├─ product-card.tsx
│  │  │  ├─ anime-tag.tsx
│  │  │  ├─ quick-add-sheet.tsx
│  │  │  ├─ gallery.tsx
│  │  │  ├─ pickup-or-delivery.tsx
│  │  │  ├─ price-tag.tsx
│  │  │  ├─ stock-signal.tsx
│  │  │  ├─ filter-bar.tsx
│  │  │  ├─ search-overlay.tsx
│  │  │  └─ index.ts
│  │  ├─ stories/
│  │  ├─ tests/                                       # axe + RTL
│  │  └─ package.json
│  ├─ tokens/                                         # design tokens (source of truth)
│  │  ├─ source/
│  │  │  ├─ colour.json
│  │  │  ├─ type.json
│  │  │  ├─ space.json
│  │  │  ├─ radius.json
│  │  │  ├─ shadow.json
│  │  │  └─ motion.json
│  │  ├─ build/                                       # generated
│  │  │  ├─ tokens.css
│  │  │  ├─ tokens.ts
│  │  │  ├─ tailwind.preset.cjs
│  │  │  └─ figma.json
│  │  ├─ scripts/build.ts
│  │  └─ package.json
│  ├─ commerce/                                       # typed Glstore client
│  │  ├─ src/
│  │  │  ├─ client.ts
│  │  │  ├─ resources/
│  │  │  │  ├─ product.ts
│  │  │  │  ├─ collection.ts
│  │  │  │  ├─ cart.ts
│  │  │  │  ├─ checkout.ts
│  │  │  │  ├─ customer.ts
│  │  │  │  └─ custom-order.ts                       # SHINOBI-specific custom-print bridge
│  │  │  └─ types.ts                                  # generated from Glstore OpenAPI
│  │  └─ package.json
│  ├─ db/                                             # Prisma schema + migrations
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma                             # drops, reviews, loyalty, magic-link, custom-orders
│  │  │  └─ migrations/
│  │  ├─ src/index.ts                                 # exported PrismaClient
│  │  └─ package.json
│  ├─ anime/                                          # franchise + character dictionaries
│  │  ├─ src/
│  │  │  ├─ franchises.ts                             # Naruto, JJK, One Piece … with colours + jp names
│  │  │  └─ characters.ts                             # character → franchise map
│  │  └─ package.json
│  ├─ wilayas/                                        # 58 wilayas + communes dataset
│  ├─ analytics/                                      # typed PostHog + pixel events
│  ├─ icons/                                          # lucide / phosphor wrapped
│  ├─ utils/                                          # date, currency, slug
│  └─ tsconfig/
│
├─ tools/
│  ├─ eslint-config/
│  ├─ prettier-config/
│  ├─ commitlint.config.cjs
│  └─ scripts/
│     ├─ check-tokens.ts                              # asserts contrast invariants
│     ├─ check-a11y.ts                                # axe-core in CI
│     └─ lighthouse-budget.ts
│
├─ docs/
│  └─ shinobi-rebuild/                                # this folder
│
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     ├─ visual.yml                                   # Chromatic
│     ├─ lighthouse.yml
│     └─ deploy-preview.yml
├─ .changeset/
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
└─ README.md
```

## Notes on the layout

- **Route groups** `(marketing)`, `(shop)`, `(account)` let each
  group own a layout without leaking into the URL.
- **`packages/anime`** is a SHINOBI-specific dictionary of franchise
  names, Japanese spellings, characters, and brand colours — used by
  the `AnimeTag` component and the Algolia indexer's synonyms.
- **`packages/commerce`** typed Glstore client — the storefront
  never sees raw REST strings; types are generated from the Glstore
  OpenAPI spec.
- **`packages/db`** owns Prisma. Drops, reviews, loyalty,
  magic-link, **custom-orders** live in Postgres so the Glstore
  catalog stays clean.
- **`tools/scripts/check-tokens.ts`** enforces the contrast
  invariants from `06-design-system.md §B.1`.

## Naming conventions

- File names: `kebab-case.tsx` for components, `camelCase.ts` for
  libs.
- Component exports: PascalCase named export.
- Server actions: live next to the page that owns them, file
  `actions.ts`.
- Tests: `*.test.ts(x)` (unit) and `*.spec.ts` (e2e).
- French-language routes follow the brand voice: `/panier`,
  `/checkout`, `/commande/suivi`, `/aide/personnalisation`,
  `/a-propos`, `/boutique`, `/mentions`.
