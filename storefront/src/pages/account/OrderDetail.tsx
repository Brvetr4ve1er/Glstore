/**
 * /account/orders/:id — one of the signed-in customer's orders.
 *
 * GET /account/orders/{id} answers in the same shape as the public tracking
 * lookup (TrackedOrder). Someone else's order, another store's, or an id that
 * is not a UUID all come back as "not found" — the page never says which.
 *
 * Status words are copied from pages/OrderTracking.tsx so the account page
 * and the public tracking page name an order's state the same way. The
 * timeline takes WHERE the order stands from `status` and WHEN each step
 * happened from the confirmed/shipped/delivered/cancelled timestamps.
 */
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, LogIn, Package, PackageSearch,
  ReceiptText, RotateCcw, Truck, XCircle, type LucideIcon,
} from 'lucide-react'
import { ApiError, fetchMyOrder, type TrackedOrder } from '@/lib/api'
import { ACCOUNT_QUERY_ROOT, loginPath } from '@/lib/session'
import { cn, fmtMoney, pluralize } from '@/lib/format'
import type { TagTone } from '@/lib/tags'
import { AccountShell } from '@/components/account/AccountShell'
import { Button, Spinner, Tag } from '@/components/ui'

const LIST_PATH = '/account/orders'

/* Same words as pages/OrderTracking.tsx STATUS_LABELS. */
const STATUS_LABELS: Record<string, { label: string; tone: TagTone }> = {
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

function statusOf(code: string): { label: string; tone: TagTone } {
  return STATUS_LABELS[code] ?? { label: code, tone: 'muted' }
}

/* The steps of pages/OrderTracking.tsx TIMELINE_STEPS, each paired with the
   timestamp the order records for it. */
type StepField = 'created_at' | 'confirmed_at' | 'shipped_at' | 'delivered_at'

const FLOW: { key: string; label: string; field: StepField; statuses: string[]; icon: LucideIcon }[] = [
  { key: 'received',  label: 'Reçue',     field: 'created_at',   icon: ReceiptText,  statuses: ['PENDING', 'RESERVED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
  { key: 'confirmed', label: 'Confirmée', field: 'confirmed_at', icon: CheckCircle2, statuses: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
  { key: 'shipping',  label: 'Expédiée',  field: 'shipped_at',   icon: Truck,        statuses: ['SHIPPED', 'DELIVERED'] },
  { key: 'delivered', label: 'Livrée',    field: 'delivered_at', icon: Package,      statuses: ['DELIVERED'] },
]

const TERMINAL_STATUSES = new Set(['CANCELLED', 'RETURNED', 'FAILED'])

type StepState = 'done' | 'current' | 'upcoming' | 'stopped'

interface TimelineEntry {
  key: string
  label: string
  at: string | null
  state: StepState
  icon: LucideIcon
}

/**
 * Where the order stands comes from `status` (the source of truth); a step
 * also counts as reached when its timestamp is set. A cancelled, returned or
 * failed order shows only the steps it actually reached, then a stop node.
 */
function buildTimeline(order: TrackedOrder): TimelineEntry[] {
  const stopped = TERMINAL_STATUSES.has(order.status)
  const currentIdx = stopped
    ? -1
    : FLOW.reduce((acc, step, i) => (step.statuses.includes(order.status) ? i : acc), 0)

  const entries: TimelineEntry[] = []
  FLOW.forEach((step, i) => {
    const at = order[step.field]
    const reached = i === 0 || (!stopped && i <= currentIdx) || at != null
    if (stopped && !reached) return
    entries.push({
      key: step.key,
      label: step.label,
      at,
      icon: step.icon,
      state: !reached ? 'upcoming' : i === currentIdx ? 'current' : 'done',
    })
  })

  if (stopped) {
    entries.push({
      key: 'stopped',
      label: statusOf(order.status).label,
      at: order.status === 'CANCELLED' ? order.cancelled_at : null,
      icon: XCircle,
      state: 'stopped',
    })
  }
  return entries
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  COD: 'Paiement à la livraison',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement bancaire',
  WALLET: 'Portefeuille électronique',
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Non réglée',
  PENDING: 'En attente de règlement',
  PAID: 'Réglée',
  REFUNDED: 'Remboursée',
  PARTIAL: 'Règlement partiel',
  FAILED: 'Paiement échoué',
}

const DATE_FMT = new Intl.DateTimeFormat('fr-DZ', { day: 'numeric', month: 'long', year: 'numeric' })
const DATE_TIME_FMT = new Intl.DateTimeFormat('fr-DZ', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function fmtDate(iso: string | null, fmt: Intl.DateTimeFormat = DATE_FMT): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : fmt.format(d)
}

/** The backend types the id as a UUID; anything else is a 422 there and
 *  "not found" here — without sending a request built from a stray path. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A 4xx will not fix itself on a second try; a network blip or 5xx might. */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

const LINK_BUTTON =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 tracking-wide transition-all duration-150'

export default function OrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const validId = UUID_RE.test(id)

  const q = useQuery({
    queryKey: [ACCOUNT_QUERY_ROOT, 'orders', id],
    queryFn: () => fetchMyOrder(id),
    enabled: validId,
    retry: shouldRetry,
  })

  const notFound =
    !validId || (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422))

  const title = notFound
    ? 'Commande introuvable'
    : q.data
      ? `Commande ${q.data.order_number}`
      : 'Détail de la commande'

  return (
    <AccountShell title={title}>
      <Link
        to={LIST_PATH}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] transition-colors mb-6"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Mes commandes
      </Link>

      {notFound ? (
        <NotFound />
      ) : q.isPending ? (
        <div role="status" className="flex items-center justify-center gap-3 py-20 text-[var(--color-text-3)]">
          <span aria-hidden="true">
            <Spinner size={22} className="text-[var(--color-electric-blue)]" />
          </span>
          <span className="text-sm">Chargement de la commande…</span>
        </div>
      ) : q.isError ? (
        <LoadError
          error={q.error}
          selfPath={`${LIST_PATH}/${id}`}
          retrying={q.isFetching}
          onRetry={() => { void q.refetch() }}
        />
      ) : (
        <OrderView order={q.data} />
      )}
    </AccountShell>
  )
}

function OrderView({ order }: { order: TrackedOrder }) {
  const reduceMotion = useReducedMotion()
  const status = statusOf(order.status)
  const placedOn = fmtDate(order.created_at, DATE_TIME_FMT)

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start"
    >
      <div className="flex flex-col gap-6 min-w-0">
        {/* ── Status + timeline ── */}
        <section aria-labelledby="order-progress-heading" className="glass-strong p-5 sm:p-6 relative overflow-hidden">
          <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
                Statut
              </div>
              <p className="text-sm text-[var(--color-text-2)] mt-1">
                {placedOn ? (
                  <>Passée le <time dateTime={order.created_at}>{placedOn}</time></>
                ) : (
                  'Date de commande non renseignée'
                )}
              </p>
            </div>
            <Tag label={status.label} tone={status.tone} />
          </div>

          <h2
            id="order-progress-heading"
            className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4"
          >
            Suivi de la commande
          </h2>
          <Timeline entries={buildTimeline(order)} />
        </section>

        {/* ── Items ── */}
        <section aria-labelledby="order-items-heading" className="glass p-5 sm:p-6">
          <h2
            id="order-items-heading"
            className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3"
          >
            Articles ({order.items.length})
          </h2>
          {order.items.length === 0 ? (
            <p className="text-sm text-[var(--color-text-3)]">Aucun article enregistré pour cette commande.</p>
          ) : (
            <ItemsTable order={order} />
          )}
        </section>
      </div>

      {/* ── Summary ── */}
      <section aria-labelledby="order-summary-heading" className="glass p-5 sm:p-6 lg:sticky lg:top-24">
        <h2
          id="order-summary-heading"
          className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4"
        >
          Récapitulatif
        </h2>
        <dl className="flex flex-col gap-2.5 text-sm">
          <SummaryRow term="Sous-total" value={fmtMoney(order.subtotal, order.currency)} />
          <SummaryRow term="Livraison" value={fmtMoney(order.shipping_cost, order.currency)} />
          {order.discount_amount > 0 && (
            <SummaryRow
              term="Remise"
              value={`− ${fmtMoney(order.discount_amount, order.currency)}`}
              valueClassName="text-[var(--color-success)]"
            />
          )}
          {order.tax_amount > 0 && (
            <SummaryRow term="Taxes" value={fmtMoney(order.tax_amount, order.currency)} />
          )}
          <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t border-[var(--color-surface-4)]">
            <dt className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">Total</dt>
            <dd className="num text-2xl font-black text-[var(--color-text-1)]">
              {fmtMoney(order.total, order.currency)}
            </dd>
          </div>
        </dl>

        <dl className="mt-6 pt-4 border-t border-[var(--color-surface-4)] flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-0.5">
              Mode de paiement
            </dt>
            <dd className="text-[var(--color-text-1)]">
              {PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-0.5">
              État du paiement
            </dt>
            <dd className="text-[var(--color-text-1)]">
              {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
            </dd>
          </div>
          {order.customer_name && (
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-0.5">
                Destinataire
              </dt>
              <dd className="text-[var(--color-text-1)] break-words">{order.customer_name}</dd>
            </div>
          )}
        </dl>
      </section>
    </motion.div>
  )
}

function SummaryRow({
  term, value, valueClassName,
}: { term: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-text-2)]">{term}</dt>
      <dd className={cn('num font-bold text-[var(--color-text-1)]', valueClassName)}>{value}</dd>
    </div>
  )
}

function ItemsTable({ order }: { order: TrackedOrder }) {
  const units = order.items.reduce((n, it) => n + it.quantity, 0)

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">
          Articles de la commande {order.order_number} : {units} {pluralize(units, 'unité')}
        </caption>
        <thead>
          <tr className="border-b border-[var(--color-surface-4)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            <th scope="col" className="text-left font-black py-2 pr-3">Article</th>
            <th scope="col" className="hidden sm:table-cell text-right font-black py-2 px-3 whitespace-nowrap">
              Prix unitaire
            </th>
            <th scope="col" className="text-right font-black py-2 px-3">
              <span aria-hidden="true">Qté</span>
              <span className="sr-only">Quantité</span>
            </th>
            <th scope="col" className="text-right font-black py-2 pl-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map(it => (
            <tr key={it.id} className="border-b border-[var(--color-surface-4)]/60 last:border-b-0 align-top">
              <td className="py-3 pr-3 min-w-[10rem]">
                <div className="font-semibold text-[var(--color-text-1)] break-words">{it.product_name}</div>
                <div className="num text-[11px] text-[var(--color-text-3)] mt-0.5 break-all">{it.variant_sku}</div>
                <div className="sm:hidden num text-[11px] text-[var(--color-text-3)] mt-0.5">
                  {fmtMoney(it.unit_price, order.currency)} l’unité
                </div>
              </td>
              <td className="hidden sm:table-cell py-3 px-3 text-right num text-[var(--color-text-2)] whitespace-nowrap">
                {fmtMoney(it.unit_price, order.currency)}
              </td>
              <td className="py-3 px-3 text-right num text-[var(--color-text-1)]">{it.quantity}</td>
              <td className="py-3 pl-3 text-right num font-bold text-[var(--color-text-1)] whitespace-nowrap">
                {fmtMoney(it.line_total, order.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATE_TEXT: Record<StepState, string> = {
  done: 'étape franchie',
  current: 'étape en cours',
  upcoming: 'étape à venir',
  stopped: 'statut final',
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, i) => {
        const last = i === entries.length - 1
        const date = fmtDate(entry.at, DATE_TIME_FMT)
        const Icon = entry.state === 'upcoming' ? Circle : entry.icon
        const reached = entry.state === 'done' || entry.state === 'current'

        return (
          <li
            key={entry.key}
            aria-current={entry.state === 'current' ? 'step' : undefined}
            className="relative flex gap-3.5 pb-5 last:pb-0"
          >
            {!last && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[17px] top-9 bottom-0 w-0.5 rounded-full',
                  reached && entries[i + 1]?.state !== 'upcoming'
                    ? 'bg-[var(--color-electric-blue)]/60'
                    : 'bg-[var(--color-surface-4)]',
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-[1] w-9 h-9 shrink-0 rounded-full flex items-center justify-center border-2',
                entry.state === 'stopped'
                  ? 'bg-[var(--color-hot-pink)]/15 border-[var(--color-hot-pink)] text-[var(--color-hot-pink)]'
                  : reached
                    ? 'bg-[var(--color-electric-blue)] border-[var(--color-electric-blue)] text-[var(--color-jet-black)]'
                    : 'bg-[var(--color-surface-2)] border-[var(--color-surface-4)] text-[var(--color-text-3)]',
                entry.state === 'current' && 'glow-brand',
              )}
            >
              <Icon size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-sm font-bold',
                    entry.state === 'upcoming' ? 'text-[var(--color-text-3)]' : 'text-[var(--color-text-1)]',
                  )}
                >
                  {entry.label}
                </span>
                <span className="sr-only">, {STATE_TEXT[entry.state]}</span>
                {entry.state === 'current' && (
                  <span aria-hidden="true" className="badge bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30">
                    Étape actuelle
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                {date && entry.at ? (
                  <time dateTime={entry.at}>{date}</time>
                ) : entry.state === 'upcoming' ? (
                  'À venir'
                ) : (
                  'Date non renseignée'
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function NotFound() {
  return (
    <div className="glass flex flex-col items-center text-center gap-4 px-6 py-16">
      <PackageSearch size={44} aria-hidden="true" className="text-[var(--color-text-3)]" />
      <p className="text-base font-bold text-[var(--color-text-1)]">Cette commande est introuvable.</p>
      <p className="text-sm text-[var(--color-text-3)] max-w-md leading-relaxed">
        Elle n’existe pas ou n’est pas associée au numéro de téléphone de votre compte.
      </p>
      <Link
        to={LIST_PATH}
        className={`${LINK_BUTTON} bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110`}
      >
        <ArrowLeft size={14} aria-hidden="true" /> Retour à mes commandes
      </Link>
    </div>
  )
}

function LoadError({
  error, selfPath, retrying, onRetry,
}: { error: Error; selfPath: string; retrying: boolean; onRetry: () => void }) {
  const expired = error instanceof ApiError && error.status === 401

  return (
    <div role="alert" className="glass-sm p-5 flex items-start gap-3 ring-1 ring-[var(--color-hot-pink)]/30">
      <AlertTriangle size={18} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[var(--color-text-1)]">
          {expired ? 'Votre session a expiré.' : 'Impossible de charger cette commande.'}
        </p>
        <p className="text-sm text-[var(--color-text-2)] mt-1">
          {expired
            ? 'Reconnectez-vous pour consulter cette commande.'
            : 'Le service ne répond pas pour le moment. Réessayez dans un instant.'}
        </p>
        <div className="mt-4">
          {expired ? (
            <Link
              to={loginPath(selfPath)}
              className={`${LINK_BUTTON} bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110`}
            >
              <LogIn size={14} aria-hidden="true" /> Se reconnecter
            </Link>
          ) : (
            <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" /> Réessayer
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
