# 10 — Data Architecture, Database & CMS Schemas

The system uses **three** data sources, each holding what it is best at:

| System | Owns | Why there |
|---|---|---|
| **Custom commerce backend** (existing) | Products, variants, inventory, orders, customers, the custom checkout, taxes, shipping rates | Already running and tuned for the Algerian market — do not replace. |
| **Sanity (CMS)** | Editorial overlay: home, drops, lookbook, journal, page copy, founder lines, SEO overrides per product/collection | Editor experience, real-time, image pipeline, i18n. |
| **Postgres (Prisma)** | Drops state, drop subscribers, review records (+ media), wishlist sync, loyalty ledger, audit log, magic-link tokens | The things the commerce backend and the CMS won't model well. |

Algolia + Klaviyo are **derived** stores (indices and contact lists)
populated by webhooks; they're not authoritative.

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
  // CMS holds copy + media; we mirror what we need for queries here.
  state           DropState  @default(UPCOMING)
  scheduledStart  DateTime
  scheduledEnd    DateTime?
  productTag      String     // products are tagged with this in the commerce backend
  accentToken     String?    // e.g. "#FE6E00" overriding --purple / --orange per drop
  capacity        Int?       // optional per-drop unit cap, when known
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
  locale    String   @default("en")
  createdAt DateTime @default(now())
  drop      Drop     @relation(fields: [dropId], references: [id], onDelete: Cascade)
  @@index([dropId])
  @@unique([dropId, email])
  @@unique([dropId, phone])
}

// ── Reviews ──────────────────────────────────────────────────────
model Review {
  id              String   @id @default(cuid())
  productHandle   String   // commerce-backend handle is the join key
  variantId       String?
  customerEmail   String
  customerName    String
  rating          Int      // 1..5
  title           String?
  body            String
  photos          ReviewMedia[]
  verifiedBuyer   Boolean  @default(false)
  commerceOrderId String?
  language        String   @default("en")
  status          ReviewStatus @default(PENDING)
  helpfulVotes    Int      @default(0)
  dropId          String?
  drop            Drop?    @relation(fields: [dropId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([productHandle, status])
}
enum ReviewStatus { PENDING APPROVED REJECTED }

model ReviewMedia {
  id        String @id @default(cuid())
  reviewId  String
  url       String
  width     Int?
  height    Int?
  review    Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
}

// ── Wishlist (server-side sync of localStorage when signed in) ───
model Wishlist {
  id        String   @id @default(cuid())
  userId    String   @unique
  items     WishlistItem[]
}
model WishlistItem {
  id           String  @id @default(cuid())
  wishlistId   String
  productHandle String
  variantId    String?
  addedAt      DateTime @default(now())
  wishlist     Wishlist @relation(fields: [wishlistId], references: [id], onDelete: Cascade)
  @@index([wishlistId, productHandle])
}

// ── Auth (magic link) ────────────────────────────────────────────
model MagicLinkToken {
  token     String   @id          // opaque, 32 bytes hex
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
  points      Int      // negative for spend / expiry
  orderId     String?
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
}
model Referral {
  code        String   @id   // "OK-XXXX"
  ownerUserId String
  uses        Int      @default(0)
  createdAt   DateTime @default(now())
}

// ── Notify-me on restock / drop launch ───────────────────────────
model NotifyEvent {
  id           String   @id @default(cuid())
  dropId       String?
  productHandle String?
  variantId    String?
  email        String?
  phone        String?
  status       NotifyStatus @default(PENDING)
  sentAt       DateTime?
  createdAt    DateTime @default(now())
  drop         Drop? @relation(fields: [dropId], references: [id])
  @@index([productHandle, status])
}
enum NotifyStatus { PENDING SENT FAILED }

// ── Audit (admin actions) ────────────────────────────────────────
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String
  entity     String
  entityId   String?
  metadata   Json?
  createdAt  DateTime @default(now())
  @@index([actorId, createdAt])
}
```

### A.1 Why Postgres rather than commerce-backend metafields?

- **Drop state machine** needs scheduled flips and history.
- **Reviews** with media + moderation workflow + RTL languages do not
  fit comfortably as product side-data.
- **Wishlist sync** must merge anonymous (localStorage) and account
  records.
- **Loyalty ledger** must be append-only and auditable.
- All four would otherwise pressure the commerce backend with reads
  it was not designed for.

### A.2 Indexes & invariants

- `Drop.slug` unique → URL invariant.
- `DropSubscription` unique on `(dropId, email)` and `(dropId, phone)`
  to prevent duplicate notifications.
- `Review` has `@@index([productHandle, status])` so PLP avg-rating
  reads are cheap.
- A nightly job purges `MagicLinkToken` rows older than 7 days.

---

## B. CMS schemas (Sanity)

### B.1 Drop document

```ts
// apps/cms/schemas/document/drop.ts
import { defineField, defineType } from 'sanity'

export const drop = defineType({
  name: 'drop',
  type: 'document',
  title: 'Drop',
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
    defineField({ name: 'hero',           type: 'hero' }),
    defineField({ name: 'subtitle',       type: 'string' }),
    defineField({ name: 'story',          type: 'array', of: [{ type: 'block' }, { type: 'media' }] }),
    defineField({ name: 'accentToken',    type: 'string', description: 'CSS colour to override --purple / --orange per drop' }),
    defineField({ name: 'productTag',     type: 'string', description: 'Products tagged with this in the commerce backend' }),
    defineField({ name: 'credits',        type: 'array', of: [{ type: 'string' }] }),
    defineField({ name: 'seo',            type: 'seo' }),
    defineField({ name: 'i18n',           type: 'object', fields: [
      { name: 'fr', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'subtitle', type: 'string' }, { name: 'story', type: 'array', of: [{type:'block'},{type:'media'}] }] },
      { name: 'ar', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'subtitle', type: 'string' }, { name: 'story', type: 'array', of: [{type:'block'},{type:'media'}] }] },
    ]}),
  ],
})
```

### B.2 Product overlay

The commerce backend owns price, inventory, variant SKUs. The CMS overlays:

- Long-form description (rich text, blocks).
- Lookbook references (which chapters this piece appears in).
- Sizing cm table per variant.
- SEO overrides.
- Translation per locale.

```ts
export const productOverlay = defineType({
  name: 'product',
  type: 'document',
  fields: [
    defineField({ name: 'productHandle', type: 'string', validation: r => r.required(), description: 'Join key to the commerce backend' }),
    defineField({ name: 'description',   type: 'array', of: [{ type: 'block' }] }),
    defineField({ name: 'sizing',        type: 'array', of: [{ type: 'object', fields: [
      { name: 'size', type: 'string' },
      { name: 'chestCm', type: 'number' },
      { name: 'lengthCm', type: 'number' },
      { name: 'shoulderCm', type: 'number' },
      { name: 'sleeveCm', type: 'number' },
    ]}]}),
    defineField({ name: 'character',     type: 'string' }), // for anime tagging
    defineField({ name: 'fabric',        type: 'string' }),
    defineField({ name: 'careNotes',     type: 'text' }),
    defineField({ name: 'seo',           type: 'seo' }),
    defineField({ name: 'i18n',          type: 'object' }),
  ],
})
```

### B.3 Lookbook + Chapter

```ts
export const lookbook = defineType({
  name: 'lookbook', type: 'document',
  fields: [
    defineField({ name: 'season',  type: 'string' }),
    defineField({ name: 'slug',    type: 'slug' }),
    defineField({ name: 'cover',   type: 'media' }),
    defineField({ name: 'chapters', type: 'array', of: [{ type: 'reference', to: [{ type: 'chapter' }] }] }),
  ]
})

export const chapter = defineType({
  name: 'chapter', type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string' }),
    defineField({ name: 'slug',  type: 'slug' }),
    defineField({ name: 'blocks', type: 'array', of: [
      { type: 'media' },
      { type: 'object', name: 'pullquote', fields: [{ name: 'text', type: 'text' }] },
      { type: 'object', name: 'productSpot', fields: [
        { name: 'mediaRef', type: 'reference', to: [{ type: 'media' }] },
        { name: 'x', type: 'number', validation: r => r.min(0).max(100) },
        { name: 'y', type: 'number', validation: r => r.min(0).max(100) },
        { name: 'product', type: 'reference', to: [{ type: 'product' }] },
      ]},
    ]}),
    defineField({ name: 'seo', type: 'seo' }),
  ],
})
```

### B.4 Journal post

```ts
export const post = defineType({
  name: 'post', type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string' }),
    defineField({ name: 'slug', type: 'slug', options: { source: 'title' } }),
    defineField({ name: 'publishedAt', type: 'datetime' }),
    defineField({ name: 'excerpt', type: 'text' }),
    defineField({ name: 'cover', type: 'media' }),
    defineField({ name: 'tags', type: 'array', of: [{ type: 'string' }] }),
    defineField({ name: 'body', type: 'array', of: [{ type: 'block' }, { type: 'media' }, { type: 'productSpot' }] }),
    defineField({ name: 'seo', type: 'seo' }),
    defineField({ name: 'i18n', type: 'object' }),
  ],
})
```

### B.5 Home document (singleton)

```ts
export const home = defineType({
  name: 'home', type: 'document', // singleton via Sanity Desk
  fields: [
    defineField({ name: 'hero', type: 'hero' }),
    defineField({ name: 'currentDrop', type: 'reference', to: [{ type: 'drop' }] }),
    defineField({ name: 'featuredProducts', type: 'array', of: [{ type: 'reference', to: [{ type: 'product' }] }] }),
    defineField({ name: 'lookbookStrip', type: 'array', of: [{ type: 'reference', to: [{ type: 'chapter' }] }] }),
    defineField({ name: 'journalPreview', type: 'array', of: [{ type: 'reference', to: [{ type: 'post' }] }] }),
    defineField({ name: 'founderLines',   type: 'array', of: [{ type: 'reference', to: [{ type: 'founderLine' }] }] }),
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
  { name: 'tone', type: 'string', options: { list: ['paper','night','drop'] } },
]})

export const media = defineType({ name: 'media', type: 'object', fields: [
  { name: 'asset', type: 'image', options: { hotspot: true } },
  { name: 'alt',   type: 'string', validation: r => r.required() },
  { name: 'video', type: 'file', options: { accept: 'video/mp4' } },
  { name: 'aspect', type: 'string', options: { list: ['1:1','4:5','3:4','16:9','free'] } },
]})

export const cta = defineType({ name: 'cta', type: 'object', fields: [
  { name: 'label', type: 'string' },
  { name: 'href',  type: 'string' },
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

## C. Commerce-backend product modelling

We do *not* try to re-implement the commerce backend's product
structure. Instead, we agree on conventions for what already exists:

- **Tags** — drop slug (`drop:winter-26`), character (`character:toji`),
  material (`material:cotton`), capsule (`capsule:limited`).
- **Side fields / metafields** — only when truly needed (e.g.
  `okami.fitNotes`, `okami.dropPriority`).
- **Collections** — keep as a navigation tool; do not encode drop
  state in collections.

The CMS overlay joins on `productHandle`.

---

## D. Webhook flow

```
Custom commerce backend
  (product/inventory/order created/updated)
        ↓ webhook
apps/web /api/webhooks/commerce
        ↓ verify HMAC
        ↓ enqueue work
Workers (Vercel cron / Upstash):
        ↓ revalidateTag('prod_{handle}')
        ↓ update Algolia index
        ↓ on order paid → reviews invite job
        ↓ on stock = 0 → set Drop variant sold_out
```

Sanity webhooks revalidate the matching CMS-tagged routes.

---

## E. Common queries (illustrative)

```ts
// Get the current drop for the homepage
await prisma.drop.findFirst({
  where: { state: 'LIVE' },
  orderBy: { scheduledStart: 'desc' },
})

// Subscribe an email to drop notifications
await prisma.dropSubscription.upsert({
  where:  { dropId_email: { dropId, email } },
  create: { dropId, email, locale },
  update: {},
})

// PLP avg-rating overlay (one query per page, cached)
await prisma.review.groupBy({
  by: ['productHandle'],
  _avg: { rating: true },
  _count: true,
  where: { status: 'APPROVED', productHandle: { in: handles } },
})
```

---

## F. Glossary of joined IDs

| Reference | Where it lives | Used by |
|---|---|---|
| `productHandle` (e.g. `toji-hoodie`) | Commerce backend | CMS overlay, reviews, search index |
| `variantId` | Commerce backend | Cart, line items, restock notify |
| `dropId` | Postgres + CMS `slug` | Drop state, subscriptions, accent tokens |
| `userId` | Postgres + commerce-backend customer | Wishlist, loyalty, addresses |
| `orderNumber` | Commerce backend | `/order/track` lookup |
