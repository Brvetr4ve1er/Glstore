/**
 * Pure helpers for the application stepper (/apply/:id?step=1..4): the step
 * in the URL, the profile form's parsing and validation, file sizes and the
 * shape of the server's error payloads. No React, no DOM — steps.test.ts runs
 * them under node.
 *
 * Nothing here knows a business term: bounds below are the API's own input
 * limits (api/routes/financing_workflow.py), never financing conditions.
 */
import {
  ApiError,
  EMPLOYMENT_TYPE_LABELS,
  type ApplicationProfile,
  type ApplicationProfileInput,
  type DocumentChecklist,
  type EmploymentType,
  type SubmitProblems,
} from '@/lib/api'

// ── Query keys ───────────────────────────────────────────────────────────
// Shared with the account pages, so the cache is too. All start with
// 'account': signing out drops every one of them.

export const applicationsKey = () => ['account', 'applications'] as const
export const applicationKey = (id: string) => ['account', 'applications', id] as const
export const profileKey = (id: string) => ['account', 'application-profile', id] as const
export const documentsKey = (id: string) => ['account', 'application-documents', id] as const

/** Retry a failed load once — unless the server answered with a 4xx, which
 *  a second identical request will not change (404, 401, 422…). */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

// ── Steps ────────────────────────────────────────────────────────────────

export const APPLY_STEPS = [
  { step: 1, label: 'Récapitulatif' },
  { step: 2, label: 'Votre situation' },
  { step: 3, label: 'Pièces justificatives' },
  { step: 4, label: 'Envoi' },
] as const

export type StepNumber = (typeof APPLY_STEPS)[number]['step']

export const FIRST_STEP: StepNumber = 1
export const LAST_STEP: StepNumber = 4

/** `?step=` → a step that exists. Anything unreadable is the first step;
 *  an integer outside 1..4 is clamped to the nearest end. */
export function parseStep(raw: string | null | undefined): StepNumber {
  if (raw == null) return FIRST_STEP
  const s = raw.trim()
  if (!/^[+-]?\d+$/.test(s)) return FIRST_STEP
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n < FIRST_STEP) return FIRST_STEP
  if (n > LAST_STEP) return LAST_STEP
  return n as StepNumber
}

export function stepLabel(step: StepNumber): string {
  return APPLY_STEPS[step - 1].label
}

/** The internal path of one step of one application. */
export function stepHref(id: string, step: StepNumber): string {
  return `/apply/${encodeURIComponent(id)}?step=${step}`
}

// ── Numbers typed by the shopper ─────────────────────────────────────────

/** 12 digits with 2 decimals server-side → at most 10 before the point. */
const AMOUNT_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A French-typed amount ("48 500", "48500,5", "48500.50") → the decimal
 * string the API expects ("48500", "48500.50"). Never goes through a float.
 */
export function parseAmount(raw: string): Parsed<string> {
  // \s also matches the no-break and narrow no-break spaces of French grouping.
  const s = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (s === '') return { ok: false, error: 'Indiquez un montant.' }
  if (s.startsWith('-')) return { ok: false, error: 'Le montant ne peut pas être négatif.' }
  const m = AMOUNT_RE.exec(s)
  if (!m) return { ok: false, error: 'Montant invalide : chiffres uniquement, deux décimales au plus.' }
  const int = m[1].replace(/^0+(?=\d)/, '')
  return { ok: true, value: m[2] ? `${int}.${m[2].padEnd(2, '0')}` : int }
}

/** Optional amount: empty means zero. */
export function parseOptionalAmount(raw: string): Parsed<string> {
  return raw.trim() === '' ? { ok: true, value: '0' } : parseAmount(raw)
}

export const DEPENDENTS_MAX = 30

/** Optional whole number of dependents; empty → null. */
export function parseDependents(raw: string): Parsed<number | null> {
  const s = raw.trim()
  if (s === '') return { ok: true, value: null }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Indiquez un nombre entier (0, 1, 2…).' }
  const n = Number.parseInt(s, 10)
  if (n > DEPENDENTS_MAX) return { ok: false, error: `${DEPENDENTS_MAX} au maximum.` }
  return { ok: true, value: n }
}

/** "48500.00" → "48500", "48500.50" → "48500.50": the server's decimal as
 *  something pleasant to edit. */
export function trimDecimal(v: string | null | undefined): string {
  if (v == null) return ''
  return v.replace(/\.0+$/, '')
}

// ── Dates ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD from the LOCAL calendar date (not UTC). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** ISO dates compare correctly as strings. */
export function isFutureDate(iso: string, today: string): boolean {
  return iso > today
}

// ── Profile form ─────────────────────────────────────────────────────────

export interface ProfileFormValues {
  monthly_income: string
  monthly_obligations: string
  dependents: string
  employment_type: EmploymentType | ''
  employer_name: string
  job_title: string
  employed_since: string
}

export type ProfileField = keyof ProfileFormValues
export type ProfileErrors = Partial<Record<ProfileField, string>>

/** Server field limits (EmploymentIn). */
export const EMPLOYER_MAX = 200
export const JOB_TITLE_MAX = 120

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  monthly_income: '',
  monthly_obligations: '',
  dependents: '',
  employment_type: '',
  employer_name: '',
  job_title: '',
  employed_since: '',
}

export function isEmploymentType(v: string): v is EmploymentType {
  return Object.prototype.hasOwnProperty.call(EMPLOYMENT_TYPE_LABELS, v)
}

/** What the server has → what the form shows. Either half may be missing. */
export function profileToForm(p: ApplicationProfile | null | undefined): ProfileFormValues {
  const f = p?.financial
  const e = p?.employment
  return {
    monthly_income: trimDecimal(f?.monthly_income),
    monthly_obligations: trimDecimal(f?.monthly_obligations),
    dependents: f?.dependents == null ? '' : String(f.dependents),
    employment_type: e && isEmploymentType(e.employment_type) ? e.employment_type : '',
    employer_name: e?.employer_name ?? '',
    job_title: e?.job_title ?? '',
    employed_since: e?.employed_since ?? '',
  }
}

function optionalText(raw: string, max: number, errors: ProfileErrors, field: ProfileField): string | null {
  const s = raw.trim()
  if (s === '') return null
  if (s.length > max) errors[field] = `${max} caractères au maximum.`
  return s
}

/**
 * Validate the whole form at once. Decimals leave as strings, blank optional
 * fields as null (the server refuses an empty string for a name or a title).
 */
export function validateProfileForm(
  form: ProfileFormValues,
  today: string,
): { input: ApplicationProfileInput | null; errors: ProfileErrors } {
  const errors: ProfileErrors = {}

  const income = parseAmount(form.monthly_income)
  if (!income.ok) errors.monthly_income = income.error

  const obligations = parseOptionalAmount(form.monthly_obligations)
  if (!obligations.ok) errors.monthly_obligations = obligations.error

  const dependents = parseDependents(form.dependents)
  if (!dependents.ok) errors.dependents = dependents.error

  const type = form.employment_type
  if (type === '' || !isEmploymentType(type)) {
    errors.employment_type = 'Choisissez votre situation professionnelle.'
  }

  const employer = optionalText(form.employer_name, EMPLOYER_MAX, errors, 'employer_name')
  const title = optionalText(form.job_title, JOB_TITLE_MAX, errors, 'job_title')

  const since = form.employed_since.trim()
  if (since !== '') {
    if (!isValidIsoDate(since)) errors.employed_since = 'Date invalide.'
    else if (isFutureDate(since, today)) errors.employed_since = 'La date ne peut pas être dans le futur.'
  }

  if (Object.keys(errors).length > 0 || !income.ok || !obligations.ok || !dependents.ok || type === '') {
    return { input: null, errors }
  }

  return {
    input: {
      financial: {
        monthly_income: income.value,
        monthly_obligations: obligations.value,
        dependents: dependents.value,
      },
      employment: {
        employment_type: type,
        employer_name: employer,
        job_title: title,
        employed_since: since === '' ? null : since,
      },
    },
    errors,
  }
}

/** Both halves saved on the server. */
export function isProfileComplete(p: ApplicationProfile | null | undefined): boolean {
  return !!p?.financial && !!p?.employment
}

// ── Documents ────────────────────────────────────────────────────────────

/** 850 Ko, 1,5 Mo — French units, no thousands grouping. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const KB = 1024
  const MB = KB * 1024
  if (n < MB) return `${Math.max(1, Math.ceil(n / KB))} Ko`
  const mo = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, useGrouping: false }).format(n / MB)
  return `${mo} Mo`
}

/** Required types with no file yet, in the server's order. */
export function missingDocumentTypes(list: DocumentChecklist | null | undefined): { code: string; label: string }[] {
  if (!list) return []
  return list.items.filter(i => i.uploaded.length === 0).map(i => ({ code: i.code, label: i.label }))
}

/**
 * The early, client-side check before an upload. The server checks the real
 * bytes; this only spares a round trip for the obvious cases.
 */
export function checkFileBeforeUpload(
  file: { size: number; type: string },
  maxBytes: number,
  accept: string,
): string | null {
  if (file.size === 0) return 'Ce fichier est vide.'
  if (file.size > maxBytes) return `Ce fichier dépasse la taille maximale (${fmtBytes(maxBytes)}).`
  const allowed = accept.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  const type = file.type.trim().toLowerCase()
  // An empty type means the browser could not tell: let the server decide.
  if (type !== '' && !allowed.includes(type)) {
    return 'Format non accepté : envoyez un PDF ou une photo JPEG, PNG ou WebP.'
  }
  return null
}

// ── Server payloads ──────────────────────────────────────────────────────

/** The server's own sentence from an error `detail`, if it sent one. */
export function serverMessage(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim() !== '') return detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'message' in detail) {
    const m = (detail as { message: unknown }).message
    if (typeof m === 'string' && m.trim() !== '') return m
  }
  return null
}

function isCodeLabel(v: unknown): v is { code: string; label: string } {
  return !!v && typeof v === 'object'
    && typeof (v as { code?: unknown }).code === 'string'
    && typeof (v as { label?: unknown }).label === 'string'
}

/**
 * A 422 from POST /submit carries `{message, missing_profile?,
 * missing_documents?, reasons?}`. A 422 from request validation carries a
 * list instead — that is not a SubmitProblems and returns null.
 */
export function readSubmitProblems(detail: unknown): SubmitProblems | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const d = detail as Record<string, unknown>
  if (typeof d.message !== 'string') return null
  const out: SubmitProblems = { message: d.message }
  if (d.missing_profile === true) out.missing_profile = true
  if (Array.isArray(d.missing_documents)) out.missing_documents = d.missing_documents.filter(isCodeLabel)
  if (Array.isArray(d.reasons)) {
    out.reasons = d.reasons.filter(isCodeLabel) as SubmitProblems['reasons']
  }
  return out
}

/** Whether a SubmitProblems names at least one thing to fix. */
export function hasListedProblems(p: SubmitProblems): boolean {
  return !!p.missing_profile || (p.missing_documents?.length ?? 0) > 0 || (p.reasons?.length ?? 0) > 0
}
