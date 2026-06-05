# GLAIVE — Gaming Gear Storefront

A from-first-principles **recreation inspired by [SteelSeries](https://steelseries.com)**, built as a
self-contained, dependency-free storefront. This is a *tribute / study build* — it reverse-engineers
the patterns of a leading gaming-hardware e-commerce site and rebuilds them cleanly, **not** a 1:1 copy.
No SteelSeries assets, logos, photography, or copy are used; all product art is original abstract SVG.

> Branch: `gaming-store` · Part of the *Ghir Laffaire* commerce platform repo.

---

## What's here

```
gaming-store/
├── index.html          # Homepage — hero, categories, featured, software, pro band, recently-viewed, newsletter
├── shop.html           # Catalog — sidebar filters (category, price), sort, saved-items view
├── product.html        # Product detail — gallery, swatches, specs, related, add-to-cart
├── checkout.html       # Checkout — contact + shipping (wilaya) + payment, order confirmation
├── 404.html            # Branded not-found page
├── assets/
│   ├── css/styles.css  # Full design system: tokens → components → layout → responsive
│   └── js/
│       ├── data.js     # Catalog data + original SVG art + icon library + shipping zones
│       └── app.js      # Cart + wishlist (localStorage), drawer, quick-view modal,
│                       #   recently-viewed, checkout, filters, search, a11y
├── README.md           # this file
└── ANALYSIS.md         # the 13-phase reverse-engineering report (the "master prompt")
```

## Run it

No build, no install. It's static.

```bash
cd gaming-store
python3 -m http.server 8080
# open http://localhost:8080
```

Or just open `index.html` in a browser (the cart persists via `localStorage`).

## Features

- **Responsive** down to 360px (mega-menu collapses to a mobile drawer).
- **Working cart** — add / increment / remove, persisted, slide-out drawer with free-shipping threshold.
- **Wishlist** — save/unsave from any card or PDP (♥), persisted, header count, dedicated saved view (`shop.html?wish=1`).
- **Quick view** — hover any product → modal with price, blurb and add-to-cart without leaving the grid.
- **Search overlay** — `/` or `⌘/Ctrl-K` opens a live product search with keyboard navigation (↑/↓/Enter).
- **Reviews** — PDP rating summary with a star-distribution histogram + verified-buyer review cards.
- **Sticky mobile buy-bar** — price + add-to-cart pinned to the bottom of product pages on small screens.
- **Sale pricing** — struck-through original + "Save X%" badges, sale-aware sorting and totals.
- **Catalog** — filter by category & price, sort by featured/new/price/rating, deep-linkable via query params
  (`shop.html?cat=Headsets`, `?q=nova`, `?tag=pro`, `?sort=price-asc`).
- **Product pages** — `product.html?id=arctis-nova-elite`, color swatches, spec table, related items.
- **Checkout** — contact + shipping (Algeria wilaya selector) + payment (COD/Card), client-side validation,
  order-number confirmation. Demo-only; wired conceptually to `POST /api/v1/orders/create`.
- **Recently viewed** — last-viewed products surface on the homepage (auto-hides when empty).
- **Accessibility** — skip link, focus-visible rings, `aria-expanded`/`aria-pressed`, Escape closes overlays,
  reduced-motion support, semantic landmarks, `aria-live` toasts.
- **SEO** — per-page titles/descriptions, Open Graph, JSON-LD organization, theme-color, `noindex` on cart/checkout.
- **Design system** — ~40 CSS custom-property tokens (color, type, spacing, radius, shadow, motion).

## How it relates to the parent platform

The parent repo (*Ghir Laffaire*) already ships a React 19 + FastAPI storefront. This `gaming-store` is a
**design-language prototype**: a clean, framework-free reference for the SteelSeries-style dark/orange
gaming aesthetic and IA. The demo checkout button points at where the real `POST /api/v1/orders/create`
integration would go — the data shapes here intentionally mirror that API's product/offer model.

See [`ANALYSIS.md`](./ANALYSIS.md) for the full system reverse-engineering and rebuild rationale.
