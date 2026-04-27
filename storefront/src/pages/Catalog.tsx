import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, SlidersHorizontal, X as XIcon } from 'lucide-react'
import { fetchProducts } from '@/lib/api'
import { categoryIcon, fmtNumber } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductCard } from '@/components/ProductCard'
import { FilterSidebar, EMPTY_FILTERS, type FilterState } from '@/components/FilterSidebar'
import { SortMenu, type SortOption } from '@/components/SortMenu'
import { Button, EmptyState } from '@/components/ui'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { SEO } from '@/components/SEO'

const PAGE_SIZE = 24

export default function Catalog() {
  const { category: rawCat } = useParams<{ category: string }>()
  const category = rawCat && rawCat !== 'all' ? decodeURIComponent(rawCat) : ''

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [sort, setSort]       = useState<SortOption>('recent')
  const [page, setPage]       = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [category, filters, sort])

  const params = useMemo(() => ({
    ...(category    ? { category } : {}),
    ...(filters.brand ? { brand: filters.brand } : {}),
    ...(filters.inStockOnly ? { in_stock: 'true' } : {}),
    ...(filters.priceMin != null ? { price_min: filters.priceMin } : {}),
    ...(filters.priceMax != null ? { price_max: filters.priceMax } : {}),
    sort,
    page, page_size: PAGE_SIZE,
  }), [category, filters, sort, page])

  const { data, isPending, isError } = useQuery({
    queryKey: ['catalog', category, filters, sort, page],
    queryFn: () => fetchProducts(params),
    placeholderData: keepPreviousData,
  })

  // Backend is canonical — no client-side filtering or sorting.
  const items = data?.items ?? []

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO
        title={category ? `${category}` : 'Catalogue'}
        description={
          category
            ? `Tous les ${category.toLowerCase()} disponibles en Algérie. Livraison 48h, paiement à la livraison.`
            : 'Le catalogue complet : électroménager, smartphones, TV, audio, accessoires.'
        }
      />
      <Breadcrumbs items={[
        { to: '/c/all', label: 'Catalogue' },
        ...(category ? [{ label: category }] : []),
      ]} />

      {/* Title row */}
      <div className="mt-4 mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)] flex items-center gap-3">
            {category && <span className="text-2xl">{categoryIcon(category)}</span>}
            <span className="punk-stripe">{category || 'Tous les produits'}</span>
          </h1>
          {!isPending && (
            <p className="text-sm text-[var(--color-text-3)] mt-1.5">
              <span className="num font-bold text-[var(--color-text-1)]">{fmtNumber(total)}</span>{' '}
              produit{total !== 1 ? 's' : ''}
              {filters.brand && <> · marque <span className="text-[var(--color-electric-blue)]">{filters.brand}</span></>}
            </p>
          )}
        </div>

        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[var(--color-surface-4)] text-sm font-bold text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)]"
          >
            <SlidersHorizontal size={14} /> Filtres
          </button>
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        <FilterSidebar state={filters} onChange={setFilters} />

        <div>
          {/* Active filter chips */}
          {(filters.brand || filters.inStockOnly || filters.priceMin != null || filters.priceMax != null) && (
            <div className="flex flex-wrap gap-2 mb-4">
              {filters.brand && (
                <FilterChip label={`Marque: ${filters.brand}`} onClear={() => setFilters(f => ({ ...f, brand: '' }))} />
              )}
              {filters.inStockOnly && (
                <FilterChip label="En stock" onClear={() => setFilters(f => ({ ...f, inStockOnly: false }))} />
              )}
              {(filters.priceMin != null || filters.priceMax != null) && (
                <FilterChip
                  label={`Prix ${filters.priceMin ?? '?'} – ${filters.priceMax ?? '?'}`}
                  onClear={() => setFilters(f => ({ ...f, priceMin: null, priceMax: null }))}
                />
              )}
            </div>
          )}

          {isPending ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] shimmer rounded-2xl" />
              ))}
            </div>
          ) : isError ? (
            <EmptyState title="Erreur" desc="Impossible de charger les produits — vérifiez votre connexion." />
          ) : items.length === 0 ? (
            <EmptyState
              title="Aucun produit ne correspond"
              desc="Essayez de relâcher quelques filtres ou changez de catégorie."
              action={<Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>Réinitialiser les filtres</Button>}
            />
          ) : (
            <ScrollReveal variant="fade-up-sm">
              <motion.div
                className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                variants={STAGGER_CONTAINER}
                initial="hidden"
                animate="show"
              >
                {items.map(p => (
                  <motion.div key={p.id} variants={STAGGER_ITEM}>
                    <ProductCard product={p} />
                  </motion.div>
                ))}
              </motion.div>
            </ScrollReveal>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-10">
              <span className="text-xs text-[var(--color-text-3)]">
                Page <span className="text-[var(--color-text-1)] font-bold">{page}</span> / {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                >
                  <ChevronLeft size={14} /> Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => { setPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                >
                  Suivant <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="lg:hidden fixed top-0 right-0 bottom-0 w-[85vw] max-w-[360px] z-50 glass-strong"
            >
              <FilterSidebar state={filters} onChange={setFilters} drawer onClose={() => setDrawerOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}


function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] text-[11px] font-bold border border-[var(--color-electric-blue)]/30 hover:bg-[var(--color-electric-blue)]/20"
    >
      {label}
      <XIcon size={11} />
    </button>
  )
}
