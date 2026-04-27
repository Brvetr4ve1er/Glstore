import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ImageIcon, Pencil, Sparkles, Globe, Images } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchProduct, enrichProduct, enqueueIntel, fetchIntelJob } from '@/lib/api'
import { Badge, Button, Card, Spinner, EmptyState } from '@/components/ui'
import { IssuePanel } from '@/components/IssuePanel'
import { PRODUCT_STATUS_COLORS, fmtMoney, fmtDate, fmtPercent } from '@/lib/utils'
import { useState } from 'react'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const [activeImg, setActiveImg] = useState(0)
  const qc = useQueryClient()

  const { data: p, isPending, isError } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id!),
    enabled: !!id,
  })

  const enrichMut = useMutation({
    mutationFn: () => enrichProduct(id!),
    onSuccess: (r) => {
      const delta = (r.completeness_after - r.completeness_before) * 100
      const sign = delta >= 0 ? '+' : ''
      toast.success(`Enriched · status ${r.status_after} · completeness ${sign}${delta.toFixed(0)}%`)
      qc.invalidateQueries({ queryKey: ['product', id] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Full Intel = scrape web + LLM extract + merge. Background job, polled here.
  const intelMut = useMutation({
    mutationFn: async () => {
      const t = toast.loading('Lancement de la recherche web…')
      try {
        const enq = await enqueueIntel(id!, false)
        toast.loading(`Job ${enq.job_id.slice(0, 8)} en cours…`, { id: t })
        const deadline = Date.now() + 180_000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2500))
          const job = await fetchIntelJob(enq.job_id)
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
            toast.dismiss(t)
            return job
          }
          if (job.status === 'RUNNING') {
            toast.loading('Scrape + LLM en cours… (~30-90s)', { id: t })
          }
        }
        toast.dismiss(t)
        throw new Error('Timeout (3 min). Voir Jobs Console.')
      } catch (e) {
        toast.dismiss(t)
        throw e
      }
    },
    onSuccess: (job) => {
      if (job.status !== 'COMPLETED') {
        toast.error(job.error_message ?? `Intel ${job.status.toLowerCase()}`)
        return
      }
      const delta = ((job.completeness_after ?? 0) - (job.completeness_before ?? 0)) * 100
      const sign = delta >= 0 ? '+' : ''
      const fields = (job.fields_filled || []).join(', ') || 'aucun champ'
      toast.success(
        `Full Intel ✓ · ${fields} · ${job.images_added} image(s) · ${sign}${delta.toFixed(0)}% complétude`,
        { duration: 6000 },
      )
      qc.invalidateQueries({ queryKey: ['product', id] })
      qc.invalidateQueries({ queryKey: ['product-issues', id] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isPending) return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={28} className="text-[var(--color-brand)]" />
    </div>
  )

  if (isError || !p) return (
    <EmptyState title="Product not found" action={<Link to="/products" className="text-sm text-[var(--color-brand)] hover:underline">← Back to products</Link>} />
  )

  const images = p.media.filter(m => m.kind === 'image')
  const heroImg = images[activeImg]?.url ?? images[0]?.url

  return (
    <div className="flex flex-col gap-6 page-enter">
      {/* Back + Actions */}
      <div className="flex items-center justify-between gap-4">
        <Link to="/products" className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] transition-colors w-fit">
          <ArrowLeft size={14} /> Back to Products
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            loading={enrichMut.isPending}
            onClick={() => enrichMut.mutate()}
            title="Rule-engine: regex on the product name. Free, instant, no network."
          >
            <Sparkles size={13} /> Enrich (rules)
          </Button>
          <Button
            variant="accent"
            size="sm"
            loading={intelMut.isPending}
            onClick={() => intelMut.mutate()}
            title="Full Intel: scrape web + LLM + merge. Fills brand/category/specs/description/images. ~30-90s."
          >
            <Globe size={13} /> Full Intel
          </Button>
          <Link to={`/products/${id}/images`}>
            <Button variant="outline" size="sm">
              <Images size={13} /> Validate images
            </Button>
          </Link>
          <Link to={`/products/${id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil size={13} /> Edit product
            </Button>
          </Link>
        </div>
      </div>

      {/* Catalog quality / issues panel */}
      <IssuePanel productId={p.id} productName={p.name} />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Images */}
        <div className="flex flex-col gap-3">
          <div className="glass aspect-square flex items-center justify-center overflow-hidden rounded-2xl">
            {heroImg
              ? <img src={heroImg} alt={p.name} className="w-full h-full object-contain p-4" />
              : <div className="flex flex-col items-center gap-2 opacity-20">
                  <ImageIcon size={48} />
                  <span className="text-xs">No image</span>
                </div>
            }
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${i === activeImg ? 'border-[var(--color-brand)]' : 'border-[var(--color-surface-4)] hover:border-[var(--color-surface-3)]'}`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h1 className="text-xl font-bold text-[var(--color-text-1)] leading-tight">{p.name}</h1>
                {p.model && <div className="text-sm text-[var(--color-text-3)] mt-1">{p.brand} · {p.model}</div>}
              </div>
              <Badge label={p.status} colorClass={PRODUCT_STATUS_COLORS[p.status]} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                ['SKU', <span className="num text-xs">{p.sku}</span>],
                ['Category', p.category ?? '—'],
                ['Subcategory', p.subcategory ?? '—'],
                ['Completeness', (
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-[var(--color-surface-4)]">
                      <div className="h-full rounded-full"
                        style={{ width: fmtPercent(p.completeness_score), background: p.completeness_score > 0.8 ? 'var(--color-success)' : 'var(--color-warning)' }} />
                    </div>
                    <span className="num text-xs">{fmtPercent(p.completeness_score)}</span>
                  </div>
                )],
                ['Updated', fmtDate(p.updated_at)],
                ['MPN / Barcode', p.mpn ?? p.barcode ?? '—'],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-[var(--color-surface-3)] rounded-xl px-3 py-3">
                  <div className="text-[10px] text-[var(--color-text-3)] uppercase tracking-widest mb-1">{label}</div>
                  <div className="text-[var(--color-text-1)] text-sm font-medium">{val}</div>
                </div>
              ))}
            </div>

            {p.description && (
              <p className="mt-4 text-sm text-[var(--color-text-2)] leading-relaxed border-t border-[var(--color-surface-4)] pt-4">
                {p.description}
              </p>
            )}
          </Card>

          {/* Specs */}
          {Object.keys(p.specs).length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-[var(--color-text-2)] mb-3 uppercase tracking-wide">Specs</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {Object.entries(p.specs).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm py-1.5 border-b border-[var(--color-surface-4)]/50">
                    <span className="text-[var(--color-text-3)] text-xs capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-[var(--color-text-1)] font-medium text-xs num">{String(v)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Offers */}
          <Card>
            <h3 className="text-sm font-semibold text-[var(--color-text-2)] mb-3 uppercase tracking-wide">Offers ({p.offers.length})</h3>
            {p.offers.length === 0
              ? <p className="text-sm text-[var(--color-text-3)]">No offers for this product</p>
              : (
                <div className="flex flex-col gap-2">
                  {p.offers.map(o => (
                    <div key={o.id} className="flex items-center justify-between bg-[var(--color-surface-3)] rounded-xl px-4 py-3 gap-4">
                      <div>
                        <div className="text-xs num text-[var(--color-text-2)] mb-1">{o.variant_sku}</div>
                        {Object.keys(o.variant_attrs).length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {Object.entries(o.variant_attrs).map(([k,v]) => (
                              <span key={k} className="badge bg-[var(--color-surface-4)] text-[var(--color-text-3)] text-[10px]">
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="num font-bold text-[var(--color-text-1)]">{fmtMoney(o.sale_price ?? o.retail_price)}</div>
                        {o.sale_price && <div className="num text-xs text-[var(--color-text-3)] line-through">{fmtMoney(o.retail_price)}</div>}
                        <div className={`text-[10px] mt-1 ${o.available > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {o.available > 0 ? `${o.available} available` : 'Out of stock'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </Card>
        </div>
      </div>
    </div>
  )
}
