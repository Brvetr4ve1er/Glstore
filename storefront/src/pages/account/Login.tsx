/**
 * /login?next=<path> — sign in with a mobile number and a one-time SMS code.
 *
 * There is no password and no separate sign-up: verifying a phone IS the
 * account (api/routes/customer_auth.py). Two steps:
 *
 *   1. phone → requestOtp()      422 not an Algerian mobile · 429 throttled ·
 *                                503 SMS sign-in unavailable on this deployment
 *   2. code  → verifyOtp()       400 wrong/expired code (server says which and
 *                                how many tries are left) · 429 locked → new code
 *      → signIn(session) → safeNext(next)
 *
 * Every timing (resend cooldown, code validity) comes from the request-otp
 * response. After a 429 the pause is the server's Retry-After (ApiError.retryAfter);
 * LOCAL_RETRY_PAUSE_S is only the fallback when the server sent none (e.g. a
 * 503), so the send button cannot be hammered.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, KeyRound, MessageSquareText,
  PackageCheck, RotateCw, Smartphone,
} from 'lucide-react'
import { ApiError, requestOtp, verifyOtp } from '@/lib/api'
import { safeNext, useCustomer } from '@/lib/session'
import { Button, Input, Spinner } from '@/components/ui'
import { SEO } from '@/components/SEO'
import { cn } from '@/lib/format'

type Step = 'phone' | 'code'

const STEPS: { key: Step; label: string }[] = [
  { key: 'phone', label: 'Numéro' },
  { key: 'code', label: 'Code' },
]

/** Mirrors OtpVerifyIn.code on the server: exactly six digits. */
const CODE_LENGTH = 6
const CODE_RE = /^\d{6}$/

/** Client-side anti-hammer pause after a 429/503 on sending (see header). */
const LOCAL_RETRY_PAUSE_S = 30

const NETWORK_MESSAGE = 'Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.'
const CODE_FORMAT_MESSAGE = 'Saisissez les 6 chiffres reçus par SMS.'

interface Banner {
  tone: 'error' | 'info'
  message: string
  /** 503: SMS sign-in is not available — point to what still works. */
  unavailable?: boolean
}

// ── Pure helpers ─────────────────────────────────────────────

/** Where to land after signing in — never back onto this page. */
function afterSignIn(next: string | null): string {
  const dest = safeNext(next)
  if (dest === '/login' || dest.startsWith('/login?') || dest.startsWith('/login/')) return safeNext(null)
  return dest
}

function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

/** 45 → "45 s" · 65 → "1 min 05 s" · 300 → "5 min". */
function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m === 0) return `${rest} s`
  if (rest === 0) return `${m} min`
  return `${m} min ${String(rest).padStart(2, '0')} s`
}

/** The server's French wording, unless the response carried none. */
function serverMessage(err: ApiError, fallback: string): string {
  return err.message && !/^HTTP \d+$/.test(err.message) ? err.message : fallback
}

interface SendFailure {
  message: string
  /** Belongs on the phone field rather than in a banner. */
  field: boolean
  /** Start the local retry pause. */
  pause: boolean
  unavailable: boolean
}

function sendFailure(err: unknown): SendFailure {
  const base = { field: false, pause: false, unavailable: false }
  if (!(err instanceof ApiError)) return { ...base, message: NETWORK_MESSAGE }
  switch (err.status) {
    case 422:
      return {
        ...base,
        field: true,
        message: 'Ce numéro n’est pas un mobile algérien valide. Vérifiez-le et réessayez.',
      }
    case 429:
      return {
        ...base,
        pause: true,
        message: serverMessage(err, 'Trop de demandes de code. Réessayez un peu plus tard.'),
      }
    case 503:
      return {
        ...base,
        pause: true,
        unavailable: true,
        message: serverMessage(err, 'La connexion par SMS n’est pas disponible pour le moment.'),
      }
    default:
      return { ...base, message: 'Le code n’a pas pu être envoyé. Réessayez dans un instant.' }
  }
}

interface VerifyFailure {
  message: string
  field: boolean
  /** Too many attempts: this code is dead, only a new one helps. */
  locked: boolean
}

function verifyFailure(err: unknown): VerifyFailure {
  if (!(err instanceof ApiError)) return { message: NETWORK_MESSAGE, field: false, locked: false }
  switch (err.status) {
    case 400:
      return { message: serverMessage(err, 'Code incorrect ou expiré.'), field: true, locked: false }
    case 422:
      return { message: CODE_FORMAT_MESSAGE, field: true, locked: false }
    case 429:
      return {
        message: serverMessage(err, 'Trop de tentatives. Demandez un nouveau code.'),
        field: false,
        locked: true,
      }
    default:
      return { message: 'La vérification a échoué. Réessayez dans un instant.', field: false, locked: false }
  }
}

// ── Page ─────────────────────────────────────────────────────

export default function LoginPage() {
  const { signedIn, loading, signIn } = useCustomer()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const destination = afterSignIn(params.get('next'))

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  /** The number the live code was sent to, as the shopper typed it. */
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [expiresIn, setExpiresIn] = useState(0)
  const [locked, setLocked] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  /** Only focus the phone field when coming back from step 2, not on arrival. */
  const [returned, setReturned] = useState(false)

  // Countdowns: deadlines in epoch ms, `now` ticks once a second while any runs.
  const [now, setNow] = useState(() => Date.now())
  const [resendAt, setResendAt] = useState(0)
  const [pauseUntil, setPauseUntil] = useState(0)
  const ticking = Math.max(resendAt, pauseUntil) > now

  useEffect(() => {
    if (!ticking) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [ticking])

  const resendLeft = secondsLeft(resendAt, now)
  const pauseLeft = secondsLeft(pauseUntil, now)
  const sendWait = Math.max(resendLeft, pauseLeft)

  const codeRef = useRef<HTMLInputElement>(null)
  // Bumped after a resend: focus once the re-render has re-enabled the field
  // (a locked code input is still disabled inside the success callback).
  const [focusCodeKey, setFocusCodeKey] = useState(0)
  useEffect(() => {
    if (focusCodeKey > 0) codeRef.current?.focus()
  }, [focusCodeKey])

  const send = useMutation({ mutationFn: (target: string) => requestOtp(target) })
  const verify = useMutation({
    mutationFn: (v: { phone: string; code: string }) => verifyOtp(v.phone, v.code),
  })

  /** The server's Retry-After when it sent one (the real per-phone or hourly
   *  wait); the local pause only when it did not. */
  function startPause(err?: unknown) {
    const t = Date.now()
    const serverWait = err instanceof ApiError ? err.retryAfter : null
    setNow(t)
    setPauseUntil(t + (serverWait ?? LOCAL_RETRY_PAUSE_S) * 1000)
  }

  function sendCode(target: string, origin: Step) {
    setFieldError(null)
    setBanner(null)
    send.mutate(target, {
      onSuccess: res => {
        if (!res.sent) {
          setBanner({ tone: 'error', message: 'Le code n’a pas pu être envoyé. Réessayez dans un instant.' })
          return
        }
        const t = Date.now()
        setNow(t)
        setResendAt(t + res.resend_after * 1000)
        setPauseUntil(0)
        setExpiresIn(res.expires_in)
        setSentTo(target)
        setCode('')
        setLocked(false)
        verify.reset()
        if (origin === 'code') {
          setBanner({ tone: 'info', message: 'Un nouveau code vous a été envoyé.' })
          setFocusCodeKey(k => k + 1)
        }
        setStep('code')
      },
      onError: err => {
        const f = sendFailure(err)
        if (f.pause) startPause(err)
        if (f.field && origin === 'phone') {
          setFieldError(f.message)
        } else {
          setBanner({ tone: 'error', message: f.message, unavailable: f.unavailable })
        }
      },
    })
  }

  function onSubmitPhone(e: FormEvent) {
    e.preventDefault()
    if (send.isPending || pauseLeft > 0) return
    const target = phone.trim()
    if (!target) {
      setFieldError('Saisissez votre numéro de mobile.')
      return
    }
    sendCode(target, 'phone')
  }

  function onSubmitCode(e: FormEvent) {
    e.preventDefault()
    if (verify.isPending || locked) return
    if (!CODE_RE.test(code)) {
      setFieldError(CODE_FORMAT_MESSAGE)
      codeRef.current?.focus()
      return
    }
    setFieldError(null)
    setBanner(null)
    verify.mutate({ phone: sentTo, code }, {
      onSuccess: session => {
        signIn(session)
        toast.success('Vous êtes connecté.')
        navigate(destination, { replace: true })
      },
      onError: err => {
        const f = verifyFailure(err)
        if (f.locked) {
          setLocked(true)
          setCode('')
          setBanner({ tone: 'error', message: f.message })
        } else if (f.field) {
          setFieldError(f.message)
          codeRef.current?.select()
        } else {
          setBanner({ tone: 'error', message: f.message })
        }
      },
    })
  }

  function changeNumber() {
    setStep('phone')
    setReturned(true)
    setCode('')
    setLocked(false)
    setFieldError(null)
    setBanner(null)
    verify.reset()
  }

  // ── Early exits (after every hook) ──
  if (signedIn) return <Navigate to={destination} replace />

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center" role="status">
        <SEO title="Connexion" noIndex />
        <Spinner size={28} className="text-[var(--color-electric-blue)]" />
        <span className="sr-only">Vérification de la session…</span>
      </div>
    )
  }

  const busy = send.isPending || verify.isPending

  return (
    <div className="page-enter max-w-md mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <SEO
        title="Connexion"
        description="Connectez-vous à votre compte avec votre numéro de mobile et un code reçu par SMS."
        noIndex
      />

      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Connexion</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2 leading-relaxed">
          Pas de mot de passe : saisissez votre numéro de mobile, puis le code reçu par SMS.
        </p>
      </div>

      <div className="glass-strong p-5 sm:p-6 relative overflow-hidden">
        <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />

        <Stepper step={step} />

        <AnimatePresence mode="wait" initial={false}>
          {step === 'phone' ? (
            <motion.form
              key="phone"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              onSubmit={onSubmitPhone}
              noValidate
              className="flex flex-col gap-4"
            >
              <Input
                label="Numéro de mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
                required
                autoFocus={returned}
                value={phone}
                onChange={e => {
                  setPhone(e.target.value)
                  if (fieldError) setFieldError(null)
                }}
                hint="Exemple : 0555 12 34 56"
                error={fieldError ?? undefined}
                leftIcon={<Smartphone size={16} aria-hidden="true" />}
              />

              {banner && <BannerBox banner={banner} />}

              <Button
                type="submit"
                variant="accent"
                size="lg"
                loading={send.isPending}
                disabled={pauseLeft > 0}
                className="w-full"
              >
                <MessageSquareText size={16} aria-hidden="true" />
                {pauseLeft > 0 ? `Réessayer dans ${fmtDuration(pauseLeft)}` : 'Recevoir un code par SMS'}
              </Button>

              <p className="flex items-start gap-2 text-xs text-[var(--color-text-3)] leading-relaxed">
                <PackageCheck size={14} aria-hidden="true" className="shrink-0 mt-0.5 text-[var(--color-electric-blue)]" />
                Les commandes déjà passées avec ce numéro apparaissent dans votre compte.
              </p>
            </motion.form>
          ) : (
            <motion.form
              key="code"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18 }}
              onSubmit={onSubmitCode}
              noValidate
              className="flex flex-col gap-4"
            >
              <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
                Code envoyé au{' '}
                <span className="num font-bold text-[var(--color-text-1)]">{sentTo}</span>.
                {expiresIn > 0 && <> Il est valable {fmtDuration(expiresIn)}.</>}
              </p>

              <Input
                ref={codeRef}
                label="Code reçu par SMS"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                pattern="[0-9]{6}"
                required
                autoFocus
                disabled={locked}
                value={code}
                onChange={e => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                  if (fieldError) setFieldError(null)
                }}
                hint="6 chiffres"
                error={fieldError ?? undefined}
                leftIcon={<KeyRound size={16} aria-hidden="true" />}
                className="num text-lg tracking-[0.4em]"
              />

              {banner && <BannerBox banner={banner} />}

              <Button
                type="submit"
                variant={locked ? 'outline' : 'accent'}
                size="lg"
                loading={verify.isPending}
                disabled={locked || send.isPending}
                className="w-full"
              >
                Valider le code
              </Button>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant={locked ? 'primary' : 'outline'}
                  size="md"
                  loading={send.isPending}
                  disabled={sendWait > 0 || verify.isPending}
                  onClick={() => sendCode(sentTo, 'code')}
                  className="flex-1"
                >
                  <RotateCw size={14} aria-hidden="true" />
                  {sendWait > 0 ? `Renvoyer le code dans ${fmtDuration(sendWait)}` : 'Renvoyer le code'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  disabled={busy}
                  onClick={changeNumber}
                  className="flex-1"
                >
                  <ArrowLeft size={14} aria-hidden="true" /> Changer de numéro
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const currentIndex = STEPS.findIndex(s => s.key === step)
  return (
    <ol aria-label="Étapes de connexion" className="flex items-center gap-2 mb-5">
      {STEPS.map((s, i) => {
        const current = i === currentIndex
        const done = i < currentIndex
        return (
          <li
            key={s.key}
            aria-current={current ? 'step' : undefined}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em]"
          >
            {i > 0 && <span aria-hidden="true" className="w-6 h-px bg-[var(--color-surface-4)]" />}
            <span
              aria-hidden="true"
              className={cn(
                'num w-6 h-6 rounded-full flex items-center justify-center border text-[11px]',
                current && 'bg-[var(--color-electric-blue)] border-[var(--color-electric-blue)] text-[var(--color-jet-black)]',
                done && 'border-[var(--color-electric-blue)] text-[var(--color-electric-blue)]',
                !current && !done && 'border-[var(--color-surface-4)] text-[var(--color-text-3)]',
              )}
            >
              {i + 1}
            </span>
            <span className={current ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-3)]'}>
              <span className="sr-only">Étape {i + 1} : </span>
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function BannerBox({ banner }: { banner: Banner }) {
  const isError = banner.tone === 'error'
  let extra: ReactNode = null
  if (banner.unavailable) {
    extra = (
      <p className="mt-1.5">
        Vous avez déjà commandé ?{' '}
        <Link to="/order/track" className="font-bold text-[var(--color-electric-blue)] hover:underline">
          Suivre une commande
        </Link>
      </p>
    )
  }
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3.5 text-xs leading-relaxed text-[var(--color-text-2)]',
        isError
          ? 'border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10'
          : 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10',
      )}
    >
      {isError
        ? <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        : <CheckCircle2 size={15} aria-hidden="true" className="text-[var(--color-success)] mt-0.5 shrink-0" />}
      <div>
        <p>{banner.message}</p>
        {extra}
      </div>
    </div>
  )
}
