import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Package, ShoppingCart, Clock, ArrowRight, Activity, Zap, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { fetchDashboardStats, fetchOrders, fetchEnrichmentStats } from '@/lib/api'
import { StatCard, Card, Badge, PageHeader } from '@/components/ui'
import { ORDER_STATUS_COLORS, fmtMoney, fmtAgo, fmtPercent } from '@/lib/utils'

const containerVar = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const itemVar = {
  hidden:  { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 340, damping: 26 } },
}

export default function Dashboard() {
  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: fetchDashboardStats })
  const enrichment = useQuery({
    queryKey: ['enrichment-stats'],
    queryFn: fetchEnrichmentStats,
    refetchInterval: 60_000,
  })
  const recent = useQuery({
    queryKey: ['orders-recent'],
    queryFn: () => fetchOrders({ page: 1, page_size: 8 }),
    refetchInterval: 30_000,
  })

  const s = stats.data
  const orders = recent.data?.items ?? []
  const enr = enrichment.data
  const needsFix = enr?.by_status?.NEEDS_FIX?.count ?? 0
  const verified = (enr?.by_status?.VERIFIED?.count ?? 0) + (enr?.by_status?.ACTIVE?.count ?? 0)
  const avgComplete = enr?.average_completeness ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        sub="Live overview · Fast. Reliable. Yours."
      />

      {/* Stat cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        variants={containerVar}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVar}>
          <StatCard
            label="Total Orders"
            loading={stats.isPending}
            value={s?.totalOrders ?? 0}
            icon={<ShoppingCart size={16} />}
            accent="var(--color-electric-blue)"
          />
        </motion.div>
        <motion.div variants={itemVar}>
          <StatCard
            label="Awaiting Confirm"
            loading={stats.isPending}
            value={s?.pendingOrders ?? 0}
            sub="reserved, not yet confirmed"
            icon={<Clock size={16} />}
            accent="var(--color-neon-yellow)"
          />
        </motion.div>
        <motion.div variants={itemVar}>
          <StatCard
            label="Active Products"
            loading={stats.isPending}
            value={s?.totalProducts ?? 0}
            icon={<Package size={16} />}
            accent="var(--color-hot-pink)"
          />
        </motion.div>
      </motion.div>

      {/* Catalog intelligence row */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2 uppercase tracking-wide">
            <Sparkles size={15} className="text-[var(--color-neon-yellow)]" />
            Catalog Intelligence
          </h2>
          <Link to="/products" className="text-xs text-[var(--color-electric-blue)] flex items-center gap-1 hover:underline font-semibold">
            Browse <ArrowRight size={11} />
          </Link>
        </div>
        {enrichment.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="shimmer h-12 w-full rounded" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Average completeness — big bar */}
            <div className="glass-sm p-3 col-span-1 sm:col-span-2 flex flex-col gap-2 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full" style={{ background: 'var(--color-electric-blue)' }} />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.18em]">Average completeness</span>
                <span className="num text-2xl font-black text-[var(--color-text-1)]">{fmtPercent(avgComplete)}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(avgComplete * 100)}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  style={{
                    background: avgComplete > 0.8
                      ? 'var(--color-success)'
                      : avgComplete > 0.5
                        ? 'var(--color-neon-yellow)'
                        : 'var(--color-hot-pink)',
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {Object.entries(enr?.by_status ?? {}).map(([status, info]) => (
                  <span key={status} className="badge bg-[var(--color-surface-3)] text-[var(--color-text-3)] border border-[var(--color-surface-4)]">
                    {status}: {info.count}
                  </span>
                ))}
              </div>
            </div>

            {/* Action chips */}
            <div className="flex flex-col gap-2">
              <Link
                to="/products?status=NEEDS_FIX"
                className="glass-sm flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-3)] transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-[var(--color-neon-yellow)]" />
                  <span className="text-xs font-semibold text-[var(--color-text-2)]">Needs Fix</span>
                </div>
                <span className="num text-sm font-bold text-[var(--color-neon-yellow)]">{needsFix}</span>
              </Link>
              <div className="glass-sm flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span className="text-xs font-semibold text-[var(--color-text-2)]">Verified</span>
                </div>
                <span className="num text-sm font-bold text-emerald-400">{verified}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Recent orders */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2 uppercase tracking-wide">
            <Activity size={15} className="text-[var(--color-electric-blue)]" />
            Recent Orders
          </h2>
          <Link to="/orders" className="text-xs text-[var(--color-electric-blue)] flex items-center gap-1 hover:underline font-semibold">
            View all <ArrowRight size={11} />
          </Link>
        </div>

        {recent.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shimmer h-10 w-full rounded" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <Zap size={28} className="text-[var(--color-neon-yellow)] opacity-60" />
            <p className="text-sm text-[var(--color-text-2)] font-semibold">No orders yet</p>
            <p className="text-xs text-[var(--color-text-3)]">Once your storefront fires, they land here in real-time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-[var(--color-text-3)] uppercase tracking-[0.18em] border-b border-[var(--color-surface-4)]">
                  <th className="pb-2 pr-4 font-bold">Order</th>
                  <th className="pb-2 pr-4 font-bold">Status</th>
                  <th className="pb-2 pr-4 font-bold">Payment</th>
                  <th className="pb-2 pr-4 font-bold text-right">Total</th>
                  <th className="pb-2 font-bold text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="tr-hover border-b border-[var(--color-surface-4)]/50">
                    <td className="py-2.5 pr-4">
                      <Link to={`/orders/${o.id}`} className="num text-xs text-[var(--color-electric-blue)] hover:underline font-bold">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge label={o.status} colorClass={ORDER_STATUS_COLORS[o.status]} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs text-[var(--color-text-3)] font-medium uppercase tracking-wide">{o.payment_status}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right num text-xs font-bold text-[var(--color-text-1)]">
                      {fmtMoney(o.total, o.currency)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-[var(--color-text-3)]">
                      {fmtAgo(o.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
