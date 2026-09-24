/**
 * /apply/:id?step=1..4 — the stepper for one DRAFT financing application.
 *
 *   1 Récapitulatif · 2 Votre situation · 3 Pièces justificatives · 4 Envoi
 *
 * The step lives in the URL (parsed and clamped by steps.ts), so back/forward
 * and a reload land on the same step. Once the application has left DRAFT
 * nothing is editable: the page shows the server-worded status and points to
 * the account page that follows it.
 *
 * Mounted behind <RequireCustomer> by the router; every query key here
 * starts with 'account', so signing out clears it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, RefreshCw, SearchX } from 'lucide-react'
import { ApiError, fetchMyApplication, type ApplicationDetail } from '@/lib/api'
import { loginPath } from '@/lib/session'
import { cn } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { SEO } from '@/components/SEO'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { ApplicationStatusBadge } from '@/components/financing/ApplicationStatusBadge'
import {
  APPLY_STEPS, LAST_STEP, applicationKey, parseStep, retryUnlessClientError, stepHref, stepLabel,
  type StepNumber,
} from './steps'
import { StepSummary } from './StepSummary'
import { StepProfile } from './StepProfile'
import { StepDocuments } from './StepDocuments'
import { StepSubmit, SubmitSuccess, type SubmitResult } from './StepSubmit'

const LINK_BUTTON =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 ' +
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] transition-colors'

export default function ApplyPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const rawStep = searchParams.get('step')
  const step = parseStep(rawStep)

  // Keyed by the route id: the same page instance can be reused for another.
  const [submitted, setSubmitted] = useState<{ routeId: string; result: SubmitResult } | null>(null)

  // A missing, unreadable or out-of-range ?step= is replaced by the step shown.
  useEffect(() => {
    if (rawStep === String(step)) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('step', String(step))
      return next
    }, { replace: true })
  }, [rawStep, step, setSearchParams])

  const query = useQuery({
    queryKey: applicationKey(id),
    queryFn: () => fetchMyApplication(id),
    enabled: id !== '',
    retry: retryUnlessClientError,
  })
  const app = query.data

  // Moving between steps: put keyboard and screen-reader focus on the new step.
  const panelRef = useRef<HTMLElement>(null)
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    window.scrollTo({ top: 0 })
    panelRef.current?.focus({ preventScroll: true })
  }, [step])

  const goTo = (n: StepNumber) => navigate(stepHref(id, n))

  const justSent = submitted?.routeId === id ? submitted.result : null
  const reference = justSent?.reference ?? app?.reference

  let body: ReactNode
  if (!id) {
    body = <NotFoundPanel />
  } else if (justSent) {
    body = <SubmitSuccess result={justSent} />
  } else if (query.isPending) {
    body = (
      <div role="status" className="glass p-10 flex items-center justify-center gap-3 text-sm text-[var(--color-text-2)]">
        <Spinner size={20} className="text-[var(--color-electric-blue)]" />
        Chargement de la demande…
      </div>
    )
  } else if (!app) {
    const status = query.error instanceof ApiError ? query.error.status : null
    body = status === 404 || status === 422
      ? <NotFoundPanel />
      : (
        <div role="alert" className="glass-sm p-4 flex items-start gap-3 border border-[var(--color-hot-pink)]/30">
          <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-[var(--color-text-2)]">
            {status === 401 ? (
              <>
                Votre session a expiré.{' '}
                <Link
                  to={loginPath(location.pathname + location.search)}
                  className="font-bold text-[var(--color-electric-blue)] hover:underline"
                >
                  Se reconnecter
                </Link>
              </>
            ) : (
              <>
                Impossible de charger cette demande.{' '}
                <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
                  <RefreshCw size={12} aria-hidden="true" /> Réessayer
                </Button>
              </>
            )}
          </div>
        </div>
      )
  } else if (app.status !== 'DRAFT') {
    body = <AlreadySentPanel app={app} />
  } else {
    body = (
      <>
        <Stepper id={id} current={step} />
        <section
          ref={panelRef}
          tabIndex={-1}
          aria-label={`Étape ${step} sur ${LAST_STEP} : ${stepLabel(step)}`}
          className="outline-none"
        >
          {step === 1 && <StepSummary application={app} onNext={() => goTo(2)} />}
          {step === 2 && <StepProfile id={id} onBack={() => goTo(1)} onNext={() => goTo(3)} />}
          {step === 3 && <StepDocuments id={id} onBack={() => goTo(2)} onNext={() => goTo(4)} />}
          {step === 4 && (
            <StepSubmit
              id={id}
              onBack={() => goTo(3)}
              onSubmitted={result => setSubmitted({ routeId: id, result })}
            />
          )}
        </section>
      </>
    )
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO title="Demande de financement" noIndex />
      <Breadcrumbs
        items={[
          { to: '/account/applications', label: 'Mes demandes de financement' },
          { label: reference ?? 'Demande' },
        ]}
      />

      <header className="mt-4 mb-6">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Demande de financement</span>
        </h1>
        {reference && (
          <p className="text-sm text-[var(--color-text-3)] mt-2">
            Référence <span className="num font-black text-[var(--color-neon-yellow)]">{reference}</span>
          </p>
        )}
      </header>

      {body}
    </div>
  )
}

function Stepper({ id, current }: { id: string; current: StepNumber }) {
  return (
    <nav aria-label="Étapes de la demande" className="mb-6">
      <ol className="grid grid-cols-4 gap-2 sm:gap-3">
        {APPLY_STEPS.map(s => {
          const isCurrent = s.step === current
          const reached = s.step <= current
          return (
            <li key={s.step} className="min-w-0">
              <Link
                to={stepHref(id, s.step)}
                aria-current={isCurrent ? 'step' : undefined}
                className="group flex flex-col gap-2 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1 rounded-full transition-colors',
                    reached ? 'bg-[var(--color-electric-blue)]' : 'bg-[var(--color-surface-4)]',
                  )}
                />
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      'num w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black border',
                      isCurrent
                        ? 'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] border-[var(--color-electric-blue)]'
                        : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] group-hover:text-[var(--color-text-1)]',
                    )}
                  >
                    <span className="sr-only">Étape </span>{s.step}
                  </span>
                  <span
                    className={cn(
                      'sr-only sm:not-sr-only text-xs font-bold leading-tight',
                      isCurrent
                        ? 'text-[var(--color-text-1)]'
                        : 'text-[var(--color-text-3)] group-hover:text-[var(--color-text-1)]',
                    )}
                  >
                    <span className="sr-only">{' : '}</span>{s.label}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      {/* Phones: the labels above are visually hidden, so name the current step. */}
      <p aria-hidden="true" className="sm:hidden mt-3 text-sm font-bold text-[var(--color-text-1)]">
        Étape {current} sur {LAST_STEP} · {stepLabel(current)}
      </p>
    </nav>
  )
}

function NotFoundPanel() {
  return (
    <div role="alert" className="glass">
      <EmptyState
        icon={<SearchX size={40} aria-hidden="true" className="text-[var(--color-text-3)]" />}
        title="Demande introuvable"
        desc="Cette demande n'existe pas ou n'est pas liée à votre compte."
        action={
          <Link to="/account/applications" className={LINK_BUTTON}>
            Voir mes demandes <ArrowRight size={14} aria-hidden="true" />
          </Link>
        }
      />
    </div>
  )
}

function AlreadySentPanel({ app }: { app: ApplicationDetail }) {
  return (
    <div className="glass-strong p-6 sm:p-8 relative overflow-hidden flex flex-col items-start gap-4">
      <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
          Statut
        </span>
        <ApplicationStatusBadge status={app.status} label={app.status_label} />
      </div>
      <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
        Cette demande a déjà été envoyée : elle ne peut plus être modifiée.
      </p>
      <Link to={`/account/applications/${encodeURIComponent(app.id)}`} className={LINK_BUTTON}>
        Voir le suivi de la demande <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  )
}
