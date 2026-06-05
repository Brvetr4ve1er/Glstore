# 04 — Competitive Analysis

> The point is not to copy these brands. It is to mark the bar a fashion
> e-commerce site can clear today, and to be honest about which
> primitives we will steal and which we will not.

## A. Reference set

| Brand | Why it is here | What it does best |
|---|---|---|
| **Nike** | Largest commerce in fashion — every primitive is battle-tested at scale. | Drop calendar (SNKRS), member-gated launches, fast PDP. |
| **Aimé Leon Dore** | Elite editorial fashion site. | Storytelling-first homepage, lookbook density, brand atmosphere. |
| **Kith** | Drops culture done right. | Drop pages with countdowns, archive narrative, mood. |
| **Represent** | Direct competitor in size — UK premium streetwear. | Bilingual market support, clean PDP, cinematic hero. |
| **Uniqlo** | Mass-market, but the engineering is excellent. | Filters, performance, accessibility, multilingual UX. |

## B. Scorecard (0–5, calibrated to fashion e-commerce 2026)

| Capability | Nike | ALD | Kith | Represent | Uniqlo | **OKAMI today** | **OKAMI target** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Brand storytelling on home | 4 | 5 | 5 | 5 | 3 | 2 | **5** |
| Navigation & search | 5 | 3 | 4 | 4 | 5 | 2 | **4** |
| Product discovery (PLP) | 5 | 4 | 4 | 4 | 5 | 2 | **4** |
| PDP quality | 5 | 5 | 4 | 5 | 4 | 2 | **5** |
| Drop / launch experience | 5 | 4 | 5 | 4 | 3 | 1 | **5** |
| Mobile experience | 5 | 4 | 4 | 4 | 5 | 3 | **5** |
| Checkout | 4 | 4 | 4 | 4 | 5 | 3 | **4** |
| Account / loyalty | 5 | 3 | 3 | 3 | 4 | 1 | **3** |
| Trust building | 5 | 4 | 4 | 4 | 4 | 2 | **4** |
| Performance | 4 | 3 | 4 | 4 | 5 | 2 | **4** |
| Accessibility | 4 | 3 | 3 | 3 | 5 | 2 | **4** |
| SEO / content | 5 | 4 | 4 | 4 | 5 | 2 | **4** |
| Internationalisation | 5 | 3 | 3 | 4 | 5 | 1 | **4** |

`OKAMI today` is a heuristic best-case for a generic Shopify streetwear
store; revise after a live audit.

## C. What we steal — by primitive

### From Nike
- **Drop pages** with explicit `pre-launch / live / sold-out / restock` states.
- **Notify-me** as a first-class feature, not a bolt-on.
- **Server-rendered, time-zoned countdowns** that do not drift.

### From Aimé Leon Dore
- **Editorial hero** — full-bleed model photography, set, mood.
- **Story-led collection pages** — collection has a paragraph and a
  photo set above the grid.
- **Quiet design tokens** — small palette, generous spacing, restrained
  motion.

### From Kith
- **Drop archive** — sold-out drops are still browsable as story
  pages, not 404s.
- **"In the bag" cart drawer** with cross-sell that feels curated, not
  spammed.
- **Press / collaborations** surfaced as a journal track.

### From Represent
- **PDP image discipline** — flat-lay, on-model, detail, video — in
  that order.
- **Atmospheric homepage video** that respects reduced-motion.
- **Bilingual support** for EU vs UK market.

### From Uniqlo
- **PLP filter UX** — pinned filters bar, "applied" chips, "clear" CTA,
  count-as-you-filter.
- **Accessibility** — keyboard navigation, focus indicators, large
  touch targets.
- **Image performance** — responsive sources, no aspect-ratio jumps.

## D. What we do *not* steal

| From | What | Why not |
|---|---|---|
| Nike | Mega-menus | Wrong scale for OKAMI's catalog; adds load and complexity. |
| Nike | Login-gated launches | Hostile for a 13 K-follower brand still building trust. |
| ALD / Kith | NYC ZIP-coded delivery promises | Irrelevant in Algeria. |
| Represent | Card-only checkout default | COD is the default for the Algerian market. |
| Uniqlo | "Heat-tech / Airism" feature blocks | Overengineered for a graphic-apparel brand. |

## E. What we do that *they* don't

| Capability | Why it matters here |
|---|---|
| **COD-first checkout** with wilaya/commune cascade | The actual payment reality in Algeria. |
| **Track-by-phone+order#** without an account | Matches local customer-service expectations. |
| **Bilingual EN / FR / AR** with RTL | Real market segmentation. |
| **WhatsApp deep-link in confirmation + footer** | The actual communication channel. |
| **Founder voice** as a persistent thread on homepage + journal | OKAMI's actual differentiation. |
| **Anime / character drop tagging** for search and SEO | Customers search "TOJI hoodie", not "graphic hoodie". |

## F. Benchmarks to hit before launch

| Metric | Reference brands' typical | OKAMI launch target |
|---|---|---|
| Lighthouse Mobile Performance | 70–90 | ≥ 90 |
| LCP (4G mobile) | 1.4 – 2.0 s | < 1.8 s |
| CLS | < 0.05 | < 0.05 |
| INP | < 200 ms | < 200 ms |
| WCAG 2.2 AA | partial | full |
| TTFB drop-day p95 | 200–400 ms | < 250 ms |

When we hit these on launch we beat the reference set on the
fundamentals; the brand voice does the rest.
