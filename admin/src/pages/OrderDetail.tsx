import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle, XCircle, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { useState } from 'react'
import { fetchOrder, confirmOrder, cancelOrder } from '@/lib/api'
import { Badge, Button, Card, Modal, Spinner, EmptyState, PageHeader } from '@/components/ui'
import { ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS, fmtMoney, fmtDate, fmtAgo } from '@/lib/utils'

const ORDER_FLOW = ['PENDING','RESERVED','CONFIRMED','PACKED','SHIPPED','DELIVERED']

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const qc     = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const { data: order, isPending, isError } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  })

  const confirmMut = useMutation({
    mutationFn: () => confirmOrder(id!),
    onSuccess: () => {
      toast.success('Order confirmed')
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelMut = useMutation({
    mutationFn: () => cancelOrder(id!, cancelReason || undefined),
    onSuccess: () => {
      toast.success('Order cancelled')
      setCancelOpen(false)
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isPending) return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={28} className="text-[var(--color-brand)]" />
    </div>
  )

  if (isError || !order) return (
    <EmptyState title="Order not found" action={<Link to="/orders" className="text-sm text-[var(--color-brand)] hover:underline">← Back to orders</Link>} />
  )

  const canConfirm = order.status === 'RESERVED'
  const canCancel  = !['DELIVERED','CANCELLED','RETURNED','FAILED'].includes(order.status)
  const flowIdx    = ORDER_FLOW.indexOf(order.status)

  return (
    <div className="flex flex-col gap-6 page-enter">
      <Link to="/orders" className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text-2)] w-fit transition-colors">
        <ArrowLeft size={14} /> Back to Orders
      </Link>

      <PageHeader
        title={order.order_number}
        sub={`Created ${fmtDate(order.created_at)} · ${fmtAgo(order.created_at)}`}
        actions={
          <div className="flex gap-2">
            {canConfirm && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => confirmMut.mutate()}
                loading={confirmMut.isPending}
              >
                <CheckCircle size={14} /> Confirm
              </Button>
            )}
            {canCancel && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setCancelOpen(true)}
              >
                <XCircle size={14} /> Cancel
              </Button>
            )}
          </div>
        }
      />

      {/* Progress bar */}
      {!['CANCELLED','RETURNED','FAILED'].includes(order.status) && (
        <div className="glass p-4" data-aos="fade-up-sm">
          <div className="flex items-center gap-0">
            {ORDER_FLOW.map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className={`flex flex-col items-center gap-1 ${i <= flowIdx ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-3)]'}`}>
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                    i < flowIdx  ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white' :
                    i === flowIdx ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/15 text-[var(--color-brand)]' :
                    'border-[var(--color-surface-4)] bg-transparent text-[var(--color-text-3)]'
                  }`}>{i+1}</div>
                  <span className="text-[9px] uppercase tracking-wide font-medium hidden sm:block">{s}</span>
                </div>
                {i < ORDER_FLOW.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded transition-all ${i < flowIdx ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-surface-4)]'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Line items */}
        <Card data-aos="fade-up-sm">
          <h3 className="text-sm font-semibold text-[var(--color-text-2)] mb-3 uppercase tracking-wide flex items-center gap-2">
            <Package size={14} /> Items ({order.items.length})
          </h3>
          <div className="flex flex-col divide-y divide-[var(--color-surface-4)]/50">
            {order.items.map(item => (
              <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text-1)] truncate">{item.product_name}</div>
                  <div className="text-xs text-[var(--color-text-3)] num mt-0.5">{item.variant_sku} · ×{item.quantity}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num text-sm font-semibold text-[var(--color-text-1)]">{fmtMoney(item.line_total)}</div>
                  <div className="num text-xs text-[var(--color-text-3)]">{fmtMoney(item.unit_price)} each</div>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="mt-4 pt-4 border-t border-[var(--color-surface-4)] flex flex-col gap-1.5">
            {[
              ['Subtotal', order.subtotal],
              ['Shipping', order.shipping_cost],
              ['Discount', -order.discount_amount],
              ['Tax', order.tax_amount],
            ].map(([label, val]) => (
              <div key={String(label)} className="flex justify-between text-sm text-[var(--color-text-3)]">
                <span>{label}</span>
                <span className="num">{fmtMoney(Number(val))}</span>
              </div>
            ))}
            <div className="flex justify-between text-base font-bold text-[var(--color-text-1)] pt-2 border-t border-[var(--color-surface-4)] mt-1">
              <span>Total</span>
              <span className="num">{fmtMoney(order.total, order.currency)}</span>
            </div>
          </div>
        </Card>

        {/* Metadata */}
        <div className="flex flex-col gap-4">
          <Card data-aos="fade-up-sm" data-aos-delay="40">
            <h3 className="text-xs font-semibold text-[var(--color-text-3)] uppercase tracking-widest mb-3">Status</h3>
            <div className="flex flex-wrap gap-2">
              <Badge label={order.status} colorClass={ORDER_STATUS_COLORS[order.status]} />
              <Badge label={order.payment_status} colorClass={PAYMENT_STATUS_COLORS[order.payment_status]} />
              <Badge label={order.payment_method} />
            </div>
          </Card>

          <Card data-aos="fade-up-sm" data-aos-delay="60">
            <h3 className="text-xs font-semibold text-[var(--color-text-3)] uppercase tracking-widest mb-3">Details</h3>
            <dl className="flex flex-col gap-2 text-sm">
              {[
                ['Order ID', <span className="num text-xs break-all">{order.id}</span>],
                ['Customer',  <span className="num text-xs">{order.customer_id.slice(0,12)}…</span>],
                ['Created', fmtDate(order.created_at)],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex flex-col gap-0.5">
                  <dt className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wide">{k}</dt>
                  <dd className="text-[var(--color-text-2)]">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {/* Cancel modal */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel Order">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-2)]">
            Cancelling <span className="font-semibold text-[var(--color-text-1)]">{order.order_number}</span> will release reserved stock immediately.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wide">Reason (optional)</label>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Customer requested cancel…"
              className="px-3 py-2 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-brand)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none resize-none transition-colors"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Nevermind</Button>
            <Button variant="danger" onClick={() => cancelMut.mutate()} loading={cancelMut.isPending}>
              Cancel Order
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
