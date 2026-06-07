# 12 — Launch Checklist

Use as a pre-flight gate. Nothing ships until every box is checked.

## A. Functional

- [ ] `/` renders within budget on cold cache (mobile).
- [ ] All nav routes resolve; no 404 from the nav.
- [ ] Search returns results for top-10 anime queries; zero-result
      handling shows a useful empty state.
- [ ] PLP filters work (anime, character, size, colour, price);
      URL reflects state.
- [ ] PDP add-to-cart works; cart drawer opens.
- [ ] `PickupOrDeliveryPicker` works on cart and checkout.
- [ ] Cart persists across reload (cart-id cookie).
- [ ] Checkout completes for COD; order confirmation page renders.
- [ ] Checkout completes for in-store pickup; address group hidden.
- [ ] Card payment path completes (Stripe / CIB test).
- [ ] Order tracking `/commande/suivi` works on real data.
- [ ] Magic-link login works in FR and EN.
- [ ] Account dashboard shows orders + wishlist + addresses + saved
      Custom quotes.
- [ ] Wishlist syncs anon → account on first login.
- [ ] Newsletter signup writes to Klaviyo and confirms via email.
- [ ] Notify-me on drop and on restock writes a `NotifyEvent`.
- [ ] Drop state flips automatically at the scheduled time.
- [ ] Custom Builder happy path (pick → preview → quote → add → buy)
      completes end-to-end.
- [ ] `/custom/quote/{id}` shareable links work.
- [ ] Owner Print Queue groups by `baseKind × designId × colour × size`
      and supports state transitions.
- [ ] `/boutique` shows the Bab Ezzouar info + map + hours +
      `LocalBusiness` JSON-LD passes Google's Rich Results test.

## B. Performance

- [ ] Lighthouse Mobile: Performance ≥ 90 on `/`, `/shop`, PDP,
      `/custom`, `/drops`, `/boutique`.
- [ ] Lighthouse Desktop: Performance ≥ 95 on the same.
- [ ] LCP < 1.8 s on 4G (CrUX & lab).
- [ ] CLS < 0.05 on all routes.
- [ ] INP < 200 ms on all interactive routes.
- [ ] Initial JS ≤ 120 KB gz; per-route JS ≤ 80 KB gz.
- [ ] Hero image ≤ 100 KB (AVIF) at LCP size.
- [ ] No render-blocking third-party scripts above the fold.
- [ ] Custom Builder preview compositing runs at < 200 ms per change.

## C. Accessibility (WCAG 2.2 AA)

- [ ] axe-core: zero violations of impact ≥ `serious` on every
      Storybook story.
- [ ] Keyboard: all interactive elements reachable; visible focus.
- [ ] Skip-to-content link works on every page.
- [ ] All images have `alt`; decorative images use `alt=""`.
- [ ] Forms have labels + error messaging announced.
- [ ] Modals + drawers trap focus; close on `Esc`.
- [ ] Colour-contrast invariants hold for every token pair used
      (`--sumi/--washi`, `--torii/--washi`, `--white/--indigo`, …).
- [ ] `prefers-reduced-motion` honoured (no autoplay videos, no
      `koi-bob`).
- [ ] Custom Builder design picker is keyboard navigable; live
      total announced via `aria-live`.

## D. SEO

- [ ] Per-route `<title>` + meta description set; no defaults.
- [ ] Canonical URLs set, locale-prefixed where applicable.
- [ ] `hreflang` for every translated route.
- [ ] JSON-LD validated:
      `Organization`, `WebSite (SearchAction)`, `Product`, `Offer`,
      `AggregateRating`, `BreadcrumbList`, `Article`, `FAQPage`,
      **`LocalBusiness`** on `/boutique`,
      **`Service`** on `/custom`.
- [ ] `sitemap.xml` complete and referenced in `robots.txt`.
- [ ] OG/Twitter card images per page (1200×630, < 200 KB).
- [ ] Google Business Profile claimed and linked to `/boutique`.

## E. Internationalisation

- [ ] FR + EN parity on nav, footer, PLP, PDP, cart, checkout,
      account, Custom Builder.
- [ ] Currency formatting per locale (DZD always; EUR display
      optional).
- [ ] Date/time formatting per locale.
- [ ] AR plan (v1.1) — RTL stylesheet draft + translation seed.

## F. Trust + commerce

- [ ] Privacy policy + CGV + Refund + Shipping pages reviewed by
      stakeholder + visible from footer.
- [ ] Cookie banner with category gating.
- [ ] WhatsApp / phone / email contact visible in footer + on
      order-confirmation + on `/boutique`.
- [ ] Return process documented; return label flow tested.
- [ ] Shipping ETAs per wilaya documented (target: 48 h after print).
- [ ] COD assurance copy visible on PDP + cart + checkout.
- [ ] Pickup-in-boutique copy visible everywhere shipping is
      mentioned.

## G. Security

- [ ] HTTPS enforced; HSTS preload enabled.
- [ ] CSP enabled with nonce/hash; report-uri set.
- [ ] Rate limits on auth, magic-link, tracking, reviews,
      subscribe, custom-quote.
- [ ] Secrets in Vercel env; no `.env*` committed.
- [ ] HMAC verified on every Glstore webhook
      (`/api/webhooks/glstore`).
- [ ] Audit log writes for admin actions.
- [ ] Sentry sourcemaps uploaded; PII filters configured.
- [ ] Custom-design uploads: size + type validation, virus scan,
      human moderation gate before printable.

## H. Observability

- [ ] Sentry capturing 100 % of `error` and `unhandled` rejections.
- [ ] PostHog funnel: view_product → add_to_cart → checkout →
      purchase.
- [ ] PostHog funnel: custom_start → custom_design_picked →
      custom_added → purchase.
- [ ] Lighthouse-CI baseline saved.
- [ ] Print-queue Grafana dashboard wired (open orders, p95
      turnaround, queue depth).
- [ ] On-call rota set; PagerDuty / OpsGenie configured.

## I. Operational

- [ ] Runbooks: drop-day, checkout failure, oversell, custom-print
      saturation, deliverability.
- [ ] Backup/restore drill executed on Postgres.
- [ ] Sanity dataset export scheduled weekly.
- [ ] Customer-support inbox + macros prepared (in FR; EN templates
      for v1).
- [ ] Fulfilment partner(s) — courier + the in-store handover —
      onboarded.
- [ ] Owner trained on: Print Queue admin, Sanity Studio, Klaviyo
      drop sends.

## J. Legal + commercial

- [ ] **Owner-flagged confirmations resolved** (from
      [00-source-data.md](./00-source-data.md)):
  - [ ] Full email address (`ccwdz.contact@…`?)
  - [ ] Ready-made (non-custom) selling prices
  - [ ] Delivery cost (the "69 W" — confirm 690 DA)
- [ ] Business address + RC / tax ID surfaced where required.
- [ ] Anime-design licensing posture documented; take-down process
      in place.
- [ ] Cookie + GDPR posture verified for EU diaspora visits.
- [ ] DSAR endpoint or process documented.
- [ ] Image licensing checked for every editorial photograph.

## K. Day-0 communications

- [ ] Founder post drafted (Instagram, TikTok) announcing the site.
- [ ] Email blast drafted + scheduled.
- [ ] Phone-line script: "we now have a website — same shop, same
      service."
- [ ] In-store: a QR code on the counter linking to `/custom`.
- [ ] First drop is loaded, photographed, and indexed in Algolia.

When all of A–K are ticked, ship it.
