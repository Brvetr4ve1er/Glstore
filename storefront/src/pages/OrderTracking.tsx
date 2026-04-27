import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Package, Phone, Truck, CheckCircle2, XCircle,
  Clock, AlertTriangle,
} from 'lucide-react'
import { trackOrder, type TrackedOrder } from '@/lib/api'
import { fmtMoney } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Button, Card, Input } from '@/components/ui'
import { SEO } from '@/components/SEO'


/**
 * Visual order timeline. Each status maps to a step. PENDING/RESERVED ≈ "received",
 * CONFIRMED → "confirmed", PACKED/SHIPPED → "shipping", DELIVERED → "delivered".
 * CANCELLED/RETURNED/FAILED branch the timeline to a terminal red node.
 */
const TIMELINE_STEPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'received',  label: 'Reçue',     statuses: ['PENDING', 'RESERVED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
  { key: 'confirmed', label: 'Confirmée', statuses: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
  { key: 'shipping',  label: 'Expédiée',  statuses: ['SHIPPED', 'DELIVERED'] },
  { key: 'delivered', label: 'Livrée',    statuses: ['DELIVERED'] },
]

const STATUS_LABELS: Record<string, { label: string; tone: 'electric' | 'yellow' | 'pink' | 'success' }> = {
  PENDING:   { label: 'Réception',  tone: 'yellow' },
  RESERVED:  { label: 'En attente', tone: 'yellow' },
  CONFIRMED: { label: 'Confirmée',  tone: 'electric' },
  PACKED:    { label: 'Préparée',   tone: 'electric' },
  SHIPPED:   { label: 'Expédiée',   tone: 'electric' },
  DELIVERED: { label: 'Livrée',     tone: 'success' },
  CANCELLED: { label: 'Annulée',    tone: 'pink' },
  RETURNED:  { label: 'Retournée',  tone: 'pink' },
  FAILED:    { label: 'Échec',      tone: 'pink' },
}

const TONE_BG: Record<string, string> = {
  electric: 'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border-[var(--color-electric-blue)]/30',
  yellow:   'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border-[var(--color-neon-yellow)]/30',
  pink:     'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border-[var(--color-hot-pink)]/30',
  success:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
}


export default function OrderTrackingPage() {
  const [orderNumber, setOrderNumber] = useState('')
  const [phone, setPhone] = useState('')

  const mut = useMutation({
    mutationFn: () => trackOrder(orderNumber.trim(), phone.trim()),
    // we keep the raw error: backend returns 404 for both unknown order# and phone mismatch
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orderNumber.trim() || !phone.trim()) return
    mut.mutate()
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Suivre ma commande"
        description="Suivez l’état de votre commande Ghir Laffaire avec votre numéro et téléphone."
        noIndex
      />
      <Breadcrumbs items={[{ label: 'Suivi de commande' }]} />

      <div className="mt-4 mb-6">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Suivi</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2">
          Saisissez votre numéro de commande et le téléphone utilisé lors de l'achat.
        </p>
      </div>

      <Card className="mb-6">
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Input
            label="N° de commande"
            value={orderNumber}
            onChange={e => setOrderNumber(e.target.value)}
            placeholder="GL-2026-000123"
            autoComplete="off"
          />
          <Input
            label="Téléphone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="0555 12 34 56"
            autoComplete="tel"
          />
          <Button type="submit" variant="accent" size="md" loading={mut.isPending} disabled={!orderNumber || !phone}>
            <Search size={14} /> Rechercher
          </Button>
        </form>
      </Card>

      {/* Error */}
      <AnimatePresence>
        {mut.isError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-sm p-4 mb-6 flex items-start gap-3 border border-[var(--color-hot-pink)]/30"
          >
            <AlertTriangle size={16} className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
            <div className="text-sm text-[var(--color-text-2)]">
              Aucune commande ne correspond à ces informations. Vérifiez le numéro et le téléphone.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {mut.data && (
          <motion.div
            key={mut.data.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <OrderResult order={mut.data} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


function OrderResult({ order }: { order: TrackedOrder }) {
  const status = STATUS_LABELS[order.status] ?? { label: order.status, tone: 'electric' as const }
  const isCancelled = order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'FAILED'

  return (
    <div className="glass-strong p-6 relative overflow-hidden">
      <div aria-hidden className="absolute top-0 left-0 right-0 h-1 brand-stripe" />

      <div className="flex items-center justify-between gap-4 mb-5">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
            Numéro de commande
          </div>
          <div className="num text-2xl font-black text-[var(--color-neon-yellow)]">
            {order.order_number}
          </div>
        </div>
        <span className={`badge text-xs px-3 py-1.5 border ${TONE_BG[status.tone]}`}>
          {status.label}
        </span>
      </div>

      {/* Timeline */}
      {!isCancelled ? (
        <Timeline status={order.status} />
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-hot-pink)]/10 border border-[var(--color-hot-pink)]/25 mb-4">
          <XCircle size={16} className="text-[var(--color-hot-pink)]" />
          <span className="text-sm text-[var(--color-text-1)] font-semibold">
            Cette commande a été {status.label.toLowerCase()}.
          </span>
        </div>
      )}

      {/* Items */}
      <div className="mt-6">
        <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3">
          Articles ({order.items.length})
        </h3>
        <ul className="flex flex-col gap-2">
          {order.items.map(it => (
            <li key={it.id} className="glass-sm flex items-center justify-between px-3 py-2.5 gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--color-text-1)] font-semibold truncate">{it.product_name}</div>
                <div className="text-[10px] num text-[var(--color-text-3)]">{it.variant_sku} · ×{it.quantity}</div>
              </div>
              <div className="num font-bold text-[var(--color-text-1)] shrink-0">
                {fmtMoney(it.line_total, order.currency)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Total */}
      <div className="mt-5 pt-4 border-t border-[var(--color-surface-4)] flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">Total</span>
        <span className="num text-2xl font-black text-[var(--color-text-1)]">
          {fmtMoney(order.total, order.currency)}
        </span>
      </div>

      {/* Customer + meta */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-[var(--color-text-3)]">
        <div>
          <div className="uppercase tracking-wider font-bold mb-0.5">Destinataire</div>
          <div className="text-[var(--color-text-2)]">{order.customer_name}</div>
        </div>
        <div className="text-right">
          <div className="uppercase tracking-wider font-bold mb-0.5">Paiement</div>
          <div className="text-[var(--color-text-2)]">{order.payment_method} · {order.payment_status}</div>
        </div>
      </div>
    </div>
  )
}


function Timeline({ status }: { status: string }) {
  const reachedIndex = TIMELINE_STEPS.findIndex(s => !s.statuses.includes(status))
  const reached = reachedIndex === -1 ? TIMELINE_STEPS.length : reachedIndex

  return (
    <div className="grid grid-cols-4 gap-2">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < reached
        const current = i === reached - 1 || (reached === TIMELINE_STEPS.length && i === TIMELINE_STEPS.length - 1)
        const Icon = STEP_ICONS[step.key] ?? Clock
        return (
          <div key={step.key} className="flex flex-col items-center text-center gap-2">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                done
                  ? 'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] border-[var(--color-electric-blue)]'
                  : 'border-[var(--color-surface-4)] text-[var(--color-text-3)]'
              } ${current ? 'glow-brand' : ''}`}
            >
              <Icon size={14} />
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${done ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-3)]'}`}>
              {step.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}


const STEP_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  received:  Phone,
  confirmed: CheckCircle2,
  shipping:  Truck,
  delivered: Package,
}
