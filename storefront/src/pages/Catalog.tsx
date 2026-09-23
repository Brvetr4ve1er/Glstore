import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, SlidersHorizontal, X as XIcon } from 'lucide-react'
import { fetchProducts, type ProductListItem } from '@/lib/api'
import { categoryIcon, fmtNumber } from '@/lib/format'
import { categoryLabel } from '@/lib/taxonomy'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductCard } from '@/components/ProductCard'
import {
  FilterSidebar,
  EMPTY_FILTERS,
  SANS_MARQUE,
  catalogQueryParams,
  filterProducts,
  type FilterState,
} from '@/components/FilterSidebar'
import { SortMenu, type SortOption } from '@/components/SortMenu'
import { Button, EmptyState } from '@/components/ui'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { SEO } from '@/components/SEO'

const PAGE_SIZE = 24

/** Server maximum (api/routes/products.py:86 `le=120`). */
const MAX_SERVER_PAGE = 120
/** Safety rail on the fetch-everything path. 567 products today. */
const CLIENT_FILTER_CAP = 2000

/**
 * Pull every product matching the SERVER-side facets.
 *
 * Needed because three facets cannot be expressed to the API:
 *   · the category slug  -- every row's `products.category` is the single
 *     value "Electromenager"; the real taxonomy is derived from the product
 *     NAME, client-side (see lib/taxonomy.ts).
 *   · the stock level    -- derived from `available`, not a column.
 *   · "Sans marque"      -- absence of a brand, which `brand=` cannot say.
 *
 * Filtering a single 24-row page client-side would make every count and
 * page number wrong, so when one of those facets is on we fetch the whole
 * matching set and paginate locally. At 567 products that is 5 requests of
 * 120, once, and React Query caches it.
 *
 * This is the honest version of a temporary situation. The durable fix is
 * teaching `api/services/enrichment` the appliance taxonomy so
 * `products.category` becomes authoritative and the server can filter --
 * at which point this whole path collapses back to server pagination.
 */
async function fetchEveryProduct(
  serverParams: Record<string, string | number | undefined>,
): Promise<ProductListItem[]> {
  const out: ProductListItem[] = []
  for (let page = 1; out.length < CLIENT_FILTER_CAP; page++) {
    const res = await fetchProducts({ ...serverParams, page, page_size: MAX_SERVER_PAGE })
    out.push(...res.items)
    if (res.items.length < MAX_SERVER_PAGE || out.length >= res.total) break
  }
  return out
}

export default function Catalog() {
  const { category: rawCat } = useParams<{ category: string }>()
  // /c/:slug carries a TAXONOMY slug ('cuisson'), not a DB category value.
  // Sending it to the API as `category=` matches nothing, because every row
  // is 'Electromenager'. That is what made all 13 category links dead.
  const categorySlug = rawCat && rawCat !== 'all' ? decodeURIComponent(rawCat) : ''
  const categoryTitle = categorySlug ? categoryLabel(categorySlug) : ''

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [sort, setSort]       = useState<SortOption>('recent')
  const [page, setPage]       = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [categorySlug, filters, sort])

  // The URL's category wins over the sidebar's, so /c/cuisson is honoured
  // even when the sidebar has its own selection.
  const effective: FilterState = useMemo(
    () => ({ ...filters, category: categorySlug || filters.category || '' }),
    [filters, categorySlug],
  )

  // Facets the API cannot express. See fetchEveryProduct above.
  const clientOnly =
    Boolean(effective.category) ||
    Boolean(effective.stock) ||
    effective.brand === SANS_MARQUE

  const serverParams = useMemo(
    () => ({ ...catalogQueryParams(effective), sort }),
    [effective, sort],
  )

  const { data, isPending, isError } = useQuery({
    queryKey: ['catalog', serverParams, clientOnly, clientOnly ? 'all' : page],
    queryFn: async () => {
      if (clientOnly) {
        const all = await fetchEveryProduct(serverParams)
        return { items: all, total: all.length }
      }
      return fetchProducts({ ...serverParams, page, page_size: PAGE_SIZE })
    },
    placeholderData: keepPreviousData,
  })

  // When a client-only facet is on we hold the whole matching set, so the
  // filter, the count and the pager all agree. Otherwise the server already
  // narrowed and paginated, and re-filtering here would double-apply.
  const { items, total } = useMemo(() => {
    const fetched = data?.items ?? []
    if (!clientOnly) return { items: fetched, total: data?.total ?? 0 }
    const matched = filterProducts(fetched, effective)
    const start = (page - 1) * PAGE_SIZE
    return { items: matched.slice(start, start + PAGE_SIZE), total: matched.length }
  }, [data, clientOnly, effective, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO
        title={categoryTitle || 'Catalogue'}
        description={
          categoryTitle
            ? `${categoryTitle} : tout le rayon disponible en Algérie. Livraison dans les 58 wilayas, paiement à la livraison.`
            : 'Le catalogue complet : électroménager, cuisson, froid, lavage, petit déjeuner et plus.'
        }
      />
      <Breadcrumbs items={[
        { to: '/c/all', label: 'Catalogue' },
        ...(categoryTitle ? [{ label: categoryTitle }] : []),
      ]} />

      {/* Title row */}
      <div className="mt-4 mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)] flex items-center gap-3">
            {categorySlug && <span className="text-2xl">{categoryIcon(categorySlug)}</span>}
            <span className="punk-stripe">{categoryTitle || 'Tous les produits'}</span>
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
