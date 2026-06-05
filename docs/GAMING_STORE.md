# GLAIVE — Gaming Store Build

This repo's commerce platform (originally **Ghir Laffaire**, a general
consumer-electronics store for Algeria) has been re-skinned and re-mapped into
**GLAIVE**, a **gaming-gear store** — *same architecture, different design and map*.

Nothing about the system shape changed: FastAPI write model + SQLAlchemy async,
PostgreSQL, async workers, the React 19 / Vite / Tailwind v4 storefront and admin,
the COD + 58-wilaya checkout, the order/reservation pipeline, the enrichment +
scraper + Image-Review intelligence. Only the **brand, design tokens, and catalog**
changed.

## What changed

### 1. Design (the look)
The storefront's runtime design tokens (`storefront/src/index.css` `@theme`) were
re-mapped to a gaming palette while **keeping the token names** so the admin Theme
Studio still drives everything:

| Token | Was (Ghir Laffaire) | Now (GLAIVE) |
|---|---|---|
| `--color-electric-blue` (primary) | `#3DA9FC` electric blue | `#FF5A1F` **signature orange** |
| `--color-neon-yellow` (highlight) | `#FFD400` | `#FFC400` amber |
| `--color-hot-pink` (accent) | `#FF2E7A` | `#FF2D78` RGB magenta |
| surfaces | blue-black ramp | near-black gaming ramp `#08080a→#2c2c34` |

Rebranded surfaces: `BrandLogo` (new angular glaive mark + `GLAIVE` wordmark / *For
Glory* tagline), `Navbar`, `Footer`, `Home`, `SEO`, `index.html`, `favicon.svg`,
and the category-icon map in `lib/format.ts` (🎧 ⌨️ 🖱️ 🟧 🎮 🎚️).

> Because the storefront only **receives** themes (the admin authors them), changing
> the `@theme` *defaults* is the correct, architecture-preserving way to set the new
> look. An admin can still recolor or publish any theme on top at runtime.

### 2. Map (the catalog)
`db/seed_gaming.sql` seeds the gaming catalog: **6 categories** (Headsets, Keyboards,
Mice, Mousepads, Controllers, Accessories) and **14 products / 18 sellable offers**,
priced in **DZD**, all `status = ACTIVE` so they surface immediately on the storefront.
Categories are derived from `products.category` exactly as before, so the nav mega-menu,
catalog, search and filters all populate automatically.

The seed is wired into `docker-compose.yml` as `02-seed_gaming.sql`, so a fresh DB is
gaming-ready on first boot. Product imagery is intentionally omitted — attaching photos
is exactly what the platform's scraper + Image-Review pipeline is built to do.

## Run it

```bash
docker compose up -d          # DB auto-seeds schema + admin + gaming catalog
cd storefront && npm install && npm run dev   # http://localhost:5173
```

Re-seed gaming catalog on an existing DB (idempotent — `ON CONFLICT DO NOTHING`):

```bash
docker compose exec db psql -U glstore -d glstore \
  -f /docker-entrypoint-initdb.d/02-seed_gaming.sql
```

## Files touched

```
db/seed_gaming.sql                         # NEW — gaming catalog
docker-compose.yml                         # mount 02-seed_gaming.sql
storefront/index.html                      # title / theme-color / body bg
storefront/public/favicon.svg              # glaive mark
storefront/src/index.css                   # @theme gaming tokens
storefront/src/components/BrandLogo.tsx    # GLAIVE logo
storefront/src/components/Navbar.tsx       # gaming categories + promo strip
storefront/src/components/Footer.tsx       # gaming links + copy
storefront/src/components/SEO.tsx          # site name + default description
storefront/src/lib/format.ts               # gaming category icons
storefront/src/pages/Home.tsx              # gaming hero + callout
```

> The standalone static prototype under `gaming-store/` (built earlier in this branch)
> remains as a zero-dependency design reference; the platform reskin above is the
> production path on the real architecture.
