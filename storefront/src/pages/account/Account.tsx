/**
 * /account — the signed-in customer's overview.
 *
 * Three blocks inside <AccountShell>: who is signed in (phone, name, when the
 * phone was verified), the three latest financing applications and the three
 * latest orders. Both lists come back newest first from the API
 * (ORDER BY created_at DESC), so the first three ARE the latest three.
 *
 * The full responses are cached under the shared account keys — the list
 * pages read the same entries — and only sliced at render time.
 *
 * Compliance: application status words are the server's `status_label`,
 * shown through ApplicationStatusBadge. The only financing figure here is the
 * financed amount, and the panel carries the server's EstimateLabel beside it.
 * No per-month figure is rendered on this page.
 */
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRight, BadgeCheck, Calculator, FileText, Package,
  Phone, RotateCw, ShoppingBag, User,
} from 'lucide-react'
import {
  ApiError, fetchMyApplications, fetchMyOrders,
  type ApplicationSummary, type Customer, type FinancingPresentation, type MyOrderSummary,
} from '@/lib/api'
import { loginPath, useCustomer } from '@/lib/session'
import { cn, fmtAmount, fmtMoney, pluralize } from '@/lib/format'
import { Button, Spinner } from '@/components/ui'
import { AccountShell } from '@/components/account/AccountShell'
import { ApplicationStatusBadge } from '@/components/financing/ApplicationStatusBadge'
import { EstimateLabel } from '@/components/financing/EstimateLabel'

const LATEST = 3

type ApplicationsResponse = FinancingPresentation & { items: ApplicationSummary[] }
type OrdersResponse = { items: MyOrderSummary[] }

/** A dead session is not worth a second request; anything else gets the
 *  store-wide single retry. */
function retryUnlessUnauthorized(failures: number, error: Error): boolean {
  if (error instanceof ApiError && error.status === 401) return false
  return failures < 1
}

const DATE_FMT = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'medium' })

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : DATE_FMT.format(d)
}

/** "Créée le 24 sept. 2026" — or the fallback alone when the date is missing,
 *  so a null never reads "Créée le Date inconnue". */
function DateText({
  iso, prefix, fallback = 'Date inconnue',
}: { iso: string | null; prefix?: string; fallback?: string }) {
  const text = formatDate(iso)
  if (!text || !iso) return <span>{fallback}</span>
  return (
    <span>
      {prefix && `${prefix} `}
      <time dateTime={iso}>{text}</time>
    </span>
  )
}

const linkBase =
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'
const linkGhost = cn(linkBase, 'text-xs px-2.5 py-1.5 text-[var(--color-electric-blue)] hover:bg-[var(--color-surface-3)]')
const linkOutline = cn(
  linkBase,
  'text-sm px-4 py-2.5 border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5',
)
const linkAccent = cn(
  linkBase,
  'text-xs px-3 py-1.5 bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105',
)

export default function AccountPage() {
  const { customer, signedIn } = useCustomer()

  const applications = useQuery({
    queryKey: ['account', 'applications'],
    queryFn: fetchMyApplications,
    enabled: signedIn,
    retry: retryUnlessUnauthorized,
  })

  const orders = useQuery({
    queryKey: ['account', 'orders'],
    queryFn: fetchMyOrders,
    enabled: signedIn,
    retry: retryUnlessUnauthorized,
  })

  return (
    <AccountShell title="Mon compte">
      <div className="page-enter flex flex-col gap-6">
        {customer && <ProfilePanel customer={customer} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <ApplicationsPanel query={applications} />
          <OrdersPanel query={orders} />
        </div>
      </div>
    </AccountShell>
  )
}

// ── Profile ──────────────────────────────────────────────────

function ProfilePanel({ customer }: { customer: Customer }) {
  return (
    <section aria-labelledby="account-profile-title" className="glass p-5 sm:p-6 rounded-xl">
      <h2
        id="account-profile-title"
        className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-4"
      >
        Mes informations
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ProfileItem icon={<Phone size={16} aria-hidden="true" />} term="Téléphone">
          <span className="num">{customer.phone}</span>
        </ProfileItem>

        {customer.full_name && (
          <ProfileItem icon={<User size={16} aria-hidden="true" />} term="Nom">
            {customer.full_name}
          </ProfileItem>
        )}

        <ProfileItem icon={<BadgeCheck size={16} aria-hidden="true" />} term="Téléphone vérifié le">
          <DateText iso={customer.phone_verified_at} fallback="—" />
        </ProfileItem>
      </dl>
    </section>
  )
}

/** dl > div > (dt, dd) is the only valid grouping inside a <dl>, so the
 *  decorative icon lives inside the <dt> and a grid lays it out beside both. */
function ProfileItem({ icon, term, children }: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[2.25rem_1fr] gap-x-3 items-start min-w-0">
      <dt className="contents">
        <span
          aria-hidden="true"
          className="row-span-2 w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] flex items-center justify-center"
        >
          {icon}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">{term}</span>
      </dt>
      <dd className="col-start-2 text-sm font-semibold text-[var(--color-text-1)] break-words mt-0.5 min-w-0">{children}</dd>
    </div>
  )
}

// ── Panels ───────────────────────────────────────────────────

function Panel({
  id, title, icon, seeAllTo, seeAllLabel, children,
}: {
  id: string
  title: string
  icon: ReactNode
  seeAllTo: string
  /** Completes "Tout voir" for screen readers, so the two links differ. */
  seeAllLabel: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="glass p-5 sm:p-6 rounded-xl flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="flex items-center gap-2 text-lg font-black text-[var(--color-text-1)]">
          <span className="text-[var(--color-electric-blue)]">{icon}</span>
          {title}
        </h2>
        <Link to={seeAllTo} className={linkGhost}>
          Tout voir<span className="sr-only"> : {seeAllLabel}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {children}
    </section>
  )
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-8 justify-center text-sm text-[var(--color-text-3)]">
      <Spinner size={18} className="text-[var(--color-electric-blue)]" />
      <span>{label}</span>
    </div>
  )
}

function PanelError({
  error, message, onRetry, retrying,
}: { error: Error; message: string; onRetry: () => void; retrying: boolean }) {
  const location = useLocation()
  const expired = error instanceof ApiError && error.status === 401
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl p-4 border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/5"
    >
      <p className="flex items-start gap-2 text-sm text-[var(--color-text-2)]">
        <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <span>{expired ? 'Votre session a expiré. Reconnectez-vous pour retrouver votre compte.' : message}</span>
      </p>
      <div>
        {expired ? (
          <Link to={loginPath(location.pathname + location.search)} className={linkOutline}>
            Se reconnecter
          </Link>
        ) : (
          <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
            {!retrying && <RotateCw size={14} aria-hidden="true" />} Réessayer
          </Button>
        )}
      </div>
    </div>
  )
}

function PanelEmpty({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-xl border border-dashed border-[var(--color-surface-4)]">
      <p className="text-sm text-[var(--color-text-2)]">{text}</p>
      {action}
    </div>
  )
}

// ── Applications ─────────────────────────────────────────────

function ApplicationsPanel({ query }: { query: UseQueryResult<ApplicationsResponse, Error> }) {
  const titleId = 'account-applications-title'
  return (
    <Panel
      id={titleId}
      title="Mes demandes de financement"
      icon={<FileText size={18} aria-hidden="true" />}
      seeAllTo="/account/applications"
      seeAllLabel="mes demandes de financement"
    >
      {query.isPending ? (
        <PanelLoading label="Chargement de vos demandes…" />
      ) : query.isError ? (
        <PanelError
          error={query.error}
          message="Impossible de charger vos demandes de financement pour le moment."
          onRetry={() => { void query.refetch() }}
          retrying={query.isFetching}
        />
      ) : query.data.items.length === 0 ? (
        <PanelEmpty
          text="Vous n'avez encore aucune demande de financement."
          action={
            <Link to="/simulate" className={linkOutline}>
              <Calculator size={16} aria-hidden="true" /> Simuler un financement
            </Link>
          }
        />
      ) : (
        <>
          {/* Caption first: a screen reader or a narrow screen meets it
              before any of the figures it qualifies. */}
          <EstimateLabel presentation={query.data} />
          <ul className="flex flex-col gap-2">
            {query.data.items.slice(0, LATEST).map(a => (
              <ApplicationRow key={a.id} application={a} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function ApplicationRow({ application: a }: { application: ApplicationSummary }) {
  return (
    <li className="glass-sm rounded-xl px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num font-black text-[var(--color-text-1)] truncate">{a.reference}</p>
          <p className="text-xs text-[var(--color-text-3)] mt-0.5">
            <DateText iso={a.created_at} prefix="Créée le" />
          </p>
        </div>
        <ApplicationStatusBadge status={a.status} label={a.status_label} className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-3)]">
          Montant financé{' '}
          <span className="num font-bold text-[var(--color-text-1)]">{fmtAmount(a.financed_amount)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.status === 'DRAFT' && (
            <Link to={`/apply/${a.id}`} className={linkAccent}>
              Continuer ma demande<span className="sr-only"> {a.reference}</span>
            </Link>
          )}
          <Link to={`/account/applications/${a.id}`} className={linkGhost}>
            Voir le détail<span className="sr-only"> de la demande {a.reference}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </li>
  )
}

// ── Orders ───────────────────────────────────────────────────

function OrdersPanel({ query }: { query: UseQueryResult<OrdersResponse, Error> }) {
  const titleId = 'account-orders-title'
  return (
    <Panel
      id={titleId}
      title="Mes commandes"
      icon={<Package size={18} aria-hidden="true" />}
      seeAllTo="/account/orders"
      seeAllLabel="mes commandes"
    >
      {query.isPending ? (
        <PanelLoading label="Chargement de vos commandes…" />
      ) : query.isError ? (
        <PanelError
          error={query.error}
          message="Impossible de charger vos commandes pour le moment."
          onRetry={() => { void query.refetch() }}
          retrying={query.isFetching}
        />
      ) : query.data.items.length === 0 ? (
        <PanelEmpty
          text="Vous n'avez encore passé aucune commande."
          action={
            <Link to="/c/all" className={linkOutline}>
              <ShoppingBag size={16} aria-hidden="true" /> Parcourir le catalogue
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {query.data.items.slice(0, LATEST).map(o => (
            <OrderRow key={o.id} order={o} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function OrderRow({ order: o }: { order: MyOrderSummary }) {
  return (
    <li className="glass-sm rounded-xl px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num font-black text-[var(--color-neon-yellow)] truncate">{o.order_number}</p>
          <p className="text-xs text-[var(--color-text-3)] mt-0.5">
            <DateText iso={o.created_at} prefix="Passée le" />
            {' · '}
            {o.item_count} {pluralize(o.item_count, 'article')}
          </p>
        </div>
        <p className="num font-black text-[var(--color-text-1)] shrink-0">{fmtMoney(o.total, o.currency)}</p>
      </div>
      <div className="flex justify-end">
        <Link to={`/account/orders/${o.id}`} className={linkGhost}>
          Voir le détail<span className="sr-only"> de la commande {o.order_number}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}
