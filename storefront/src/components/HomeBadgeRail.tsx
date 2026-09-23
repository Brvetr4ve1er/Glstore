/**
 * `<HomeBadgeRail />` — a homepage merchandising rail for one `products.badge`
 * value (`GET /products?badge=NEW|BEST_SELLER|PRO|SALE`, migration 008).
 *
 * Parameterized so the orchestrator can drop as many as it wants:
 *   <HomeBadgeRail badge="NEW" title="Nouveautés" />
 *   <HomeBadgeRail badge="BEST_SELLER" title="Meilleures ventes" />
 *
 * `ProductCard` already renders the badge chip itself from `product.badge`
 * (`components/ProductCard.tsx:71-74`), so this component's only job is to
 * fetch the matching products and lay them out — no badge UI here.
 *
 * ── Why this can render nothing ──────────────────────────────────────────
 * `products.badge` is an admin-assigned field with no default, and today
 * (2026-06-20 measurement) zero products in the catalogue have one set. A
 * rail that fetches by badge will therefore almost always resolve to an
 * empty list — until an admin assigns one. Rendering an empty section, a
 * "coming soon" placeholder, or a skeleton that never resolves would look
 * broken for every visitor today, so this component renders `null` for the
 * loading state, the error state and the zero-items state alike: only a
 * non-empty result ever produces visible markup. An admin assigning this
 * badge to a product is what turns the rail on.
 */
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { fetchProducts } from '@/lib/api'
import { ProductCard, type ProductBadge } from './ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from './ScrollReveal'

interface HomeBadgeRailProps {
  /** `products.badge` value to filter on. */
  badge: ProductBadge
  /** Section heading, e.g. "Nouveautés". */
  title: string
}

export function HomeBadgeRail({ badge, title }: HomeBadgeRailProps) {
  const { data, isSuccess } = useQuery({
    queryKey: ['home-badge-rail', badge],
    queryFn: () => fetchProducts({ badge, page_size: 8, sort: 'recent' }),
    staleTime: 60_000,
  })

  const items = data?.items ?? []

  // Loading, error and "resolved to zero" all render nothing — see header.
  if (!isSuccess || items.length === 0) return null

  return (
    <section className="max-w-[1400px] mx-auto px-6 mb-16">
      <ScrollReveal variant="fade-up-sm">
        <div className="mb-6">
          <h2 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
            <span className="punk-stripe">{title}</span>
          </h2>
        </div>
      </ScrollReveal>

      <motion.div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.05 }}
      >
        {items.map((p) => (
          <motion.div key={p.id} variants={STAGGER_ITEM}>
            <ProductCard product={p} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
