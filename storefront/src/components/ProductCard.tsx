import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Image as ImageIcon, ArrowUpRight } from 'lucide-react'
import { fmtMoney, categoryIcon } from '@/lib/format'
import { deriveTags } from '@/lib/tags'
import type { ProductListItem } from '@/lib/api'
import { Tag } from './ui'

interface ProductCardProps {
  product: ProductListItem
  /** layout density */
  size?: 'md' | 'lg'
}

export function ProductCard({ product: p, size = 'md' }: ProductCardProps) {
  const tags = deriveTags(p).slice(0, 3)
  const oos = p.available <= 0

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="group relative h-full"
    >
      <Link
        to={`/p/${p.slug}`}
        className="flex flex-col h-full glass overflow-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] outline-none"
      >
        {/* Image */}
        <div className={`zoom-card ${size === 'lg' ? 'aspect-[4/3]' : 'aspect-square'} no-img-placeholder relative`}>
          {p.primary_image ? (
            <img
              src={p.primary_image}
              alt={p.name}
              loading="lazy"
              className="w-full h-full object-contain p-4"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--color-text-3)] gap-2">
              <ImageIcon size={28} className="opacity-30" />
              <span className="text-[10px] uppercase tracking-widest font-bold">{categoryIcon(p.category)} {p.category ?? 'Produit'}</span>
            </div>
          )}

          {/* Top-right hint */}
          <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[var(--color-jet-black)]/70 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowUpRight size={14} className="text-[var(--color-neon-yellow)]" />
          </div>

          {oos && (
            <div className="absolute top-3 left-3">
              <Tag label="Rupture" tone="muted" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-4 flex-1">
          {/* Tag chips */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {tags.map((t, i) => <Tag key={i} label={t.label} tone={t.tone} />)}
            </div>
          )}

          <h3 className="font-bold text-[var(--color-text-1)] text-sm leading-snug line-clamp-2 min-h-[2.5em]">
            {p.name}
          </h3>

          <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2 mt-auto">
            {p.brand && <span className="font-semibold uppercase tracking-wider">{p.brand}</span>}
            {p.category && <span className="opacity-60">· {p.category}</span>}
          </div>

          {/* Price */}
          <div className="flex items-end justify-between gap-2 mt-1">
            <div>
              <div className="num text-lg font-black text-[var(--color-text-1)] leading-none">
                {p.min_price != null ? fmtMoney(p.min_price) : '—'}
              </div>
              {!oos && p.available <= 5 && p.available > 0 && (
                <div className="text-[10px] text-[var(--color-hot-pink)] font-bold mt-1">
                  Plus que {p.available}
                </div>
              )}
            </div>
            <div className="text-[10px] text-[var(--color-electric-blue)] font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
              Voir →
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
