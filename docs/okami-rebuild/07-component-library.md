# 07 — Component Library

> Every component lists: purpose · props (TS-ish) · variants · states ·
> a11y requirements · responsive behaviour. Built on shadcn/ui where
> possible; custom where shadcn's defaults disagree with the design
> system. All components live in `src/components/` and have a Storybook
> story + axe-core test.

## 1. Foundations

### 1.1 `Button`
- **Purpose:** primary action affordance.
- **Props:**
  ```ts
  variant: 'solid' | 'outline' | 'ghost' | 'link'
  tone: 'ink' | 'okami' | 'danger' | 'subtle'
  size: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: ReactNode; iconRight?: ReactNode
  asChild?: boolean
  ```
- **States:** default · hover · focus-visible · active · disabled · loading.
- **A11y:** real `<button>` (or `<a>` when `asChild` + `<Link>`); focus
  ring `2px var(--white)` (or `var(--purple)` for focus on dark cards);
  loading announces `aria-busy="true"`.
- **Responsive:** size tokens cascade with breakpoint; touch target ≥ 44 px.

### 1.2 `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
- Floating-label variant for forms (checkout); compact for inline.
- Error: `aria-invalid="true"` + descriptive `aria-describedby` text.
- Native select on mobile; custom listbox on desktop only.

### 1.3 `Badge`, `Pill`, `Tag`
- 11/12 px uppercase mono labels.
- Tones map to semantic colours (`okami`, `warn`, `error`, `ok`, `info`).
- Includes `DropTag` variant rendered with drop accent.

### 1.4 `Card`
- Hard-edge surface; `--bg-card` background, `border var(--w10)`.
- Slots: `media`, `header`, `body`, `footer`.

### 1.5 `Skeleton` / `Shimmer`
- Replaces every async region. No CLS, identical box-model to the
  loaded state.

### 1.6 `Toast`
- `position: bottom-right` on desktop, `bottom-center` on mobile.
- Live region (`role="status"`), dismissed after 4 s unless action
  attached.

### 1.7 `Modal`, `Drawer`, `Popover`, `Sheet`
- Built on Radix primitives + design tokens.
- Focus trap; `Esc` to close; backdrop click closes unless `persistent`.

### 1.8 `Tabs`, `Accordion`
- Accordion is the FAQ primitive; one-open-at-a-time.
- Tabs roving-focus with `←/→`.

## 2. Navigation

### 2.1 `TopNav`
- **Layout:** logo · primary nav · utility cluster.
- **Sticky** with a small shrink (8 px height drop) after 100 px scroll;
  shadow appears only on overlay state.
- **Drop badge:** when a drop is `live`, a `okami` pill appears next to
  "Drops" with a count-up of items.
- **Mobile:** hamburger → full-screen sheet, ESC + swipe to close,
  drop carousel inside.

### 2.2 `Breadcrumbs`
- JSON-LD `BreadcrumbList` emitted.
- Truncates the middle on long paths.

### 2.3 `Footer`
- 4 columns desktop, 1 column mobile.
- Newsletter form (POST → email platform).
- Payment icons row.
- "Made for the streets · Algiers" stamp.

### 2.4 `LanguageSwitch`
- Pill dropdown with EN / FR / AR.
- Sets cookie + redirects to localized path; emits `hreflang`.

### 2.5 `SearchOverlay`
- Triggered from the nav search icon, full-screen on mobile.
- Renders `recent`, `trending`, `products`, `drops`, `journal`
  grouped results.
- Keyboard: `↑ ↓` to nav, `Enter` to open, `/` to focus from anywhere.

## 3. Commerce primitives

### 3.1 `ProductCard` (greyscale → colour signature)

- **Purpose:** PLP card. **Carries the brand's signature interaction**:
  product art is desaturated at rest, snaps to full colour on hover,
  permanent greyscale at brightness 0.5 when sold out (see
  [00 §8.1](./00-extracted-design-system.md#81-greyscale--colour-on-product-hover)).
- **Slots:**
  - `image` — first variant image with `filter: grayscale(0.95) brightness(1.1)`;
    hover removes the filter and scales `1.10` over 500 ms `--ease-expo`.
  - `swatches` — up to 5 visible, "+N" overflow.
  - `dropTag` — small pill linking to the drop, coloured by drop tone
    (`--orange` "Limited Drop", `--purple` "New", `--amber` "Last Pieces").
  - `title` (OKAMI face) · `price` (OKAMI face, `--ls-1`) ·
    `category` (Inter, `--w50`) · `quickAdd`.
- **Variants:** `default` (3 : 4) · `featured` (3 : 4 larger) ·
  `compact` (search results).
- **States:** in-stock · low-stock badge · sold-out
  (permanent `filter: grayscale(1) brightness(0.5)`, sold-out pill,
  click → notify-me).
- **A11y caveats:**
  - The greyscale-on-rest treatment **must not** be the only signal
    of "available vs sold-out" — a sold-out badge + visible price
    state always accompany it.
  - The hover-to-reveal-colour pattern is **inaccessible on keyboard /
    touch by default** — also trigger the colour state on
    `:focus-within` and via `IntersectionObserver` for touch
    (cards become coloured once they enter the viewport on mobile).
- **A11y:** entire card is a single link with `aria-label` "{name},
  {price}, {colour}, {sizes available}". Quick-add is a separate
  `<button>`, not nested in the link.

### 3.2 `QuickAddSheet`
- Bottom-sheet on PLP `Quick add`.
- Variant chips (size, colour).
- Inline stock signal ("only 2 left in M").
- "Add to bag" — closes sheet, opens cart drawer.

### 3.3 `Gallery` (PDP)
- Image array with thumbnails (desktop) or dots (mobile).
- Keyboard: `← / →` to swipe.
- Video clip variant; respects `prefers-reduced-motion`.
- Zoom-on-hover desktop / pinch-to-zoom mobile.

### 3.4 `VariantSelector`
- Size = real `<button>` group with `role="radiogroup"`.
- Disabled size shows reason (`title` and visible if sold-out).
- Colour = swatch row; selected has 2 px ink ring.

### 3.5 `SizeRecommender`
- "Find your size" — height + weight inputs → fit recommendation.
- "We recommend M based on your measurements" (uses garment cm
  tables from CMS).

### 3.6 `PriceTag`
- Renders price + compareAt strikethrough + savings percent + currency.
- Locale-aware separators.

### 3.7 `StockSignal`
- 5 states: `in_stock`, `low_stock` (≤ 5), `last_one`, `sold_out`,
  `preorder`.
- Last-one and sold-out are persistent on the card; low-stock fades
  after 24 h to avoid the boy-who-cried-low.

### 3.8 `AddToCartButton`
- Wraps `Button` with cart-mutation hook.
- Optimistic UI; reverts + toast on error.
- Disabled while no variant selected — and explains why
  (`aria-describedby`).

### 3.9 `WishlistButton`
- Heart icon; toggles `wishlist` state in localStorage + account sync.
- Animated check on first add (only).

### 3.10 `CartDrawer`
- Slide-in right.
- Header: line-count + close.
- Body: scrollable line items + free-shipping progress.
- Cross-sell strip (one item).
- Footer: subtotal + COD assurance + checkout CTA.
- A11y: `role="dialog"` + focus trap.

### 3.11 `LineItem`
- Thumbnail + name + variant attrs + price + qty + remove.
- Editing qty is a single text-style numeric input with `-` / `+`
  buttons; debounced PATCH.

### 3.12 `CheckoutFlow`
- Single-page; three groups: Contact, Address, Pay.
- Sticky `Order Summary` panel on desktop; collapsible on mobile.
- `WilayaCommuneCascade` — see 3.13.
- Payment radio: COD (default), Card (Stripe / CIB).
- Place-order button shows the amount + "Pay on delivery" or "Pay now".

### 3.13 `WilayaCommuneCascade`
- Two `<Combobox>` widgets sourced from the 58-wilayas dataset.
- Choosing a wilaya filters commune options; remembers last for
  returning users.

### 3.14 `OrderTracking`
- Public widget on `/order/track`: `(order_number, phone)`.
- Renders ladder: `Confirmed → Packed → Shipped → Delivered`.
- Failure modes (Cancelled, Returned) inline.

## 4. Content / editorial

### 4.1 `Hero` (with variants)
- `editorial` — image + headline + sub + CTA.
- `drop-live` — countdown reads `00 : 00 : 00`, then flips state.
- `drop-upcoming` — countdown + "Get notified" form.
- `video` — IO-controlled play; reduced-motion → poster.

### 4.2 `LookbookChapter`
- Sequence of full-bleed images + copy blocks + product hot-spots.
- Hot-spot = absolute-positioned `<button>` opening a PDP bottom-sheet.

### 4.3 `JournalPost`
- Long-form. MDX-backed; supports `Product`, `LookbookEmbed`,
  `Pullquote`, `Image` components inline.

### 4.4 `MarqueeStrip`
- A press / "as seen on" row. Pure CSS animation.

### 4.5 `FounderLine`
- Rotates a one-line quote weekly (CMS-backed). Plain text, no
  decoration.

### 4.6 `Countdown`
- Server-rendered at first paint with the time-to-drop value so the
  countdown is correct *immediately* without a flash of `--:--:--`.
- Reduced-motion: no flip-card animation, just plain number replace.

## 5. Account / forms

### 5.1 `MagicLinkForm`
- Email-only auth; POST → email service.
- Success state: "Check your inbox" + open-mail buttons.

### 5.2 `AddressForm`
- Inherits `WilayaCommuneCascade`.
- Default-address checkbox.

### 5.3 `OrdersList`
- Status pill + total + items thumbnail strip + actions
  ("Track", "Reorder").

## 6. Discovery

### 6.1 `FilterBar` (PLP)
- Sticky on scroll past header.
- Chips for applied filters; "Clear" pill.
- Drop facet shows colour-coded chips per drop.

### 6.2 `Pagination` (Load more)
- Prefer load-more on mobile; numbered on desktop with focus
  preservation.

### 6.3 `Recommendations`
- Lazy-loaded slot; never gates the LCP.
- Slot names: `pdp.related`, `pdp.cross_sell`, `cart.upsell`,
  `home.featured`.

## 7. Trust + reassurance

### 7.1 `TrustStrip` (PDP, cart, footer)
- COD, 48 h shipping, 14-day returns, secure checkout.
- Always real claims — no decorative badges that aren't backed by
  policy.

### 7.2 `ReviewBlock`
- Star rating + per-star distribution + first-photo gallery + lazy
  list.
- Verified-buyer flag pulled from order history.

### 7.3 `UgcWall`
- Instagram-tag-driven grid; each cell links to product.

## 7.5 OKAMI-signature primitives

These three primitives are part of the brand's verified visual
language ([00 §7, §8](./00-extracted-design-system.md)). They are
first-class components, not decorations.

### 7.5.1 `FlipCard` (3D card flip)

- **Purpose:** front-to-back reveal on hover; used for "size guide"
  thumbnails, drop teaser tiles, founder line cards.
- **Markup:** outer `perspective: 1000px`, inner
  `transform-style: preserve-3d` + `transition: transform 0.7s var(--ease-expo)`,
  two faces `backface-visibility: hidden`, back face `transform: rotateY(180deg)`.
- **A11y:** the back face must be reachable via keyboard — toggle the
  flipped state on `:focus-within` and via an explicit "Flip" `<button>`
  for assistive tech. The back content must be readable by screen
  readers even when not flipped (`aria-hidden` is wrong here; rely
  on visual `backface-visibility` only).
- **Reduced motion:** swap to a 200 ms cross-fade.

### 7.5.2 `AuroraOrbs`

- **Purpose:** decorative section-break / hero background atmosphere.
  Three blurred coloured discs floating behind the content.
- **Props:** `tone` (`purple` default, `green`, `orange`), `intensity`
  (`subtle | strong`), `count` (1–3).
- **Implementation:** absolute-positioned `<div>`s with
  `filter: blur(120px); mix-blend-mode: overlay`. Sizes 150–240 px.
- **A11y:** `aria-hidden="true"`. Always behind content; never an
  interaction target.
- **Reduced motion:** static positions (no drift animation).

### 7.5.3 `WallpaperBackdrop`

- **Purpose:** the body-level halftone background; pinned with
  `background-attachment: fixed` so it parallaxes as the page scrolls.
- **Implementation:** a CSS class applied to `<body>` that sets
  `background-image: url(/wallpaper.svg)` + `cover` + `fixed`.
- **A11y:** must not interfere with text contrast — the wallpaper
  reads at <5 % luminance against `--bg-base`. Plus a grain `body::after`
  at `mix-blend-overlay; opacity: 0.35`.
- **Performance:** the SVG is < 8 KB and ships from the static origin;
  cached forever. Skip on `prefers-reduced-motion: reduce` (the fixed
  attachment is what gives the parallax feel; it can stay).

## 8. Surfaces unique to drops

### 8.1 `DropHero`
- Full-bleed campaign image + drop name + state (countdown / live /
  archive).

### 8.2 `DropGate`
- Pre-launch "Get notified" capture form (email + SMS) — segmented
  per drop in the email platform.

### 8.3 `DropArchiveCard`
- Sold-out drop tile linking to its `archived` page.

## 9. Component contract — example

A working sketch of a `ProductCard` contract, in TypeScript:

```ts
export type ProductCardSize = 'compact' | 'default' | 'featured'

export interface ProductCardProps {
  product: {
    id: string
    handle: string
    title: string
    price: { amount: number; currencyCode: string }
    compareAt?: { amount: number; currencyCode: string } | null
    images: { url: string; alt: string }[]
    swatches: { color: string; variantId: string }[]
    drop?: { id: string; slug: string; name: string; tone: string }
    availability: 'in_stock' | 'low_stock' | 'last_one' | 'sold_out' | 'preorder'
    sizes: { code: string; available: boolean }[]
  }
  size?: ProductCardSize
  onQuickAdd?: (variantId: string) => void
}
```

A11y contract:

- Outer link with `aria-label` describing `title`, `price`, default
  `colorway`, and `availability`.
- Quick-add is a `<button>` with `aria-haspopup="dialog"`.
- Image has an `alt` always; empty string when decorative only.

## 10. Storybook + visual tests

Every component file owns a sibling `*.stories.tsx` and a `*.spec.ts`
running:

- Axe-core a11y baseline (no violations of impact ≥ `serious`).
- Visual regression via Chromatic / Loki on the canonical viewport set
  (`360`, `744`, `1024`, `1440`, `1900`).
- Reduced-motion render check.

A component without these is not "done".
