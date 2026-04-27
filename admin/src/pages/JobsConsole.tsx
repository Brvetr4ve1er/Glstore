import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Pause, RotateCcw, Search, X as XIcon, Zap, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchJobs, fetchJobsStats, fetchJobDetail, retryJob, cancelJob,
  type UnifiedJob, type JobType,
} from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner, Select } from '@/components/ui'
import { fmtAgo, fmtDate } from '@/lib/utils'

const PAGE_SIZE = 40

type StatusFilter =
  | '' | 'PENDING' | 'CLAIMED' | 'RUNNING' | 'COMPLETED'
  | 'FAILED' | 'CANCELLED' | 'RETRYING' | 'SYNCED'

const TYPE_TABS: { value: JobType | ''; label: string }[] = [
  { value: '',       label: 'Tous' },
  { value: 'scrape', label: 'Scrape' },
  { value: 'event',  label: 'Events' },
  { value: 'sync',   label: 'Sync' },
]

const STATUS_OPTIONS: StatusFilter[] = [
  '', 'PENDING', 'CLAIMED', 'RUNNING', 'RETRYING',
  'COMPLETED', 'SYNCED', 'FAILED', 'CANCELLED',
]


export default function JobsConsole() {
  const qc = useQueryClient()
  const [type, setType]       = useState<JobType | ''>('')
  const [status, setStatus]   = useState<StatusFilter>('')
  const [q, setQ]             = useState('')
  const [page, setPage]       = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selected, setSelected] = useState<UnifiedJob | null>(null)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [type, status, q])

  // Stats — refresh every 5s when auto is on
  const stats = useQuery({
    queryKey: ['jobs-stats'],
    queryFn: fetchJobsStats,
    refetchInterval: autoRefresh ? 5_000 : false,
  })

  const list = useQuery({
    queryKey: ['jobs-list', type, status, q, page],
    queryFn: () => fetchJobs({
      type: type || undefined,
      status: status || undefined,
      q: q || undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? 5_000 : false,
  })

  const total = list.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Jobs Console"
        sub="Tâches asynchrones — scrape · events · sync · retries"
        actions={
          <Button
            variant={autoRefresh ? 'accent' : 'outline'}
            size="md"
            onClick={() => setAutoRefresh(v => !v)}
          >
            <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} />
            {autoRefresh ? 'Auto-refresh' : 'Manuel'}
          </Button>
        }
      />

      {/* ── Stat tiles ─────────────────────────────────────────── */}
      <StatTiles stats={stats.data} loading={stats.isPending} />

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Type tabs */}
        <div className="flex items-center gap-1.5">
          {TYPE_TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`relative px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
                type === t.value
                  ? 'text-[var(--color-text-1)]'
                  : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
              }`}
            >
              {type === t.value && (
                <motion.div
                  layoutId="job-type-pill"
                  className="absolute inset-0 rounded-xl bg-[var(--color-electric-blue)]/15 border border-[var(--color-electric-blue)]/40"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Status select */}
        <Select
          label="Statut"
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          className="w-44"
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s || 'any'} value={s}>{s || 'Tous statuts'}</option>
          ))}
        </Select>

        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] pointer-events-none">
            <Search size={14} />
          </span>
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Rechercher type, erreur, sous-type…"
            aria-label="Recherche"
            className="h-10 w-full pl-10 pr-3 rounded-xl bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors"
          />
        </div>

        <div className="ml-auto self-end text-xs text-[var(--color-text-3)] pb-2.5">
          {list.isPending ? '…' : total.toLocaleString()} résultats
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="glass overflow-hidden">
        <div
          className="grid items-center text-[10px] text-[var(--color-text-3)] uppercase tracking-widest font-bold px-4 py-2.5 border-b border-[var(--color-surface-4)]"
          style={{ gridTemplateColumns: '90px 1fr 130px 120px 120px 110px' }}
        >
          <span>Type</span>
          <span>Sujet</span>
          <span>Statut</span>
          <span>Worker</span>
          <span>Quand</span>
          <span></span>
        </div>

        {list.isPending && !list.data ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={20} className="text-[var(--color-electric-blue)]" />
          </div>
        ) : list.isError ? (
          <EmptyState title="Erreur" desc="Impossible de charger les jobs." />
        ) : (list.data?.items ?? []).length === 0 ? (
          <EmptyState title="Aucun job" desc="Ajustez les filtres ou attendez qu'un job soit lancé." />
        ) : (
          <div className="max-h-[calc(100dvh-320px)] overflow-y-auto">
            <AnimatePresence initial={false}>
              {list.data!.items.map(j => (
                <motion.button
                  key={`${j.type}-${j.id}`}
                  type="button"
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelected(j)}
                  className="w-full text-left grid items-center px-4 py-2.5 border-b border-[var(--color-surface-4)]/40 hover:bg-[var(--color-surface-3)] transition-colors"
                  style={{ gridTemplateColumns: '90px 1fr 130px 120px 120px 110px' }}
                >
                  <TypeBadge type={j.type} />

                  <div className="min-w-0 pr-3">
                    <div className="text-xs text-[var(--color-text-1)] font-semibold truncate">{j.label}</div>
                    {j.error && (
                      <div className="text-[10px] text-[var(--color-hot-pink)] truncate font-mono">
                        {j.error}
                      </div>
                    )}
                  </div>

                  <StatusBadge status={j.status} />

                  <span className="text-[10px] num text-[var(--color-text-3)] truncate">
                    {j.claimed_by ?? '—'}
                  </span>

                  <span className="text-[10px] text-[var(--color-text-3)]" title={fmtDate(j.created_at)}>
                    {fmtAgo(j.created_at)}
                  </span>

                  <div className="flex items-center justify-end gap-1.5">
                    {j.retry_count > 0 && (
                      <span className="badge bg-[var(--color-surface-3)] text-[var(--color-text-3)] border border-[var(--color-surface-4)] text-[9px]">
                        ↻ {j.retry_count}
                      </span>
                    )}
                    <ChevronRight size={12} className="text-[var(--color-text-3)] opacity-50" />
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--color-text-3)]">
            Page <span className="text-[var(--color-text-1)] font-bold">{page}</span> / {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} /> Précédent
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Suivant <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Drawer */}
      <JobDetailDrawer
        job={selected}
        onClose={() => setSelected(null)}
        onMutated={() => {
          qc.invalidateQueries({ queryKey: ['jobs-list'] })
          qc.invalidateQueries({ queryKey: ['jobs-stats'] })
        }}
      />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Stat tiles
// ─────────────────────────────────────────────────────────────────────────

function StatTiles({ stats, loading }: { stats?: { totals: { active: number; failed: number; completed: number; total: number } } ; loading: boolean }) {
  const tiles = [
    { label: 'Actifs',    value: stats?.totals.active    ?? 0, icon: Activity,      tone: 'electric' },
    { label: 'Échecs',    value: stats?.totals.failed    ?? 0, icon: AlertTriangle, tone: 'pink' },
    { label: 'Complétés', value: stats?.totals.completed ?? 0, icon: CheckCircle2,  tone: 'success' },
    { label: 'Total',     value: stats?.totals.total     ?? 0, icon: Zap,           tone: 'yellow' },
  ] as const

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="glass p-4 flex items-center gap-3 relative overflow-hidden">
          <div
            className="absolute top-0 left-0 w-1 h-full"
            style={{ background:
              t.tone === 'electric' ? 'var(--color-electric-blue)' :
              t.tone === 'pink'     ? 'var(--color-hot-pink)' :
              t.tone === 'yellow'   ? 'var(--color-neon-yellow)' :
              'var(--color-success)'
            }}
          />
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            t.tone === 'electric' ? 'bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)]' :
            t.tone === 'pink'     ? 'bg-[var(--color-hot-pink)]/12 text-[var(--color-hot-pink)]' :
            t.tone === 'yellow'   ? 'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)]' :
                                    'bg-emerald-500/12 text-emerald-400'
          }`}>
            <t.icon size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.18em]">{t.label}</div>
            <div className="num text-2xl font-black text-[var(--color-text-1)] leading-none mt-1">
              {loading ? '—' : t.value.toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Type badge
// ─────────────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: JobType }) {
  const styles: Record<JobType, { label: string; cls: string }> = {
    scrape: { label: 'SCRAPE', cls: 'bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] border-[var(--color-electric-blue)]/30' },
    event:  { label: 'EVENT',  cls: 'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border-[var(--color-neon-yellow)]/30' },
    sync:   { label: 'SYNC',   cls: 'bg-[var(--color-hot-pink)]/12 text-[var(--color-hot-pink)] border-[var(--color-hot-pink)]/30' },
  }
  const s = styles[type]
  return (
    <span className={`badge text-[9px] border ${s.cls}`}>{s.label}</span>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:   'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border-[var(--color-neon-yellow)]/30',
    CLAIMED:   'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border-[var(--color-electric-blue)]/30',
    RUNNING:   'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border-[var(--color-electric-blue)]/30',
    RETRYING:  'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border-[var(--color-neon-yellow)]/30',
    COMPLETED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    SYNCED:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    FAILED:    'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border-[var(--color-hot-pink)]/30',
    CANCELLED: 'bg-[var(--color-surface-3)] text-[var(--color-text-3)] border-[var(--color-surface-4)]',
  }
  const cls = map[status] ?? 'bg-[var(--color-surface-3)] text-[var(--color-text-3)] border-[var(--color-surface-4)]'
  return <span className={`badge text-[9px] border ${cls}`}>{status}</span>
}


// ─────────────────────────────────────────────────────────────────────────
// Detail drawer
// ─────────────────────────────────────────────────────────────────────────

function JobDetailDrawer({
  job, onClose, onMutated,
}: {
  job: UnifiedJob | null
  onClose: () => void
  onMutated: () => void
}) {
  const open = job !== null

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && job && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed top-0 right-0 bottom-0 w-full max-w-2xl glass-strong z-50 overflow-y-auto"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            role="dialog"
            aria-modal="true"
            aria-label="Détail du job"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />
            <DrawerContent job={job} onClose={onClose} onMutated={onMutated} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}


function DrawerContent({
  job, onClose, onMutated,
}: { job: UnifiedJob; onClose: () => void; onMutated: () => void }) {
  const detail = useQuery({
    queryKey: ['job-detail', job.type, job.id],
    queryFn: () => fetchJobDetail(job.type, job.id),
  })

  const retryMut = useMutation({
    mutationFn: () => retryJob(job.type, job.id),
    onSuccess: () => { toast.success('Job remis en file'); onMutated(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancelMut = useMutation({
    mutationFn: () => cancelJob(job.type, job.id),
    onSuccess: () => { toast.success('Job annulé'); onMutated(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  const canRetry  = ['FAILED', 'CANCELLED', 'COMPLETED', 'RETRYING', 'SYNCED'].includes(job.status)
  // Cancel only valid for scrape
  const canCancel = job.type === 'scrape' && ['PENDING', 'CLAIMED', 'RUNNING'].includes(job.status)

  return (
    <div className="p-6 pt-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <TypeBadge type={job.type} />
            <StatusBadge status={job.status} />
            {job.retry_count > 0 && (
              <span className="badge text-[9px] bg-[var(--color-surface-3)] text-[var(--color-text-3)] border border-[var(--color-surface-4)]">
                ↻ {job.retry_count}
              </span>
            )}
          </div>
          <h2 className="text-lg font-black text-[var(--color-text-1)] truncate">{job.label}</h2>
          <div className="text-[10px] num text-[var(--color-text-3)] break-all">{job.id}</div>
        </div>
        <button onClick={onClose} aria-label="Fermer"
          className="p-2 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)]">
          <XIcon size={16} />
        </button>
      </div>

      {/* Quick facts */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Fact label="Créé"     value={fmtDate(job.created_at)} />
        <Fact label="Worker"   value={job.claimed_by ?? '—'} mono />
        <Fact label="Démarré"  value={job.started_at ? fmtDate(job.started_at) : '—'} />
        <Fact label="Terminé"  value={job.completed_at ? fmtDate(job.completed_at) : '—'} />
      </div>

      {/* Error */}
      {job.error && (
        <div className="glass-sm p-3 border border-[var(--color-hot-pink)]/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={12} className="text-[var(--color-hot-pink)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-hot-pink)]">
              Dernière erreur
            </span>
          </div>
          <pre className="text-[11px] font-mono text-[var(--color-text-2)] whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {job.error}
          </pre>
        </div>
      )}

      {/* Detail JSON */}
      {detail.isPending ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size={18} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : detail.data ? (
        <DetailBody data={detail.data} />
      ) : null}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-surface-4)] sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-[var(--color-surface-2)]/60 backdrop-blur">
        {canCancel && (
          <Button variant="danger" size="md" onClick={() => cancelMut.mutate()} loading={cancelMut.isPending}>
            <Pause size={13} /> Annuler
          </Button>
        )}
        {canRetry && (
          <Button variant="accent" size="md" onClick={() => retryMut.mutate()} loading={retryMut.isPending}>
            <RotateCcw size={13} /> Relancer
          </Button>
        )}
      </div>
    </div>
  )
}


function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="glass-sm px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
        {label}
      </div>
      <div className={`text-xs mt-1 text-[var(--color-text-1)] ${mono ? 'font-mono' : ''} truncate`} title={value}>
        {value}
      </div>
    </div>
  )
}


function DetailBody({ data }: { data: Record<string, unknown> }) {
  // Show payload first if it exists, then sources, then dump the rest as JSON
  const payload = data.payload ?? data.summary ?? null
  const sources = data.sources as unknown[] | undefined
  const interesting = useMemo(() => {
    const skip = new Set(['id', 'type', 'payload', 'summary', 'sources', 'error_message',
                          'last_error', 'created_at', 'started_at', 'completed_at',
                          'claimed_at', 'locked_at', 'processed_at'])
    const out: { k: string; v: unknown }[] = []
    for (const [k, v] of Object.entries(data)) {
      if (skip.has(k)) continue
      if (v == null) continue
      if (typeof v === 'object' && !Array.isArray(v)) continue
      out.push({ k, v })
    }
    return out
  }, [data])

  return (
    <div className="flex flex-col gap-4">
      {interesting.length > 0 && (
        <Section title="Paramètres">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {interesting.map(({ k, v }) => (
              <Fact key={k} label={k} value={Array.isArray(v) ? v.join(', ') : String(v)} mono={k.endsWith('_id') || k === 'event_id'} />
            ))}
          </div>
        </Section>
      )}

      {payload != null && (
        <Section title={data.summary ? 'Résumé' : 'Payload'}>
          <pre className="text-[11px] font-mono text-[var(--color-text-2)] whitespace-pre-wrap break-words max-h-72 overflow-y-auto bg-[var(--color-surface-3)]/60 p-3 rounded-lg">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </Section>
      )}

      {sources && sources.length > 0 && (
        <Section title={`Sources (${sources.length})`}>
          <ul className="flex flex-col gap-1.5">
            {sources.map((s, i) => (
              <li key={i} className="glass-sm px-3 py-2 text-xs flex items-center justify-between gap-3">
                <SourceRow s={s as Record<string, unknown>} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-2">
        {title}
      </h3>
      {children}
    </div>
  )
}


function SourceRow({ s }: { s: Record<string, unknown> }) {
  const url    = String(s.url ?? '')
  const tier   = String(s.tier ?? '')
  const fetchEngine = String(s.fetch_engine ?? '')
  const fetchMs = Number(s.fetch_ms ?? 0)
  const conf   = Number(s.confidence ?? 0)
  const extracted = (s.extracted as Record<string, unknown>) || {}
  const price  = extracted.price as number | null | undefined
  return (
    <>
      <div className="flex-1 min-w-0">
        <div className="text-[var(--color-text-1)] truncate">{url || '(no url)'}</div>
        <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2 mt-0.5">
          <span>{tier}</span>
          <span>· {fetchEngine}</span>
          <span>· {fetchMs}ms</span>
          <span className="num">· conf {Math.round(conf * 100)}%</span>
        </div>
      </div>
      <div className="num text-xs text-[var(--color-electric-blue)] font-bold shrink-0">
        {price ? `${price.toLocaleString('fr-DZ')} DA` : '—'}
      </div>
    </>
  )
}
