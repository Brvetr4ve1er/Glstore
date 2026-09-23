/**
 * `<ProductCard />` — a card for a catalogue that has almost no data.
 *
 * Measured against the real 567-product file, not estimated:
 *   · 0% have an image      → the illustration is the primary treatment, not a fallback
 *   · 0% have specs         → `deriveTags()` produces almost nothing here (see below)
 *   · 71.8% have a brand    → 160 cards must say something deliberate instead
 *   · `available` is 1 on 338 products, 2 on 110, 0 on 38
 *
 * Everything below follows from those four numbers.
 *
 * ── Why the tag row is filtered ───────────────────────────────────────────
 * `deriveTags()` (lib/tags.ts) is kept — GLAIVE products carry real specs and
 * it earns its place there. But two of its branches do NOT depend on specs:
 * `tags.ts:41-46` pushes a hot-pink `Plus que N en stock` for `available ≤ 3`,
 * which on this catalogue is 479 of 567 products, sorted to the front by tone
 * priority; and `tags.ts:85-90` pushes the brand as a chip. Rendered as-is the
 * card would state the same stock fact twice and the brand twice.
 *
 * The card now owns stock display, so it filters the inventory chips and the
 * duplicate brand chip out of what it renders. Exact-label matching against
 * `tags.ts`'s own output, not a regex — a spec chip can never collide with it.
 * `tags.ts` itself is untouched; other surfaces keep the full list.
 *
 * ── Why "Faible" is not a `≤ N` threshold ─────────────────────────────────
 * The supplier's own rule is `Quantité en Stock ≤ Stock Minimum`, and
 * `Stock Minimum` is 0 on 566 of 567 rows — which is why their file reports
 * Faible exactly once and Normal 500 times. A stock of 1 is *normal* for this
 * shop, so any absolute threshold invents urgency the merchant never claimed:
 * `≤ 5` (what this card used to do) flags 512 products, `≤ 1` still flags 338.
 *
 * So `LOW_STOCK_AT` defaults to 1 and the low state is rendered **calm** —
 * neutral chip, no pink, no countdown — and `lowStockAt={0}` turns it off
 * entirely. When the API starts exposing the merchant's own `Statut Stock`,
 * pass `stock` explicitly and the derivation steps aside.
 */
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { fmtMoney, NoImageIllustration } from '@/lib/format'
import { deriveTags, type TagTone } from '@/lib/tags'
import type { ProductListItem } from '@/lib/api'
import { Tag } from './ui'

/** Merchandising flag from `products.badge` (db/migrations/008_merchandising.sql). */
export type ProductBadge = 'NEW' | 'BEST_SELLER' | 'PRO' | 'SALE'

/** Stock as a shopper sees it — the three states the supplier file actually has. */
export type StockState = 'normal' | 'faible' | 'rupture'

const BADGE_LABEL: Record<ProductBadge, { label: string; tone: TagTone }> = {
  NEW: { label: 'Nouveau', tone: 'electric' },
  BEST_SELLER: { label: 'Meilleure vente', tone: 'yellow' },
  PRO: { label: 'Pro', tone: 'muted' },
  SALE: { label: 'Promo', tone: 'pink' },
}

const BADGES = Object.keys(BADGE_LABEL) as ProductBadge[]

/**
 * `products.badge` ships in the list payload (`api/routes/products.py:176`) but
 * is not declared on `ProductListItem` yet — `lib/api.ts` belongs to another
 * task. Read through `unknown` rather than intersecting the interface: an
 * intersection would break every call site the day that field lands with a
 * slightly different type.
 */
function readBadge(p: ProductListItem): ProductBadge | null {
  const raw = (p as { badge?: unknown }).badge
  return BADGES.find((b) => b === raw) ?? null
}

/** Below (and including) this quantity the card calls the stock low. See header. */
const LOW_STOCK_AT = 1

function deriveStock(available: number, lowAt: number): StockState {
  if (available <= 0) return 'rupture'
  if (lowAt > 0 && available <= lowAt) return 'faible'
  return 'normal'
}

interface ProductCardProps {
  product: ProductListItem
  /** layout density */
  size?: 'md' | 'lg'
  /**
   * Merchandising flag. Defaults to `product.badge` when the API sends one.
   * Pass `null` to suppress a badge the payload carries.
   */
  badge?: ProductBadge | null
  /**
   * Override the derived stock state — pass the merchant's own `Statut Stock`
   * here once the API exposes it.
   */
  stock?: StockState
  /** Quantity at or below which stock reads "low". `0` disables the state. */
  lowStockAt?: number
}

export function ProductCard({
  product: p,
  size = 'md',
  badge,
  stock,
  lowStockAt = LOW_STOCK_AT,
}: ProductCardProps) {
  // Inventory chips and the brand chip are the card's own job now — see header.
  const inventoryLabels = new Set([`Plus que ${p.available} en stock`, 'Bientôt de retour'])
  const brandLabel = p.brand?.trim().toLowerCase() ?? null
  const tags = deriveTags(p)
    .filter((t) => !inventoryLabels.has(t.label))
    .filter((t) => t.label.toLowerCase() !== brandLabel)
    .slice(0, 3)

  const flag = badge !== undefined ? badge : readBadge(p)
  const state = stock ?? deriveStock(p.available, lowStockAt)
  const oos = state === 'rupture'

  return (
    <motion.div
      whileHover={oos ? undefined : { y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="group relative h-full"
    >
      <Link
        to={`/p/${p.slug}`}
        className="flex flex-col h-full glass overflow-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] outline-none"
      >
        {/* ── Visual slot ──────────────────────────────────────────────
            With no photograph anywhere in the catalogue, the illustration is
            the product's picture. `zoom-card` (cursor: zoom-in) is applied
            only when there is a real image to zoom into. */}
        <div
          className={`relative overflow-hidden ${size === 'lg' ? 'aspect-[4/3]' : 'aspect-square'} ${
            p.primary_image ? 'zoom-card' : ''
          }`}
        >
          <div className={oos ? 'w-full h-full grayscale opacity-50 transition-opacity' : 'w-full h-full'}>
            {p.primary_image ? (
              <img
                src={p.primary_image}
                alt={p.name}
                loading="lazy"
                className="w-full h-full object-contain p-4"
              />
            ) : (
              /* Name, not category: every row in this catalogue is filed under
                 "Electromenager", so the name is the only usable signal. */
              <NoImageIllustration category={p.category} name={p.name} size={size === 'lg' ? 'lg' : 'md'} />
            )}
          </div>

          {/* Merchandising flag — top-left, away from the rupture band. */}
          {flag && (
            <div className="absolute top-3 left-3">
              <Tag label={BADGE_LABEL[flag].label} tone={BADGE_LABEL[flag].tone} />
            </div>
          )}

          {/* Top-right hint */}
          {!oos && (
            <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[var(--color-jet-black)]/70 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowUpRight size={14} className="text-[var(--color-neon-yellow)]" />
            </div>
          )}

          {/* Unavailable: a stated band, not a colour cue. 38 products land here
              and they have to read as closed, while staying openable. */}
          {oos && (
            <div className="absolute inset-x-0 bottom-0 bg-[var(--color-jet-black)]/85 backdrop-blur-sm px-3 py-2 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-2)]">
                Rupture de stock
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-4 flex-1">
          {/* Tag chips — usually empty on this catalogue, by design. */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {tags.map((t, i) => <Tag key={i} label={t.label} tone={t.tone} />)}
            </div>
          )}

          <h3 className="font-bold text-[var(--color-text-1)] text-sm leading-snug line-clamp-2 min-h-[2.5em]">
            {p.name}
          </h3>

          {/* Brand — or the absence of one, said out loud. 160 cards use the
              second branch, so a blank line there would look like a bug. */}
          <div className="text-xs mt-auto">
            {p.brand ? (
              <span className="font-semibold uppercase tracking-wider text-[var(--color-text-3)]">
                {p.brand}
              </span>
            ) : (
              <span className="italic text-[var(--color-text-3)]">Sans marque</span>
            )}
          </div>

          {/* Price + stock state */}
          <div className="flex items-end justify-between gap-2 mt-1">
            <div>
              <div
                className={`num text-lg font-black leading-none ${
                  oos ? 'text-[var(--color-text-3)]' : 'text-[var(--color-text-1)]'
                }`}
              >
                {p.min_price != null ? fmtMoney(p.min_price) : '—'}
              </div>
            </div>

            <StockLine state={state} available={p.available} />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

/**
 * The stock state, in words. Deliberately quiet: the merchant reports 500 of
 * 567 products as Normal, so the card has nothing urgent to say about most of
 * them, and pink is reserved for a real promotion.
 */
function StockLine({ state, available }: { state: StockState; available: number }) {
  if (state === 'rupture') {
    return (
      <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-3)]">
        Indisponible
      </span>
    )
  }

  if (state === 'faible') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-2)]">
        {/* Neutral dot on purpose: this state lands on 338 of 567 cards, and a
            brand accent here would make "stock bas" the grid's loudest signal. */}
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-3)]" />
        {available === 1 ? 'Dernière pièce' : 'Stock limité'}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-3)]">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      En stock
    </span>
  )
}
