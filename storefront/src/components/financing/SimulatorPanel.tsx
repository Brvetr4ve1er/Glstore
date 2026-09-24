/**
 * The financing simulator — on /simulate (full) and on the product page
 * (compact). Every business term it shows comes from the API: the durations
 * and the minimum down-payment share from GET /financing/terms, every figure
 * from POST /financing/simulate. Nothing is computed or assumed here.
 *
 * A figure appears only after the shopper presses "Estimer", and only while
 * the inputs still match the ones it was computed for: change the duration,
 * the down payment or the lines and the result is withdrawn instead of being
 * left on screen next to inputs it does not describe. "Faire ma demande"
 * sends exactly the input that produced the result being shown.
 */
import { useId, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Calculator, LogIn, RotateCcw } from 'lucide-react'
import {
  ApiError, createApplication, fetchFinancingTerms, simulateFinancing,
  type FinancingDecision, type FinancingLineInput, type FinancingReason,
  type FinancingRequestInput, type SimulationResult,
} from '@/lib/api'
import { cn, fmtAmount, fmtNumber } from '@/lib/format'
import { loginPath, safeNext, useCustomer } from '@/lib/session'
import { Button, Input, Select, Spinner } from '@/components/ui'
import { EstimateLabel } from '@/components/financing/EstimateLabel'

// ── Input helpers ─────────────────────────────────────────────────────────

/** The server takes a decimal with at most two places. */
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/

/** "12 000,50" → "12000.50". Empty means no down payment ("0"); anything
 *  that is not a plain amount is null. */
function normalizeDown(raw: string): string | null {
  const v = raw.replace(/\s/g, '').replace(',', '.')
  if (v === '') return '0'
  return DECIMAL_RE.test(v) ? v : null
}

/** Identity of a request, so a result is only shown for the inputs it was
 *  computed from. */
function inputKey(input: FinancingRequestInput): string {
  return JSON.stringify([
    input.lines.map(l => [l.offer_id, l.quantity]),
    input.down_payment,
    input.duration_months,
  ])
}

/** "10.00" → "10", "12.50" → "12,5". */
function fmtPct(pct: string): string {
  const n = Number(pct)
  return Number.isFinite(n) ? fmtNumber(n) : pct
}

/** The server's own French wording, unless it sent none. */
function serverMessage(err: ApiError, fallback: string): string {
  return err.message && !/^HTTP \d+$/.test(err.message) ? err.message : fallback
}

function simulateErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return serverMessage(err, 'Ce produit ou le financement n’est pas disponible pour le moment.')
    }
    if (err.status === 422) return 'Certaines informations sont invalides. Vérifiez l’apport saisi et les articles.'
    if (err.status === 429) return 'Trop de demandes en peu de temps. Patientez un instant puis réessayez.'
  }
  return 'L’estimation n’a pas pu être calculée. Réessayez dans un instant.'
}

/** A 422 from POST /financing/applications carries `detail.decision`. */
function reasonsFromDetail(detail: unknown): FinancingReason[] {
  if (!detail || typeof detail !== 'object' || !('decision' in detail)) return []
  const decision = (detail as { decision: unknown }).decision
  if (!decision || typeof decision !== 'object' || !('reasons' in decision)) return []
  const reasons = (decision as { reasons: unknown }).reasons
  if (!Array.isArray(reasons)) return []
  return reasons.filter((r): r is FinancingReason =>
    !!r && typeof r === 'object' && typeof (r as { label?: unknown }).label === 'string')
}

// ── Component ─────────────────────────────────────────────────────────────

export function SimulatorPanel({
  lines, compact = false, initialDown, initialMonths, returnTo,
}: {
  lines: FinancingLineInput[]
  compact?: boolean
  initialDown?: string
  initialMonths?: number
  returnTo?: string
}) {
  const headingId = useId()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { signedIn, loading: sessionLoading } = useCustomer()

  const termsQuery = useQuery({
    queryKey: ['financing', 'terms'],
    queryFn: fetchFinancingTerms,
    staleTime: 5 * 60_000,
  })

  const [down, setDown] = useState(initialDown ?? '')
  const [downError, setDownError] = useState<string | null>(null)
  const [selectedMonths, setSelectedMonths] = useState<number | null>(null)

  const simulate = useMutation({ mutationFn: simulateFinancing })
  const create = useMutation({
    mutationFn: createApplication,
    onSuccess: created => {
      void qc.invalidateQueries({ queryKey: ['account', 'applications'] })
      navigate(`/apply/${encodeURIComponent(created.id)}`)
    },
  })

  const terms = termsQuery.data
  const durations = terms?.available ? terms.durations ?? [] : []
  const months =
    selectedMonths !== null && durations.includes(selectedMonths) ? selectedMonths
    : initialMonths !== undefined && durations.includes(initialMonths) ? initialMonths
    : durations[0]

  const normalizedDown = normalizeDown(down)
  const currentKey = months !== undefined && normalizedDown !== null
    ? inputKey({ lines, down_payment: normalizedDown, duration_months: months })
    : null
  const matchesCurrent = (v: FinancingRequestInput | undefined) =>
    v !== undefined && currentKey !== null && inputKey(v) === currentKey

  const result = simulate.data && matchesCurrent(simulate.variables) ? simulate.data : null
  const estimatedInput = result ? simulate.variables : undefined
  const simulateError = simulate.isError && matchesCurrent(simulate.variables) ? simulate.error : null
  const estimating = simulate.isPending && matchesCurrent(simulate.variables)
  const createError = create.isError && matchesCurrent(create.variables) ? create.error : null

  /** Where to come back after signing in, carrying what the shopper typed. */
  function nextPath(): string {
    const base = safeNext(returnTo ?? `${location.pathname}${location.search}`, '/simulate')
    let url: URL
    try {
      url = new URL(base, window.location.origin)
    } catch {
      return '/simulate'
    }
    if (normalizedDown !== null) url.searchParams.set('down', normalizedDown)
    if (months !== undefined) url.searchParams.set('months', String(months))
    return safeNext(`${url.pathname}${url.search}`, '/simulate')
  }

  function onEstimate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (lines.length === 0 || months === undefined) return
    const downPayment = normalizeDown(down)
    if (downPayment === null) {
      setDownError('Montant invalide : saisissez un nombre, avec deux décimales au plus.')
      return
    }
    create.reset()
    simulate.mutate({ lines, down_payment: downPayment, duration_months: months })
  }

  function estimateWithDown(amount: string) {
    if (lines.length === 0 || months === undefined) return
    setDown(amount)
    setDownError(null)
    create.reset()
    simulate.mutate({ lines, down_payment: amount, duration_months: months })
  }

  function onApply() {
    if (!estimatedInput) return
    if (!signedIn) {
      navigate(loginPath(nextPath()))
      return
    }
    create.mutate(estimatedInput)
  }

  // ── Terms not ready / not offered ──
  if (termsQuery.isPending) {
    if (compact) return null
    return (
      <div role="status" className="glass p-6 flex items-center gap-3 text-sm text-[var(--color-text-2)]">
        <Spinner size={18} className="text-[var(--color-electric-blue)]" />
        Chargement des conditions de financement…
      </div>
    )
  }

  if (termsQuery.isError) {
    if (compact) return null
    return (
      <div role="alert" className="glass p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="flex items-start gap-2.5 text-sm text-[var(--color-text-2)] flex-1">
          <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          Les conditions de financement n’ont pas pu être chargées.
        </p>
        <Button variant="outline" size="sm" onClick={() => void termsQuery.refetch()} loading={termsQuery.isFetching}>
          <RotateCcw size={14} aria-hidden="true" /> Réessayer
        </Button>
      </div>
    )
  }

  if (!terms?.available || durations.length === 0) {
    if (compact) return null
    return (
      <div className="glass p-6">
        <p className="text-sm text-[var(--color-text-2)]">Le financement n’est pas disponible pour le moment.</p>
      </div>
    )
  }

  // "0.00" is a truthy string: test the number, so a rule with no minimum
  // down payment shows no "Apport minimum : 0 %" noise.
  const pctHint = Number(terms.min_down_payment_pct) > 0
    ? `Apport minimum : ${fmtPct(terms.min_down_payment_pct!)} % du montant`
    : undefined

  return (
    <section
      aria-labelledby={headingId}
      className={cn('glass relative overflow-hidden', compact ? 'p-4 sm:p-5' : 'p-5 sm:p-6')}
    >
      <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />

      <h2
        id={headingId}
        className={cn(
          'font-black text-[var(--color-text-1)] flex items-center gap-2',
          compact ? 'text-base' : 'text-lg',
        )}
      >
        <Calculator size={compact ? 16 : 18} aria-hidden="true" className="text-[var(--color-electric-blue)]" />
        {compact ? 'Simuler un financement' : 'Vos paramètres'}
      </h2>
      {!compact && (
        <p className="text-sm text-[var(--color-text-3)] mt-1.5 leading-relaxed">
          Choisissez une durée et le montant de votre apport, puis lancez l’estimation. Les prix
          utilisés sont ceux du catalogue au moment du calcul.
        </p>
      )}

      <form onSubmit={onEstimate} noValidate className={cn('grid gap-4 grid-cols-1 sm:grid-cols-2', compact ? 'mt-3' : 'mt-5')}>
        <Select
          label="Durée"
          value={months !== undefined ? String(months) : ''}
          onChange={e => setSelectedMonths(Number(e.target.value))}
          className="w-full"
        >
          {durations.map(n => (
            <option key={n} value={String(n)}>{n} mois</option>
          ))}
        </Select>

        <Input
          label="Apport (DA)"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={down}
          onChange={e => {
            setDown(e.target.value)
            setDownError(null)
          }}
          hint={pctHint}
          error={downError ?? undefined}
        />

        <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size={compact ? 'md' : 'lg'}
            loading={estimating}
            disabled={lines.length === 0}
            className="w-full sm:w-fit"
          >
            <Calculator size={15} aria-hidden="true" /> Estimer
          </Button>
          {lines.length === 0 && (
            <p className="text-xs text-[var(--color-text-3)]">Aucun article à financer.</p>
          )}
        </div>
      </form>

      {/* Progress and outcome for screen readers; errors announce themselves (role="alert"). */}
      <p role="status" className="sr-only">
        {estimating ? 'Estimation en cours…' : result ? 'Résultat de l’estimation affiché.' : ''}
      </p>

      <div>
        {simulateError && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5"
          >
            <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--color-text-2)] leading-relaxed">{simulateErrorMessage(simulateError)}</p>
          </div>
        )}

        {result && (
          <motion.div
            key={currentKey ?? 'result'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="mt-5 rounded-xl border border-[var(--color-surface-4)] bg-[var(--color-surface-2)] p-4 sm:p-5"
          >
            <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3">
              Résultat de l’estimation
            </h3>
            {result.decision.eligible ? (
              <EligibleResult
                result={result}
                compact={compact}
                signedIn={signedIn}
                sessionLoading={sessionLoading}
                applying={create.isPending}
                onApply={onApply}
              />
            ) : (
              <IneligibleResult
                result={result}
                onUseMinimum={estimateWithDown}
              />
            )}

            {createError && <CreateError error={createError} loginTo={loginPath(nextPath())} />}
          </motion.div>
        )}
      </div>
    </section>
  )
}

// ── Result views ──────────────────────────────────────────────────────────

function EligibleResult({
  result, compact, signedIn, sessionLoading, applying, onApply,
}: {
  result: SimulationResult
  compact: boolean
  signedIn: boolean
  sessionLoading: boolean
  applying: boolean
  onApply: () => void
}) {
  const d = result.decision
  return (
    <>
      <p className="text-sm font-bold text-[var(--color-text-2)]">Remboursement mensuel estimé</p>
      <p className={cn('num font-black text-[var(--color-neon-yellow)] leading-tight', compact ? 'text-2xl' : 'text-3xl sm:text-4xl')}>
        {fmtAmount(d.monthly_instalment)}
      </p>
      <p className="text-xs text-[var(--color-text-3)] mt-0.5">Sur {d.duration_months} mois</p>

      <EstimateLabel presentation={result} className="mt-3" />

      <dl className={cn('mt-4 grid gap-x-6 gap-y-2 text-sm', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
        <FigureRow label="Prix comptant" value={fmtAmount(d.cash_total)} />
        <FigureRow label="Apport" value={fmtAmount(d.down_payment)} />
        <FigureRow label="Montant financé" value={fmtAmount(d.financed_amount)} />
        <FigureRow label="Marge de financement" value={fmtAmount(d.markup_amount)} />
        <FigureRow label="Total à rembourser" value={fmtAmount(d.total_repayable)} strong />
      </dl>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <Button
          type="button"
          variant="accent"
          size={compact ? 'md' : 'lg'}
          onClick={onApply}
          loading={applying}
          disabled={sessionLoading}
          className="w-full sm:w-fit"
        >
          {!signedIn && !sessionLoading && <LogIn size={15} aria-hidden="true" />}
          Faire ma demande
          <ArrowRight size={15} aria-hidden="true" />
        </Button>
        {!signedIn && !sessionLoading && (
          <p className="text-xs text-[var(--color-text-3)] leading-relaxed">
            Vous vous connecterez d’abord avec votre numéro de téléphone.
          </p>
        )}
      </div>
    </>
  )
}

function IneligibleResult({
  result, onUseMinimum,
}: {
  result: SimulationResult
  onUseMinimum: (amount: string) => void
}) {
  const d: FinancingDecision = result.decision
  const belowMinimum = d.reasons.some(r => r.code === 'DOWN_PAYMENT_BELOW_MINIMUM')
  return (
    <>
      <div
        role="alert"
        className="rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5"
      >
        <p className="flex items-start gap-2.5 text-sm font-bold text-[var(--color-text-1)]">
          <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          Cette simulation ne permet pas d’ouvrir une demande :
        </p>
        {d.reasons.length > 0 ? (
          <ul className="mt-2 ml-7 list-disc flex flex-col gap-1 text-sm text-[var(--color-text-2)]">
            {d.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`}>{r.label}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 ml-7 text-sm text-[var(--color-text-2)]">Modifiez la durée ou l’apport, puis relancez l’estimation.</p>
        )}
      </div>

      {belowMinimum && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-[var(--color-text-2)] flex-1">
            Apport minimum pour cet achat :{' '}
            <strong className="num text-[var(--color-text-1)]">{fmtAmount(d.minimum_down_payment)}</strong>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onUseMinimum(d.minimum_down_payment)}
          >
            <Calculator size={14} aria-hidden="true" /> Estimer avec cet apport
          </Button>
        </div>
      )}

      <EstimateLabel presentation={result} className="mt-4" />
    </>
  )
}

function FigureRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-surface-4)]/60 py-1.5">
      <dt className="text-[var(--color-text-3)]">{label}</dt>
      <dd className={cn('num text-right', strong ? 'font-black text-[var(--color-text-1)]' : 'font-bold text-[var(--color-text-2)]')}>
        {value}
      </dd>
    </div>
  )
}

function CreateError({ error, loginTo }: { error: Error; loginTo: string }) {
  let message = 'La demande n’a pas pu être ouverte. Réessayez dans un instant.'
  let reasons: FinancingReason[] = []
  let expired = false

  if (error instanceof ApiError) {
    if (error.status === 401) {
      expired = true
      message = 'Votre session a expiré. Reconnectez-vous pour faire votre demande.'
    } else if (error.status === 404) {
      message = serverMessage(error, 'Ce produit ou le financement n’est pas disponible pour le moment.')
    } else if (error.status === 422) {
      if (Array.isArray(error.detail)) {
        // Field validation (pydantic): its wording is not meant for shoppers.
        message = 'Certaines informations sont invalides. Relancez l’estimation.'
      } else {
        reasons = reasonsFromDetail(error.detail)
        message = serverMessage(error, 'Cette demande ne peut pas être ouverte en l’état.')
      }
    } else if (error.status === 429) {
      message = 'Trop de demandes en peu de temps. Patientez un instant puis réessayez.'
    }
  }

  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5"
    >
      <p className="flex items-start gap-2.5 text-sm text-[var(--color-text-1)]">
        <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        {message}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-2 ml-7 list-disc flex flex-col gap-1 text-sm text-[var(--color-text-2)]">
          {reasons.map((r, i) => (
            <li key={`${r.code}-${i}`}>{r.label}</li>
          ))}
        </ul>
      )}
      {expired && (
        <Link
          to={loginTo}
          className="mt-3 ml-7 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-electric-blue)] hover:underline"
        >
          <LogIn size={14} aria-hidden="true" /> Se connecter
        </Link>
      )}
    </div>
  )
}
