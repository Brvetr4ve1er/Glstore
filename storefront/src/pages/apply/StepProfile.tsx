/**
 * Step 2 — the shopper's own declarations (income, commitments, work).
 * Prefilled from the server; saved with PUT …/profile, DRAFT only.
 */
import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ArrowRight, Info, RefreshCw } from 'lucide-react'
import {
  ApiError, EMPLOYMENT_TYPE_LABELS, fetchApplicationProfile, saveApplicationProfile,
  type ApplicationProfile, type ApplicationProfileInput, type EmploymentType,
} from '@/lib/api'
import { loginPath } from '@/lib/session'
import { Button, Input, Select, Spinner } from '@/components/ui'
import {
  EMPLOYER_MAX, JOB_TITLE_MAX, applicationKey, isoDate, profileKey, profileToForm,
  retryUnlessClientError, serverMessage, validateProfileForm,
  type ProfileErrors, type ProfileField, type ProfileFormValues,
} from './steps'

const FIELD_ORDER: ProfileField[] = [
  'monthly_income', 'monthly_obligations', 'dependents',
  'employment_type', 'employer_name', 'job_title', 'employed_since',
]

const EMPLOYMENT_OPTIONS = Object.entries(EMPLOYMENT_TYPE_LABELS) as [EmploymentType, string][]

export function StepProfile({
  id, onBack, onNext,
}: { id: string; onBack: () => void; onNext: () => void }) {
  const location = useLocation()
  const query = useQuery({
    queryKey: profileKey(id),
    queryFn: () => fetchApplicationProfile(id),
    retry: retryUnlessClientError,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[var(--color-text-1)]">Votre situation</h2>
        <p className="text-sm text-[var(--color-text-3)] mt-1 leading-relaxed flex items-start gap-2">
          <Info size={14} aria-hidden="true" className="shrink-0 mt-0.5" />
          <span>Ces informations sont des déclarations de votre part : elles servent à étudier votre demande.</span>
        </p>
      </div>

      {query.isPending ? (
        <div role="status" className="glass p-8 flex items-center justify-center gap-3 text-sm text-[var(--color-text-2)]">
          <Spinner size={18} className="text-[var(--color-electric-blue)]" />
          Chargement de vos informations…
        </div>
      ) : query.data ? (
        // A failed background refresh keeps the last good data: stay on the form.
        // Keyed on the application: moving to another application's step 2
        // must not keep the previous one's form state.
        <ProfileForm key={id} id={id} initial={query.data} onBack={onBack} onNext={onNext} />
      ) : (
        <div role="alert" className="glass-sm p-4 flex items-start gap-3 border border-[var(--color-hot-pink)]/30">
          <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-[var(--color-text-2)]">
            {query.error instanceof ApiError && query.error.status === 401 ? (
              <>
                Votre session a expiré.{' '}
                <Link
                  to={loginPath(location.pathname + location.search)}
                  className="font-bold text-[var(--color-electric-blue)] hover:underline"
                >
                  Se reconnecter
                </Link>
              </>
            ) : query.error instanceof ApiError && query.error.status === 404 ? (
              'Demande introuvable.'
            ) : (
              <>
                Impossible de charger vos informations.{' '}
                <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
                  <RefreshCw size={12} aria-hidden="true" /> Réessayer
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileForm({
  id, initial, onBack, onNext,
}: { id: string; initial: ApplicationProfile; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient()
  const location = useLocation()
  const uid = useId()
  const fieldId = (f: ProfileField) => `${uid}-${f}`
  const today = useMemo(() => isoDate(new Date()), [])

  const [form, setForm] = useState<ProfileFormValues>(() => profileToForm(initial))
  const [errors, setErrors] = useState<ProfileErrors>({})

  const save = useMutation({
    mutationFn: (input: ApplicationProfileInput) => saveApplicationProfile(id, input),
    onSuccess: saved => {
      qc.setQueryData(profileKey(id), saved)
      onNext()
    },
    onError: err => {
      // Already sent: reload the application so the page turns read-only.
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: applicationKey(id) })
      }
    },
  })

  function update<K extends ProfileField>(key: K, value: ProfileFormValues[K]) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key]) {
      setErrors(e => {
        const next = { ...e }
        delete next[key]
        return next
      })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateProfileForm(form, today)
    setErrors(result.errors)
    if (!result.input) {
      const first = FIELD_ORDER.find(f => result.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    save.mutate(result.input)
  }

  const err = save.error
  const status = err instanceof ApiError ? err.status : null

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <fieldset className="glass p-5 sm:p-6 flex flex-col gap-4">
        <legend className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] px-1">
          Revenus et charges
        </legend>
        <Input
          id={fieldId('monthly_income')}
          label="Revenu mensuel net (DA)"
          inputMode="decimal"
          autoComplete="off"
          aria-required="true"
          value={form.monthly_income}
          onChange={e => update('monthly_income', e.target.value)}
          error={errors.monthly_income}
          hint="Obligatoire."
        />
        <Input
          id={fieldId('monthly_obligations')}
          label="Remboursements mensuels en cours (DA)"
          inputMode="decimal"
          autoComplete="off"
          value={form.monthly_obligations}
          onChange={e => update('monthly_obligations', e.target.value)}
          error={errors.monthly_obligations}
          hint="Crédits ou échéances que vous remboursez déjà. Laissez vide s'il n'y en a aucun."
        />
        <Input
          id={fieldId('dependents')}
          label="Personnes à charge"
          inputMode="numeric"
          autoComplete="off"
          value={form.dependents}
          onChange={e => update('dependents', e.target.value)}
          error={errors.dependents}
          hint="Facultatif."
          className="sm:max-w-[12rem]"
        />
      </fieldset>

      <fieldset className="glass p-5 sm:p-6 flex flex-col gap-4">
        <legend className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] px-1">
          Situation professionnelle
        </legend>
        <Select
          id={fieldId('employment_type')}
          label="Situation professionnelle"
          aria-required="true"
          value={form.employment_type}
          onChange={e => update('employment_type', e.target.value as ProfileFormValues['employment_type'])}
          error={errors.employment_type}
        >
          <option value="">Choisissez…</option>
          {EMPLOYMENT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            id={fieldId('employer_name')}
            label="Employeur"
            autoComplete="organization"
            maxLength={EMPLOYER_MAX}
            value={form.employer_name}
            onChange={e => update('employer_name', e.target.value)}
            error={errors.employer_name}
            hint="Facultatif."
          />
          <Input
            id={fieldId('job_title')}
            label="Poste"
            autoComplete="organization-title"
            maxLength={JOB_TITLE_MAX}
            value={form.job_title}
            onChange={e => update('job_title', e.target.value)}
            error={errors.job_title}
            hint="Facultatif."
          />
        </div>
        <Input
          id={fieldId('employed_since')}
          label="En poste depuis"
          type="date"
          max={today}
          value={form.employed_since}
          onChange={e => update('employed_since', e.target.value)}
          error={errors.employed_since}
          hint="Facultatif."
          className="sm:max-w-[14rem]"
        />
      </fieldset>

      {save.isError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5"
        >
          <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          <div className="text-sm text-[var(--color-text-2)] leading-relaxed">
            {status === 409 ? (
              <>
                {serverMessage((err as ApiError).detail)
                  ?? 'Cette demande a déjà été envoyée : elle ne peut plus être modifiée.'}{' '}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void qc.invalidateQueries({ queryKey: applicationKey(id) })}
                >
                  <RefreshCw size={12} aria-hidden="true" /> Actualiser
                </Button>
              </>
            ) : status === 401 ? (
              <>
                Votre session a expiré : vos réponses n'ont pas été enregistrées.{' '}
                <Link
                  to={loginPath(location.pathname + location.search)}
                  className="font-bold text-[var(--color-electric-blue)] hover:underline"
                >
                  Se reconnecter
                </Link>
              </>
            ) : status === 404 ? (
              'Demande introuvable.'
            ) : status === 422 ? (
              // The raw 422 text is the validator's (often English); the
              // shopper gets French guidance instead.
              <>Certaines informations n’ont pas été acceptées. Vérifiez que les montants sont positifs et que la date d’embauche n’est pas dans le futur.</>
            ) : (
              "L'enregistrement a échoué. Vérifiez votre connexion et réessayez."
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft size={16} aria-hidden="true" /> Retour
        </Button>
        <Button type="submit" variant="accent" size="lg" loading={save.isPending} className="w-full sm:w-auto">
          Enregistrer et continuer <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}
