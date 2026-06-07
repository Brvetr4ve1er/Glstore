# 07 — Component Library

> Every component lists: purpose · props (TS-ish) · variants · states
> · a11y · responsive. Built on shadcn/ui primitives where possible.
> Lives in `src/components/`; each has a Storybook story and an
> axe-core test. The **Custom Builder** is the brand's moat —
> documented in §6 in full.

## 1. Foundations

### 1.1 `Button`
- **Props:** `variant: 'solid' | 'outline' | 'ghost' | 'link'`,
  `tone: 'torii' | 'sumi' | 'subtle' | 'danger'`,
  `size: 'sm' | 'md' | 'lg'`, `loading?`, `iconLeft?`, `iconRight?`,
  `asChild?`.
- **Default tone:** `torii` — the brand colour does the work.
- **States:** default · hover (`--e-torii` glow) · focus-visible ·
  active · disabled · loading.
- **A11y:** real `<button>`; focus ring `2px var(--torii)`; loading
  announces `aria-busy="true"`.
- **Responsive:** touch target ≥ 44 px on mobile.

### 1.2 `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
- Floating-label variant for checkout; compact for inline.
- Error: `aria-invalid="true"` + `aria-describedby` text.
- Native `<select>` on mobile; custom combobox on desktop only.

### 1.3 `Pill`, `Tag`, `Badge`
- 11 / 12 px `--ls-label` all-caps labels.
- Tones: `torii` (action), `gold` (drop / rare), `jade` (in stock),
  `err` (sold out), `sumi-ghost` (neutral).
- **`AnimeTag`** subtype — pre-coloured by anime franchise
  (Naruto → orange, JJK → mauve, One Piece → red, DBZ → orange-red,
  Bleach → cyan…). Stored as a `Map<Slug, Hex>` in
  `lib/anime-colors.ts`.

### 1.4 `Card`
- Soft-corner surface; default `--washi-2` background, optional
  `--indigo-3` for dark sections.
- Slots: `media`, `header`, `body`, `footer`.

### 1.5 `Skeleton` / `Shimmer`
- Replaces every async region; no CLS, identical box-model.

### 1.6 `Toast`
- `bottom-right` desktop, `bottom-center` mobile.
- `role="status"`; auto-dismiss 4 s unless action attached.

### 1.7 `Modal`, `Drawer`, `Popover`, `Sheet`
- Radix primitives + tokens.
- Focus trap; `Esc` to close.

### 1.8 `Tabs`, `Accordion`
- Accordion is the FAQ primitive (one-open-at-a-time).
- Tabs roving-focus with `←/→`.

## 2. Navigation

### 2.1 `TopNav`
- **Layout:** mascot badge + wordmark · primary nav · utility cluster.
- **Sticky** with an 8 px height drop after 100 px scroll; soft
  shadow only on overlay state.
- Drop badge (`gold`) next to "Drops" when a drop is `live`.
- **Mobile:** hamburger → full-screen sheet, ESC + swipe to close.

### 2.2 `Breadcrumbs`
- JSON-LD `BreadcrumbList` emitted.
- Truncates middle on long paths.

### 2.3 `Footer`
- 4 columns desktop, 1 column mobile.
- Newsletter form (POST → Klaviyo).
- Payment icons.
- "Notre boutique" block with map deep-link + hours.
- Social row: Instagram + TikTok + WhatsApp + Maps.

### 2.4 `LanguageSwitch`
- Pill dropdown FR / EN (AR in v1.1).
- Sets cookie + redirects to localised path; emits `hreflang`.

### 2.5 `SearchOverlay`
- Triggered from the nav icon, full-screen on mobile.
- Groups: `recent` · `anime` (Naruto, JJK, …) · `products` ·
  `journal`.
- Keyboard: `↑↓` to nav, `Enter` to open, `/` to focus from anywhere.

## 3. Commerce primitives

### 3.1 `ProductCard`
- **Slots:** `image` (3 : 4 portrait, hover swaps to second), `animeTag`,
  `title`, `price`, `quickAdd`.
- **Variants:** `default` · `featured` (larger, 4 : 5) · `compact`.
- **States:** in-stock · low-stock pill · sold-out
  (`--sumi-4` overlay + watermark + click → notify-me) · in-store-only
  (gold pill).
- **A11y:** the whole card is a single link with `aria-label`
  "{title} — {price} — {variants available}". Quick-add is a
  separate `<button>`, not nested.

### 3.2 `QuickAddSheet`
- Bottom-sheet on PLP `Quick add`.
- Variant chips (size, colour).
- Inline stock signal.
- "Personnaliser" deep-link to the Custom Builder, pre-selecting
  this base.

### 3.3 `Gallery` (PDP)
- Image array with thumbnails (desktop) or dots (mobile).
- Keyboard: `←/→` to swipe.
- Video clip variant; respects `prefers-reduced-motion`.
- Zoom-on-hover desktop / pinch-to-zoom mobile.

### 3.4 `VariantSelector`
- Size as a real `<button>` group with `role="radiogroup"`.
- Disabled size shows reason (`title` + visible if sold-out).
- Colour as swatch row; selected gets a 2 px ink ring.

### 3.5 `SizeRecommender`
- Height + weight inputs → fit recommendation against the per-piece
  cm table.

### 3.6 `PriceTag`
- Price + currency + locale-aware separators.
- Variant: `compareAt` strikethrough + savings %.

### 3.7 `StockSignal`
- 5 states: `in_stock`, `low_stock` (≤ 5), `last_one`, `sold_out`,
  `pickup_only`.
- Pickup-only is shown as a `gold` pill on accessories.

### 3.8 `AddToCartButton`
- Wraps `Button` with cart-mutation hook.
- Optimistic UI; reverts on error.
- Disabled while no variant selected; explains why
  (`aria-describedby`).

### 3.9 `WishlistButton`
- Heart icon; toggles localStorage + syncs to account on login.

### 3.10 `CartDrawer`
- Slide-in right.
- Header: line-count + close.
- Body: line items + free-shipping bar + **pickup-vs-delivery
  toggle** (the SHINOBI-specific bit).
- Cross-sell strip (one item, from same anime by default).
- Footer: subtotal + COD assurance + "Passer la commande".

### 3.11 `LineItem`
- Thumbnail + name + variant attrs OR `customConfig` summary +
  price + qty + remove.
- **Custom configs** render with a tiny "Personnalisé" pill in gold.

### 3.12 `CheckoutFlow`
- Single page; three groups: Contact · Livraison · Paiement.
- Sticky order-summary panel on desktop; collapsible on mobile.
- `PickupOrDeliveryPicker` at the top of "Livraison".
- `WilayaCommuneCascade` when Livraison is selected.
- Payment radio: COD default, Card secondary.
- Place-order button shows the amount + "Payer à la livraison" or
  "Payer maintenant".

### 3.13 `PickupOrDeliveryPicker`
- Two radio cards.
  - **Retrait en boutique** — *Centre Commercial Bab Ezzouar* —
    *0 DA*. Time window: "prêt en 3 – 4 jours".
  - **Livraison à domicile** — *690 DA (estimated)* — *48 h après
    impression*.
- Map preview on the pickup card.

### 3.14 `WilayaCommuneCascade`
- Two comboboxes sourced from the 58-wilayas dataset.
- Remembers last for returning users.

### 3.15 `OrderTracking`
- Public widget on `/commande/suivi`.
- Ladder: `Confirmée → Imprimée → Emballée → Expédiée → Livrée` (or
  `Prête en boutique`).

## 4. Content / editorial

### 4.1 `Hero` (variants)
- `editorial` — image + headline + sub + CTA.
- `drop-live` — countdown + "Voir le drop".
- `drop-upcoming` — countdown + "Notifie-moi".
- `custom-pitch` — "Forge la tienne — à partir de 2 200 DA" +
  builder CTA.

### 4.2 `AnimeStrip`
- Horizontal scroller of anime franchise tiles: Naruto, JJK, One
  Piece, DBZ, Bleach, Death Note, AOT, Blue Lock, Dandadan, Solo
  Leveling. Each tile links to a filtered shop view.

### 4.3 `JournalPost`
- Long-form, MDX-backed; supports `Product`, `LookbookEmbed`,
  `Pullquote`, `Image` inline.

### 4.4 `MarqueeStrip`
- Pure CSS `marquee` of brand lines:
  "FORGE TON UNIVERS · 忍者 · BAB EZZOUAR · DM POUR PASSER COMMANDE".

### 4.5 `FounderLine`
- Rotates a one-line founder quote weekly (CMS).

### 4.6 `MapEmbed` (`/boutique`)
- Map of the Bab Ezzouar location with hours, photo, deep-link.
- `LocalBusiness` JSON-LD nearby.

### 4.7 `UgcWall`
- `#shinobishopdz` Instagram hashtag scraped (Foursixty / Flowbox)
  → shoppable grid.

## 5. Trust + reassurance

### 5.1 `TrustStrip`
- COD · 48 h après impression · retrait en boutique gratuit ·
  14 j retour. Always real claims, never decorative.

### 5.2 `ReviewBlock`
- Star rating + per-star distribution + first-photo gallery + list.
- Verified-buyer flag pulled from order history.

### 5.3 `BoutiqueCallout`
- A horizontal card with shop photo + "Tu peux aussi passer en
  boutique" + map deep-link. Lives on PDP and on the cart-drawer
  footer.

## 6. Custom Builder (the brand's moat)

The most important component in the site. Routed at `/custom`.

### 6.1 Purpose
Productise the in-shop custom-print service. Replace the 7-message
DM with a 3-minute self-serve flow.

### 6.2 Steps

```
Step 1 · Pick a base
  ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
  │  T-shirt     │  Sweatshirt  │  Pull        │  Tote bag    │  Mug         │
  │  2 200 DA    │  3 300 DA    │  2 800 DA    │  1 000 DA    │  1 000 DA    │
  └──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

Step 2 · Pick a design (or upload your own — moderated)
  Filter by: Anime  ·  Character  ·  Style (B&W · colour · minimal)
  Gallery of curated designs (the Phase-1 catalogue).

Step 3 · Side(s)
  ◯  Recto seulement
  ◯  Recto + Verso  (+500 DA)

Step 4 · Size + colour
  Variant chips (only valid combinations).

Step 5 · Review
  Live composited preview (PNG over the base photo).
  Live total with line breakdown.
  Buttons:  [ Ajouter au panier ]   [ Garder le devis ]
```

### 6.3 Props (TS sketch)

```ts
export interface CustomBuilderProps {
  bases: Base[]              // from /api/v1/custom/bases
  designs: Design[]          // from /api/v1/custom/designs
  initial?: Partial<CustomConfig>
  onAddToCart: (cfg: CustomConfig) => Promise<void>
  onSaveQuote: (cfg: CustomConfig) => Promise<{ id: string; url: string }>
}

export type Base = {
  id: string
  name: 't-shirt' | 'sweat' | 'pull' | 'tote' | 'mug'
  basePrice: number          // DZD; from the owner's pricing table
  colours: { code: string; hex: string; image: string }[]
  sizes: { code: string; available: boolean }[]
  doubleSideAllowed: boolean
}

export type Design = {
  id: string
  name: string
  anime: string | null
  character: string | null
  style: 'bw' | 'colour' | 'minimal' | 'text'
  preview: { url: string; w: number; h: number }
  printOk: boolean           // owner-verified printable
}

export type CustomConfig = {
  baseId: string
  designId: string
  doubleSide: boolean
  size?: string
  colour?: string
  notes?: string             // free-text the owner sees in the print queue
}
```

### 6.4 Pricing

The price comes from a single function so the test suite can pin it:

```ts
export function quoteCustom(cfg: CustomConfig, bases: Base[]): number {
  const base = bases.find(b => b.id === cfg.baseId)!
  let total = base.basePrice
  if (cfg.doubleSide && base.doubleSideAllowed) total += 500
  return total
}
```

The price chip on screen updates from `quoteCustom` on every change,
never from a network round-trip.

### 6.5 Preview

A `<canvas>` composites the chosen design over a high-resolution
photo of the chosen base / colour. The compositing is purely client
side at 80 % JPEG to keep perf budget.

### 6.6 Save-quote

`/custom/quote/{id}` is a public, sharable URL with the
configuration baked in. Useful for buyers who want owner approval
before adding to cart.

### 6.7 A11y

- Each step is a `<fieldset>` with a visible `<legend>`.
- Design picker is keyboard-reachable: filterable list, not
  hover-only.
- Preview is `aria-live="polite"` to announce updates.
- Total price has `aria-atomic` so screen readers read the full new
  number on each change.

### 6.8 Empty states

- No designs in a filter → "Pas (encore) de design ici — propose
  le tien." with a one-tap upload (gated by moderation).
- Base out of stock in selected size → "Choisis une autre taille
  ou viens en boutique."

## 7. Mobile

### 7.1 `MobileBottomNav`
- Five items: Boutique · Custom · Search · Favoris · Compte.
- Active item pulses a 2 px torii bar at the top.
- Glass background that fades into `--washi` / `--indigo`.

### 7.2 `StickyAddToBag`
- PDP sticky bar on mobile.
- Renders price + size selector + "Ajouter".

## 8. Storybook + visual tests

Every component file owns:
- `*.stories.tsx`
- `*.spec.ts` with axe-core (zero `serious` violations),
  visual regression via Chromatic at canonical viewports
  (`360 / 744 / 1024 / 1440 / 1900`), and `prefers-reduced-motion`
  render check.

A component without these is **not "done"**.
