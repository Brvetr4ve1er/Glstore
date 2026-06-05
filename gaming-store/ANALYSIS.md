# SteelSeries — System Reverse-Engineering & Rebuild (GLAIVE)

A senior product-and-engineering analysis of **steelseries.com**, followed by the first-principles
rebuild shipped in this directory. The goal is *understanding the system well enough to build a better
one* — not cloning. Confidence levels are noted where the analysis is inferred rather than observed
(the live site returns `403` to automated fetchers, so visual/IA details below are reconstructed from
domain knowledge, search results, and public press material — **confidence: medium-high**).

---

## Phase 1 — Discovery

**Purpose & business model.** SteelSeries is a direct-to-consumer (D2C) **gaming-peripherals brand**
(headsets, keyboards, mice, mousepads, controllers) plus a free **software ecosystem** (GG / Sonar /
Engine / Moments) that drives retention and a data/community moat. Revenue is primarily hardware sales
(own store + retail/Amazon distribution), with the software acting as a zero-revenue *lock-in and
brand-affinity engine*.

| Dimension | Finding |
|---|---|
| Primary goal | Sell pro-grade peripherals D2C; route to retail where needed |
| Target audience | Competitive & enthusiast PC/console gamers, esports fans, content creators |
| Value proposition | "For Glory" — championship-proven gear co-designed with pro athletes |
| Conversion goals | Add-to-cart → checkout; software download; newsletter/account signup |
| Revenue model | Hardware sales (high consideration, mid-high AOV), accessories/consumables (grip tape, ear cushions = recurring) |
| Personas | *The Competitor* (specs/latency), *The Upgrader* (value/best-seller), *The Fan* (pro/limited editions), *The Gifter* (guided discovery) |

**Sitemap (inferred).**
```
/                       home
/headsets /keyboards /mice /mousepads /controllers /accessories   category PLPs
/<product-slug>         product detail (PDP)
/gg /sonar /engine /moments      software
/discover /press /pro-teams      brand/marketing
/cart /checkout /account /orders auth + commerce
/support (support.*)             help center (separate subdomain)
/legal /privacy /warranty        utility
```

**Information architecture.** Two top-level mental models — **Shop** (transaction) and
**Software/Discover** (engagement). Products nest *Category → Family (Arctis/Apex/Aerox) → Model → Variant*.
This family-based taxonomy is deliberate: it builds brand-line loyalty (you buy "an Arctis") and makes
cross-sell legible.

**Key user flows.**
- *Visitor → convert*: Home → category rail → PLP (filter) → PDP → add → cart drawer → checkout.
- *Researcher*: Home → product family landing → spec compare → PDP → reviews → buy.
- *Owner/retention*: download GG → register product → warranty/+1yr → re-buy consumables.
- *Support*: problem → support subdomain → article/downloads → contact.

---

## Phase 2 — Feature inventory

| Feature | Value | Complexity |
|---|---|---|
| Category PLPs with faceted filters (sort, price, connectivity, platform) | Core discovery | Med |
| PDP: gallery, variant/color swatches, spec table, reviews, financing | Core conversion | Med |
| Cart drawer + persistent cart | Reduce friction | Low-Med |
| Product family landing pages (editorial) | SEO + brand | Med |
| Software ecosystem (GG/Sonar/Moments) | **Retention moat** | High |
| Product registration + extended warranty | Trust + data capture | Med |
| Newsletter / account / early-access drops | Lead-gen + LTV | Low |
| Reviews & ratings (UGC) | Social proof | Med |
| Support knowledge base (subdomain) | Deflection | Med |
| Pro-team / esports content | Brand affinity | Low |
| Localization / multi-currency | Global reach | High |

**Improvement opportunities flagged:** spec-based product *comparison* tool, guided "find your gear" quiz,
bundle builder (mouse+pad+headset), trade-in/recycle, and clearer post-purchase software onboarding.

---

## Phase 3 — Design-system extraction → Phase 9 — tokens

Reverse-engineered visual language → reissued as the token set in `assets/css/styles.css`:

| Token group | Decision |
|---|---|
| **Color** | Near-black layered surfaces (`#0a0a0b → #232327`), single high-energy brand orange (`#ff5101`), restrained semantic colors. Dark-first because gaming hardware photography pops on black and reduces eye strain. |
| **Type** | Display: condensed bold uppercase (`Archivo`) for impact; Body: `Inter` for legibility. Fluid `clamp()` scale 0.75rem → 5.5rem. |
| **Spacing** | 4px base, 10-step scale. |
| **Radius** | 6/10/16/24px + pill. |
| **Elevation** | 3 shadow tiers + a brand "glow" for primary CTA emphasis. |
| **Motion** | One easing language (`cubic-bezier`), 140/280/500ms tiers; hover lift, scroll-reveal, drawer slide — all `prefers-reduced-motion` aware. |

**Component inventory rebuilt:** buttons (primary/ghost/lg/block + states), nav + mega-menu, mobile drawer,
hero, category card, product card, filter sidebar, sort select, cart drawer + line item + qty stepper,
PDP gallery/swatches/spec rows, feature bands, trust strip, newsletter, toast, footer.

---

## Phase 4 — UX / product / a11y / perf / SEO audit (of the original)

| Area | Likely strengths | Likely weaknesses / risks | Severity |
|---|---|---|---|
| Usability | Strong family IA, rich PDPs | Deep menus; spec overload for novices | Med |
| Accessibility | — | Dark UI risks low contrast on dim text; carousels & mega-menus are classic keyboard/SR traps | **High** |
| Performance | CDN, image pipeline | Heavy hero video/imagery, marketing scripts/tag managers inflate LCP/TBT | High |
| Mobile | Responsive | Mega-menu→mobile parity, tap targets on dense PLPs | Med |
| SEO | Strong domain, family pages | SPA/JS-rendered content can hurt crawl if not SSR'd | Med |
| Security | Standard PCI/checkout | Third-party script surface (analytics/ads) = XSS/supply-chain exposure | Med |

**Every issue → fix in the rebuild:** semantic landmarks + skip link, `aria-expanded`/Escape on menus,
contrast-checked dim text, reduced-motion, system-font-fast first paint with no blocking framework JS,
zero third-party scripts in the prototype, deep-linkable filters for crawlability.

---

## Phase 5 — Technical reverse-engineering (inferred · confidence: medium)

```
Browser ──► CDN / edge cache (Cloudflare/Fastly-class)
                 │
        ┌────────┴─────────┐
   Web frontend         Headless commerce API
   (React/Next-class,    (cart, catalog, checkout,
    component-driven)      pricing, inventory)
        │                       │
   Marketing CMS          Payments (PCI gateway) · Tax · Fraud
   (headless)             Search (hosted, e.g. Algolia-class)
                          Reviews (Bazaarvoice/Yotpo-class)
                          Auth/account · Analytics/CDP
```
Likely: SSR/SSG React for SEO, a headless/composable commerce backend, a hosted search provider, a
reviews SaaS, a tag-manager-driven analytics layer, and a CDN with an image-optimization service.

---

## Phase 6–7 — Business & competitive

- **Moats:** software ecosystem (switching cost), pro-team co-design (credibility), accessory
  consumables (recurring revenue), 25-year brand equity.
- **Funnels:** awareness (esports/social) → consideration (family pages/reviews) → conversion (PDP/cart)
  → retention (GG + registration + email) → advocacy (community/UGC).
- **vs. competitors (Razer, Logitech G, Corsair):** Razer wins on lifestyle/ecosystem breadth and unified
  account; Logitech on supply chain and bundles; Corsair on PC-building adjacency. SteelSeries' edge is
  audio (Arctis) + magnetic switches (OmniPoint). **Missed opportunities:** comparison/quiz tooling,
  bundle builder, trade-in, deeper account-tied software identity.

---

## Phase 8–12 — Rebuild strategy, architecture, blueprint, roadmap

**Rebuild thesis:** keep the dark/orange high-energy brand and family IA; *cut* friction (instant cart
drawer, deep-linkable filters), *add* discovery (compare + quiz + bundles), and *harden* the
foundation (a11y, perf, SEO) that a marketing-script-heavy site tends to erode.

**Recommended production architecture (beyond this static prototype):**

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + this token CSS / Tailwind | SSR/ISR for SEO + speed; design tokens already defined here |
| Commerce | Reuse the repo's **FastAPI** write-model + `/api/v1` catalog/orders | Already built (products, offers, orders, inventory reservation) |
| Search | Postgres `pg_trgm` (present) → hosted search at scale | Cheap now, scalable later |
| Auth | JWT (present) + customer accounts | Already in admin; extend to storefront customers |
| Payments | Stripe/local gateway behind the orders API | PCI-offloaded |
| Reviews | Owned table or SaaS | Social proof |
| Infra/CI | Docker Compose (present) → containers + CDN | Matches repo |

**Roadmap.** P1 Foundation: design system + IA + catalog/PDP (this prototype). P2 Core: real cart/checkout
on the orders API, accounts, reviews. P3 Advanced: compare, quiz, bundle builder, registration/warranty.
P4 Optimization: a11y/perf/SEO hardening, experimentation. P5 Launch: localization, payments, analytics.
P6 Scale: hosted search, recommendations, software-account identity.

---

## Phase 13 — Engineering posture

What's delivered in this branch is **Phase 1 (Foundation)**: a clean, dependency-free, accessible,
SEO-aware reference implementation of the brand and IA — deliberately framework-free so the design
language and component contracts are legible before being ported into the repo's React + FastAPI stack.
Assumptions are labelled; the live-site IA is reconstructed (the site blocks automated inspection), so
treat Phases 1/4/5 as informed hypotheses to validate against a real crawl before production.
