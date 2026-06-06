# 12 — Launch Checklist

Use as a pre-flight gate. Nothing ships until every box is checked.

## A. Functional

- [ ] Home renders within budget on cold cache (mobile).
- [ ] All nav routes resolve; no 404 from the nav.
- [ ] Search returns results for top-10 queries; zero-result handling
      shows a useful empty state.
- [ ] PLP filters work (size, colour, drop, price); URL reflects state.
- [ ] PDP add-to-cart works; cart drawer opens.
- [ ] Cart persists across reload (cart-id cookie).
- [ ] Checkout completes for COD; order confirmation page renders.
- [ ] Card-payment path completes (Stripe / CIB test).
- [ ] Order tracking `/order/track` works on real data.
- [ ] Magic-link login works in EN and FR.
- [ ] Account dashboard shows orders + wishlist + addresses.
- [ ] Wishlist syncs anon → account on first login.
- [ ] Newsletter signup writes to Klaviyo and confirms via email.
- [ ] Notify-me on drop and on restock writes a `NotifyEvent`.
- [ ] Drop state flips automatically at the scheduled time
      (`upcoming → live → sold_out → archived`).

## B. Performance

- [ ] Lighthouse Mobile: Performance ≥ 90 on Home, PLP, PDP, Cart, Drop.
- [ ] Lighthouse Desktop: Performance ≥ 95 on the same.
- [ ] LCP < 1.8 s on 4G (CrUX & lab).
- [ ] CLS < 0.05 on all routes.
- [ ] INP < 200 ms on all interactive routes.
- [ ] Initial JS ≤ 120 KB gz; per-route JS ≤ 80 KB gz.
- [ ] Hero image ≤ 100 KB (AVIF) at LCP size.
- [ ] No render-blocking third-party scripts above the fold.

## C. Accessibility (WCAG 2.2 AA)

- [ ] axe-core: zero violations of impact ≥ `serious` on every story.
- [ ] Keyboard: all interactive elements reachable; visible focus.
- [ ] Skip-to-content link works on every page.
- [ ] All images have `alt`; decorative images use `alt=""`.
- [ ] Forms have labels + error messaging announced.
- [ ] Modals + drawers trap focus; close on `Esc`.
- [ ] Color contrast invariants hold for every token pair used.
- [ ] `prefers-reduced-motion` honored (no autoplay videos).
- [ ] RTL (AR, v1.1) — keyboard order matches visual order.

## D. SEO

- [ ] Per-route `<title>` + meta description set; no defaults.
- [ ] Canonical URLs set, locale-prefixed.
- [ ] `hreflang` for every translated route.
- [ ] JSON-LD validated:
      `Organization`, `WebSite (SearchAction)`, `Product`, `Offer`,
      `AggregateRating`, `BreadcrumbList`, `Article`, `FAQPage`.
- [ ] `sitemap.xml` complete and referenced in `robots.txt`.
- [ ] OG/Twitter card images per page (1200×630, < 200 KB).
- [ ] 301 redirects from legacy URLs in place.

## E. Internationalisation

- [ ] EN + FR parity on nav, footer, PLP, PDP, cart, checkout, account.
- [ ] Currency formatting per locale.
- [ ] Date/time formatting per locale.
- [ ] AR plan (v1.1) — RTL stylesheet draft + translation seed.

## F. Trust + commerce

- [ ] Privacy policy + Terms + Refund + Shipping pages reviewed by
      stakeholder + visible from footer.
- [ ] Cookie banner with category gating.
- [ ] WhatsApp / phone / email contact visible in footer + on
      order-confirmation.
- [ ] Return process documented; return label flow tested.
- [ ] Shipping ETAs per wilaya documented.
- [ ] COD assurance copy visible on PDP + cart + checkout.

## G. Security

- [ ] HTTPS enforced; HSTS preload enabled.
- [ ] CSP enabled with nonce/hash; report-uri set.
- [ ] Rate limits on auth, magic-link, tracking, reviews, subscribe.
- [ ] Secrets in Vercel env; no `.env*` committed.
- [ ] HMAC verified on every commerce-backend webhook (`/api/webhooks/commerce`).
- [ ] Audit log writes for admin actions.
- [ ] Sentry sourcemaps uploaded; PII filters configured.

## H. Observability

- [ ] Sentry capturing 100 % of `error` and `unhandled` rejections.
- [ ] PostHog funnel: view_product → add_to_cart → checkout → purchase.
- [ ] Lighthouse-CI baseline saved.
- [ ] Drop-day Grafana dashboard wired (TTFB p95, error rate, add rate,
      sellout times).
- [ ] On-call rota set; PagerDuty / OpsGenie configured.

## I. Operational

- [ ] Runbooks: drop-day, checkout failure, oversell, deliverability.
- [ ] Backup/restore drill executed on Postgres.
- [ ] Sanity dataset export scheduled weekly.
- [ ] Customer-support inbox + macros prepared.
- [ ] Fulfilment partner (Yalidine / Maystro etc.) onboarded.

## J. Legal + commercial

- [ ] Business address + RC / tax ID surfaced where required.
- [ ] Cookie + GDPR posture verified for EU diaspora visits.
- [ ] DSAR endpoint or process documented.
- [ ] Image licensing checked for every editorial photograph.
- [ ] Music licensing checked for any drop teaser videos.

## K. Day-0 communications

- [ ] Founder post drafted (Instagram, TikTok).
- [ ] Email blast drafted + scheduled.
- [ ] Press / partner emails ready.
- [ ] First drop is loaded, photographed, and indexed in Algolia.

When all of A–K are ticked, ship it.
