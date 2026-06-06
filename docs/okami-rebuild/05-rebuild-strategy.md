# 05 — Rebuild Strategy

## A. Positioning statement

> **OKAMI** is the founder-led streetwear label from Algiers that
> dresses anime-and-pop-culture fans in clothes built to outlast the
> meme. The site is the drop ceremony, the lookbook, and the
> handshake — in that order.

Every page should pass the "would the founder be proud to post this
to Instagram?" test.

## B. Three product principles

1. **The drop is the unit.** Every page either is, leads to, or
   archives a drop.
2. **Story before grid.** The customer sees a photograph and a
   sentence before they see a product card. The grid is the reward.
3. **No mystery costs.** Price, shipping, ETA, and return policy are
   visible in the same surface as the Add-to-bag button.

## C. New information architecture

Already drafted in [03-user-flows-and-ux.md §D](./03-user-flows-and-ux.md#d-information-architecture--to-be).
Headlines:

- Top-level nav: **Shop · Drops · Lookbook · Journal · About · Help**.
- Drops promoted to top-level (was just a collection tag before).
- Utility cluster: Search · Account · Wishlist · Bag · `EN ▾`.

## D. Page-by-page brief

### D.1 Homepage
- **Above the fold:** current drop hero (or, when there is no live
  drop, the editorial campaign image). One CTA: "Shop the drop" *or*
  "Get notified · T-minus 2 days 06 h 14 m".
- **Sub-hero:** founder's line of the week (rotates weekly).
- **Featured products:** 6–8 pieces, large card, swatches visible.
- **Lookbook strip:** 4 chapter tiles → lookbook chapters.
- **Journal preview:** the most recent 3 posts.
- **Newsletter strip:** "Get the next drop calendar in your inbox."
- **Footer:** standard + WhatsApp + payment-method icons.

### D.2 Shop / Collection (PLP)
- Sticky filter bar (size, colour, drop, character, price, stock).
- Cards: image (with hover-variant), title, drop tag, swatches,
  price, "Quick add".
- Pagination = load-more (mobile-friendly).
- Header: name + one paragraph + cover photograph for collections
  that warrant it.

### D.3 Drop page (new)
- States rendered server-side from the drop record:
  - `upcoming` → countdown + notify-me CTA (email + SMS).
  - `live` → PLP with live inventory + "selling fast" pills.
  - `sold_out` → archive + restock-notify + next-drop teaser.
- Each drop has an editorial paragraph, a hero, a credits line
  (photography by · model · production by).

### D.4 Product detail (PDP)
- Gallery (flat-lay · on-model · detail · on-model 2 · clip).
- Title · price · variant chips (size / colour).
- "Your size?" widget (height · weight → recommendation).
- Add-to-bag + Wishlist.
- Trust strip (COD · 48 h shipping · 14-day returns).
- Description (≤ 80 words, bullet specs).
- Reviews (with photo upload + verified-buyer badge).
- "Pairs with…" cross-sell.
- "From the drop" — sibling pieces from the same drop.
- Sticky mobile add-to-bag.

### D.5 Cart drawer + cart page
- Drawer is enough for 95 % of users; full page is the fallback.
- Lines with thumbnail, name, variant, price, qty selector, remove.
- Subtotal, free-shipping progress, COD assurance, "Continue to
  checkout" + "Continue shopping".

### D.6 Checkout
- One-page, three groups (contact · address · pay & confirm).
- Wilaya → commune cascading.
- COD default; Card secondary (Stripe / CIB integration).
- Phone number required (used for SMS confirmation + tracking).
- Order summary always visible on desktop; collapsible on mobile.

### D.7 Account
- Magic-link login (no password). Optional password setup.
- Dashboard: last order + wishlist + drop calendar.
- Orders list (with tracking).
- Addresses.
- Notification preferences.

### D.8 Lookbook
- Chapter pages — full-bleed photography, 8–14 images, copy blocks,
  product hot-spots (`<button>` over image opens PDP bottom-sheet).

### D.9 Journal
- Long-form posts. Tag by drop, character, theme.
- Author = founder by default.

### D.10 Help cluster
- Size guide (per-product cm tables, body-measurement guide).
- Shipping (DZ tariffs, ETA per wilaya).
- Returns (14-day, conditions, process).
- FAQ (search-friendly accordion).
- Contact (form + WhatsApp + email).

## E. Modern commerce features — pick list

Implementation priority encoded in the roadmap; this is the catalog.

- **Wishlist** — local-first, sync to account on login.
- **Recently viewed** — 8 items, localStorage; quietly resurfaced on
  PLP & homepage on return visits.
- **Quick add** — bottom-sheet on PLP & search.
- **Quick view** — modal PDP; size + add without leaving the grid.
- **Recommendations** — "Pairs with", "From the same drop", "You
  recently viewed". Manual curation first; Algolia / Vector second.
- **Cross-sell / Bundles** — bundle a hoodie + a tee at a discount on
  PDP and cart.
- **Upsell** — at checkout: a sticker pack at 0.5 × shipping cost,
  one-click add.
- **Gift cards** — issued by the commerce backend (custom code-table +
  spend rules).
- **Reviews** — first-party (Judge.me-compatible schema) with photo
  upload; verified-buyer flag tied to fulfilled orders.
- **UGC gallery** — `#okami` Instagram hashtag scraped (Foursixty /
  Flowbox) → shoppable wall on collection pages.
- **Creator collaborations** — surfaced as drops; the drop archive
  becomes the brand's roster.
- **Loyalty (Phase 4)** — points for orders + referrals; spend on
  shipping or stickers.
- **Referral program** — give 10 % / get 10 %, tracked via personal
  codes.
- **Drops system** — see [10-data-and-cms-schemas.md §B](./10-data-and-cms-schemas.md#b-cms-schemas-payload--sanity).
- **Limited releases** — variant-level cap, real-time inventory
  decrement, queue when traffic spikes.
- **Restock notifications** — email + SMS; segmented by drop and SKU.

## F. Internationalization plan

- Languages: **EN** (current default), **FR** (Algerian primary
  reading language), **AR** (with RTL).
- Currency: **DZD** primary; **EUR** display option for diaspora;
  conversion read from a daily-cached FX feed; payment still in DZD.
- URL strategy: `/fr/…`, `/ar/…` (no `/en/` — EN is root).
  Re-render server-side; `hreflang` tags emitted per route.
- Translation owned in the CMS (per-document field set), not in
  source code.

## G. Performance budget (per page)

| Resource | Mobile budget |
|---|---|
| HTML | ≤ 30 KB compressed |
| CSS  | ≤ 30 KB total critical |
| JS (initial) | ≤ 120 KB gz |
| Fonts | 1 family, 1 variable file, `font-display: swap`, ≤ 60 KB |
| Hero image | ≤ 100 KB at LCP size |
| 3rd-party scripts | 0 above the fold |

If a page cannot ship within the budget, the page does not ship.

## H. Accessibility baseline (non-negotiable)

- WCAG 2.2 AA across every published surface.
- Keyboard reachable; visible focus on every interactive element.
- `prefers-reduced-motion` honoured.
- Colour-contrast checks in CI for every token combination used.
- Live regions for cart drawer "added" toasts and stock errors.

## I. SEO architecture (highlights)

- Stable URLs: `/shop`, `/shop/{handle}` (PDP), `/drops/{slug}`,
  `/lookbook/{slug}`, `/journal/{slug}`. No tracking params in canonical.
- JSON-LD: `Product`, `Offer`, `AggregateRating`, `BreadcrumbList`,
  `Organization`, `WebSite` (with `SearchAction`), `FAQPage` where
  applicable, `Article` for journal.
- `hreflang` per language; `x-default` to EN.
- Sitemap split: `products`, `collections`, `drops`, `pages`,
  `journal`, regenerated nightly + on publish webhook.
- Canonical URLs always include the locale prefix; never the
  filter query string.
- Open Graph + Twitter card per page; per-drop OG art generated by
  the CMS.

## J. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing commerce API missing capabilities (e.g. scheduled drops, segmented notify lists, granular inventory holds) | Medium | High | Postgres + Prisma layer (see [10-data-and-cms-schemas.md](./10-data-and-cms-schemas.md)) absorbs the gaps; commerce API stays focused on products / orders / inventory. |
| Drop traffic spikes outpace ISR + cache | Medium | High | Server-render with edge cache; queue page when stock < 5 % to avoid oversell. Pre-warm cache. |
| Bilingual launch slips Phase 1 | High | Medium | Ship EN at v1; FR within v1.1; AR with RTL after observability. |
| Image asset volume (lookbook + drops) exceeds CDN budget | Medium | Medium | Server-resize via `@vercel/image` or `next/image`; cap originals at 2400 px max edge. |
| Email deliverability poor in MENA | Medium | High | Klaviyo + dedicated subdomain + DKIM/SPF/DMARC enforced. |
| Local courier integrations late | Medium | Medium | Ship a manual fulfillment dashboard first; integrate Yalidine/Maystro API in Phase 2. |
