# 02 — Website Audit & Sitemap

> Tags: `[VERIFIED]` — confirmed via public sources · `[INFERRED]` —
> derived from platform/category convention · `[CONVENTION]` — standard
> Shopify-store anatomy.

## 1. Platform & stack signals

| Item | Finding | Source |
|---|---|---|
| **Platform** | **Shopify** | `[INFERRED]` — sister OKAMI domains live on Shopify; brand size/style matches Shopify SMB segment |
| **Theme** | Custom or paid streetwear-focused theme (e.g. Impulse / Be Yours / Symmetry family) | `[INFERRED]` |
| **CDN / images** | `cdn.shopify.com` | `[CONVENTION]` |
| **Checkout** | Shopify-hosted checkout (`checkout.shopify.com`) | `[CONVENTION]` |
| **Search** | Shopify default search (sometimes Searchanise / Boost) | `[INFERRED]` |
| **Front-end framework** | Liquid templates + jQuery + theme JS | `[CONVENTION]` |
| **Analytics** | Shopify Analytics + Meta Pixel + likely TikTok Pixel | `[INFERRED]` (consistent with drops + Instagram/TikTok promotion) |
| **Email** | Shopify Email and/or Klaviyo | `[INFERRED]` |
| **Geography** | Algeria primary; sells in DZD | `[VERIFIED]` brand title "from Algiers" |
| **Currency display** | DZD; possibly EUR/USD via Shopify Markets | `[INFERRED]` |

## 2. Verified brand surface

- Site title pattern: **OKAMI — Premium Streetwear from Algiers**
- Brand voice line surfaced publicly: *"just a guy who puts his
  passion on shirts"*.
- Product imagery includes anime-licensed-adjacent references (e.g.
  TOJI hoodie — *Jujutsu Kaisen* character) — `[VERIFIED]` via TikTok.
- Social: `@okami.streetwear` on Instagram (~13 K) and TikTok.
- No custom orders policy stated socially.

## 3. Sitemap — as-is (Shopify convention)

```
/
├── /collections                       — “All collections” index
│   ├── /collections/all               — every product
│   ├── /collections/hoodies           [INFERRED]
│   ├── /collections/t-shirts          [INFERRED]
│   ├── /collections/new-arrivals      [INFERRED]
│   ├── /collections/best-sellers      [INFERRED]
│   ├── /collections/drop-{slug}       — past drops [INFERRED]
│   └── /collections/sale              [INFERRED]
├── /products/{handle}                 — every product detail page
├── /pages/about                       — brand story        [CONVENTION]
├── /pages/contact                     — contact form       [CONVENTION]
├── /pages/lookbook                    [INFERRED — common in streetwear]
├── /pages/size-guide                  [CONVENTION]
├── /pages/shipping                    [CONVENTION]
├── /pages/returns                     [CONVENTION]
├── /pages/faq                         [CONVENTION]
├── /blogs/journal                     [CONVENTION — Shopify blog]
│   └── /blogs/journal/{post}          [CONVENTION]
├── /cart                              [CONVENTION]
├── /account                           [CONVENTION]
│   ├── /account/login
│   ├── /account/register
│   ├── /account/orders
│   └── /account/addresses
├── /search                            [CONVENTION]
├── /policies/privacy-policy           [CONVENTION]
├── /policies/terms-of-service         [CONVENTION]
├── /policies/refund-policy            [CONVENTION]
├── /policies/shipping-policy          [CONVENTION]
└── /sitemap.xml + /robots.txt         [CONVENTION]
```

Out-of-band but linked:

- Instagram, TikTok, possibly Facebook
- `mailto:` brand email in footer
- Phone / WhatsApp link (very common in Algerian e-commerce)

## 4. Product hierarchy — as-is

| Object | Identifier | Notes |
|---|---|---|
| Product | `/products/{handle}` | Shopify product |
| Variants | size × colour (mostly size; colour usually fixed per design) | `[INFERRED]` |
| Collections | manual + smart (tagged) | `[CONVENTION]` |
| Drops | modelled as a collection (Shopify has no first-class "drop") | `[INFERRED]` — major weakness, see §6 |

## 5. Conversion funnel — as-is

```
Instagram / TikTok post
        ↓
Homepage  (or direct PDP via bio link)
        ↓
Collection grid  →  Product detail
                          ↓
                     Add to cart
                          ↓
                     Cart drawer
                          ↓
              Shopify-hosted checkout
                          ↓
                  Order confirmation
                          ↓
            Email confirmation (Shopify Email)
                          ↓
            COD courier dispatch (manual)
```

**Funnel friction (typical of generic Shopify themes in this segment):**

- Homepage → PLP: hero carousel often slow on mobile; CTA labels weak
  ("Shop Now" not "Shop the X Drop").
- PLP → PDP: grid lacks colour swatches; user must click through to
  see if the design is available.
- PDP → Add: size-selector inconsistent with grid information; no
  inline stock signals ("only 2 left in M").
- Cart → Checkout: cart drawer often lacks shipping promise / total
  visibility / upsell.
- Checkout → Paid: COD is fine, but card payment in Algeria is rare;
  no clear "wilaya then commune" cascade is provided by the default
  Shopify address form.

## 6. Notable gaps vs the brand promise

| Gap | Why it hurts |
|---|---|
| No first-class **drops** model | The whole brand revolves around drops, but Shopify treats them as just another collection — no countdown, no notify, no "drop replay" page. |
| No **lookbook** beyond a product grid | Streetwear is bought on context; a flat catalog underplays the styling. |
| **Founder voice** invisible | A homepage selling "just a guy who puts his passion on shirts" should *show* that guy in 5 seconds. |
| **Size guide** typically a single static image | Returns are expensive in Algeria; specific cm measurements per garment reduce returns. |
| **Notify-on-restock** unlikely in the default theme | Sellouts are the drop's biggest signal but the email-capture is wasted. |
| **No bilingual UX** (EN / FR / AR) confirmed | The Algerian market is naturally FR-dominant with AR speakers; an EN-only premium positioning blocks a real customer segment. |
| **Search** is Shopify default | Streetwear shoppers search by drop, character, colourway — default search returns title-keyword matches only. |
| **COD friction** | The default Shopify address form does not know about wilaya/commune ordering. |

## 7. Accessibility quick-check (heuristic, not measured)

Common Shopify-streetwear-theme failures to expect:

- Low-contrast helper text under price (`#9CA3AF` on white < 4.5:1).
- Image carousels with no keyboard navigation or aria-live updates.
- Size selectors that are not real buttons (clickable spans).
- Modals (cart drawer, size guide) that do not trap focus.
- Hero videos with no captions, no reduced-motion fallback.

Each is fixable in the rebuild and is treated as a non-negotiable in
the component-library spec ([07-component-library.md](./07-component-library.md)).

## 8. SEO quick-check (heuristic)

Default Shopify gives you:

- Per-product `<title>`/`<meta description>` (often the product handle).
- Auto JSON-LD `Product` + `Offer` + `BreadcrumbList` on PDPs.
- Sitemap.xml + robots.txt.

It does **not** give you:

- Per-collection editorial content for ranking on "Algerian streetwear",
  "anime hoodie Algeria", etc.
- Story-driven blog content for top-of-funnel.
- `hreflang` for FR / AR variants.
- Structured FAQ schema where relevant.

These become Phase 1 deliverables in [05-rebuild-strategy.md](./05-rebuild-strategy.md).
