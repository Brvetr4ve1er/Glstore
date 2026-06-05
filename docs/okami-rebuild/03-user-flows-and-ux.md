# 03 — User Flows & UX Critique

## A. The four flows that decide the business

These are the only flows that move revenue. Every other page exists to
keep them honest.

### A.1 Discovery flow — social → buy

```
Instagram post / TikTok drop teaser
        │  bio link → Linktree / direct
        ▼
HOMEPAGE  ─── hero (current drop) ───────────────────┐
        │                                            │
        ▼                                            ▼
COLLECTION (drop)  ←──── nav: "Shop the drop"    DROP STORY page
        │                                            │
        ▼                                            │
PRODUCT DETAIL  ◄────────────────────────────────────┘
        │
   pick size · variants
        ▼
ADD TO CART  →  CART DRAWER
        │
        ▼
CHECKOUT (one-page, COD-first)
        ▼
ORDER CONFIRMATION  +  SMS/Email confirm + "track by phone+order#"
```

**KPI:** time-to-first-add-to-cart on mobile < 25 s from first paint.

### A.2 Search flow

```
SEARCH input  →  autosuggest (products, collections, drops)
        ▼
SEARCH RESULTS  (mixed: products + drops + journal)
        ▼
PRODUCT DETAIL
        ▼
ADD TO CART  → CHECKOUT
```

**KPI:** non-zero search-result rate ≥ 95 %; 0-result queries logged
and answered weekly.

### A.3 Returning-customer flow

```
LOGIN  /  magic-link (no password)
        ▼
ACCOUNT HOME — last order, wishlist preview, drop calendar
        │
        ├─ Orders  → track an order
        ├─ Wishlist → quick-add to cart
        └─ Addresses → reuse for checkout
```

**KPI:** ≥ 40 % of buyers create an account inside 30 days. Magic-link
adoption ≥ 70 % (no password = no support tickets).

### A.4 Drop flow

A first-class flow the original site does not have:

```
PRE-DROP  — landing page with countdown, notify-me email/SMS capture
        ▼  (T-0 hits)
LIVE     — page flips to PLP variant: products buyable
        │           inventory live; "only 2 M left" badges live
        ▼
SELLOUT  — page becomes archive: "missed it?" sign up for restock
                              + show next drop teaser
```

The drop page never breaks; it changes mode.

## B. Mobile flow notes

The Algerian customer is overwhelmingly on mobile (Android). The mobile
flow is the primary flow.

- Hero must be hero-image, not hero-video, by default; video as
  enhancement with `IntersectionObserver`-controlled play.
- Sticky **Add to bag** on PDP below the fold (one-tap to cart).
- Sticky **Continue** on cart and checkout.
- One-page checkout; never a 3-step wizard on mobile.
- Wilaya/commune as native cascading selects with autofill from last
  order; never a free-text city field.
- WhatsApp deep link in footer + every order-confirmation email.

## C. UX critique — the friction we are removing

Each item: **Problem · Impact · Fix · Expected benefit.**

### C.1 Homepage hero does not tell you what to do

- **Problem:** Generic "Shop Now" CTA over a styled-model image. The
  drop the brand is talking about on Instagram is not visible on the
  homepage in the first 600 ms.
- **Impact:** social → site → leave. The customer arrived for *the
  drop* and the homepage does not match.
- **Fix:** Hero is the *current drop*. Headline = drop name. CTA =
  "Shop the X drop" / "Get notified" depending on drop state.
- **Benefit:** +30–50 % click-through from hero to PLP (we have
  industry-typical numbers in the 4–8 % → 6–12 % range when CTAs are
  drop-named instead of generic).

### C.2 Collection grid lacks colourway / variant signal

- **Problem:** The user must click through to see if a design is in
  red, white, or black.
- **Impact:** Wasted clicks, lower depth, higher bounce.
- **Fix:** Card shows colour swatches; hover/tap-and-hold cycles
  through variant imagery; "+2 more" indicator for sized variants.
- **Benefit:** Reduces back-and-forth between PLP and PDP; raises
  add-to-cart per session.

### C.3 No fast-add on the grid

- **Problem:** Customer who knows their size has to enter the PDP to
  buy.
- **Impact:** Funnel narrowing at PDP for low-information buyers.
- **Fix:** "Quick add" pill on PLP — opens a small bottom-sheet with
  size buttons; one tap puts it in the bag.
- **Benefit:** Add-to-cart rate +15–25 %.

### C.4 PDP gallery is the only image surface

- **Problem:** No styled / lookbook context. The hoodie looks like
  any other hoodie when you do not see it worn.
- **Impact:** Lower perceived value, weaker brand differentiation.
- **Fix:** PDP gallery includes (in order) flat-lay, on-model,
  detail crop, on-model 2, video clip. Editorial blocks below the
  fold link to the matching lookbook chapter.
- **Benefit:** Higher PDP dwell, lower returns (size visible on body).

### C.5 Size selection is a row of guessed-width buttons

- **Problem:** No measurements at the moment of choice. Returns are
  expensive in Algeria where the carrier model is local.
- **Impact:** Returns + refunds (cash flow drain).
- **Fix:** Inline "your size?" widget — pick height + weight, get a
  recommendation against the actual garment chest/length cm. Plus a
  "size guide" modal with the cm table for every variant.
- **Benefit:** Returns -20–40 %.

### C.6 Cart drawer is a list, not a decision

- **Problem:** Just a list of line items and a "Checkout" button.
- **Impact:** No urgency, no upsell, no shipping clarity.
- **Fix:** Cart drawer includes:
  - free-shipping progress bar ("Add 1,200 DZD for free shipping"),
  - low-stock badge per line ("only 1 left in M"),
  - one cross-sell ("People who picked this also got…"),
  - secure-COD badge and arrival estimate.
- **Benefit:** Average order value +8–12 %, cart-abandon -10 %.

### C.7 Checkout is generic Shopify

- **Problem:** Shopify hosted checkout works but is one-size-fits-all.
  Wilaya then commune is not a cascading select; COD is one of many
  payment buttons; no Arabic.
- **Impact:** Real, ongoing checkout abandonment.
- **Fix:** Headless checkout for Algeria (Shopify Plus enables
  customisation; if not on Plus, build a thin checkout that posts to
  Shopify Cart API for non-card and uses Stripe for card).
  - Wilaya → commune cascading select.
  - COD as the **default**, card as the secondary option.
  - Live shipping cost + ETA.
  - Bilingual (FR primary, AR toggle).
- **Benefit:** Checkout completion +10–20 pp.

### C.8 No "track my order" without an account

- **Problem:** Customers in Algeria expect WhatsApp-style "where is my
  order?" capability without making an account.
- **Impact:** Inbound support load.
- **Fix:** Public `/order/track` with `(order_number, phone)`.
  (The same pattern already shipped in Ghir Laffaire.)
- **Benefit:** -50 % support tickets on "where is my order".

### C.9 Newsletter signup is below the fold + asks for nothing

- **Problem:** "Sign up for our newsletter" is too cold for the
  audience.
- **Impact:** ~0.5 % signup vs achievable 2–4 %.
- **Fix:** "Notify me when the next drop is live" + "Get the size
  guide PDF" — value-led signups, tagged by intent in the email
  platform. Exit-intent modal on the homepage at most once per 30 d.
- **Benefit:** 4–8× email-capture rate.

### C.10 No trust signals on price/payment

- **Problem:** Customers in Algeria are cautious — many e-commerce
  experiences are bad. There is no visible reassurance.
- **Impact:** Cart-abandon on first-time buyers.
- **Fix:** A trust strip on PDP and cart:
  - "Paiement à la livraison · Livraison 48 h · 14 jours de retours."
  - Order tracking link.
  - Real customer reviews (with photos) on PDP.
- **Benefit:** First-time conversion +15–25 %.

### C.11 Accessibility

- **Problems:** common Shopify-theme defaults — low-contrast prices,
  no focus rings, modal focus traps absent, hero videos auto-playing.
- **Impact:** unusable for some customers; SEO hit (Core Web Vitals);
  legal exposure as EU diaspora grows.
- **Fix:** WCAG 2.2 AA baseline, captured in the design tokens and
  component contracts.

### C.12 Performance

- **Problems:** typical of streetwear themes — bloated hero videos,
  third-party trackers loaded eagerly, fonts shipping 4 weights, no
  responsive `srcset` discipline.
- **Impact:** LCP > 3 s on mobile, abandon on the first paint.
- **Fix:** image budget (≤ 100 KB hero), font-variable display swap,
  client-script budget, third-party defer-by-default.

## D. Information architecture — to-be

```
ROOT
├─ Shop
│   ├─ All
│   ├─ Hoodies
│   ├─ T-shirts
│   ├─ Outerwear (when range expands)
│   └─ Accessories (when range expands)
├─ Drops          ← first-class
│   ├─ Current
│   ├─ Upcoming   (notify-me)
│   └─ Archive    (sold-out look-back)
├─ Lookbook
├─ Journal        (story, build notes, founder posts)
├─ About
└─ Help
    ├─ Size guide
    ├─ Shipping
    ├─ Returns
    ├─ FAQ
    └─ Contact
```

Account, search, wishlist, bag, and language switch live in the
top-right utility cluster.

## E. Anti-patterns we will not adopt

- Auto-playing audio.
- "Enter your email to see the homepage" gates.
- Discount-wheel pop-ups.
- Floating chat bubbles that block CTAs on mobile.
- Hover-only navigation on touch devices.
- "Add to cart" buttons that don't say what they cost.
