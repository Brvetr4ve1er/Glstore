# 01 — Executive Summary

## The brand we are rebuilding

OKAMI is a founder-led, Algiers-based streetwear label that sells graphic
hoodies and tees with anime-pop-culture references through limited drops.
The current storefront is (almost certainly) a Shopify theme — capable,
but generic. The brand's strongest asset is a personal, drop-driven
narrative on Instagram and TikTok; the storefront does not yet match
that energy.

## What the rebuild must do

Move from "competent theme" to "*the* drop-culture storefront from
Algiers."

1. **Tell the story.** A founder voice + drop calendar must be the
   spine of the site, not an afterthought below the fold.
2. **Sell the drop, then the product.** Drops are the unit of inventory,
   not SKUs. Treat them as first-class CMS objects with countdowns,
   notify-on-restock, and "exit polish" (sold-out badges, lookbook
   afterlife).
3. **Compress the funnel.** Streetwear sales hinge on size + colour +
   quick-add. Quick-view, sticky bag, and a one-screen checkout matter
   more than mega-menus.
4. **Be honest about Algeria.** COD-first checkout, wilaya/commune
   addresses, DZD with EUR display option for diaspora — the same
   constraints already solved in the Ghir Laffaire backend that lives
   in this repo. Reuse it.
5. **Be fast and accessible.** A streetwear site that hangs on hero
   videos or fails colour-contrast on a hoodie price tag has already
   lost the click.

## Why a rebuild rather than a re-theme

Shopify themes get you 70 % of the way to "fine" and 0 % of the way to
"the OKAMI thing." The brand needs:

- A real drop-engine (scheduled release, queue, notify-when-live).
- A lookbook + editorial layer that is not a stretched product grid.
- Bilingual (EN / FR / AR) with proper RTL where relevant.
- COD checkout flows tuned for Algerian fulfilment.
- A headless setup that lets the design move quickly without theme
  overrides bottlenecks.

A headless front (Next.js) on top of Shopify keeps the inventory /
payment / Shopify-admin advantages while removing the design ceiling.

## Headline targets (one quarter, post-launch)

| Metric                       | Today (est.) | Target |
|------------------------------|--------------|--------|
| Lighthouse Performance (mob) | 50–70        | ≥ 90   |
| Largest Contentful Paint     | 3–5 s        | < 1.8 s |
| CLS                          | 0.1+         | < 0.05 |
| Mobile add-to-cart rate      | ~3 %         | 6 %+   |
| Cart → Checkout              | 35–45 %      | 60 %+  |
| Checkout completion (COD)    | 65 %         | 85 %+  |
| Newsletter capture rate      | 0.5 %        | 2 %+   |
| Drop-day p95 TTFB            | 800 ms+      | < 250 ms |

These are not guesses pulled from the ether — they are the gap between
a generic Shopify theme and a hand-built headless storefront targeted
at this exact segment.

## Phased plan in one breath

- **Phase 0 (Week 1):** Foundations — design tokens, repo, CMS schemas,
  CI, analytics base.
- **Phase 1 (Weeks 2–4):** Core commerce — PLP, PDP, cart, COD checkout,
  account, search.
- **Phase 2 (Weeks 5–6):** Drops engine — scheduled releases, queue,
  countdowns, notify-on-restock.
- **Phase 3 (Weeks 7–8):** Editorial — lookbook, journal, founder
  voice, UGC.
- **Phase 4 (Weeks 9–10):** Loyalty, referrals, retention.
- **Phase 5 (Week 11):** Hardening — performance, a11y, SEO, security.
- **Phase 6 (Week 12):** Soft launch, instrument, iterate.

Full detail in [11-roadmap.md](./11-roadmap.md).

## What to read next

- The opinionated diagnosis: [03-user-flows-and-ux.md](./03-user-flows-and-ux.md).
- The systems that make the rebuild buildable in 12 weeks:
  [05-rebuild-strategy.md](./05-rebuild-strategy.md) +
  [08-technical-architecture.md](./08-technical-architecture.md).
