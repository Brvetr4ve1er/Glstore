import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ShoppingCart } from 'lucide-react'
import { fetchOrders, type OrderListItem } from '@/lib/api'
import { Badge, EmptyState, PageHeader, Select, Spinner } from '@/components/ui'
import { ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS, fmtMoney, fmtAgo } from '@/lib/utils'

const PAGE_SIZE = 100
const STATUSES = ['', 'PENDING', 'RESERVED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED']

export default function Orders() {
  const [status, setStatus] = useState('')
  const [page, setPage]     = useState(1)
  const parentRef           = useRef<HTMLDivElement>(null)

  const { data, isPending, isError } = useQuery({
    queryKey: ['orders', status, page],
    queryFn: () => fetchOrders({
      page, page_size: PAGE_SIZE,
      ...(status ? { status } : {}),
    }),
    placeholderData: prev => prev,
    refetchInterval: 20_000,
  })

  const items: OrderListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 12,
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Orders"
        sub={total ? `${total.toLocaleString()} orders` : undefined}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3" data-aos="fade-up-sm">
        <Select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="w-44"
          label="Status"
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s || 'All statuses'}</option>
          ))}
        </Select>
        <div className="self-end text-xs text-[var(--color-text-3)] pb-2">
          {isPending ? '…' : total.toLocaleString()} results
        </div>
      </div>

      {/* Table */}
      <div className="glass overflow-hidden" data-aos="fade-up-sm" data-aos-delay="60">
        <div
          className="grid items-center text-[10px] text-[var(--color-text-3)] uppercase tracking-widest font-semibold px-4 py-2.5 border-b border-[var(--color-surface-4)]"
          style={{ gridTemplateColumns: '140px 1fr 120px 100px 110px 100px' }}
        >
          <span>Order #</span>
          <span>Customer</span>
          <span>Status</span>
          <span>Payment</span>
          <span className="text-right">Total</span>
          <span className="text-right">When</span>
        </div>

        {isPending && items.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Spinner size={24} className="text-[var(--color-brand)]" />
          </div>
        ) : isError ? (
          <EmptyState title="Failed to load orders" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No orders yet"
            icon={<ShoppingCart size={32} className="opacity-20" />}
            desc={status ? `No orders with status "${status}"` : undefined}
          />
        ) : (
          <div ref={parentRef} style={{ height: 'min(620px, 65vh)', overflowY: 'auto' }}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vr => {
                const o = items[vr.index]
                return (
                  <div
                    key={vr.key}
                    style={{ position: 'absolute', top: vr.start, left: 0, right: 0, height: vr.size }}
                    className="grid items-center px-4 tr-hover border-b border-[var(--color-surface-4)]/40"
                    // gridTemplateColumns applied via inline
                  >
                    <div
                      className="grid items-center h-full w-full gap-0"
                      style={{ gridTemplateColumns: '140px 1fr 120px 100px 110px 100px' }}
                    >
                      <Link to={`/orders/${o.id}`} className="num text-xs text-[var(--color-brand)] hover:underline font-semibold truncate pr-2">
                        {o.order_number}
                      </Link>
                      <span className="text-xs text-[var(--color-text-3)] num truncate pr-2 opacity-60">
                        {o.customer_id.slice(0,8)}…
                      </span>
                      <span>
                        <Badge label={o.status} colorClass={ORDER_STATUS_COLORS[o.status]} />
                      </span>
                      <span>
                        <Badge label={o.payment_status} colorClass={PAYMENT_STATUS_COLORS[o.payment_status]} />
                      </span>
                      <span className="num text-xs font-semibold text-right text-[var(--color-text-1)] pr-2">
                        {fmtMoney(o.total, o.currency)}
                      </span>
                      <span className="text-xs text-right text-[var(--color-text-3)]">
                        {fmtAgo(o.created_at)}
                      </span>
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
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-[var(--color-text-3)]">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-surface-4)] text-[var(--color-text-2)] hover:border-[var(--color-brand)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-surface-4)] text-[var(--color-text-2)] hover:border-[var(--color-brand)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
