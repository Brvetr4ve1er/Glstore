import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchProducts } from '@/lib/api'
import { fmtNumber } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductCard } from '@/components/ProductCard'
import { Button, EmptyState } from '@/components/ui'
import { SearchBox } from '@/components/SearchBox'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { SEO } from '@/components/SEO'

const PAGE_SIZE = 24

export default function SearchResults() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [q])

  const queryParams = useMemo(() => ({
    q, page, page_size: PAGE_SIZE,
  }), [q, page])

  const { data, isPending } = useQuery({
    queryKey: ['search', q, page],
    queryFn: () => fetchProducts(queryParams),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  })

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO
        title={q ? `Recherche : ${q}` : 'Recherche'}
        description={q ? `Résultats pour "${q}" sur Ghir Laffaire.` : undefined}
        noIndex
      />
      <Breadcrumbs items={[{ label: q ? `Recherche : "${q}"` : 'Recherche' }]} />

      <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)] mt-4 mb-2">
        <span className="punk-stripe">Recherche</span>
      </h1>

      {q ? (
        <p className="text-sm text-[var(--color-text-3)] mb-6">
          {!isPending && (
            <>
              <span className="num font-bold text-[var(--color-text-1)]">{fmtNumber(total)}</span>{' '}
              résultat{total !== 1 ? 's' : ''} pour <span className="text-[var(--color-electric-blue)] font-bold">"{q}"</span>
            </>
          )}
        </p>
      ) : (
        <div className="my-12">
          <SearchBox variant="page" />
        </div>
      )}

      {q && isPending && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/4] shimmer rounded-2xl" />)}
        </div>
      )}

      {q && !isPending && (data?.items ?? []).length === 0 && (
        <EmptyState
          title={`Aucun résultat pour "${q}"`}
          desc="Essayez moins de mots-clés ou parcourez les catégories."
        />
      )}

      {q && !isPending && (data?.items ?? []).length > 0 && (
        <ScrollReveal variant="fade-up-sm">
          <motion.div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            variants={STAGGER_CONTAINER}
            initial="hidden"
            animate="show"
          >
            {(data!.items).map(p => (
              <motion.div key={p.id} variants={STAGGER_ITEM}>
                <ProductCard product={p} />
              </motion.div>
            ))}
          </motion.div>
        </ScrollReveal>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-10">
          <span className="text-xs text-[var(--color-text-3)]">
            Page <span className="text-[var(--color-text-1)] font-bold">{page}</span> / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} /> Précédent
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Suivant <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
