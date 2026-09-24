/**
 * /account/orders — every order placed with the signed-in phone number.
 *
 * The server matches orders on every legacy spelling of the session's phone
 * (api/routes/customer_account.py), so orders placed at checkout before the
 * shopper ever signed in show up here too. Totals on this endpoint are plain
 * numbers (not the financing API's decimal strings) → fmtMoney.
 *
 * The route is wrapped in <RequireCustomer>; a 401 here means the session
 * expired mid-visit — lib/api.ts has already signed the shopper out, so the
 * page only offers the way back in.
 *
 * Status wording is copied from pages/OrderTracking.tsx so both surfaces
 * name an order's state the same way.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ChevronRight, LogIn, PackageOpen, RotateCcw } from 'lucide-react'
import { ApiError, fetchMyOrders, type MyOrderSummary } from '@/lib/api'
import { ACCOUNT_QUERY_ROOT, loginPath } from '@/lib/session'
import { fmtMoney, pluralize } from '@/lib/format'
import type { TagTone } from '@/lib/tags'
import { AccountShell } from '@/components/account/AccountShell'
import { Button, EmptyState, Spinner, Tag } from '@/components/ui'

const SELF_PATH = '/account/orders'

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

const DATE_FMT = new Intl.DateTimeFormat('fr-DZ', { day: 'numeric', month: 'long', year: 'numeric' })

function fmtDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : DATE_FMT.format(d)
}

/** A 4xx will not fix itself on a second try; a network blip or 5xx might. */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

const LINK_BUTTON =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 tracking-wide transition-all duration-150'

export default function OrdersPage() {
  const q = useQuery({
    queryKey: [ACCOUNT_QUERY_ROOT, 'orders'],
    queryFn: fetchMyOrders,
    retry: shouldRetry,
  })

  return (
    <AccountShell title="Mes commandes">
      {q.isPending ? (
        <div role="status" className="flex items-center justify-center gap-3 py-20 text-[var(--color-text-3)]">
          <span aria-hidden="true">
            <Spinner size={22} className="text-[var(--color-electric-blue)]" />
          </span>
          <span className="text-sm">Chargement de vos commandes…</span>
        </div>
      ) : q.isError ? (
        <LoadError error={q.error} retrying={q.isFetching} onRetry={() => { void q.refetch() }} />
      ) : q.data.items.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={<PackageOpen size={44} aria-hidden="true" className="text-[var(--color-text-3)]" />}
            title="Aucune commande pour le moment"
            desc="Les commandes passées avec votre numéro de téléphone apparaîtront ici."
            action={
              <Link
                to="/c/all"
                className={`${LINK_BUTTON} bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]`}
              >
                Parcourir le catalogue
              </Link>
            }
          />
        </div>
      ) : (
        <OrderList orders={q.data.items} />
      )}
    </AccountShell>
  )
}

function OrderList({ orders }: { orders: MyOrderSummary[] }) {
  const reduceMotion = useReducedMotion()
  const count = orders.length

  return (
    <section aria-labelledby="orders-list-heading">
      <h2 id="orders-list-heading" className="sr-only">Liste de vos commandes</h2>
      <p className="text-sm text-[var(--color-text-3)] mb-4">
        {count} {pluralize(count, 'commande')}, de la plus récente à la plus ancienne.
      </p>
      <ul className="flex flex-col gap-3">
        {orders.map((order, i) => (
          <motion.li
            key={order.id}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: Math.min(i, 8) * 0.03 }}
            className="relative glass-sm p-4 sm:p-5 transition-shadow hover:ring-1 hover:ring-[var(--color-electric-blue)]/40"
          >
            <OrderRow order={order} />
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

function OrderRow({ order }: { order: MyOrderSummary }) {
  const status = statusOf(order.status)
  const date = fmtDate(order.created_at)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
            Commande
          </div>
          <div className="num text-base sm:text-lg font-black text-[var(--color-neon-yellow)] break-all">
            {order.order_number}
          </div>
          <p className="text-xs text-[var(--color-text-3)] mt-1">
            {date && order.created_at ? (
              <>Passée le <time dateTime={order.created_at}>{date}</time></>
            ) : (
              'Date non renseignée'
            )}
            {' · '}
            {order.item_count} {pluralize(order.item_count, 'article')}
          </p>
        </div>
        <Tag label={status.label} tone={status.tone} />
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--color-surface-4)] flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">Total</div>
          <div className="num text-lg font-black text-[var(--color-text-1)]">
            {fmtMoney(order.total, order.currency)}
          </div>
        </div>
        {/* The link's ::after covers the whole card, so the card is one
            target; its outline is drawn on that overlay for keyboard users. */}
        <Link
          to={`${SELF_PATH}/${encodeURIComponent(order.id)}`}
          className="inline-flex items-center gap-1 text-xs font-bold text-[var(--color-electric-blue)] hover:underline after:absolute after:inset-0 after:content-[''] after:rounded-[14px] focus-visible:[outline:none] focus-visible:after:[outline:2px_solid_var(--color-electric-blue)] focus-visible:after:[outline-offset:2px]"
        >
          Voir le détail
          <span className="sr-only"> de la commande {order.order_number}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </>
  )
}

function LoadError({
  error, retrying, onRetry,
}: { error: Error; retrying: boolean; onRetry: () => void }) {
  const expired = error instanceof ApiError && error.status === 401

  return (
    <div role="alert" className="glass-sm p-5 flex items-start gap-3 ring-1 ring-[var(--color-hot-pink)]/30">
      <AlertTriangle size={18} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[var(--color-text-1)]">
          {expired ? 'Votre session a expiré.' : 'Impossible de charger vos commandes.'}
        </p>
        <p className="text-sm text-[var(--color-text-2)] mt-1">
          {expired
            ? 'Reconnectez-vous pour retrouver vos commandes.'
            : 'Le service ne répond pas pour le moment. Réessayez dans un instant.'}
        </p>
        <div className="mt-4">
          {expired ? (
            <Link
              to={loginPath(SELF_PATH)}
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
