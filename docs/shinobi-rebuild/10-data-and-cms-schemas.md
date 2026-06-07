# 10 — Data, Database & CMS Schemas

The system uses **three** data sources, each holding what it is
best at:

| System | Owns | Why there |
|---|---|---|
| **Glstore FastAPI backend** (this repo) | Products, variants, inventory, orders, customers, the custom checkout, taxes, shipping rates, 58-wilaya address dataset | Already running, already tuned for DZ — do not replace. |
| **Sanity (CMS)** | Editorial overlay: home, drops, lookbook, journal, page copy, founder lines, the design catalogue for the Custom Builder, the Boutique page, SEO overrides | Editor experience, real-time, image pipeline, i18n. |
| **Postgres (Prisma)** | Drops state, drop subscribers, **custom-order configurations**, review records (+ media), wishlist sync, loyalty ledger, audit log, magic-link tokens | The things Glstore and the CMS won't model well. |

Algolia + Klaviyo are **derived** stores (indices and contact
lists) populated by Glstore webhooks; they are not authoritative.

---

## A. Postgres schema (Prisma)

```prisma
// packages/db/prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ── Drops ────────────────────────────────────────────────────────
enum DropState { UPCOMING LIVE SOLD_OUT ARCHIVED }

model Drop {
  id              String     @id @default(cuid())
  slug            String     @unique
  name            String
  state           DropState  @default(UPCOMING)
  scheduledStart  DateTime
  scheduledEnd    DateTime?
  glstoreTag      String     // products are tagged with this in the Glstore backend
  accentToken     String?    // e.g. "#FE6E00" overriding --torii per drop
  capacity        Int?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  subscriptions   DropSubscription[]
  notifyEvents    NotifyEvent[]
  reviews         Review[]
}

model DropSubscription {
  id        String   @id @default(cuid())
  dropId    String
  email     String?
  phone     String?
  locale    String   @default("fr")
  createdAt DateTime @default(now())
  drop      Drop     @relation(fields: [dropId], references: [id], onDelete: Cascade)
  @@index([dropId])
  @@unique([dropId, email])
  @@unique([dropId, phone])
}

// ── Custom orders (the SHINOBI moat) ─────────────────────────────
enum CustomOrderState {
  DRAFT          // builder open
  QUOTE          // saved quote, public link
  IN_CART        // attached to a cart
  CONFIRMED      // attached to a paid/COD-pending Glstore order
  PRINTED
  READY          // ready for pickup or dispatch
  HANDED_OFF     // delivered or picked up
  CANCELLED
}

enum BaseKind { TSHIRT SWEATSHIRT PULL TOTE MUG }

model CustomOrder {
  id            String           @id @default(cuid())
  glstoreOrderNumber String?     // set when the order is paid/COD-pending
  glstoreCustomerId  String?

  baseKind      BaseKind
  baseId        String           // Sanity reference (specific base model + colour)
  designId      String           // Sanity reference (the printable artwork)
  doubleSide    Boolean          @default(false)
  size          String?
  colour        String?
  notes         String?          // free-text the owner sees in the print queue

  quotedPrice   Decimal          @db.Decimal(10, 2)  // computed by quoteCustom()
  currency      String           @default("DZD")
  state         CustomOrderState @default(DRAFT)

  customerEmail String?
  customerPhone String?

  publicQuoteId String?          @unique             // /custom/quote/{id} share link

  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  @@index([state, createdAt])
  @@index([baseKind, designId])                       // print-queue grouping
}

// ── Reviews ──────────────────────────────────────────────────────
enum ReviewStatus { PENDING APPROVED REJECTED }

model Review {
  id              String   @id @default(cuid())
  productHandle   String   // Glstore product slug — join key
  variantId       String?
  customerEmail   String
  customerName    String
  rating          Int      // 1..5
  title           String?
  body            String
  photos          ReviewMedia[]
  verifiedBuyer   Boolean  @default(false)
  glstoreOrderNumber String?
  language        String   @default("fr")
  status          ReviewStatus @default(PENDING)
  helpfulVotes    Int      @default(0)
  dropId          String?
  drop            Drop?    @relation(fields: [dropId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([productHandle, status])
}

model ReviewMedia {
  id        String @id @default(cuid())
  reviewId  String
  url       String
  width     Int?
  height    Int?
  review    Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
}

// ── Wishlist (server-side sync) ─────────────────────────────────
model Wishlist {
  id     String   @id @default(cuid())
  userId String   @unique
  items  WishlistItem[]
}
model WishlistItem {
  id            String  @id @default(cuid())
  wishlistId    String
  productHandle String
  variantId     String?
  addedAt       DateTime @default(now())
  wishlist      Wishlist @relation(fields: [wishlistId], references: [id], onDelete: Cascade)
  @@index([wishlistId, productHandle])
}

// ── Auth (magic link) ────────────────────────────────────────────
model MagicLinkToken {
  token     String   @id      // opaque, 32 bytes hex
  email     String
  expiresAt DateTime
  consumed  Boolean  @default(false)
  createdAt DateTime @default(now())
  @@index([email])
}

// ── Loyalty (Phase 4) ────────────────────────────────────────────
model LoyaltyLedger {
  id          String   @id @default(cuid())
  userId      String
  reason      String   // 'order', 'referral_referee', 'referral_referrer', 'manual', 'expiry'
  points      Int
  orderId     String?
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
}
model Referral {
  code        String   @id   // "SHN-XXXX"
  ownerUserId String
  uses        Int      @default(0)
  createdAt   DateTime @default(now())
}

// ── Notify-me on restock / drop launch ──────────────────────────
enum NotifyStatus { PENDING SENT FAILED }
model NotifyEvent {
  id            String       @id @default(cuid())
  dropId        String?
  productHandle String?
  variantId     String?
  email         String?
  phone         String?
  status        NotifyStatus @default(PENDING)
  sentAt        DateTime?
  createdAt     DateTime     @default(now())
  drop          Drop?        @relation(fields: [dropId], references: [id])
  @@index([productHandle, status])
}

// ── Audit (admin actions) ────────────────────────────────────────
model AuditLog {
  id        String   @id @default(cuid())
  actorId   String
  action    String
  entity    String
  entityId  String?
  metadata  Json?
  createdAt DateTime @default(now())
  @@index([actorId, createdAt])
}
```

### A.1 Why Postgres for these (and not Glstore)

- **Custom orders** need a state machine + a print queue grouping
  (`baseKind × designId`); they are not catalogue rows.
- **Drops** need scheduled state flips and an audit history.
- **Reviews with photos** + moderation workflow + bilingual storage
  do not belong in a generic product table.
- **Wishlist sync** must merge anonymous (localStorage) and account
  records — outside the catalogue concern.
- **Loyalty** must be an append-only ledger.

### A.2 Print-queue read

The owner-facing print queue is one query:

```ts
await prisma.customOrder.groupBy({
  by: ['baseKind', 'designId', 'colour', 'size', 'doubleSide'],
  where: { state: { in: ['CONFIRMED', 'PRINTED'] } },
  _count: { _all: true },
})
```

Returns lines like `[Sweat black L · Sukuna · recto+verso] × 3`.

---

## B. CMS schemas (Sanity)

### B.1 Drop

```ts
// apps/cms/schemas/document/drop.ts
import { defineField, defineType } from 'sanity'

export const drop = defineType({
  name: 'drop', type: 'document', title: 'Drop',
  fields: [
    defineField({ name: 'name', type: 'string', validation: r => r.required() }),
    defineField({ name: 'slug', type: 'slug', options: { source: 'name' }, validation: r => r.required() }),
    defineField({
      name: 'state', type: 'string',
      options: { list: ['upcoming','live','sold_out','archived'], layout: 'radio' },
      validation: r => r.required(),
    }),
    defineField({ name: 'scheduledStart', type: 'datetime', validation: r => r.required() }),
    defineField({ name: 'scheduledEnd',   type: 'datetime' }),
    defineField({ name: 'hero', type: 'hero' }),
    defineField({ name: 'subtitle', type: 'string' }),
    defineField({ name: 'story', type: 'array', of: [{ type: 'block' }, { type: 'media' }] }),
    defineField({ name: 'accentToken', type: 'string', description: 'CSS colour to override --torii per drop' }),
    defineField({ name: 'glstoreTag', type: 'string', description: 'Products tagged with this in Glstore' }),
    defineField({ name: 'credits', type: 'array', of: [{ type: 'string' }] }),
    defineField({ name: 'seo', type: 'seo' }),
    defineField({ name: 'i18n', type: 'object', fields: [
      { name: 'en', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'subtitle', type: 'string' }, { name: 'story', type: 'array', of: [{type:'block'},{type:'media'}] }] },
      { name: 'ar', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'subtitle', type: 'string' }, { name: 'story', type: 'array', of: [{type:'block'},{type:'media'}] }] },
    ]}),
  ],
})
```

### B.2 Product overlay

Glstore owns price, inventory, variant SKUs. The CMS overlays:

```ts
export const productOverlay = defineType({
  name: 'product', type: 'document',
  fields: [
    defineField({ name: 'glstoreHandle', type: 'string', validation: r => r.required() }),
    defineField({ name: 'description', type: 'array', of: [{ type: 'block' }] }),
    defineField({ name: 'sizing', type: 'array', of: [{ type: 'object', fields: [
      { name: 'size', type: 'string' },
      { name: 'chestCm', type: 'number' },
      { name: 'lengthCm', type: 'number' },
      { name: 'shoulderCm', type: 'number' },
      { name: 'sleeveCm', type: 'number' },
    ]}]}),
    defineField({ name: 'animeFranchise', type: 'string', description: 'Naruto, JJK, OnePiece, DBZ, …' }),
    defineField({ name: 'character',      type: 'string', description: 'Gojo, Sukuna, Goku, …' }),
    defineField({ name: 'fabric',         type: 'string' }),
    defineField({ name: 'careNotes',      type: 'text' }),
    defineField({ name: 'pickupOnly',     type: 'boolean', initialValue: false }),
    defineField({ name: 'seo',            type: 'seo' }),
    defineField({ name: 'i18n',           type: 'object' }),
  ],
})
```

### B.3 Design (Custom Builder catalogue)

```ts
export const design = defineType({
  name: 'design', type: 'document', title: 'Design (Custom Builder)',
  fields: [
    defineField({ name: 'name', type: 'string', validation: r => r.required() }),
    defineField({ name: 'preview', type: 'image', options: { hotspot: true }, validation: r => r.required() }),
    defineField({ name: 'animeFranchise', type: 'string' }),
    defineField({ name: 'character', type: 'string' }),
    defineField({
      name: 'style', type: 'string',
      options: { list: ['bw','colour','minimal','text'] },
    }),
    defineField({ name: 'printOk', type: 'boolean', initialValue: false, description: 'Owner-verified printable' }),
    defineField({ name: 'allowedBases', type: 'array', of: [{ type: 'string' }],
      description: 'Subset of t-shirt | sweatshirt | pull | tote | mug' }),
    defineField({ name: 'tags', type: 'array', of: [{ type: 'string' }] }),
  ],
})
```

### B.4 Boutique (the Bab Ezzouar shop)

```ts
export const boutique = defineType({
  name: 'boutique', type: 'document', // singleton
  fields: [
    defineField({ name: 'name', type: 'string' }),
    defineField({ name: 'addressLine', type: 'string', initialValue: 'Centre Commercial Bab Ezzouar' }),
    defineField({ name: 'city', type: 'string', initialValue: 'Bab Ezzouar, Alger' }),
    defineField({ name: 'country', type: 'string', initialValue: 'Algérie' }),
    defineField({ name: 'lat', type: 'number' }),
    defineField({ name: 'lng', type: 'number' }),
    defineField({ name: 'phone', type: 'string', initialValue: '023 925 014' }),
    defineField({ name: 'email', type: 'string' }),
    defineField({ name: 'instagramHandle', type: 'string', initialValue: '@shinobishopdz' }),
    defineField({ name: 'openingHours', type: 'array', of: [{ type: 'object', fields: [
      { name: 'day', type: 'string' },           // 'Mon' … 'Sun'
      { name: 'opens', type: 'string' },         // '10:00'
      { name: 'closes', type: 'string' },        // '20:00'
      { name: 'closed', type: 'boolean' },
    ]}]}),
    defineField({ name: 'photos', type: 'array', of: [{ type: 'media' }] }),
    defineField({ name: 'description', type: 'array', of: [{ type: 'block' }] }),
    defineField({ name: 'seo', type: 'seo' }),
  ],
})
```

### B.5 Home (singleton)

```ts
export const home = defineType({
  name: 'home', type: 'document', // singleton
  fields: [
    defineField({ name: 'hero', type: 'hero' }),
    defineField({ name: 'currentDrop', type: 'reference', to: [{ type: 'drop' }] }),
    defineField({ name: 'animeStrip',  type: 'array', of: [{ type: 'string' }],
      description: 'Anime franchise slugs to surface as quick-shop tiles' }),
    defineField({ name: 'featuredProducts', type: 'array', of: [{ type: 'reference', to: [{ type: 'product' }] }] }),
    defineField({ name: 'pickupCallout', type: 'reference', to: [{ type: 'boutique' }] }),
    defineField({ name: 'journalPreview', type: 'array', of: [{ type: 'reference', to: [{ type: 'post' }] }] }),
    defineField({ name: 'founderLines',  type: 'array', of: [{ type: 'reference', to: [{ type: 'founderLine' }] }] }),
  ],
})
```

### B.6 Shared object types

```ts
export const hero = defineType({ name: 'hero', type: 'object', fields: [
  { name: 'eyebrow', type: 'string' },
  { name: 'headline', type: 'string' },
  { name: 'sub', type: 'text' },
  { name: 'media', type: 'media' },
  { name: 'cta', type: 'cta' },
  { name: 'tone', type: 'string', options: { list: ['washi','indigo','torii','seigaiha-red'] } },
]})

export const media = defineType({ name: 'media', type: 'object', fields: [
  { name: 'asset', type: 'image', options: { hotspot: true } },
  { name: 'alt', type: 'string', validation: r => r.required() },
  { name: 'video', type: 'file', options: { accept: 'video/mp4' } },
  { name: 'aspect', type: 'string', options: { list: ['1:1','4:5','3:4','16:9','free'] } },
]})

export const cta = defineType({ name: 'cta', type: 'object', fields: [
  { name: 'label', type: 'string' },
  { name: 'href', type: 'string' },
  { name: 'variant', type: 'string', options: { list: ['solid','outline','ghost','link'] } },
]})

export const seo = defineType({ name: 'seo', type: 'object', fields: [
  { name: 'title', type: 'string' },
  { name: 'description', type: 'text' },
  { name: 'ogImage', type: 'image' },
  { name: 'noindex', type: 'boolean', initialValue: false },
]})
```

---

## C. Glstore product modelling

We do not re-implement Glstore product structure. Instead, agree on
conventions for what already exists:

- **Tags** — drop slug (`drop:ramadan-26`), anime
  (`anime:jujutsu-kaisen`), character (`character:gojo`), material
  (`material:cotton`), capsule (`capsule:limited`),
  `fulfilment:pickup_only` for in-store-only accessories.
- **Side-fields** — only when needed (e.g. `shinobi.fitNotes`,
  `shinobi.printableOnPickup`).
- **Collections** — keep as navigation tools; do not encode drop
  state.

The CMS overlay joins on `glstoreHandle`.

---

## D. Webhook flow

```
Glstore FastAPI (product/inventory/order created/updated)
        ↓ webhook
apps/web /api/webhooks/glstore
        ↓ verify HMAC
        ↓ enqueue work
Workers (Vercel cron / Upstash QStash):
        ↓ revalidateTag('prod_{handle}')
        ↓ update Algolia index
        ↓ on order paid → reviews invite job
        ↓ on stock = 0 → set Drop variant sold_out
        ↓ on custom order paid → transition CustomOrder DRAFT/IN_CART → CONFIRMED
```

Sanity webhooks revalidate the matching CMS-tagged routes.

---

## E. Common queries (illustrative)

```ts
// The current drop for the homepage
await prisma.drop.findFirst({
  where: { state: 'LIVE' },
  orderBy: { scheduledStart: 'desc' },
})

// Save a Custom Builder configuration as a public quote
const co = await prisma.customOrder.create({
  data: {
    baseKind: 'TSHIRT', baseId, designId, doubleSide,
    size, colour, notes,
    quotedPrice: quoteCustom(cfg, bases),
    publicQuoteId: nanoid(10),
    state: 'QUOTE',
  },
})

// PLP avg-rating overlay (single query per page, cached)
await prisma.review.groupBy({
  by: ['productHandle'],
  _avg: { rating: true },
  _count: true,
  where: { status: 'APPROVED', productHandle: { in: handles } },
})

// Print queue (one query)
await prisma.customOrder.groupBy({
  by: ['baseKind', 'designId', 'colour', 'size', 'doubleSide'],
  where: { state: { in: ['CONFIRMED', 'PRINTED'] } },
  _count: { _all: true },
})
```

---

## F. Glossary of joined IDs

| Reference | Where it lives | Used by |
|---|---|---|
| `glstoreHandle` (e.g. `gojo-tee-bw`) | Glstore | CMS overlay, reviews, search index |
| `variantId` | Glstore | Cart, line items, restock notify |
| `customOrderId` | Postgres | Cart line meta, print queue, order tracking page |
| `dropId` | Postgres + CMS `slug` | Drop state, subscriptions, accents |
| `userId` | Postgres + Glstore customer | Wishlist, loyalty, addresses |
| `orderNumber` | Glstore | `/commande/suivi` lookup |
