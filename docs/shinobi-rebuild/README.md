# SHINOBI Shop — Build Project

> A senior cross-functional plan to take SHINOBI Shop from
> **Instagram-DM-only commerce** to a real storefront — without losing
> the brand voice, the physical boutique, or the custom-print service
> that defines it.
>
> This is a *0 → 1* build, not a re-platforming. The brand exists on
> Instagram (@shinobishopdz), in a physical shop at Centre Commercial
> Bab Ezzouar, Algiers — but does not have its own online store yet.

## How to read this folder

| # | File | Maps to brief output |
|---|---|---|
| **00** | [**00-source-data.md**](./00-source-data.md) | Owner-supplied brand data (verbatim · source of truth) |
| 01 | [01-executive-summary.md](./01-executive-summary.md) | Executive Summary |
| 02 | [02-audit-and-sitemap.md](./02-audit-and-sitemap.md) | Current-state Audit · Future Sitemap |
| 03 | [03-user-flows-and-ux.md](./03-user-flows-and-ux.md) | User Flows · DM → Web Conversion |
| 04 | [04-competitive-analysis.md](./04-competitive-analysis.md) | Competitive Analysis (DZ + global) |
| 05 | [05-rebuild-strategy.md](./05-rebuild-strategy.md) | Build Strategy |
| 06 | [06-design-system.md](./06-design-system.md) | Design System |
| 07 | [07-component-library.md](./07-component-library.md) | Component Library (with custom-design builder) |
| 08 | [08-technical-architecture.md](./08-technical-architecture.md) | Technical Architecture |
| 09 | [09-folder-structure.md](./09-folder-structure.md) | Folder Structure |
| 10 | [10-data-and-cms-schemas.md](./10-data-and-cms-schemas.md) | Database & CMS Schema |
| 11 | [11-roadmap.md](./11-roadmap.md) | Implementation Roadmap · Final Recommendations |
| 12 | [12-launch-checklist.md](./12-launch-checklist.md) | Launch Checklist |
| **preview** | [**preview/index.html**](./preview/index.html) | Live HTML preview of the design system |

## Source-access note

Direct HTTP fetches of the Instagram account are blocked at this
build environment's egress proxy. The brand intel therefore combines:

1. **[VERIFIED — Owner]** — the data the owner pasted into the build
   brief (see `00-source-data.md`).
2. **[VERIFIED — Public]** — Instagram account presence and
   Bab Ezzouar location confirmed via web search.
3. **[INFERRED]** — convention from the broader DZ anime-streetwear
   segment + the comparable boutiques surfaced in the competitive
   analysis.

The recommendations themselves do not depend on the inferences — they
describe what a superior system *should be*.

## Brand reality (verified by owner)

- **Name:** SHINOBI Shop · *La Boutique du Guerrier* (the warrior's
  shop)
- **Position:** anime-otaku streetwear and personalised print
  service. *"Forgez votre propre univers otaku"* (forge your own
  otaku universe).
- **Where:** Centre Commercial Bab Ezzouar, Algiers, Algeria.
  Nationwide delivery across the 58 wilayas.
- **Today's storefront:** Instagram (@shinobishopdz), phone
  (023 925 014), and the physical boutique. **No e-commerce site
  exists yet.**
- **Catalogue:** anime-print T-shirts (oversize), hoodies/sweats,
  mugs, caps, tote bags, plus accessories sold in-store (katana
  replicas, figurines, keychains).
- **Service core:** in-shop custom printing — pick a piece, pick a
  design, recto / verso, walk out with it.

## What this build does

It ships SHINOBI an actual online store, **on top of the Glstore
FastAPI commerce backend that already lives in this repo** — saving
months of plumbing — with three brand-specific additions:

1. A **custom-print builder** (product × design × side(s)) that is
   the brand's actual differentiator.
2. **In-store pickup vs delivery** picker that respects the Bab
   Ezzouar physical presence.
3. **Bilingual FR/EN** UI with the option to add AR + RTL in v1.1.

## Sources

- [Shinobi Shop DZ on Instagram (@shinobishopdz)](https://www.instagram.com/shinobishopdz/?hl=en)
- [LinkedIn — Bab Ezzouar media: shinobishopdz](https://fr.linkedin.com/posts/bab-ezzouar-media-shinobishopdz-45485229a_shinobishop-boutique-sp%C3%A9cialis%C3%A9e-dans-lobjet-activity-7141357582924840960-MQhc)
- DZ market comparables surveyed in `04-competitive-analysis.md`:
  [Geekio Store DZ](https://www.instagram.com/geekio_dz/?hl=en),
  [NexWear](https://www.instagram.com/nexwear_dz/?hl=es),
  [AY-Line](https://ay-line.com/).
