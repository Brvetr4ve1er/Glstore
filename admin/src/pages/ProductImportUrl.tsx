/**
 * URL import panel — paste a product link, scrape it, review the extracted
 * draft, then commit it as a real product (+ offer + images).
 *
 * Rendered inside ProductImport.tsx under the "From URL" mode.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Globe, Sparkles, CheckCircle2, ChevronRight, ImageOff, ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  previewUrlImport, commitUrlImport,
  type UrlImportDraft, type UrlImportCommitResult,
} from '@/lib/api'
import { Button, Card, Input, Textarea, Spinner } from '@/components/ui'

type Stage = 'idle' | 'scraping' | 'review' | 'committing' | 'done'

const METHOD_LABEL: Record<string, string> = {
  json_ld: 'JSON-LD (schema.org)',
  microdata: 'Microdata',
  opengraph: 'OpenGraph tags',
  domain_specific: 'Site-specific parser',
  css_heuristic: 'CSS heuristic',
  llm_fallback: 'LLM fallback',
}

export function UrlImportPanel() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [draft, setDraft] = useState<UrlImportDraft | null>(null)
  const [publish, setPublish] = useState(true)
  const [stock, setStock] = useState(0)
  const [result, setResult] = useState<UrlImportCommitResult | null>(null)

  const scrapeMut = useMutation({
    mutationFn: (u: string) => previewUrlImport(u),
    onMutate: () => setStage('scraping'),
    onSuccess: ({ draft }) => { setDraft(draft); setStage('review') },
    onError: (e: Error) => { toast.error(e.message); setStage('idle') },
  })

  const commitMut = useMutation({
    mutationFn: (d: UrlImportDraft) =>
      commitUrlImport(d, { publish, default_stock: stock }),
    onMutate: () => setStage('committing'),
    onSuccess: (r) => {
      setResult(r); setStage('done')
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(`"${r.name}" added to the catalog`)
    },
    onError: (e: Error) => { toast.error(e.message); setStage('review') },
  })

  const reset = () => {
    setUrl(''); setDraft(null); setResult(null); setStage('idle')
    setPublish(true); setStock(0)
  }

  const patch = (p: Partial<UrlImportDraft>) =>
    setDraft(d => (d ? { ...d, ...p } : d))

  // ── Done ──
  if (stage === 'done' && result) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="flex flex-col items-center text-center gap-4 py-10">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-black text-[var(--color-text-1)]">Product imported</h2>
            <p className="text-sm text-[var(--color-text-3)]">
              {result.name} · {result.published ? 'live in store' : 'saved as draft'}
              {result.offer_created ? ' · price set' : ' · no price found'}
              {result.images_added > 0 ? ` · ${result.images_added} image${result.images_added > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Button variant="ghost" onClick={reset}>Import another</Button>
            <Button variant="accent" onClick={() => navigate(`/products/${result.product_id}`)}>
              View product <ChevronRight size={15} />
            </Button>
          </div>
        </Card>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* URL input */}
      <Card>
        <form
          onSubmit={e => { e.preventDefault(); if (url.trim()) scrapeMut.mutate(url.trim()) }}
          className="flex flex-col gap-3"
        >
          <label className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em]">
            Product page URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus-within:border-[var(--color-electric-blue)]">
              <Globe size={15} className="text-[var(--color-text-3)] shrink-0" />
              <input
                type="url"
                required
                placeholder="https://store.example.com/product/…"
                value={url}
                onChange={e => setUrl(e.target.value)}
                disabled={stage === 'scraping'}
                className="flex-1 bg-transparent py-2.5 text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] focus:outline-none"
              />
            </div>
            <Button type="submit" variant="accent" loading={stage === 'scraping'} disabled={stage === 'scraping' || !url.trim()}>
              {stage === 'scraping' ? 'Scraping…' : <><Sparkles size={15} /> Scrape</>}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--color-text-3)]">
            Works on any site that exposes product data (JSON-LD, microdata, or OpenGraph) — most modern stores do.
          </p>
        </form>
      </Card>

      {stage === 'scraping' && (
        <Card>
          <div className="flex items-center gap-3 py-6">
            <Spinner size={20} className="text-[var(--color-electric-blue)]" />
            <div>
              <div className="font-semibold text-[var(--color-text-1)]">Fetching & extracting…</div>
              <div className="text-xs text-[var(--color-text-3)]">Escalating http → browser → stealth if the page is protected.</div>
            </div>
          </div>
        </Card>
      )}

      {/* Review draft */}
      {(stage === 'review' || stage === 'committing') && draft && (
        <motion.div className="flex flex-col gap-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* Provenance chip */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="badge bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30">
              {METHOD_LABEL[draft.method] ?? draft.method}
            </span>
            <ConfidenceChip value={draft.confidence} />
            <a href={draft.source_url} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] truncate max-w-[340px]">
              <ExternalLink size={11} /> {draft.source_url}
            </a>
          </div>

          {draft.notes.length > 0 && (
            <div className="text-[11px] text-[var(--color-neon-yellow)] flex flex-col gap-0.5">
              {draft.notes.map((n, i) => <span key={i}>• {n}</span>)}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            {/* Editable fields */}
            <Card>
              <div className="flex flex-col gap-3">
                <Input label="Name" value={draft.name ?? ''} onChange={e => patch({ name: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Brand" value={draft.brand ?? ''} onChange={e => patch({ brand: e.target.value })} />
                  <Input label="SKU" value={draft.sku} onChange={e => patch({ sku: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Category" placeholder="e.g. Laptops" value={draft.category ?? ''} onChange={e => patch({ category: e.target.value })} />
                  <Input
                    label={`Price (${draft.currency})`}
                    type="number"
                    value={draft.price ?? ''}
                    onChange={e => patch({ price: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </div>
                <Textarea label="Description" rows={4} value={draft.description ?? ''} onChange={e => patch({ description: e.target.value })} />

                {Object.keys(draft.specs).length > 0 && (
                  <details className="group">
                    <summary className="text-[11px] text-[var(--color-text-3)] cursor-pointer hover:text-[var(--color-text-2)]">
                      {Object.keys(draft.specs).length} extracted spec(s)
                    </summary>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      {Object.entries(draft.specs).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-[var(--color-surface-4)]/30 py-1">
                          <span className="text-[var(--color-text-3)] font-mono truncate">{k}</span>
                          <span className="text-[var(--color-text-2)] truncate text-right">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </Card>

            {/* Image + publish options */}
            <div className="flex flex-col gap-4">
              <Card>
                <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-3">
                  Images ({draft.images.length})
                </h3>
                {draft.images.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {draft.images.map((src, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--color-surface-3)] border border-[var(--color-surface-4)]">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        {i === 0 && (
                          <span className="absolute bottom-1 left-1 badge bg-[var(--color-jet-black)]/70 text-white text-[9px]">Primary</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-6 text-[var(--color-text-3)]">
                    <ImageOff size={22} className="opacity-40" />
                    <span className="text-xs">No images found on the page</span>
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-3">
                  Publish
                </h3>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-1)] cursor-pointer mb-3">
                  <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} />
                  Make live in the store now
                </label>
                <Input
                  label="Initial stock"
                  type="number"
                  min={0}
                  value={stock}
                  onChange={e => setStock(Math.max(0, Number(e.target.value) || 0))}
                />
                <p className="text-[11px] text-[var(--color-text-3)] mt-2">
                  {publish
                    ? 'Product will appear in the storefront immediately. Set stock so it is buyable.'
                    : 'Product will be saved as a draft (NORMALIZED) for review.'}
                </p>
              </Card>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 sticky bottom-4">
            <Button variant="ghost" onClick={reset} disabled={stage === 'committing'}>Cancel</Button>
            <Button
              variant="accent"
              size="lg"
              loading={stage === 'committing'}
              disabled={stage === 'committing' || !(draft.name ?? '').trim()}
              onClick={() => commitMut.mutate(draft)}
            >
              <Sparkles size={15} /> Add to store
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}

function ConfidenceChip({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.8
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : value >= 0.5
      ? 'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border-[var(--color-neon-yellow)]/30'
      : 'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border-[var(--color-hot-pink)]/30'
  return <span className={`badge border ${tone}`}>{pct}% confidence</span>
}
