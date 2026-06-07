# 11 — Implementation Roadmap & Final Recommendations

A 12-week plan from empty repo to live storefront, riding on the
Glstore FastAPI backend that already lives in this repo. Phases
mirror the OKAMI roadmap so a single team can ship both projects in
parallel.

## A. Phases

### Phase 0 — Foundations (Week 1)

| Workstream | Deliverables |
|---|---|
| Repo | Monorepo scaffold ([09-folder-structure.md](./09-folder-structure.md)), pnpm, turbo, commit hooks, lint, prettier. |
| Tokens | `packages/tokens` source + Style-Dictionary build; CI contrast check; seigaiha SVG asset. |
| Design system | Storybook + first 10 primitives from [07-component-library.md](./07-component-library.md). |
| Infra | Vercel project, Neon Postgres, Sanity project, Algolia app, Klaviyo account, Sentry, PostHog. |
| Commerce client | `packages/commerce` typed client against the Glstore FastAPI (OpenAPI-driven codegen). |
| Env | `.env.example`, zod-validated `env.ts`. |
| CI | GitHub Actions: lint + test + build on every PR; preview deploy per PR. |

Exit criteria: a deployable home page on Vercel renders one hero
with the SHINOBI seigaiha background + token CSS; Storybook deployed;
CI green.

### Phase 1 — Core commerce (Weeks 2–4)

| Workstream | Deliverables |
|---|---|
| Routing | `(marketing)`, `(shop)`, `(account)` route groups; middleware for FR/EN cookie + redirect; `robots.ts` + `sitemap.ts`. |
| Pages | `/`, `/shop`, `/shop/{cat}`, `/shop/{cat}/{handle}`, `/search`, `/panier`, `/checkout`, `/checkout/confirm/{order}`, `/commande/suivi`, `/aide/*`, `/mentions/*`, `/boutique`, `/a-propos`. |
| Components | TopNav (with mascot), Footer, ProductCard, AnimeTag, Gallery, VariantSelector, AddToCartButton, CartDrawer, PickupOrDeliveryPicker, WilayaCommuneCascade, FilterBar, Pagination. |
| Search | Algolia ingestion worker fed by Glstore webhooks; SearchOverlay component; PLP filters. |
| Auth | Magic-link primary; Glstore customer token mapping. |
| Account | Dashboard, orders, addresses, wishlist. |
| Analytics | PostHog + Plausible + Meta Pixel + TikTok Pixel installed; events `view_product`, `add_to_cart`, `checkout_start`, `purchase`. |
| `/boutique` SEO | `LocalBusiness` JSON-LD with the verified address, opening hours, map. |
| Tests | E2E happy path (home → PLP → PDP → cart → COD checkout). |

Exit criteria: a customer can find a real product, add it, and
check out via COD or in-store pickup; Lighthouse ≥ 85 mobile on the
four core templates.

### Phase 2 — Custom Builder + Print Queue (Weeks 5–6)

| Workstream | Deliverables |
|---|---|
| Postgres | Prisma migrations for `CustomOrder`, `Drop`, `DropSubscription`, `NotifyEvent`, `MagicLinkToken`. |
| Custom Builder | The `/custom` route end-to-end (see [07 §6](./07-component-library.md#6-custom-builder-the-brands-moat)). |
| Quotes | `/custom/quote/{id}` shareable URLs. |
| Cart bridge | Custom config attaches to the cart line via `meta.customOrderId`. |
| Print Queue | Owner-facing admin page (`/admin/print-queue` in the Glstore admin) — grouped reads, state transitions, ETA badges. |
| Drops engine | Reuse OKAMI's Drop machinery; UPCOMING → LIVE → SOLD_OUT → ARCHIVED. |
| Email | Klaviyo flows: "drop launching in 24 h", "drop is live", "we restocked", "your custom order is printed", "your order is ready in-store". |
| SMS | DZ SMS provider wired for pickup-ready + delivery alerts. |
| Tests | E2E: build a Custom Order → add → checkout → owner marks printed → buyer sees "Prête". |

Exit criteria: the owner can run a full custom-print day from one
screen; buyers can self-serve a quote and add it to cart.

### Phase 3 — Editorial layer + Reviews (Weeks 7–8)

| Workstream | Deliverables |
|---|---|
| CMS schemas | Drop, Boutique singleton, Journal post, Home singleton, FounderLine, Design (Custom Builder catalogue). |
| Pages | `/journal`, `/journal/{slug}`, founder-line rotator on home. |
| Reviews | Submission form + moderation queue + display on PDP + `AggregateRating` JSON-LD. |
| UGC | `#shinobishopdz` Instagram wall on the homepage and PDPs. |
| SEO | JSON-LD on every editorial route; `hreflang` for FR + EN. |
| i18n | EN locale shipped end-to-end (translations from the CMS). |

Exit criteria: an editor can publish a journal post in Sanity and
see it live within 60 s; EN parity on nav, PLP, PDP, cart, account.

### Phase 4 — Loyalty & retention (Weeks 9–10)

| Workstream | Deliverables |
|---|---|
| Loyalty | `LoyaltyLedger`, `Referral`; points-on-order, redemption at checkout (discount code via Glstore admin endpoint). |
| Recommendations | `pdp.related`, `pdp.cross_sell`, `cart.upsell` slots; curated lists in CMS first; Algolia personalisation second. |
| Reactivation | Klaviyo flows: cart abandon, browse abandon, post-purchase, "your anime drops" tag-based. |
| Wishlist sync | Anonymous → account merge on login. |

Exit criteria: a returning customer sees their wishlist, gets a
relevant upsell in the cart, and can redeem loyalty points at
checkout.

### Phase 5 — Hardening (Week 11)

| Workstream | Deliverables |
|---|---|
| Accessibility | Full WCAG 2.2 AA audit; fix every `serious` finding; Custom Builder reachable by keyboard end-to-end. |
| Performance | LCP < 1.8 s mobile on every key route; bundle ≤ 120 KB gz initial. |
| SEO | Manual sitemap review; hreflang; per-route OG art; broken-link sweep. |
| Security | CSP nonce; rate limits on auth + tracking + reviews + custom-builder save-quote; HSTS preload; secret scanning. |
| Observability | Sentry sourcemaps; PostHog dashboards; print-queue Grafana board; on-call rota. |
| Backups | Postgres nightly + PITR; Sanity dataset export weekly. |

Exit criteria: every page passes Lighthouse ≥ 90 mobile and
axe-core has zero `serious` violations; security scan clean.

### Phase 6 — Launch (Week 12)

| Workstream | Deliverables |
|---|---|
| Soft launch | 10 % traffic via Vercel A/B for 48 h; full cutover after. |
| Comms | Founder post on IG + TikTok; phone-line scripts for "we now have a website"; an in-store QR code on the counter. |
| Day-1 ops | War-room channel, sub-15-min SLA on checkout errors. |
| Day-7 review | KPI vs targets; backlog pruned. |

Exit criteria: live, monitored, learning.

---

## B. AR (Arabic + RTL) — v1.1

Why not in v1: AR forces a layout + typography review for every
component. Ship FR + EN in v1, add AR in v1.1 (Weeks 13–14):

- `--f-arabic` family + RTL stylesheet (`dir="rtl"` on `<html>`).
- All physical (`left/right`) styles → logical (`start/end`).
- Translation via CMS + Klaviyo lists.
- Re-shoot a11y + Lighthouse in AR.

---

## C. Risks & mitigations (focused)

| Risk | Mitigation |
|---|---|
| Custom orders saturate the printer | Cart blocks new custom orders when the queue depth > N; copy: "nous reprenons les commandes {date}". |
| Anime IP licensing exposure | Phase 1 ships only the curated catalogue; uploads require owner moderation; standard disclaimer; remove on takedown. |
| Pickup-vs-delivery confusion in checkout | Pickup is a single visible toggle at the top of the shipping step; copy + map reinforce; pickup gets a distinct order-number prefix. |
| Drop-day traffic spikes | Pre-warm cache; edge SSR; queue page at > 50 req/s/SKU. |
| Email deliverability MENA | Dedicated subdomain + DKIM/SPF/DMARC; warm before drop blasts. |
| Translation rot | Per-locale CI check: missing keys / untranslated strings. |
| Designer ↔ engineer drift on tokens | Tokens are the only source; Figma imports `tokens.json`. |
| Glstore backend changes break the storefront | OpenAPI codegen pinned per release; contract tests at `packages/commerce`. |

---

## D. Operating cadence after launch

- **Weekly review.** Funnel + drop performance + Custom Builder
  completion + a11y/perf budgets.
- **Bi-weekly drop ritual.** Pre-drop (CMS + tags + assets), drop
  day (war-room), post-drop (replays + email retarget).
- **Monthly content sweep.** Out-of-date journal posts pruned; SEO
  refresh on top 20 routes.
- **Quarterly system review.** Lighthouse + axe; refresh stack
  versions; rotate secrets.

---

## E. Final recommendations

1. **Ride the Glstore backend.** Months of plumbing already exist —
   COD, 58 wilayas, order tracking, admin, the URL importer. The
   biggest mistake would be rebuilding any of it.
2. **The Custom Builder is the product.** It is what SHINOBI *is*,
   not a feature. Resource it accordingly — Phase 2 is non-optional.
3. **Make the boutique visible.** The Bab Ezzouar shop is an asset,
   not just an address. A real `/boutique` page with photos, hours,
   `LocalBusiness` schema, and in-store pickup as a first-class
   option compounds for years.
4. **Stay French-first.** The brand voice is FR. English is a
   bridge to the diaspora; AR is the v1.1 unlock.
5. **Show the price.** Always, everywhere, on every product, on
   every quote. The "Combien?" tax is the single biggest growth
   leak.
6. **Use Postgres for what Glstore won't model.** Custom orders,
   drops, reviews, loyalty, magic-links. Resist the temptation to
   shove them into product side-fields.
7. **Instrument from day one.** PostHog funnels, Sentry,
   Lighthouse-CI, a print-queue Grafana board. You cannot fix what
   you cannot see.
8. **Be honest in copy.** COD, the 3 – 4 day lead time, the 14-day
   return window. Trust is the single biggest conversion lever in
   this market.
9. **A11y and perf budgets are non-negotiable in CI.** They are the
   only honest defence against drift.
10. **Plan the variant model expansion now.** Today's catalogue is
    tees / sweats / pulls / mugs / totes / caps + in-store
    accessories. When katanas and figurines go online in v1.1, the
    variant model needs `fulfilment: pickup_only`, `lead_time_days`,
    and `requires_id_check` fields. Provision them in the schema
    today.
