import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle, AlertCircle, Info, Image as ImageIcon, ArrowRight, Sparkles,
} from 'lucide-react'
import {
  fetchIssuesSummary, fetchIssuesList,
  type IssueCode, type IssueListItem,
} from '@/lib/api'
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { fmtMoney, fmtPercent } from '@/lib/utils'

const TABS: { code: IssueCode; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; severity: 'error' | 'warning' | 'info' }[] = [
  { code: 'missing_brand',          label: 'Missing brand',         icon: AlertCircle,    severity: 'error' },
  { code: 'missing_category',       label: 'Missing category',      icon: AlertCircle,    severity: 'error' },
  { code: 'missing_price',          label: 'No price',              icon: AlertCircle,    severity: 'error' },
  { code: 'missing_description',    label: 'No description',        icon: AlertTriangle,  severity: 'warning' },
  { code: 'missing_image',          label: 'No image',              icon: AlertTriangle,  severity: 'warning' },
  { code: 'no_stock',               label: 'Out of stock',          icon: AlertTriangle,  severity: 'warning' },
  { code: 'missing_barcode_or_mpn', label: 'No barcode / MPN',      icon: AlertTriangle,  severity: 'warning' },
  { code: 'low_completeness',       label: 'Low completeness',      icon: Info,           severity: 'info' },
  { code: 'low_specs',              label: 'Low specs',             icon: Info,           severity: 'info' },
]

const SEV_RING: Record<string, string> = {
  error:   'border-[var(--color-hot-pink)]/40 text-[var(--color-hot-pink)]',
  warning: 'border-[var(--color-neon-yellow)]/40 text-[var(--color-neon-yellow)]',
  info:    'border-[var(--color-electric-blue)]/40 text-[var(--color-electric-blue)]',
}

export default function IssueExplorer() {
  const [active, setActive] = useState<IssueCode>('missing_brand')

  const { data: summary } = useQuery({
    queryKey: ['issues-summary'],
    queryFn: fetchIssuesSummary,
    refetchInterval: 60_000,
  })

  const { data: list, isPending } = useQuery({
    queryKey: ['issues-list', active],
    queryFn: () => fetchIssuesList(active, 1, 100),
  })

  const total = summary?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalog quality"
        sub={total ? `${total.toLocaleString()} active products · pick an issue to triage` : 'No products in catalog yet'}
      />

      {/* Tabs (motion shared layout pill) */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(tab => {
          const Icon = tab.icon
          const count = summary?.by_issue?.[tab.code] ?? 0
          const isActive = active === tab.code
          return (
            <button
              key={tab.code}
              onClick={() => setActive(tab.code)}
              type="button"
              className={`relative px-3.5 py-2 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors ${
                isActive
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-text-1)] border-[var(--color-electric-blue)]/40'
                  : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="issue-tab-indicator"
                  className="absolute inset-0 rounded-xl bg-[var(--color-electric-blue)]/10"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <Icon size={13} className={`relative ${SEV_RING[tab.severity]}`} />
              <span className="relative">{tab.label}</span>
              <span className={`relative num text-[10px] px-1.5 py-0.5 rounded-md ${
                count > 0
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-1)]'
                  : 'bg-transparent text-[var(--color-text-3)]'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Body */}
      <Card>
        {isPending ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={24} className="text-[var(--color-electric-blue)]" />
          </div>
        ) : !list || list.items.length === 0 ? (
          <EmptyState
            title="Nothing to fix here"
            desc="No products match this issue. Try another tab — or run Enrich all on the Products page."
            icon={<Sparkles size={28} className="text-[var(--color-neon-yellow)] opacity-60" />}
          />
        ) : (
          <IssueRows items={list.items} totalShown={list.items.length} totalAll={list.total} />
        )}
      </Card>
    </div>
  )
}


// ── List rows ─────────────────────────────────────────────────────────
function IssueRows({ items, totalShown, totalAll }: { items: IssueListItem[]; totalShown: number; totalAll: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-3 text-xs text-[var(--color-text-3)]">
        <span>
          Showing <span className="text-[var(--color-text-1)] font-bold">{totalShown}</span>{' '}
          of <span className="text-[var(--color-text-1)] font-bold">{totalAll.toLocaleString()}</span>{' '}
          products affected.
        </span>
        <span className="text-[10px] uppercase tracking-widest">↓ lowest completeness first</span>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid items-center text-[10px] text-[var(--color-text-3)] uppercase tracking-widest font-bold pb-2 border-b border-[var(--color-surface-4)] gap-3"
          style={{ gridTemplateColumns: '40px 1fr 110px 110px 90px 100px 80px' }}
        >
          <span></span>
          <span>Name / SKU</span>
          <span>Brand</span>
          <span>Category</span>
          <span className="text-right">Price</span>
          <span className="text-right">Complete</span>
          <span></span>
        </div>

        {items.map(p => (
          <div
            key={p.id}
            className="grid items-center py-2 border-b border-[var(--color-surface-4)]/30 gap-3 tr-hover text-sm"
            style={{ gridTemplateColumns: '40px 1fr 110px 110px 90px 100px 80px' }}
          >
            <div className="flex items-center">
              {p.primary_image
                ? <img src={p.primary_image} alt="" className="w-8 h-8 rounded-md object-cover" loading="lazy" />
                : <div className="w-8 h-8 rounded-md bg-[var(--color-surface-3)] flex items-center justify-center">
                    <ImageIcon size={12} className="text-[var(--color-text-3)]" />
                  </div>
              }
            </div>
            <div className="min-w-0 pr-2">
              <Link to={`/products/${p.id}`} className="text-[var(--color-text-1)] font-semibold hover:text-[var(--color-electric-blue)] truncate block leading-tight">
                {p.name}
              </Link>
              <span className="text-[10px] font-mono text-[var(--color-text-3)]">{p.sku}</span>
            </div>
            <span className={`text-xs truncate ${p.brand ? 'text-[var(--color-text-2)]' : 'text-[var(--color-hot-pink)] italic'}`}>
              {p.brand ?? 'missing'}
            </span>
            <span className={`text-xs truncate ${p.category ? 'text-[var(--color-text-3)]' : 'text-[var(--color-hot-pink)] italic'}`}>
              {p.category ?? 'missing'}
            </span>
            <span className="num text-xs text-right text-[var(--color-text-1)] font-medium">
              {p.min_price != null ? fmtMoney(p.min_price) : '—'}
            </span>
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-12 h-1.5 rounded-full bg-[var(--color-surface-4)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: fmtPercent(p.completeness_score),
                    background:
                      p.completeness_score > 0.8 ? 'var(--color-success)' :
                      p.completeness_score > 0.5 ? 'var(--color-neon-yellow)' :
                      'var(--color-hot-pink)',
                  }}
                />
              </div>
              <span className="num text-[10px] text-[var(--color-text-3)] w-8 text-right">
                {fmtPercent(p.completeness_score)}
              </span>
            </div>
            <Link to={`/products/${p.id}`}
              className="text-[var(--color-electric-blue)] text-xs font-bold flex items-center gap-1 hover:underline">
              Fix <ArrowRight size={11} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
