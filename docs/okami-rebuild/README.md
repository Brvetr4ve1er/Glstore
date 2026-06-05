# OKAMI Streetwear — Rebuild Project

> A senior cross-functional reverse-engineering and modernization plan for
> `okami-streetwear.com`. Goal: ship a fashion e-commerce platform that
> is objectively superior to the original — in usability, conversion,
> scalability, maintainability, accessibility, performance, and brand
> presentation. Not a visual copy.

## How to read this folder

| # | File | Maps to master-prompt output |
|---|---|---|
| **00** | [**00-extracted-design-system.md**](./00-extracted-design-system.md) | **Verified as-is — source of truth** |
| 01 | [01-executive-summary.md](./01-executive-summary.md) | Executive Summary |
| 02 | [02-audit-and-sitemap.md](./02-audit-and-sitemap.md) | Website Audit · Sitemap |
| 03 | [03-user-flows-and-ux.md](./03-user-flows-and-ux.md) | User Flows · UX Problems |
| 04 | [04-competitive-analysis.md](./04-competitive-analysis.md) | Competitive Analysis |
| 05 | [05-rebuild-strategy.md](./05-rebuild-strategy.md) | Rebuild Strategy |
| 06 | [06-design-system.md](./06-design-system.md) | Design System |
| 07 | [07-component-library.md](./07-component-library.md) | Component Library |
| 08 | [08-technical-architecture.md](./08-technical-architecture.md) | Technical Architecture |
| 09 | [09-folder-structure.md](./09-folder-structure.md) | Folder Structure |
| 10 | [10-data-and-cms-schemas.md](./10-data-and-cms-schemas.md) | Database & CMS Schema |
| 11 | [11-roadmap.md](./11-roadmap.md) | Implementation Roadmap · Final Recommendations |
| 12 | [12-launch-checklist.md](./12-launch-checklist.md) | Launch Checklist |
| **13** | [**13-platform-reconciliation.md**](./13-platform-reconciliation.md) | **Reconciles the strategy with the verified stack** |

## Source-access note

Direct HTTP fetches of `okami-streetwear.com` from the original build
environment were blocked at the egress proxy
(`x-deny-reason: host_not_allowed`). The first pass relied on
inference; the project owner subsequently supplied a verbatim
ground-truth extraction (now `00-extracted-design-system.md`), and
this document set has been reconciled against it.

Tags used in the docs:

- **[VERIFIED]** — present in `00-extracted-design-system.md` or in
  other supplied source.
- **[INFERRED]** — retained only where the as-is doc is silent.
- **[CONVENTION]** — standard web-store anatomy unrelated to OKAMI.

The recommendations themselves do not depend on the inferences — they
describe what a superior system *should be*. The reconciliation in
`13-platform-reconciliation.md` records the few strategy changes
triggered by the verified stack (notably: the live site is a custom
React SPA + TailwindCSS v4 + custom headless commerce — **not**
Shopify, as earlier inferred).

## Brand reality (verified)

- **Name:** OKAMI · *Premium Streetwear from Algiers*
- **Geography:** Algeria (primary). Diaspora-EU/FR likely secondary.
- **Category:** Streetwear — anime/manga-influenced graphic apparel
  (hoodies, T-shirts; references like a "TOJI Hoodie" surface in
  social content).
- **Distribution model:** drops / limited releases. No custom orders.
- **Voice:** founder-led, personal — *"just a guy who puts his passion
  on shirts"*. Small but loyal community (~13 K Instagram followers).
- **Stack (verified from owner's extraction):** React SPA · TailwindCSS
  v4 · 3 self-hosted custom fonts (OKAMI, Streetwear, Inter) · custom
  headless commerce backend · client-side routing
  (`/shop`, `/about`, `/contact`, `/cart`) · `US` / `DA` currency
  switcher. **Not Shopify.**

## Sources

- [OKAMI — Premium Streetwear from Algiers (homepage)](https://okami-streetwear.com/)
- [@okami.streetwear on Instagram](https://www.instagram.com/okami.streetwear/)
- [OKAMI brand TikTok content (TOJI Hoodie post)](https://www.tiktok.com/@okami.streetwear/video/7313993360811855109)
- [Sister Shopify listing: okamishop.com](https://www.merchantgenius.io/shop/url/okamishop.com)
- [Sister Shopify listing: okamipad.com](https://www.merchantgenius.io/shop/url/okamipad.com)
