/**
 * Per-product issue panel — Phase 3.
 *
 * Renders the list of issues from GET /products/{id}/issues,
 * each with an inline "Fix" affordance that calls the existing
 * PATCH endpoints. Heavy lifts:
 *  - missing_brand   → datalist autocomplete of KNOWN_BRANDS
 *  - missing_category → suggested label from regex detector
 *  - missing_description → quick-edit textarea
 *  - missing_barcode_or_mpn → quick-edit text inputs
 *  - missing_image   → URL-paste form (full upload deferred to Phase 4/5)
 *  - missing_price / no_stock → "Edit offers" deeplink to ProductEditor
 *  - low_specs / low_completeness → "Re-run enrichment" button
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, Sparkles, ChevronDown,
  X as XIcon, Save, ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchProductIssues, fetchBrands, patchProduct, enrichProduct, enqueueIntel, fetchIntelJob,
  type ProductIssue, type IssueSeverity,
} from '@/lib/api'
import { Button, Input, Spinner, Textarea } from '@/components/ui'

interface IssuePanelProps {
  productId: string
  productName: string
}

const ISSUE_LABELS: Record<string, string> = {
  missing_brand:        'Missing brand',
  missing_category:     'Missing or generic category',
  missing_description:  'Description too short',
  missing_image:        'No primary image',
  missing_price:        'No active price',
  no_stock:             'Out of stock',
  missing_barcode_or_mpn: 'No barcode / MPN',
  low_completeness:     'Low completeness',
  low_specs:            'Low spec depth',
}

const SEV_STYLE: Record<IssueSeverity, string> = {
  error:   'border-[var(--color-hot-pink)]/40 bg-[var(--color-hot-pink)]/8',
  warning: 'border-[var(--color-neon-yellow)]/40 bg-[var(--color-neon-yellow)]/8',
  info:    'border-[var(--color-electric-blue)]/30 bg-[var(--color-electric-blue)]/5',
}
const SEV_ICON_COLOR: Record<IssueSeverity, string> = {
  error:   'text-[var(--color-hot-pink)]',
  warning: 'text-[var(--color-neon-yellow)]',
  info:    'text-[var(--color-electric-blue)]',
}
const SEV_ICON: Record<IssueSeverity, React.ComponentType<{ size?: number; className?: string }>> = {
  error: AlertCircle, warning: AlertTriangle, info: Info,
}

export function IssuePanel({ productId, productName }: IssuePanelProps) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['product-issues', productId],
    queryFn: () => fetchProductIssues(productId),
    enabled: !!productId,
  })

  const enrichMut = useMutation({
    mutationFn: () => enrichProduct(productId),
    onSuccess: (r) => {
      const delta = ((r.completeness_after - r.completeness_before) * 100).toFixed(0)
      toast.success(`Enriched · status ${r.status_after} · +${delta}%`)
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isPending) {
    return (
      <div className="glass p-4 flex items-center gap-3">
        <Spinner size={18} className="text-[var(--color-electric-blue)]" />
        <span className="text-sm text-[var(--color-text-3)]">Loading catalog quality checks…</span>
      </div>
    )
  }

  if (!data) return null

  const { issues, summary, completeness_score } = data

  if (issues.length === 0) {
    return (
      <div className="glass p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
          <CheckCircle2 size={20} className="text-emerald-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-[var(--color-text-1)]">Catalog quality: clean ✨</div>
          <div className="text-xs text-[var(--color-text-3)]">
            No outstanding issues. Completeness {Math.round(completeness_score * 100)}%.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--color-hot-pink)]/15 flex items-center justify-center">
            <AlertTriangle size={16} className="text-[var(--color-hot-pink)]" />
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--color-text-1)] uppercase tracking-wide">
              Catalog quality
            </div>
            <div className="text-xs text-[var(--color-text-3)] mt-0.5">
              {summary.error > 0   && <span className="text-[var(--color-hot-pink)] font-bold">{summary.error} errors </span>}
              {summary.warning > 0 && <span className="text-[var(--color-neon-yellow)] font-bold">{summary.warning} warnings </span>}
              {summary.info > 0    && <span className="text-[var(--color-electric-blue)] font-bold">{summary.info} info</span>}
              {' · '}<span>completeness {Math.round(completeness_score * 100)}%</span>
            </div>
          </div>
        </div>
        <Button
          variant="accent" size="sm"
          loading={enrichMut.isPending}
          onClick={() => enrichMut.mutate()}
        >
          <Sparkles size={13} /> Re-enrich
        </Button>
      </div>

      {/* Issue rows */}
      <div className="flex flex-col gap-2">
        {issues.map((issue) => (
          <IssueRow
            key={issue.code}
            productId={productId}
            productName={productName}
            issue={issue}
            isOpen={expanded === issue.code}
            onToggle={() => setExpanded(prev => prev === issue.code ? null : issue.code)}
          />
        ))}
      </div>
    </div>
  )
}


// ── IssueRow ────────────────────────────────────────────────
function IssueRow({
  productId, productName, issue, isOpen, onToggle,
}: {
  productId: string
  productName: string
  issue: ProductIssue
  isOpen: boolean
  onToggle: () => void
}) {
  const SevIcon = SEV_ICON[issue.severity]
  const label = ISSUE_LABELS[issue.code] ?? issue.code

  return (
    <div className={`rounded-xl border ${SEV_STYLE[issue.severity]}`}>
      <button
        onClick={onToggle}
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <SevIcon size={14} className={SEV_ICON_COLOR[issue.severity]} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[var(--color-text-1)]">{label}</div>
          <div className="text-xs text-[var(--color-text-3)] mt-0.5 truncate">{issue.message}</div>
        </div>
        <ChevronDown
          size={14}
          className={`text-[var(--color-text-3)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-4 pt-1 border-t border-[var(--color-surface-4)]/40">
              <FixerFor issue={issue} productId={productId} productName={productName} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


// ── FixerFor — dispatches off issue.code ────────────────────
function FixerFor({
  issue, productId, productName,
}: {
  issue: ProductIssue
  productId: string
  productName: string
}) {
  switch (issue.code) {
    case 'missing_brand':       return <FixBrand productId={productId} hint={issue.fix_hint} />
    case 'missing_category':    return <FixCategory productId={productId} hint={issue.fix_hint} />
    case 'missing_description': return <FixDescription productId={productId} productName={productName} />
    case 'missing_barcode_or_mpn': return <FixBarcodeMpn productId={productId} />
    case 'missing_image':       return <FixImage productId={productId} />
    case 'missing_price':       return <FixWithEditor productId={productId} reason="Add an offer with a retail price." />
    case 'no_stock':            return <FixWithEditor productId={productId} reason="Update one of the offers' stock_quantity." />
    case 'low_specs':
    case 'low_completeness':    return <FixEnrich productId={productId} />
    default:                    return <p className="text-xs text-[var(--color-text-3)]">No automated fix available — edit manually.</p>
  }
}


// ── Individual fixers ──────────────────────────────────────────────────────

function FixBrand({ productId, hint }: { productId: string; hint: Record<string, unknown> }) {
  const qc = useQueryClient()
  const { data: brandCatalog } = useQuery({ queryKey: ['brand-catalog'], queryFn: fetchBrands })
  const suggested = (hint.suggested_value as string | null) ?? ''
  const [value, setValue] = useState(suggested)

  const mut = useMutation({
    mutationFn: () => patchProduct(productId, { brand: value.trim().toUpperCase() }),
    onSuccess: () => {
      toast.success(`Brand set to ${value.trim().toUpperCase()}`)
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const options = useMemo(
    () => brandCatalog?.items.map(b => b.label).sort() ?? [],
    [brandCatalog],
  )

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) mut.mutate() }}
      className="flex flex-col gap-3"
    >
      {suggested && suggested !== value && (
        <button
          type="button"
          onClick={() => setValue(suggested)}
          className="text-xs text-left text-[var(--color-electric-blue)] hover:underline"
        >
          Suggested: <span className="font-bold">{suggested}</span> — click to apply
        </button>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Brand"
            list="brand-options"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="SAMSUNG, CONDOR, IRIS…"
          />
          <datalist id="brand-options">
            {options.map(o => <option key={o} value={o} />)}
          </datalist>
        </div>
        <Button type="submit" variant="accent" size="md" loading={mut.isPending} disabled={!value.trim()}>
          <Save size={13} /> Apply
        </Button>
      </div>
    </form>
  )
}


function FixCategory({ productId, hint }: { productId: string; hint: Record<string, unknown> }) {
  const qc = useQueryClient()
  const suggested = (hint.suggested_value as string | null) ?? ''
  const suggestedFr = (hint.suggested_label_fr as string | null) ?? ''
  const [value, setValue] = useState(suggested)

  const mut = useMutation({
    mutationFn: () => patchProduct(productId, { category: value.trim() }),
    onSuccess: () => {
      toast.success(`Category set to ${value.trim()}`)
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) mut.mutate() }}
      className="flex flex-col gap-3"
    >
      {suggested && (
        <div className="text-xs text-[var(--color-text-3)]">
          Suggested:{' '}
          <button type="button" onClick={() => setValue(suggested)}
            className="text-[var(--color-electric-blue)] font-bold hover:underline">
            {suggested}
          </button>
          {suggestedFr && <span className="text-[var(--color-text-3)]"> · <span className="italic">{suggestedFr}</span></span>}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Category" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="TV, Microwave, Washing Machine…" />
        </div>
        <Button type="submit" variant="accent" size="md" loading={mut.isPending} disabled={!value.trim()}>
          <Save size={13} /> Apply
        </Button>
      </div>
    </form>
  )
}


function FixDescription({ productId, productName }: { productId: string; productName: string }) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const mut = useMutation({
    mutationFn: () => patchProduct(productId, { description: value.trim() }),
    onSuccess: () => {
      toast.success('Description saved')
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const llmMut = useMutation({
    mutationFn: async () => {
      // Enqueue + poll until terminal (the worker does scrape + LLM + merge).
      const enq = await enqueueIntel(productId, false)
      // Poll up to 180s
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        const job = await fetchIntelJob(enq.job_id)
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          return job
        }
      }
      throw new Error('Intel job timed out (>3 min). Check Jobs Console.')
    },
    onSuccess: (job) => {
      if (job.status !== 'COMPLETED') {
        toast.error(job.error_message ?? `Intel ${job.status.toLowerCase()}`)
        return
      }
      const newDesc = (job.raw_payload?.description as string | undefined) ?? ''
      if (newDesc) setValue(newDesc)
      const delta = ((job.completeness_after ?? 0) - (job.completeness_before ?? 0)) * 100
      const sign = delta >= 0 ? '+' : ''
      toast.success(`Full Intel · ${job.fields_filled.length} champs · ${job.images_added} image(s) · ${sign}${delta.toFixed(0)}% complétude`)
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const tooShort = value.trim().length < 30

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!tooShort) mut.mutate() }}
      className="flex flex-col gap-3"
    >
      <Textarea
        label={`Description for "${productName}"`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="2-3 sentences in French. Mention brand, category, and 2 standout features."
        error={value.length > 0 && tooShort ? `${value.trim().length}/30 minimum` : undefined}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button
          type="button" variant="outline" size="sm"
          loading={llmMut.isPending}
          onClick={() => llmMut.mutate()}
          title="Scraper web → LLM extract → fill description, specs, images. Takes 30-90s."
        >
          <Sparkles size={12} /> Full Intel (web + LLM)
        </Button>
        <Button type="submit" variant="accent" size="md" loading={mut.isPending} disabled={tooShort}>
          <Save size={13} /> Save
        </Button>
      </div>
    </form>
  )
}


function FixBarcodeMpn({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const [barcode, setBarcode] = useState('')
  const [mpn, setMpn] = useState('')

  const mut = useMutation({
    mutationFn: () => patchProduct(productId, {
      barcode: barcode.trim() || undefined,
      mpn: mpn.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Identifier saved')
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const both = !barcode.trim() && !mpn.trim()
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!both) mut.mutate() }}
      className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
    >
      <Input label="Barcode (EAN)" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="20675262366730" />
      <Input label="MPN" value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="UE55AU7100UXXC" />
      <Button type="submit" variant="accent" size="md" loading={mut.isPending} disabled={both}>
        <Save size={13} /> Apply
      </Button>
    </form>
  )
}


function FixImage({ productId }: { productId: string }) {
  return (
    <div className="text-xs text-[var(--color-text-3)] flex items-start gap-2">
      <Info size={13} className="text-[var(--color-electric-blue)] mt-0.5 shrink-0" />
      <span>
        Image uploads land in Phase 4 (R2 + multipart upload). For now, you can{' '}
        <Link to={`/products/${productId}/edit`} className="text-[var(--color-electric-blue)] hover:underline font-semibold">
          open the editor
        </Link>{' '}
        and paste an image URL into the offer's variant attributes.
      </span>
    </div>
  )
}


function FixWithEditor({ productId, reason }: { productId: string; reason: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--color-text-3)]">{reason}</p>
      <Link to={`/products/${productId}/edit`}>
        <Button variant="outline" size="sm">
          Open editor <ArrowRight size={12} />
        </Button>
      </Link>
    </div>
  )
}


function FixEnrich({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => enrichProduct(productId),
    onSuccess: (r) => {
      const delta = ((r.completeness_after - r.completeness_before) * 100).toFixed(0)
      toast.success(`Enriched · +${delta}% completeness · ${r.auto_attrs_added} attrs added`)
      qc.invalidateQueries({ queryKey: ['product-issues', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--color-text-3)]">
        Re-running the rule engine extracts more specs from the product name.
      </p>
      <Button variant="accent" size="sm" loading={mut.isPending} onClick={() => mut.mutate()}>
        <Sparkles size={13} /> Re-enrich
      </Button>
    </div>
  )
}

// suppress unused-warning on XIcon while keeping the import for future inline-cancel buttons
void XIcon
