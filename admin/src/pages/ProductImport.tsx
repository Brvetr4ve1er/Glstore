import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, FileSpreadsheet, AlertTriangle, CheckCircle2,
  X as XIcon, ChevronRight, Sparkles, Link2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  previewImport, commitImport,
  type ImportPreviewResponse, type ImportCommitResponse, type ImportRowIssue,
} from '@/lib/api'
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { fmtMoney } from '@/lib/utils'
import { UrlImportPanel } from './ProductImportUrl'

type Stage = 'idle' | 'previewing' | 'preview-ready' | 'committing' | 'done'
type Mode = 'csv' | 'url'

export default function ProductImport() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [mode, setMode]       = useState<Mode>('url')
  const [file, setFile]       = useState<File | null>(null)
  const [drag, setDrag]       = useState(false)
  const [stage, setStage]     = useState<Stage>('idle')
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [commit,  setCommit]  = useState<ImportCommitResponse  | null>(null)

  const previewMut = useMutation({
    mutationFn: (f: File) => previewImport(f),
    onMutate: () => setStage('previewing'),
    onSuccess: (data) => { setPreview(data); setStage('preview-ready') },
    onError: (e: Error) => { toast.error(e.message); setStage('idle') },
  })

  const commitMut = useMutation({
    mutationFn: (f: File) => commitImport(f),
    onMutate: () => setStage('committing'),
    onSuccess: (data) => {
      setCommit(data)
      setStage('done')
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      const r = data.report
      const total = r.products_created + r.products_updated
      toast.success(`${total} products synced`)
    },
    onError: (e: Error) => { toast.error(e.message); setStage('preview-ready') },
  })

  const onPickFile = useCallback((f: File | null) => {
    if (!f) return
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) {
      toast.error('Please pick a CSV file (.csv, .tsv, .txt)')
      return
    }
    setFile(f)
    setPreview(null)
    setCommit(null)
    setStage('idle')
    previewMut.mutate(f)
  }, [previewMut])

  const reset = () => {
    setFile(null); setPreview(null); setCommit(null); setStage('idle')
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <Link to="/products" className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] transition-colors w-fit">
        <ArrowLeft size={14} /> Back to Products
      </Link>

      <PageHeader
        title="Import products"
        sub="Paste a product link to scrape one item, or drop a supplier CSV for bulk import."
      />

      {/* ── Mode toggle ── */}
      <div className="flex gap-2 p-1 rounded-xl bg-[var(--color-surface-3)] w-fit">
        <button
          onClick={() => setMode('url')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === 'url'
              ? 'bg-[var(--color-surface-1)] text-[var(--color-text-1)]'
              : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'
          }`}
        >
          <Link2 size={15} /> From URL
        </button>
        <button
          onClick={() => setMode('csv')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === 'csv'
              ? 'bg-[var(--color-surface-1)] text-[var(--color-text-1)]'
              : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'
          }`}
        >
          <FileSpreadsheet size={15} /> CSV file
        </button>
      </div>

      {/* ── URL import ── */}
      {mode === 'url' && <UrlImportPanel />}

      {/* ── CSV: Step 1: Drop zone ── */}
      {mode === 'csv' && stage === 'idle' && (
        <DropZone drag={drag} setDrag={setDrag} onFile={onPickFile} />
      )}

      {/* ── CSV: Step 2: Previewing spinner ── */}
      {mode === 'csv' && stage === 'previewing' && (
        <Card>
          <div className="flex items-center gap-3 py-6">
            <Spinner size={20} className="text-[var(--color-electric-blue)]" />
            <div>
              <div className="font-semibold text-[var(--color-text-1)]">Parsing & validating…</div>
              <div className="text-xs text-[var(--color-text-3)]">{file?.name} ({Math.round((file?.size ?? 0) / 1024)} KB)</div>
            </div>
          </div>
        </Card>
      )}

      {/* ── CSV: Step 3: Preview ready ── */}
      {mode === 'csv' && (stage === 'preview-ready' || stage === 'committing') && preview && file && (
        <PreviewBlock
          file={file}
          preview={preview}
          committing={stage === 'committing'}
          onCommit={() => commitMut.mutate(file)}
          onReset={reset}
        />
      )}

      {/* ── CSV: Step 4: Done ── */}
      {mode === 'csv' && stage === 'done' && commit && (
        <DoneBlock commit={commit} onReset={reset} onGoToProducts={() => navigate('/products')} />
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Drop zone
// ─────────────────────────────────────────────────────────────────────
function DropZone({
  drag, setDrag, onFile,
}: {
  drag: boolean
  setDrag: (b: boolean) => void
  onFile: (f: File | null) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <label
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        className={`
          glass cursor-pointer flex flex-col items-center justify-center
          py-16 px-6 gap-4 text-center
          border-2 border-dashed transition-all
          ${drag
            ? 'border-[var(--color-neon-yellow)] bg-[var(--color-neon-yellow)]/5 scale-[1.01]'
            : 'border-[var(--color-surface-4)] hover:border-[var(--color-electric-blue)]'}
        `}
      >
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-electric-blue)]/15 flex items-center justify-center">
          <FileSpreadsheet size={28} className="text-[var(--color-electric-blue)]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-base font-bold text-[var(--color-text-1)]">
            {drag ? 'Drop the CSV here' : 'Drop a CSV or click to browse'}
          </div>
          <div className="text-xs text-[var(--color-text-3)] max-w-md">
            Any delimiter (comma, semicolon, tab, pipe). UTF-8 / cp1252 / latin-1.
            French + English headers auto-mapped.
          </div>
        </div>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={e => onFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex gap-2 text-[10px] uppercase tracking-widest text-[var(--color-text-3)] mt-2">
          <span className="px-2 py-1 rounded-md bg-[var(--color-surface-3)]">.csv</span>
          <span className="px-2 py-1 rounded-md bg-[var(--color-surface-3)]">.tsv</span>
          <span className="px-2 py-1 rounded-md bg-[var(--color-surface-3)]">UTF-8</span>
          <span className="px-2 py-1 rounded-md bg-[var(--color-surface-3)]">EU/US numbers</span>
        </div>
      </label>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────
function PreviewBlock({
  file, preview, committing, onCommit, onReset,
}: {
  file: File
  preview: ImportPreviewResponse
  committing: boolean
  onCommit: () => void
  onReset: () => void
}) {
  const { diagnostic: d, report: r } = preview
  const errorIssues   = useMemo(() => r.issues.filter(i => i.severity === 'error'),   [r.issues])
  const warningIssues = useMemo(() => r.issues.filter(i => i.severity === 'warning'), [r.issues])

  const canCommit = r.valid_rows > 0

  return (
    <motion.div
      className="flex flex-col gap-4"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* File chip */}
      <div className="glass-sm flex items-center gap-3 px-4 py-3">
        <FileSpreadsheet size={16} className="text-[var(--color-electric-blue)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--color-text-1)] truncate">{file.name}</div>
          <div className="text-[11px] text-[var(--color-text-3)]">
            {Math.round(file.size / 1024)} KB · delimiter <code className="px-1 bg-[var(--color-surface-3)] rounded">{d.delimiter === '\t' ? '\\t' : d.delimiter}</code> · {d.headers.length} columns · {d.parsed_rows} rows parsed
          </div>
        </div>
        <button onClick={onReset} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] transition-colors">
          <XIcon size={14} />
        </button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="To create"  value={r.products_to_create}  accent="var(--color-electric-blue)" />
        <Stat label="To update"  value={r.products_to_update}  accent="var(--color-neon-yellow)" />
        <Stat label="Offers"     value={r.offers_to_create + r.offers_to_update} sub={`${r.offers_to_create} new · ${r.offers_to_update} updated`} accent="var(--color-bold-blue)" />
        <Stat label="Blocked"    value={r.blocked_rows}        accent="var(--color-hot-pink)" />
      </div>

      {/* Header mapping diagnostic */}
      <Card>
        <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-3">
          Detected columns ({Object.keys(d.mapped_fields).length} mapped)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
          {Object.entries(d.mapped_fields).map(([field, header]) => (
            <div key={field} className="flex items-center justify-between gap-2 border-b border-[var(--color-surface-4)]/30 py-1">
              <span className="text-[var(--color-electric-blue)] font-mono">{field}</span>
              <ChevronRight size={11} className="text-[var(--color-text-3)] opacity-50" />
              <span className="text-[var(--color-text-2)] truncate flex-1 text-right">{header}</span>
            </div>
          ))}
        </div>
        {d.unmapped_headers.length > 0 && (
          <details className="mt-3 group">
            <summary className="text-[11px] text-[var(--color-text-3)] cursor-pointer hover:text-[var(--color-text-2)]">
              {d.unmapped_headers.length} columns ignored (preserved in product specs)
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.unmapped_headers.map(h => (
                <span key={h} className="px-2 py-0.5 rounded bg-[var(--color-surface-3)] text-[10px] text-[var(--color-text-3)]">
                  {h}
                </span>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Issues */}
      {(errorIssues.length > 0 || warningIssues.length > 0) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em]">
              Validation issues
            </h3>
            <span className="text-[11px] text-[var(--color-text-3)]">
              <span className="text-[var(--color-hot-pink)] font-semibold">{errorIssues.length} errors</span>
              {' · '}
              <span className="text-[var(--color-neon-yellow)] font-semibold">{warningIssues.length} warnings</span>
            </span>
          </div>
          <IssueList issues={[...errorIssues.slice(0, 50), ...warningIssues.slice(0, 50)]} />
          {(errorIssues.length + warningIssues.length) > 100 && (
            <p className="text-[10px] text-[var(--color-text-3)] mt-2 italic">
              Showing first 100 issues of {errorIssues.length + warningIssues.length} total.
            </p>
          )}
        </Card>
      )}

      {/* Sample rows */}
      {r.sample_preview.length > 0 && (
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-3">
            Sample rows ({r.sample_preview.length} of {r.valid_rows})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-[var(--color-text-3)] uppercase tracking-widest border-b border-[var(--color-surface-4)]">
                  <th className="pb-2 pr-3 font-bold">#</th>
                  <th className="pb-2 pr-3 font-bold">SKU</th>
                  <th className="pb-2 pr-3 font-bold">Name</th>
                  <th className="pb-2 pr-3 font-bold">Brand</th>
                  <th className="pb-2 pr-3 font-bold">Category</th>
                  <th className="pb-2 pr-3 font-bold text-right">Cost</th>
                  <th className="pb-2 pr-3 font-bold text-right">Retail</th>
                  <th className="pb-2 pr-3 font-bold text-right">Stock</th>
                  <th className="pb-2 font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {r.sample_preview.map(row => (
                  <tr key={row.line_number} className="tr-hover border-b border-[var(--color-surface-4)]/40">
                    <td className="py-1.5 pr-3 num text-[10px] text-[var(--color-text-3)]">{row.line_number}</td>
                    <td className="py-1.5 pr-3 num text-[var(--color-electric-blue)]">{row.sku}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-text-1)] truncate max-w-[260px]">{row.name}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-text-2)]">{row.brand ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-text-3)]">{row.category ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right num text-[var(--color-text-2)]">{row.purchase_price ? fmtMoney(row.purchase_price) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right num text-[var(--color-text-1)] font-medium">{row.retail_price ? fmtMoney(row.retail_price) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right num text-[var(--color-text-2)]">{row.stock}</td>
                    <td className="py-1.5">
                      {row.action === 'create'
                        ? <span className="badge bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30">Create</span>
                        : <span className="badge bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border border-[var(--color-neon-yellow)]/30">Update</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between gap-3 sticky bottom-4">
        <Button variant="ghost" onClick={onReset} disabled={committing}>
          Cancel
        </Button>
        <Button
          variant="accent"
          size="lg"
          onClick={onCommit}
          loading={committing}
          disabled={!canCommit || committing}
        >
          {committing
            ? 'Committing…'
            : <>
                <Sparkles size={15} />
                Commit {r.valid_rows.toLocaleString()} rows
              </>}
        </Button>
      </div>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────
function DoneBlock({
  commit, onReset, onGoToProducts,
}: {
  commit: ImportCommitResponse
  onReset: () => void
  onGoToProducts: () => void
}) {
  const r = commit.report
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="flex flex-col items-center text-center gap-4 py-10">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 size={32} className="text-emerald-400" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-black text-[var(--color-text-1)]">Import complete</h2>
          <p className="text-sm text-[var(--color-text-3)]">Your catalog is updated. Enrichment will pick up the rest.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl mt-4">
          <Stat label="Products created" value={r.products_created} accent="var(--color-electric-blue)" />
          <Stat label="Products updated" value={r.products_updated} accent="var(--color-neon-yellow)" />
          <Stat label="Offers created"   value={r.offers_created}   accent="var(--color-bold-blue)" />
          <Stat label="Offers updated"   value={r.offers_updated}   accent="var(--color-bold-blue)" />
        </div>
        {r.blocked_rows > 0 && (
          <p className="text-xs text-[var(--color-hot-pink)] flex items-center gap-2 mt-2">
            <AlertTriangle size={12} />
            {r.blocked_rows} rows skipped due to validation errors.
          </p>
        )}
        <div className="flex items-center gap-3 mt-4">
          <Button variant="ghost" onClick={onReset}>Import another file</Button>
          <Button variant="accent" onClick={onGoToProducts}>
            View products <ChevronRight size={15} />
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────
function Stat({
  label, value, sub, accent,
}: {
  label: string; value: number; sub?: string; accent: string
}) {
  return (
    <div className="glass-sm p-3 flex flex-col gap-1 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent }} />
      <div className="text-[9px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.18em]">{label}</div>
      <div className="text-2xl font-black num text-[var(--color-text-1)]">{value.toLocaleString()}</div>
      {sub && <div className="text-[10px] text-[var(--color-text-3)]">{sub}</div>}
    </div>
  )
}

function IssueList({ issues }: { issues: ImportRowIssue[] }) {
  if (!issues.length) {
    return <EmptyState title="All rows valid" desc="Nothing to fix — ready to commit." />
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {issues.map((i, idx) => (
          <motion.div
            key={`${i.line_number}-${i.field}-${idx}`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs ${
              i.severity === 'error'
                ? 'bg-[var(--color-hot-pink)]/10 border border-[var(--color-hot-pink)]/20'
                : 'bg-[var(--color-neon-yellow)]/10 border border-[var(--color-neon-yellow)]/20'
            }`}
          >
            <span className="num text-[10px] text-[var(--color-text-3)] w-12 shrink-0">L{i.line_number}</span>
            <span className={`badge ${
              i.severity === 'error'
                ? 'bg-[var(--color-hot-pink)]/20 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/30'
                : 'bg-[var(--color-neon-yellow)]/20 text-[var(--color-neon-yellow)] border border-[var(--color-neon-yellow)]/30'
            }`}>
              {i.severity}
            </span>
            <span className="text-[var(--color-text-2)] font-mono text-[10px]">{i.field}</span>
            <span className="text-[var(--color-text-1)] flex-1 truncate">{i.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
