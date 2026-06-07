# 01 — Executive Summary

## The brand we are building

SHINOBI Shop is an Algiers-based anime / otaku streetwear boutique
with a physical shop at Centre Commercial Bab Ezzouar and a
custom-print service that lets customers turn a tee, hoodie, mug or
tote into a one-off piece. The brand voice is direct, French-first,
warrior-themed (*"La Boutique du Guerrier"*), and squarely aimed at
the manga / anime audience in Algeria. **Today the storefront is
Instagram + phone + walk-in.** There is no e-commerce website.

## What the build must do

This is a *0 → 1* commerce launch, not a re-skin. It has three jobs.

1. **Move ordering from DMs to web.** Reduce inbound DM load while
   adding a 24/7 silent salesman. The DM line stays — for trust and
   for the in-store community — but the website becomes the default
   path for known products.
2. **Productise the custom-print service.** A visual *Custom Builder*
   (product × design × side(s)) that quotes the price in real time
   from the owner's published table (T-shirt 2 200 DA, sweat
   3 300 DA, pull 2 800 DA, mug / tote 1 000 DA, +500 DA for recto/verso).
3. **Respect the dual model — online + in-store.** Pickup at Bab
   Ezzouar is a first-class fulfilment option, not a hidden
   afterthought.

## Why build on the existing Glstore backend

The FastAPI commerce backend that lives in this repo already solves
the things that take months to build from scratch:

- 58-wilaya / commune Algerian address model.
- COD payment + order status state machine.
- Order tracking by phone + order number (no account required).
- Multi-tier scraper for product-data enrichment.
- URL importer for adding products from a link.
- Admin console, role-based auth, audit log.

Building SHINOBI on this backend lets us ship the storefront in
weeks rather than quarters. It also keeps SHINOBI under the same
ops umbrella as the parent business, so a single team can run both.

## Headline targets (one quarter, post-launch)

| Metric | Today (DM-only baseline) | Target |
|---|---|---|
| Lighthouse Performance (mobile) | n/a | ≥ 90 |
| LCP (4G) | n/a | < 1.8 s |
| Time from product view → cart (mobile) | n/a | < 30 s |
| Share of orders via web (vs DM / phone / walk-in) | 0 % | 40 %+ |
| Custom-builder completion rate (start → cart) | n/a | 35 %+ |
| In-store pickup share | n/a | 25 % of online orders |
| Newsletter capture rate | n/a | 2 %+ |
| Repeat-customer rate (90 day) | unknown | 30 %+ |

## Phased plan in one breath

- **Phase 0 (Week 1):** repo scaffold, design tokens, env, CI.
- **Phase 1 (Weeks 2–4):** core commerce on the Glstore backend —
  PLP, PDP, cart, COD checkout, in-store pickup, order tracking.
- **Phase 2 (Weeks 5–6):** Custom Builder, in-store-printing
  workflow, owner-facing print job board.
- **Phase 3 (Weeks 7–8):** Account, wishlist, recently-viewed,
  reviews with photo upload, journal.
- **Phase 4 (Weeks 9–10):** Loyalty, referral codes, Instagram-driven
  campaigns (UTM-tracked drops).
- **Phase 5 (Week 11):** Hardening — performance, a11y, SEO, security.
- **Phase 6 (Week 12):** Soft launch on Instagram, instrument, iterate.

Detail in [11-roadmap.md](./11-roadmap.md).

## What to read next

- The opinionated diagnosis of today's funnel:
  [03-user-flows-and-ux.md](./03-user-flows-and-ux.md).
- The systems and the leverage from the existing backend:
  [05-rebuild-strategy.md](./05-rebuild-strategy.md) +
  [08-technical-architecture.md](./08-technical-architecture.md).
- The Custom Builder spec — the brand's actual moat:
  [07-component-library.md §6](./07-component-library.md#6-custom-builder-the-brands-moat).
