/**
 * Step 4 — check what is still missing, then send. The checklist reads the
 * same cached queries as steps 2 and 3; the server has the last word and, on
 * a 422, lists EVERY problem at once — all of them are shown.
 *
 * The success panel is exported for Apply.tsx to render: sending flips the
 * application out of DRAFT, and the page must still show the server's answer.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Circle, RefreshCw, Send,
} from 'lucide-react'
import {
  ApiError, fetchApplicationDocuments, fetchApplicationProfile, submitApplication,
} from '@/lib/api'
import { loginPath } from '@/lib/session'
import { Button, Spinner } from '@/components/ui'
import { ApplicationStatusBadge } from '@/components/financing/ApplicationStatusBadge'
import { cn } from '@/lib/format'
import {
  applicationKey, applicationsKey, documentsKey, hasListedProblems, isProfileComplete,
  profileKey, readSubmitProblems, retryUnlessClientError, serverMessage, stepHref,
} from './steps'

export type SubmitResult = Awaited<ReturnType<typeof submitApplication>>

const LINK = 'font-bold text-[var(--color-electric-blue)] hover:underline'

export function StepSubmit({
  id, onBack, onSubmitted,
}: { id: string; onBack: () => void; onSubmitted: (result: SubmitResult) => void }) {
  const qc = useQueryClient()
  const location = useLocation()

  const profile = useQuery({
    queryKey: profileKey(id),
    queryFn: () => fetchApplicationProfile(id),
    retry: retryUnlessClientError,
  })
  const documents = useQuery({
    queryKey: documentsKey(id),
    queryFn: () => fetchApplicationDocuments(id),
    retry: retryUnlessClientError,
  })

  const submit = useMutation({
    mutationFn: () => submitApplication(id),
    onSuccess: result => {
      onSubmitted(result)
      void qc.invalidateQueries({ queryKey: applicationsKey() })
    },
    onError: err => {
      if (!(err instanceof ApiError)) return
      if (err.status === 422) {
        // The checklist should now agree with what the server just said.
        void qc.invalidateQueries({ queryKey: profileKey(id) })
        void qc.invalidateQueries({ queryKey: documentsKey(id) })
      }
      if (err.status === 409) void qc.invalidateQueries({ queryKey: applicationKey(id) })
    },
  })

  const checking = profile.isPending || documents.isPending
  // A failed background refresh keeps the last good data: only a load that
  // never succeeded counts as a failure.
  const checkFailed = !profile.data || !documents.data
  const profileDone = isProfileComplete(profile.data)
  const docItems = documents.data?.items ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[var(--color-text-1)]">Envoi</h2>
        <p className="text-sm text-[var(--color-text-3)] mt-1 leading-relaxed">
          Vérifiez que tout est prêt, puis envoyez votre demande pour qu'elle soit étudiée.
        </p>
      </div>

      <section aria-labelledby="apply-checklist" className="glass p-5 sm:p-6">
        <h3
          id="apply-checklist"
          className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4"
        >
          Avant l'envoi
        </h3>

        {checking ? (
          <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-text-2)]">
            <Spinner size={16} className="text-[var(--color-electric-blue)]" />
            Vérification de votre dossier…
          </div>
        ) : checkFailed ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-2)]">
            <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] shrink-0" />
            Impossible de vérifier votre dossier pour le moment.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void profile.refetch()
                void documents.refetch()
              }}
            >
              <RefreshCw size={12} aria-hidden="true" /> Réessayer
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            <CheckItem
              done={profileDone}
              label="Votre situation"
              action={!profileDone && (
                <Link to={stepHref(id, 2)} className={LINK}>Compléter votre situation</Link>
              )}
            />
            {docItems.length === 0 ? (
              <CheckItem done label="Aucune pièce justificative n'est demandée pour le moment." />
            ) : (
              docItems.map(item => {
                const done = item.uploaded.length > 0
                return (
                  <CheckItem
                    key={item.code}
                    done={done}
                    label={item.label}
                    action={!done && (
                      <Link to={stepHref(id, 3)} className={LINK}>Ajouter « {item.label} »</Link>
                    )}
                  />
                )
              })
            )}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--color-text-3)] leading-relaxed">
        Une fois envoyée, votre demande ne pourra plus être modifiée.
      </p>

      {submit.isError && (
        <SubmitError id={id} err={submit.error} loginTo={loginPath(location.pathname + location.search)} />
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft size={16} aria-hidden="true" /> Retour
        </Button>
        <Button
          type="button"
          variant="accent"
          size="lg"
          loading={submit.isPending}
          onClick={() => submit.mutate()}
          className="w-full sm:w-auto"
        >
          {!submit.isPending && <Send size={16} aria-hidden="true" />} Envoyer ma demande
        </Button>
      </div>
    </div>
  )
}

function CheckItem({
  done, label, action,
}: { done: boolean; label: string; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      {done ? (
        <CheckCircle2 size={18} aria-hidden="true" className="text-[var(--color-success)] shrink-0 mt-0.5" />
      ) : (
        <Circle size={18} aria-hidden="true" className="text-[var(--color-neon-yellow)] shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0 text-sm">
        <span className="sr-only">{done ? 'Fait : ' : 'À compléter : '}</span>
        <span className={cn('break-words', done ? 'text-[var(--color-text-2)]' : 'font-bold text-[var(--color-text-1)]')}>
          {label}
        </span>
        {action && <div className="mt-0.5">{action}</div>}
      </div>
    </li>
  )
}

function SubmitError({ id, err, loginTo }: { id: string; err: unknown; loginTo: string }) {
  const status = err instanceof ApiError ? err.status : null
  const problems = status === 422 ? readSubmitProblems((err as ApiError).detail) : null

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-4"
    >
      <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-sm text-[var(--color-text-2)] leading-relaxed">
        {problems ? (
          <>
            <p className="font-bold text-[var(--color-text-1)]">{problems.message}</p>
            {hasListedProblems(problems) && (
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                {problems.missing_profile && (
                  <li>
                    Votre situation n'est pas encore renseignée.{' '}
                    <Link to={stepHref(id, 2)} className={LINK}>Renseigner votre situation</Link>
                  </li>
                )}
                {problems.missing_documents?.map(d => (
                  <li key={d.code}>
                    Pièce manquante : {d.label}.{' '}
                    <Link to={stepHref(id, 3)} className={LINK}>Ajouter « {d.label} »</Link>
                  </li>
                ))}
                {problems.reasons?.map(r => (
                  <li key={r.code}>{r.label}</li>
                ))}
              </ul>
            )}
          </>
        ) : status === 409 ? (
          <>
            <p>
              {serverMessage((err as ApiError).detail)
                ?? 'Cette demande ne peut plus être envoyée.'}
            </p>
            <Link to="/simulate" className={cn(LINK, 'inline-flex items-center gap-1 mt-1')}>
              Faire une nouvelle simulation <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </>
        ) : status === 401 ? (
          <>
            Votre session a expiré : la demande n'a pas été envoyée.{' '}
            <Link to={loginTo} className={LINK}>Se reconnecter</Link>
          </>
        ) : status === 404 ? (
          'Demande introuvable.'
        ) : status === 422 ? (
          <>La demande a été refusée par le serveur : {(err as ApiError).message}</>
        ) : (
          "L'envoi a échoué. Vérifiez votre connexion et réessayez."
        )}
      </div>
    </div>
  )
}

/** Shown by Apply.tsx once POST /submit succeeded — the server's own words. */
export function SubmitSuccess({ result }: { result: SubmitResult }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="glass-strong p-6 sm:p-8 relative overflow-hidden flex flex-col items-center text-center gap-4">
      <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
      <div className="w-14 h-14 rounded-full bg-[var(--color-electric-blue)]/15 flex items-center justify-center">
        <Send size={26} aria-hidden="true" className="text-[var(--color-electric-blue)]" />
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl sm:text-2xl font-black text-[var(--color-text-1)] outline-none"
      >
        Votre demande a été transmise
      </h2>
      <ApplicationStatusBadge status={result.status} label={result.status_label} />
      <p className="text-sm text-[var(--color-text-2)]">
        Référence{' '}
        <span className="num font-black text-[var(--color-neon-yellow)]">{result.reference}</span>
      </p>
      <p className="text-sm text-[var(--color-text-3)] max-w-md leading-relaxed">
        Vous pouvez suivre son avancement depuis votre espace client.
      </p>
      <Link
        to={`/account/applications/${encodeURIComponent(result.id)}`}
        className="inline-flex items-center justify-center gap-2 font-bold rounded-xl text-base px-6 py-3 bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]"
      >
        Suivre ma demande <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  )
}
