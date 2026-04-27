import { useState, useRef, useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, SlidersHorizontal, Image as ImageIcon, Plus, Upload, Sparkles, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchProducts, enrichAll, type ProductListItem } from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner, Select } from '@/components/ui'
import { fmtMoney, fmtPercent } from '@/lib/utils'

const PAGE_SIZE = 100

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [q, setQ]           = useState('')
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [page, setPage]     = useState(1)
  const parentRef           = useRef<HTMLDivElement>(null)
  const qc                  = useQueryClient()

  // Sync URL ?status=… ↔ statusFilter so Dashboard deep-links work and refresh keeps state.
  useEffect(() => {
    const sp = new URLSearchParams(searchParams)
    if (statusFilter) sp.set('status', statusFilter)
    else sp.delete('status')
    if (sp.toString() !== searchParams.toString()) setSearchParams(sp, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const { data, isPending, isError } = useQuery({
    queryKey: ['products', q, category, statusFilter, page],
    queryFn: () => fetchProducts({
      ...(q ? { q } : {}),
      ...(category ? { category } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      page, page_size: PAGE_SIZE,
    }),
    placeholderData: prev => prev,
  })

  const enrichAllMut = useMutation({
    mutationFn: () => enrichAll(['RAW', 'NORMALIZED', 'NEEDS_FIX']),
    onSuccess: (r) => {
      const delta = ((r.avg_completeness_after - r.avg_completeness_before) * 100).toFixed(1)
      const sign = (r.avg_completeness_after - r.avg_completeness_before) >= 0 ? '+' : ''
      toast.success(`Enriched ${r.enriched} products · avg completeness ${sign}${delta}%`)
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['enrichment-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const items: ProductListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Virtualized rows
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value)
    setPage(1)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Products"
        sub={total ? `${total.toLocaleString()} items` : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="md"
              loading={enrichAllMut.isPending}
              onClick={() => enrichAllMut.mutate()}
              title="Run rule-based enrichment on RAW / NORMALIZED / NEEDS_FIX rows"
            >
              <Sparkles size={14} /> Enrich all
            </Button>
            <Link to="/products/import">
              <Button variant="outline" size="md">
                <Upload size={14} /> Import CSV
              </Button>
            </Link>
            <Link to="/products/new">
              <Button variant="accent" size="md">
                <Plus size={15} /> New Product
              </Button>
            </Link>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3" data-aos="fade-up-sm">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] pointer-events-none" />
          <input
            type="search"
            placeholder="Search name, SKU, brand…"
            value={q}
            onChange={handleSearch}
            className="h-10 w-full pl-9 pr-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-brand)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors"
          />
        </div>
        <Select
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(1) }}
          className="w-44"
        >
          <option value="">All categories</option>
          <option value="Smartphone">Smartphone</option>
          <option value="Laptop">Laptop</option>
          <option value="Tablet">Tablet</option>
          <option value="TV">TV</option>
          <option value="Refrigerator">Refrigerator</option>
          <option value="Washing Machine">Washing Machine</option>
          <option value="Audio">Audio</option>
          <option value="Accessory">Accessory</option>
        </Select>
        {/* Status filter chips */}
        <div className="flex items-center gap-1.5">
          <FilterChip
            label="All"
            active={!statusFilter}
            onClick={() => { setStatusFilter(''); setPage(1) }}
          />
          <FilterChip
            label="Needs Fix"
            icon={<AlertTriangle size={11} />}
            active={statusFilter === 'NEEDS_FIX'}
            tone="warning"
            onClick={() => { setStatusFilter('NEEDS_FIX'); setPage(1) }}
          />
          <FilterChip
            label="Verified"
            active={statusFilter === 'VERIFIED'}
            tone="success"
            onClick={() => { setStatusFilter('VERIFIED'); setPage(1) }}
          />
          <FilterChip
            label="Active"
            active={statusFilter === 'ACTIVE'}
            tone="success"
            onClick={() => { setStatusFilter('ACTIVE'); setPage(1) }}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
          <SlidersHorizontal size={13} />
          <span>{isPending ? '…' : total.toLocaleString()} results</span>
        </div>
      </div>

      {/* Table wrapper — virtualized */}
      <div className="glass overflow-hidden" data-aos="fade-up-sm" data-aos-delay="60">
        {/* Header */}
        <div className="grid items-center text-[10px] text-[var(--color-text-3)] uppercase tracking-widest font-semibold px-4 py-2.5 border-b border-[var(--color-surface-4)]"
          style={{ gridTemplateColumns: '40px 1fr 110px 90px 80px 90px 80px' }}>
          <span></span>
          <span>Name / SKU</span>
          <span>Brand</span>
          <span>Category</span>
          <span>Status</span>
          <span className="text-right">Min Price</span>
          <span className="text-right">Complete</span>
        </div>

        {isPending && items.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Spinner size={24} className="text-[var(--color-brand)]" />
          </div>
        ) : isError ? (
          <EmptyState title="Failed to load products" desc="Check the API connection" />
        ) : items.length === 0 ? (
          <EmptyState title="No products found" desc="Try a different search or category" />
        ) : (
          <div ref={parentRef} style={{ height: 'min(600px, 60vh)', overflowY: 'auto' }}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vr => {
                const p = items[vr.index]
                return (
                  <div
                    key={vr.key}
                    style={{ position: 'absolute', top: vr.start, left: 0, right: 0, height: vr.size, display: 'grid', gridTemplateColumns: '40px 1fr 110px 90px 80px 90px 80px', alignItems: 'center', paddingLeft: '1rem', paddingRight: '1rem' }}
                    className="tr-hover border-b border-[var(--color-surface-4)]/40 text-sm"
                  >
                    <div className="contents">
                      {/* Thumb */}
                      <div className="flex items-center">
                        {p.primary_image
                          ? <img src={p.primary_image} alt="" className="w-8 h-8 rounded-md object-cover bg-[var(--color-surface-3)]" loading="lazy" />
                          : <div className="w-8 h-8 rounded-md bg-[var(--color-surface-3)] flex items-center justify-center">
                              <ImageIcon size={12} className="text-[var(--color-text-3)]" />
                            </div>
                        }
                      </div>
                      {/* Name */}
                      <div className="min-w-0 pr-3">
                        <Link to={`/products/${p.id}`} className="text-[var(--color-text-1)] font-medium hover:text-[var(--color-brand)] truncate block text-sm leading-tight">
                          {p.name}
                        </Link>
                        <span className="text-[10px] font-mono text-[var(--color-text-3)]">{p.sku}</span>
                      </div>
                      {/* Brand */}
                      <span className="text-xs text-[var(--color-text-2)] truncate pr-2">{p.brand ?? '—'}</span>
                      {/* Category */}
                      <span className="text-xs text-[var(--color-text-3)] truncate pr-2">{p.category ?? '—'}</span>
                      {/* Status — not in list item, use available */}
                      <span className={`badge text-[10px] justify-self-start ${p.available > 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' : 'bg-red-500/15 text-red-400 border border-red-500/25'}`}>
                        {p.available > 0 ? `${p.available} left` : 'OOS'}
                      </span>
                      {/* Price */}
                      <span className="num text-xs text-right font-medium text-[var(--color-text-1)] pr-2">
                        {fmtMoney(p.min_price ?? undefined)}
                      </span>
                      {/* Completeness */}
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-[var(--color-surface-4)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: fmtPercent(p.completeness_score),
                              background: p.completeness_score > 0.8 ? 'var(--color-success)' : p.completeness_score > 0.5 ? 'var(--color-warning)' : 'var(--color-danger)',
                            }}
                          />
                        </div>
                        <span className="num text-[10px] text-[var(--color-text-3)] w-8 text-right">
                          {fmtPercent(p.completeness_score)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm" data-aos="fade-up-sm" data-aos-delay="100">
          <span className="text-xs text-[var(--color-text-3)]">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-surface-4)] text-[var(--color-text-2)] hover:border-[var(--color-brand)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-surface-4)] text-[var(--color-text-2)] hover:border-[var(--color-brand)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── FilterChip ──────────────────────────────────────────────
function FilterChip({
  label, active, onClick, icon, tone,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  tone?: 'warning' | 'success'
}) {
  const base = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all'

  let palette: string
  if (active) {
    if (tone === 'warning') {
      palette = 'bg-[var(--color-neon-yellow)]/20 border-[var(--color-neon-yellow)]/50 text-[var(--color-neon-yellow)]'
    } else if (tone === 'success') {
      palette = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
    } else {
      palette = 'bg-[var(--color-electric-blue)]/20 border-[var(--color-electric-blue)]/50 text-[var(--color-electric-blue)]'
    }
  } else {
    palette = 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:border-[var(--color-electric-blue)]/40 hover:text-[var(--color-text-2)]'
  }

  return (
    <button onClick={onClick} className={`${base} ${palette}`} type="button">
      {icon}
      {label}
    </button>
  )
}
