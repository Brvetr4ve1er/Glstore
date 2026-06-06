# 02 — Website Audit & Sitemap

> **Updated** against the verified extraction in
> [00-extracted-design-system.md](./00-extracted-design-system.md).
> The earlier Shopify inference was wrong — the live stack is a custom
> React SPA on TailwindCSS v4 with a custom headless commerce backend.
> Tag legend: `[VERIFIED]`, `[INFERRED]`, `[CONVENTION]`.

## 1. Platform & stack signals

| Item | Finding | Source |
|---|---|---|
| **Platform** | **Custom React SPA** mounted on `#root` | `[VERIFIED]` |
| **Styling** | **TailwindCSS v4** with custom extensions | `[VERIFIED]` |
| **Routing** | Client-side SPA (`/shop`, `/about`, `/contact`, `/cart`) | `[VERIFIED]` |
| **Commerce** | Custom headless API; not Shopify, not WooCommerce | `[VERIFIED]` |
| **Currency** | Switcher `US` / `DA` (Algerian Dinar) | `[VERIFIED]` |
| **Fonts** | 3 self-hosted: `OKAMI.otf`, `streetwear.ttf`, `inter.ttf` | `[VERIFIED]` |
| **Hero image pipeline** | `<picture>` + `object-cover`, lazy-loaded | `[VERIFIED]` |
| **Animations** | Pure CSS keyframes + Tailwind animation utilities | `[VERIFIED]` |
| **Hosting / CDN** | Not extracted | `[INFERRED]` — assume static host + CDN |
| **Analytics** | Not extracted | `[INFERRED]` — likely Meta Pixel + TikTok Pixel based on social channel use |
| **Email** | Not extracted | `[INFERRED]` |
| **Search** | Custom, presumed simple (the SPA does not show third-party search markup) | `[INFERRED]` |
| **Geography** | Algeria primary; `DA` currency live | `[VERIFIED]` brand title "from Algiers" + currency switch |

## 2. Verified brand surface

- Site title pattern: **OKAMI — Premium Streetwear from Algiers**
- Brand voice line surfaced publicly: *"just a guy who puts his
  passion on shirts"*.
- Product imagery includes anime-licensed-adjacent references (e.g.
  TOJI hoodie — *Jujutsu Kaisen* character) — `[VERIFIED]` via TikTok.
- Social: `@okami.streetwear` on Instagram (~13 K) and TikTok.
- No custom orders policy stated socially.

## 3. Sitemap — as-is (verified SPA routes)

```
/                              [VERIFIED] home
├── /shop                      [VERIFIED] shop / catalog
├── /about                     [VERIFIED] about us
├── /contact                   [VERIFIED] contact
└── /cart                      [VERIFIED] cart
```

These four routes plus the home make up the verified surface of the
SPA. Everything below is either a *missing* route the rebuild should
add or a convention not surfaced in the extraction:

```
/product/{slug}                [INFERRED — required for a PDP]
/shop?category=…&size=…        [INFERRED — query-string filters]
/wishlist                      [MISSING — to add]
/account                       [MISSING — to add]
/order/track                   [MISSING — to add]
/drops                         [MISSING — to add (first-class drops)]
/drops/{slug}                  [MISSING — to add]
/lookbook                      [MISSING — to add]
/journal                       [MISSING — to add]
/help/size-guide               [MISSING — to add]
/help/shipping                 [MISSING — to add]
/help/returns                  [MISSING — to add]
/help/faq                      [MISSING — to add]
/legal/privacy                 [MISSING — to add]
/legal/terms                   [MISSING — to add]
/legal/refunds                 [MISSING — to add]
```

Out-of-band but linked:

- Instagram, TikTok
- `mailto:` brand email in footer
- Phone / WhatsApp link (very common in Algerian e-commerce; presence
  not confirmed in extraction)

## 4. Product hierarchy — as-is

| Object | Identifier | Notes |
|---|---|---|
| Product | Custom API resource | `[VERIFIED]` — custom headless commerce |
| Variants | size × colour (mostly size; colour usually fixed per design) | `[INFERRED]` |
| Collections | tagged groupings | `[INFERRED]` |
| Drops | likely a collection or tag in the current backend; no first-class state machine surfaced | `[INFERRED]` — major weakness, see §6 |

## 5. Conversion funnel — as-is

```
Instagram / TikTok post
        ↓
Homepage  (or direct PDP via bio link)
        ↓
/shop grid  →  Product detail
                    ↓
                Add to cart
                    ↓
                Cart drawer / /cart
                    ↓
              Custom checkout
                    ↓
            Order confirmation
                    ↓
            Email confirmation
                    ↓
            COD courier dispatch (manual)
```

**Funnel friction (typical of a client-rendered SPA in this segment):**

- Homepage → PLP: hero is client-rendered → blank flash before LCP;
  CTA labels weak ("Shop Now" not "Shop the X Drop").
- PLP → PDP: grid lacks colour swatches; user must click through to
  see if the design is available.
- PDP → Add: size-selector inconsistent with grid information; no
  inline stock signals ("only 2 left in M").
- Cart → Checkout: cart drawer often lacks shipping promise / total
  visibility / upsell.
- Checkout → Paid: COD is the dominant payment path in DZ but the
  current address form is unlikely to cascade wilaya → commune; card
  payment in Algeria is rare, so it cannot be the default.

## 6. Notable gaps vs the brand promise

| Gap | Why it hurts |
|---|---|
| No first-class **drops** model | The whole brand revolves around drops; the current backend has no scheduled state machine, no countdown, no notify, no "drop replay" page. |
| No **SSR / SEO surface** | The SPA renders client-side; Google sees a thin shell. Organic traffic ceiling is low. |
| No **lookbook** beyond a product grid | Streetwear is bought on context; a flat catalog underplays the styling. |
| **Founder voice** invisible | A homepage selling "just a guy who puts his passion on shirts" should *show* that guy in 5 seconds. |
| **Size guide** typically a single static image | Returns are expensive in Algeria; specific cm measurements per garment reduce returns. |
| **Notify-on-restock** missing | Sellouts are the drop's biggest signal; the email capture is wasted. |
| **No bilingual UX** (EN / FR / AR) confirmed | The Algerian market is naturally FR-dominant with AR speakers; an EN-only premium positioning blocks a real customer segment. |
| **Search** is presumed basic | Streetwear shoppers search by drop, character, colourway — title-keyword matching is not enough. |
| **COD friction** | The current address form is unlikely to cascade wilaya → commune for the 58-wilaya Algerian model. |
| **Service worker actively unregistered** | The site currently kills SW on load (verified). With SSR this changes — PWA install + offline-cache becomes viable. |

## 7. Accessibility quick-check (heuristic, not measured)

Common React-SPA-streetwear-theme failures to expect:

- Low-contrast helper text under price (`#9CA3AF` on white < 4.5:1).
- Image carousels with no keyboard navigation or aria-live updates.
- Size selectors that are not real buttons (clickable spans).
- Modals (cart drawer, size guide) that do not trap focus.
- Hero videos with no captions, no reduced-motion fallback.

Each is fixable in the rebuild and is treated as a non-negotiable in
the component-library spec ([07-component-library.md](./07-component-library.md)).

## 8. SEO quick-check (heuristic)

A client-rendered React SPA typically gives you:

- A near-empty initial HTML payload (just the `#root` shell).
- A single `<title>` set in `<head>`; per-route titles only after JS
  hydrates.
- No server-rendered JSON-LD; structured data is added by JS after
  load — Google may or may not crawl it.
- A `sitemap.xml` only if explicitly hand-maintained.

It does **not** give you:

- Per-collection editorial content for ranking on "Algerian streetwear",
  "anime hoodie Algeria", etc.
- Story-driven blog content for top-of-funnel.
- `hreflang` for FR / AR variants.
- Structured FAQ / Article / Product schema rendered server-side.

These become Phase 1 deliverables in
[05-rebuild-strategy.md](./05-rebuild-strategy.md) — they fall out of
the move to Next.js SSR.
