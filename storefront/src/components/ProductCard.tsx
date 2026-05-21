/**
 * Floema-style product card — editorial: a paper-alt tile with a large
 * product photo on top, a small collection pill, and an ink-coloured
 * title + price stacked below. No box-shadow; hover swaps the tile to
 * a darker paper tone and slowly nudges the image.
 */

import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Image as ImageIcon } from 'lucide-react'
import { fmtMoney } from '@/lib/format'
import type { ProductListItem } from '@/lib/api'

interface ProductCardProps {
  product: ProductListItem
  size?: 'md' | 'lg'
}

/** Map our product category onto the Floema collection accent tones. */
function toneFor(p: ProductListItem): string {
  const c = (p.category ?? '').toLowerCase()
  if (c.includes('laptop') || c.includes('desktop'))   return 'replastic'
  if (c.includes('headphone') || c.includes('earbud') || c.includes('speaker') || c.includes('audio')) return 'nature'
  if (c.includes('keyboard') || c.includes('mouse') || c.includes('monitor') || c.includes('console')) return 'urban'
  if (c.includes('smart') || c.includes('network'))     return 'golf'
  if (c.includes('wearable'))                           return 'citron'
  return 'details'
}

export function ProductCard({ product: p, size = 'md' }: ProductCardProps) {
  const oos = p.available <= 0
  const tone = toneFor(p)
  const collectionLabel = p.category ?? 'Product'

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'tween', duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
      className="group h-full"
    >
      <Link
        to={`/p/${p.slug}`}
        className="flex flex-col h-full fl-card focus-visible:outline outline-2 outline-[var(--color-jet-black)]"
      >
        {/* Image */}
        <div className={`zoom-card ${size === 'lg' ? 'aspect-[4/3]' : 'aspect-square'} relative overflow-hidden`}>
          {p.primary_image ? (
            <img
              src={p.primary_image}
              alt={p.name}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full no-img-placeholder flex flex-col items-center justify-center text-[var(--color-text-3)] gap-2">
              <ImageIcon size={28} className="opacity-30" />
              <span className="text-[10px] uppercase tracking-widest font-semibold">{collectionLabel}</span>
            </div>
          )}

          <div className="absolute top-3 left-3">
            <span className="fl-pill" data-tone={tone}>{collectionLabel}</span>
          </div>

          {oos && (
            <div className="absolute top-3 right-3">
              <span className="fl-pill" data-tone="ghost">Sold out</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-5 flex-1">
          {p.brand && (
            <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-[var(--color-text-3)]">
              {p.brand}
            </div>
          )}

          <h3 className="font-display text-[20px] leading-[1.1] text-[var(--color-jet-black)] line-clamp-2 min-h-[2.2em]">
            {p.name}
          </h3>

          <div className="flex items-end justify-between gap-2 mt-auto pt-3">
            <div className="num text-[16px] font-semibold text-[var(--color-jet-black)]">
              {p.min_price != null ? fmtMoney(p.min_price) : '—'}
            </div>
            {!oos && p.available <= 5 && p.available > 0 && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-hot-pink)]">
                Only {p.available} left
              </div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
