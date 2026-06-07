# 02 — Current-State Audit & Future Sitemap

> Today's storefront is non-web. The "audit" here is therefore an
> audit of the **commerce surface as it stands** — Instagram + phone
> + shop — and the gaps that the new website fills.

## A. Today's commerce surface

| Surface | Role today | Strength | Weakness |
|---|---|---|---|
| **Instagram @shinobishopdz** | Catalogue + DM order intake + community | High trust; rapid posting cadence; real reach with target audience | DMs do not scale; not searchable by SKU; price discovery is friction-heavy; no checkout |
| **Phone (023 925 014)** | Hand-held orders for cautious buyers | Personal trust; immediate quote | Owner time; no record beyond memory; opening-hours bound |
| **Bab Ezzouar shop** | In-person browsing, custom printing while you wait, accessories (katana / figurines) | The brand's "show, don't tell"; demos build word-of-mouth | Only one location; finite hours |
| **No website** | n/a | n/a | No 24 / 7 surface; no SEO; no programmatic retargeting; no analytics; no review system; no email list |

Everything below the line costs the business **every day**:

- **0 % SEO presence** — buyers searching "Gojo t-shirt Algerie",
  "boutique anime Alger", or "tee Naruto livraison wilaya" do not
  find SHINOBI.
- **No price discovery** — buyers DM "combien ?", owner answers,
  buyer drops off in ~30 % of cases. Web fixes this.
- **No remarketing** — once a DM goes cold there is no list to email,
  no pixel to retarget.
- **No data** — the owner has no way to see "of all the tees we
  posted last month, which ones sold?".
- **No social proof at the moment of purchase** — reviews live on
  IG comments, not at the buy-button.

## B. Future sitemap

```
/                                       Home
├─ /shop                                All products + filters
│   ├─ /shop/t-shirts
│   ├─ /shop/hoodies                    (sweats + pulls)
│   ├─ /shop/caps
│   ├─ /shop/mugs
│   ├─ /shop/tote-bags
│   └─ /shop/accessoires                (katana, figurines, keychains — in-store pickup only)
├─ /shop/{slug}                         Product detail (PDP)
├─ /custom                              Custom-print builder (the moat)
│   └─ /custom/quote/{id}               Saved quote — sharable link
├─ /search
├─ /panier                              Cart
├─ /checkout                            Single-page checkout
│   └─ /commande/{number}               Order confirmation
├─ /commande/suivi                      Track an order (phone + number)
├─ /compte                              Account home
│   ├─ /compte/commandes
│   ├─ /compte/favoris                  Wishlist
│   └─ /compte/adresses
├─ /journal                             Drops, lookbook, founder posts
│   └─ /journal/{slug}
├─ /boutique                            The Bab Ezzouar shop (address, hours, map, "passer en boutique")
├─ /a-propos                            About / brand story
├─ /aide
│   ├─ /aide/livraison
│   ├─ /aide/retours
│   ├─ /aide/personnalisation           How custom-print works
│   ├─ /aide/tailles                    Size guide
│   ├─ /aide/faq
│   └─ /aide/contact
└─ /mentions
    ├─ /mentions/cgv
    ├─ /mentions/confidentialite
    └─ /mentions/cookies
```

Out-of-band but linked:

- Instagram (`@shinobishopdz`)
- TikTok (if/when active)
- Phone (`023 925 014`) and email
- Google Maps deep-link to the boutique
- WhatsApp deep-link to a number tied to the owner

## C. Product hierarchy — future

| Object | Identifier | Notes |
|---|---|---|
| **Product** (ready-made) | `products.slug` | An anime-design tee / hoodie / cap / etc. |
| **Variant** | `offers.variant_sku` | size × colour |
| **Custom design** | `custom_designs.id` | An anime artwork the customer can pick (Gojo, Sukuna, Goku, …) |
| **Custom configuration** | `custom_orders.id` | (product blank × design × side(s) × size). Always priced from the owner's table; never inherits a SKU price. |
| **Collection** | `collections.slug` | "Jujutsu Kaisen", "Dragon Ball", "Originals" |
| **Drop / campaign** | `drops.slug` | Time-bound release; reuses the same Drop machinery defined in the OKAMI rebuild |
| **Accessories (in-store only)** | flagged with `fulfilment: pickup_only` | Katana, figurines |

## D. Order channels — today vs tomorrow

```
TODAY (DM-dominant)

Instagram post  →  DM "Hi, this Gojo tee in M?"
                ↓
        Owner replies with price + availability
                ↓
        Buyer sends address + name + phone
                ↓
        Owner enters order in a notebook / WhatsApp
                ↓
        Courier dispatch (manual)
                ↓
        SMS / DM with delivery ETA
                ↓
        COD on delivery


TOMORROW (web-dominant, DM fallback)

Instagram post  →  link to PDP in bio + per-post link in tools
                ↓
PDP            →  Add to cart (size pre-selected from Story sticker)
                ↓
Cart drawer    →  Free-shipping bar, low-stock signal, "passer en boutique"
                ↓
Checkout       →  Wilaya → commune cascade · COD default · phone required
                ↓
Confirmation   →  Order number + SMS + WhatsApp deep-link
                ↓
Admin queue    →  Auto-routed to print queue (if custom) or pick-pack (if stock)
                ↓
Delivery / pickup
                ↓
Review request (3 days post-delivery)
```

The DM remains live as a *trust fallback* — every PDP carries a
"je préfère discuter en DM" link.

## E. Accessibility quick-check

There is no current site to audit. The new site is held to the same
non-negotiables defined for OKAMI: WCAG 2.2 AA, keyboard reachable,
focus visible, `prefers-reduced-motion` honoured, colour-contrast
invariants enforced in CI for every token pair used.

## F. SEO quick-check — opportunity, not gap

The brand is currently invisible to Google. The new site captures:

- **"t-shirt {anime} Algérie"** — long-tail intent.
- **"boutique anime Alger"** / **"boutique manga Bab Ezzouar"** —
  local intent. A `LocalBusiness` JSON-LD points at the Bab Ezzouar
  store with hours.
- **"t-shirt personnalisé Algérie"** — high-intent for the custom
  builder.
- **`hreflang`** for FR (default) and EN, with AR + RTL in v1.1.

Tracked in the SEO architecture in
[05-rebuild-strategy.md §I](./05-rebuild-strategy.md#i-seo-architecture-highlights).
