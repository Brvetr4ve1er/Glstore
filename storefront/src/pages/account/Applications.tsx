/**
 * /account/applications — the signed-in customer's financing applications.
 *
 * Every figure and the caption beside it come from GET /financing/applications:
 * the response itself is the presentation handed to the ONE <EstimateLabel>
 * that captions the list. Status words are the server's `status_label`, shown
 * through <ApplicationStatusBadge>; this page never words a status itself.
 *
 * The route is wrapped in <RequireCustomer>; <AccountShell> owns the h1 + SEO.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Calculator, FileText, RefreshCw } from 'lucide-react'
import { ApiError, fetchMyApplications, type ApplicationSummary } from '@/lib/api'
import { cn, fmtAmount } from '@/lib/format'
import { loginPath } from '@/lib/session'
import { AccountShell } from '@/components/account/AccountShell'
import { ApplicationStatusBadge } from '@/components/financing/ApplicationStatusBadge'
import { EstimateLabel } from '@/components/financing/EstimateLabel'
import { Button, EmptyState, Spinner } from '@/components/ui'

const LIST_PATH = '/account/applications'

// Links styled like ui.tsx <Button> — a <button> cannot wrap a <Link>.
const LINK_BASE =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] tracking-wide'
const LINK_ACCENT =
  'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]'
const LINK_OUTLINE =
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5'

/** A 4xx will not change on retry; only retry server or network failures. */
function retryServerErrors(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

/** The API sends ISO timestamps (or null); a malformed one must not break the page. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('fr-DZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export default function ApplicationsPage() {
  const q = useQuery({
    queryKey: ['account', 'applications'],
    queryFn: fetchMyApplications,
    retry: retryServerErrors,
  })

  const hasItems = !!q.data && q.data.items.length > 0

  return (
    <AccountShell
      title="Mes demandes de financement"
      actions={hasItems ? (
        <Link to="/simulate" className={cn(LINK_BASE, LINK_OUTLINE, 'text-xs px-3 py-1.5')}>
          <Calculator size={14} aria-hidden="true" /> Simuler un financement
        </Link>
      ) : undefined}
    >
      <div className="page-enter">
        {q.isPending && (
          <div
            role="status"
            className="flex items-center justify-center gap-3 py-20 text-[var(--color-text-3)]"
          >
            <Spinner size={24} className="text-[var(--color-electric-blue)]" />
            <span className="text-sm">Chargement de vos demandes…</span>
          </div>
        )}

        {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />}

        {q.data && q.data.items.length === 0 && (
          <EmptyState
            icon={<FileText size={44} aria-hidden="true" className="text-[var(--color-text-3)] opacity-60" />}
            title="Aucune demande de financement"
            desc="Vous n'avez pas encore ouvert de demande. Commencez par une simulation : vous pourrez ensuite ouvrir votre demande."
            action={(
              <Link to="/simulate" className={cn(LINK_BASE, LINK_ACCENT)}>
                <Calculator size={16} aria-hidden="true" /> Simuler un financement
              </Link>
            )}
          />
        )}

        {q.data && q.data.items.length > 0 && (
          <section aria-labelledby="applications-list-title">
            <h2 id="applications-list-title" className="sr-only">Liste de vos demandes</h2>
            <EstimateLabel presentation={q.data} className="mb-5" />
            <ul className="flex flex-col gap-4">
              {q.data.items.map(app => (
                <li key={app.id}>
                  <ApplicationRow app={app} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AccountShell>
  )
}

function ApplicationRow({ app }: { app: ApplicationSummary }) {
  const isDraft = app.status === 'DRAFT'
  const detailPath = `${LIST_PATH}/${encodeURIComponent(app.id)}`
  const applyPath = `/apply/${encodeURIComponent(app.id)}`

  return (
    <article className="glass rounded-xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
            Référence
          </div>
          <h3 className="num text-lg font-black text-[var(--color-text-1)] break-all">
            {app.reference}
          </h3>
        </div>
        <ApplicationStatusBadge status={app.status} label={app.status_label} />
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            {app.submitted_at ? "Date d'envoi" : 'Date de création'}
          </dt>
          <dd className="text-sm font-semibold text-[var(--color-text-1)] mt-0.5">
            {fmtDate(app.submitted_at ?? app.created_at)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            Montant financé
          </dt>
          <dd className="num text-sm font-bold text-[var(--color-text-1)] mt-0.5">
            {fmtAmount(app.financed_amount)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            Remboursement mensuel estimé
          </dt>
          <dd className="num text-sm font-bold text-[var(--color-neon-yellow)] mt-0.5">
            {fmtAmount(app.monthly_instalment)}{' '}
            <span className="text-[var(--color-text-2)] font-semibold">× {app.duration_months} mois</span>
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-[var(--color-surface-4)]">
        {isDraft && (
          <Link to={applyPath} className={cn(LINK_BASE, LINK_ACCENT)}>
            Continuer ma demande
            <span className="sr-only"> {app.reference}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
        <Link to={detailPath} className={cn(LINK_BASE, LINK_OUTLINE)}>
          Voir le détail
          <span className="sr-only"> de la demande {app.reference}</span>
        </Link>
      </div>
    </article>
  )
}

function LoadError({
  error, onRetry, retrying,
}: { error: Error; onRetry: () => void; retrying: boolean }) {
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div
        role="alert"
        className="glass-sm rounded-xl p-4 flex items-start gap-3 border border-[var(--color-hot-pink)]/30"
      >
        <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--color-text-2)]">
          Votre session a expiré.{' '}
          <Link to={loginPath(LIST_PATH)} className="font-bold text-[var(--color-electric-blue)] hover:underline">
            Reconnectez-vous
          </Link>{' '}
          pour retrouver vos demandes.
        </p>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="glass-sm rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 border border-[var(--color-hot-pink)]/30"
    >
      <div className="flex items-start gap-3 flex-1">
        <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--color-text-2)]">
          Impossible de charger vos demandes pour le moment. Vérifiez votre connexion puis réessayez.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
        {!retrying && <RefreshCw size={14} aria-hidden="true" />} Réessayer
      </Button>
    </div>
  )
}
