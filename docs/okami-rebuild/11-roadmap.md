# 11 — Implementation Roadmap & Final Recommendations

A 12-week plan from empty repo to live storefront, plus the
recommendations that govern decisions along the way.

## A. Phases

### Phase 0 — Foundations (Week 1)

| Workstream | Deliverables |
|---|---|
| Repo | Monorepo scaffold ([09-folder-structure.md](./09-folder-structure.md)), pnpm, turbo, commit hooks, lint, prettier. |
| Tokens | `packages/tokens` source + Style-Dictionary build; CI contrast check. |
| Design system | Storybook + first 10 primitives from [07-component-library.md](./07-component-library.md). |
| Infra | Vercel project, Neon Postgres, Sanity project, Algolia app, Klaviyo account, Sentry, PostHog. |
| Env | `.env.example`, zod-validated `env.ts`. |
| CI | GitHub Actions: lint + test + build on every PR; preview deploy per PR. |

Exit criteria: a deployable home page on Vercel that renders one hero
+ token CSS; Storybook deployed; CI green.

### Phase 1 — Core commerce (Weeks 2–4)

| Workstream | Deliverables |
|---|---|
| Commerce | `packages/commerce` client + types generated from the existing backend's OpenAPI / GraphQL schema; product, collection, cart, checkout, customer queries. |
| Routing | `(marketing)`, `(shop)`, `(account)` route groups; middleware for i18n cookie + redirect; `robots.ts` + `sitemap.ts`. |
| Pages | Home (no drops yet), `/shop`, `/shop/[handle]` (PDP), `/search`, `/cart`, `/checkout` (custom), `/order/track`, `/help/*`, `/legal/*`. |
| Components | Nav, Footer, ProductCard, Gallery, VariantSelector, AddToCartButton, CartDrawer, FilterBar, Pagination. |
| Search | Algolia ingestion worker; SearchOverlay component; PLP filters. |
| Analytics | PostHog + Plausible installed; key events: `view_product`, `add_to_cart`, `checkout_start`, `purchase`. |
| Auth | Magic-link primary; commerce-backend customer token mapping. |
| Account | Dashboard, orders, addresses. |
| Tests | E2E happy path (home → PLP → PDP → cart → custom checkout). |

Exit criteria: a customer can find a real product, add it, and check
out via the custom checkout; Lighthouse ≥ 85 mobile on the four
core templates.

### Phase 2 — Drops engine (Weeks 5–6)

| Workstream | Deliverables |
|---|---|
| Postgres | Prisma migrations for `Drop`, `DropSubscription`, `NotifyEvent`, `MagicLinkToken`. |
| Cron | Scheduled state flips (Upstash QStash or Vercel cron) — `upcoming → live → sold_out → archived`. |
| Pages | `/drops`, `/drops/[slug]` (state-driven render), `/drops/archive`. |
| Components | DropHero, Countdown (server-rendered + drift-correct), DropGate, DropArchiveCard, StockSignal. |
| Email | Klaviyo flows: "drop launching in 24 h", "drop is live", "we restocked". |
| Notify-me | Server actions + Postgres records + Klaviyo segment sync. |
| Drop-day prep | Edge caching strategy, cache pre-warmer, queue page. |

Exit criteria: a scheduled drop goes live automatically, the homepage
hero swaps to "live" automatically, and the email blast goes out from
Klaviyo to the right segment.

### Phase 3 — Editorial layer (Weeks 7–8)

| Workstream | Deliverables |
|---|---|
| CMS schemas | Drop, Lookbook + Chapter, Journal post, Home singleton, FounderLine. |
| Pages | `/lookbook`, `/lookbook/[slug]`, `/journal`, `/journal/[slug]`, `/about`. |
| Components | LookbookChapter, JournalPost (MDX-like via PortableText), FounderLine rotator, UgcWall (Foursixty / curated). |
| SEO | JSON-LD on all editorial; `hreflang` for FR. |
| i18n | FR locale shipped end-to-end (translations sourced via CMS). |

Exit criteria: editor can publish a lookbook chapter in Sanity and see
it live within 60 seconds; FR shopper has full coverage of nav, PLP,
PDP, cart, account.

### Phase 4 — Loyalty & retention (Weeks 9–10)

| Workstream | Deliverables |
|---|---|
| Loyalty | `LoyaltyLedger`, `Referral`; points-on-order, redemption at checkout (discount-code creation via the commerce backend's admin endpoint). |
| Reviews | Submit form + moderation queue + display on PDP + Schema.org `AggregateRating`. |
| Recommendations | `pdp.related`, `pdp.cross_sell`, `cart.upsell` slots; curated lists in CMS first; Algolia personalisation second. |
| Reactivation | Klaviyo flows: cart abandon, browse abandon, post-purchase. |
| Wishlist sync | Anonymous → account merge on login. |

Exit criteria: a returning customer sees their wishlist, gets a relevant
upsell in the cart, and can redeem loyalty points at checkout.

### Phase 5 — Hardening (Week 11)

| Workstream | Deliverables |
|---|---|
| Accessibility | Full WCAG 2.2 AA audit (manual + axe-core); fix every `serious` finding. |
| Performance | LCP < 1.8 s mobile on every key route; bundle ≤ 120 KB gz initial; image budgets enforced. |
| SEO | Manual sitemap review; hreflang; per-route OG art; broken-link sweep. |
| Security | CSP nonce; rate limits on auth + tracking + reviews; HSTS preload; secret scanning enabled. |
| Observability | Sentry sourcemaps; PostHog dashboards; drop-day Grafana board; on-call rota. |
| Backups | Postgres nightly + PITR; Sanity dataset export weekly. |

Exit criteria: every page passes Lighthouse ≥ 90 mobile and axe-core has
zero `serious` violations; security scan clean.

### Phase 6 — Launch (Week 12)

| Workstream | Deliverables |
|---|---|
| Migration | DNS cutover; legacy redirects (old SPA URLs → new SSR routes). |
| Soft launch | 10 % traffic via Vercel A/B for 48 h; full cutover after. |
| Comms | Founder post, Instagram + TikTok announcement, email blast. |
| Day-1 ops | War-room channel, on-call rota, sub-15-min SLA on cart/checkout errors. |
| Day-7 review | KPI vs targets; backlog pruned. |

Exit criteria: live, monitored, learning.

---

## B. AR (Arabic + RTL) — v1.1

Why not in v1: AR forces a layout + typography review for every
component. Better to ship EN + FR in v1, observe, and add AR
deliberately in v1.1 (Weeks 13–14). Plan:

- Add `--f-arabic` and the RTL stylesheet (`dir="rtl"` on `<html>`).
- Swap all physical (`left/right`) styles for logical
  (`start/end`); CI lints for `left:` / `right:` outside legacy.
- Translate via CMS + Klaviyo lists.
- Re-shoot accessibility & Lighthouse in AR.

---

## C. Risks and mitigations (focused)

| Risk | Mitigation |
|---|---|
| Drop-day origin overload | Pre-warm cache; edge SSR; queue page at >X req/s/sku. |
| Commerce-backend rate limits on bulk reads | Persistent queries + ETag-aware caching at the BFF layer; pre-warm before drops. |
| CMS / commerce-backend "two sources of truth" drift | A single nightly reconciliation job logs deltas and Slack-alerts. |
| Email deliverability MENA | Dedicated subdomain + DKIM/SPF/DMARC; warm before drop blasts. |
| Image weight creep | CI gate: page weight > budget = fail build. |
| Translation rot | Per-locale CI check: missing keys / untranslated strings. |
| Designer ↔ engineer drift on tokens | Tokens are the only source; Figma imports tokens.json. |

---

## D. Operating cadence after launch

- **Weekly review.** Funnel + drop performance + a11y/perf budgets.
- **Bi-weekly drop ritual.** Pre-drop (CMS + tag + assets), drop day
  (war-room), post-drop (replays + email retarget).
- **Monthly content sweep.** Out-of-date journal posts pruned; SEO
  refresh on top 20 routes.
- **Quarterly system review.** Re-run Lighthouse + axe; refresh stack
  versions; rotate secrets.

---

## E. Final recommendations

1. **Adopt the drops engine before chasing visual polish.** The brand's
   biggest unlock is treating drops as a first-class concept; the design
   then has something concrete to dress up.
2. **Ship EN + FR in v1, not EN-only.** The Algerian customer reads
   FR. Adding AR is a v1.1 task because it is a design exercise as
   well as a translation one.
3. **Do not migrate off the custom commerce backend.** It already
   models the Algerian-market realities (DZD pricing, currency switch,
   admin subdomain). Evolve in place — re-platforming would burn
   months for no customer-visible win.
4. **Treat the founder voice as a fixture.** A weekly line in the home
   page, a monthly journal post, a quarterly lookbook. The site falls
   apart when this fades; do not let it.
5. **Lighthouse and axe gates are non-negotiable in CI.** They are the
   only honest defence against drift. Once a budget is broken, it
   tends to stay broken.
6. **Use Postgres for the things the commerce backend won't model.**
   Drops, reviews, loyalty, magic-links. Resist the temptation to
   bend the commerce schema for editorial concerns.
7. **Instrument from day one.** PostHog funnels, Sentry, Lighthouse-CI,
   and a drop-day Grafana board. You cannot fix what you cannot see.
8. **Be honest in copy about the COD reality, the delivery window,
   and the return policy.** Trust is the single biggest conversion
   lever in this market.
9. **Keep the bag light.** Streetwear sites die from feature bloat,
   not from missing features. Aim for fewer, better pages.
10. **Plan to refactor the catalog model when the brand expands beyond
    graphic apparel.** The current model assumes one shape (hoodie /
    tee). Outerwear and accessories will need a more flexible variant
    model — do not paint into a corner.
