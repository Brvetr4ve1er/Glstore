# 05 — Build Strategy

## A. Positioning statement

> **SHINOBI Shop** is the Algiers anime-otaku boutique that lets you
> walk in, walk out, or order in — and either pick a piece off the
> rack or **forge your own**. The site is the second showroom: a
> 24 / 7 mirror of Bab Ezzouar, plus a custom-print bench that
> never sleeps.

## B. Three product principles

1. **Show the price.** Every product, every quote, every variant —
   the price is on screen before the buyer asks. Pricing is the
   first trust signal in this market.
2. **Pickup and delivery are equals.** "Retrait en boutique" is a
   first-class option, not a hidden secondary path. It saves the
   buyer money and ties online discovery to physical traffic.
3. **The Custom Builder is the moat.** It is not a tab — it is a
   route, an SEO target, and the brand's largest single product.

## C. New information architecture

Sketched in [02-audit-and-sitemap.md §B](./02-audit-and-sitemap.md#b-future-sitemap).
Headlines:

- Top-level nav: **Boutique · Custom · Drops · Journal · Notre Shop · Aide**.
- Utility cluster: Search · Compte · Favoris · Panier · `FR ▾`.
- The **/custom** route is promoted to top-level — not hidden under
  "Services".
- **/boutique** (the physical shop) is in the top nav, not the footer.

## D. Page-by-page brief

### D.1 Home
- Above the fold: current drop hero OR the Custom Builder pitch
  ("Forge your own — start at 2 200 DA").
- Hero CTA: "Personnaliser maintenant" or "Voir le drop {X}".
- 6–8 featured products (the founder's pick).
- Strip "Acheter par anime" — Naruto · JJK · One Piece · DBZ · Bleach · …
- Strip "À retirer en boutique" — accessories (katanas, figurines)
  that ship in-store-only.
- Founder's line (rotates weekly).
- Newsletter capture: "Reçois le prochain drop avant Instagram."

### D.2 /boutique (Shop / PLP)
- Sticky filter bar (anime, character, size, colour, price, fit,
  in-store-only, in-stock).
- Cards: image, title, anime tag pill, price, "Quick add" pill.
- Pagination = load-more.
- Header: collection name + paragraph + cover.

### D.3 /shop/{slug} (PDP)
- Gallery (flat-lay → on-model → detail → on-model 2 → clip).
- Title, anime tag, price.
- Variant chips (size + colour).
- "Trouver ma taille" widget (height + weight → recommended size
  against the cm table).
- **Add to bag** + **Wishlist** + **Personnaliser** (deep-link to the
  builder with this base pre-selected).
- Trust strip: COD · 48 h delivery · retrait en boutique gratuit ·
  14 j retour.
- Description (≤ 80 words) + spec bullets.
- Reviews (with photos, verified-buyer flag).
- "Pairs with…" cross-sell (e.g. mug from the same anime).
- "Du même drop" — sibling pieces.
- Sticky mobile add-to-bag.

### D.4 /custom (Custom Builder)
The brand's moat. Full spec in
[07-component-library.md §6](./07-component-library.md#6-custom-builder-the-brands-moat).
Brief: pick base → pick design → side(s) → size / colour → live
price → preview → add to cart or save quote.

### D.5 /drops + /drops/{slug}
Reuse the OKAMI drop machine; pre-launch / live / sold-out / archive.

### D.6 /panier + cart drawer
- Drawer is enough for 95 % of users; full page is the fallback.
- Lines with thumbnail, name, variant (or custom config), price, qty.
- Subtotal, free-shipping bar, pickup-vs-delivery toggle, COD
  assurance, "passer la commande" + "continuer mes achats".

### D.7 /checkout
- One page, three groups: Contact · Livraison / Retrait · Paiement.
- **Wilaya → commune cascading** (reuse the Glstore wilayas dataset).
- Pickup-at-Bab-Ezzouar removes the address group entirely.
- COD default; Card secondary.
- Phone required; SMS confirmation sent on success.

### D.8 /compte
- Magic-link login (no password); optional password.
- Dashboard: last order, wishlist, "mes designs sauvegardés"
  (saved Custom Builder quotes).
- Orders list + tracking.
- Addresses.
- Notification preferences.

### D.9 /boutique (the physical shop page)
- Photos: storefront, inside, the printer at work.
- Hours + Google Maps embed (or photo + deep-link).
- "What to expect" — try-on, custom print while you wait, accessories.
- `LocalBusiness` JSON-LD with address + openingHours +
  geoCoordinates + priceRange.

### D.10 /journal
- Long-form posts: drop stories, founder posts, "how we screen-print
  in-store", anime news pieces tied to drops. Tag by anime, by
  drop, by theme.

### D.11 /aide cluster
- /aide/personnalisation — the print process, lead time, FAQ.
- /aide/livraison — DZ tariffs, ETA per wilaya.
- /aide/retours — 14-day policy.
- /aide/tailles — cm tables per garment family.
- /aide/faq — searchable accordion.
- /aide/contact — form + WhatsApp + phone + email.

## E. Modern commerce features — pick list

Same machinery as OKAMI where possible; tuned for SHINOBI:

- **Custom Builder** — see component library §6.
- **Wishlist** — local-first, syncs to account on login.
- **Recently viewed** — 8 items, localStorage, quietly surfaced on PLP + home.
- **Quick add** — bottom-sheet on PLP and search.
- **Quick view** — modal PDP; size + add without leaving the grid.
- **Recommendations** — "From the same anime", "Pairs with",
  "Customers also bought". Curated first; Algolia personalisation
  later.
- **Reviews + UGC** — first-party; photos; verified-buyer flag from
  the order ledger. Instagram-tag-driven UGC wall (`#shinobishopdz`)
  on the homepage and PDPs.
- **Drops** — reuse the OKAMI engine.
- **Notify-on-restock + drop-launch** — email + SMS, segmented.
- **Loyalty + Referral (Phase 4)** — points, codes; spend on
  shipping or in-store accessories.
- **In-store pickup** — first-class fulfilment, see §D.7.
- **WhatsApp deep-link** — footer + every confirmation email.

## F. Internationalisation

- Languages: **FR** primary (the brand voice), **EN** secondary at
  launch, **AR** with RTL in **v1.1**.
- Currency: **DZD** primary; **EUR** display for diaspora; payment
  always in DZD.
- URL strategy: `/` (FR default), `/en/`, `/ar/` (added v1.1).
  `hreflang` per route.
- Translations owned in the CMS, not in source.

## G. Performance budget (per page)

| Resource | Mobile budget |
|---|---|
| HTML | ≤ 30 KB gz |
| Critical CSS | ≤ 30 KB |
| Initial JS | ≤ 120 KB gz |
| Fonts | 1 family + 1 display weight + 1 Japanese fallback, ≤ 80 KB combined, `font-display: swap` |
| Hero image | ≤ 100 KB at LCP size |
| 3rd-party scripts above the fold | 0 |

The Custom Builder ships with its own perf budget — image
compositing in the preview happens on the client at 80 % JPEG, not
4K PNG.

## H. Accessibility baseline (non-negotiable)

- WCAG 2.2 AA across every published surface.
- Keyboard reachable; visible focus.
- `prefers-reduced-motion` honoured.
- Colour-contrast invariants checked in CI for every token pair.
- Custom Builder's design picker is keyboard reachable (arrow-keys
  + filterable list, not hover-only).

## I. SEO architecture (highlights)

- Stable URLs: `/shop/{slug}`, `/custom`, `/drops/{slug}`,
  `/journal/{slug}`, `/boutique`. Canonical never includes filter
  query strings.
- JSON-LD per route:
  - Home: `Organization`, `WebSite` (`SearchAction`), `BreadcrumbList`.
  - PLP: `BreadcrumbList`, `ItemList`.
  - PDP: `Product`, `Offer`, `AggregateRating`.
  - `/boutique`: `LocalBusiness` + `address` + `openingHours` +
    `geo`. **Single biggest local-SEO unlock.**
  - `/custom`: `Service` + `Offer` (with the priceRange).
  - Drop: `Event` + `Product[]`.
  - Journal: `Article`.
  - `/aide/faq`: `FAQPage`.
- `hreflang` per locale.
- Sitemap split: products, drops, journal, pages — regenerated
  nightly + on publish webhook.
- Open Graph + Twitter card per page; per-drop OG art generated by
  the CMS.

## J. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Owner over-commits to custom orders → lead time blows out | High | High | The Custom Builder writes a `customOrder` with `eta = now + 3 working days`; if the queue is hot, the cart blocks new custom orders ("nous reprenons les commandes lundi"). |
| Custom design IP / licensing exposure (anime rights) | High | Medium | Standard disclaimer + design-by-request workflow with the owner moderating uploads. Phase 1 ships *curated* designs only — no public upload-and-sell. |
| Drop-day traffic spikes | Low (audience size) | Medium | Edge cache for PDP / drop pages; queue page on > 50 req / s per SKU. |
| DZD ↔ EUR display drift | Medium | Low | Daily-cached FX feed; always charge DZD. |
| Email deliverability MENA | Medium | High | Klaviyo + dedicated subdomain + DKIM / SPF / DMARC enforced. |
| Pickup-vs-delivery confusion in checkout | Medium | High | Pickup is a single visible toggle at the top of the shipping step; copy + map reinforce. |
| Owner-side print queue gets disorganised | Medium | High | A dedicated **Print Queue** dashboard in the admin (Phase 2) — auto-grouped by base × design, status states (`new → printed → ready → handed_off`). |
