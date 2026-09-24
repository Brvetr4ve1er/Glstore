/**
 * /account/applications/:id — one of the signed-in customer's applications.
 *
 * Figures come from GET /financing/applications/{id}; the detail object is
 * itself the presentation handed to <EstimateLabel>. The history uses the
 * server's `label` for every entry and the status badge the server's
 * `status_label` — nothing here words a status. Documents are shown read-only
 * from GET /financing/applications/{id}/documents; changing them happens in
 * the /apply flow while the application is still a draft.
 *
 * The route is wrapped in <RequireCustomer>; <AccountShell> owns the h1 + SEO.
 */
import { Link, useParams } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ArrowRight, FileSearch, FileText, Package, RefreshCw,
} from 'lucide-react'
import {
  ApiError, fetchApplicationDocuments, fetchMyApplication,
  type ApplicationDetail, type DocumentChecklist, type UploadedDocument,
} from '@/lib/api'
import { cn, fmtAmount } from '@/lib/format'
import type { TagTone } from '@/lib/tags'
import { loginPath } from '@/lib/session'
import { AccountShell } from '@/components/account/AccountShell'
import { ApplicationStatusBadge } from '@/components/financing/ApplicationStatusBadge'
import { EstimateLabel } from '@/components/financing/EstimateLabel'
import { Button, EmptyState, Spinner, Tag } from '@/components/ui'

const LIST_PATH = '/account/applications'

// The API takes a UUID here; anything else is a 422 upstream. Checking first
// keeps a crafted URL from being spliced into an API path.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Links styled like ui.tsx <Button> — a <button> cannot wrap a <Link>.
const LINK_BASE =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] tracking-wide'
const LINK_ACCENT =
  'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]'
const LINK_OUTLINE =
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5'

const SECTION_TITLE = 'text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4'

/** Colour only — the words are the server's `status_label`. */
const DOCUMENT_TONE: Record<UploadedDocument['status'], TagTone> = {
  UPLOADED: 'electric',
  ACCEPTED: 'success',
  REJECTED: 'pink',
}

/** A 4xx will not change on retry; only retry server or network failures. */
function retryServerErrors(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

/** 404 (not mine / not found) and 422 (not a valid id) read the same. */
function isNotFound(error: Error): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422)
}

/** The API sends ISO timestamps (or null); a malformed one must not break the page. */
function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('fr-DZ', {
      day: '2-digit', month: 'short', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(d)
  } catch {
    return withTime ? d.toISOString().slice(0, 16).replace('T', ' ') : d.toISOString().slice(0, 10)
  }
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  const nf = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 })
  if (n < 1024) return `${nf.format(n)} o`
  if (n < 1024 * 1024) return `${nf.format(n / 1024)} Ko`
  return `${nf.format(n / (1024 * 1024))} Mo`
}

export default function ApplicationDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = rawId && UUID_RE.test(rawId) ? rawId : null

  const detail = useQuery({
    queryKey: ['account', 'applications', id],
    queryFn: () => fetchMyApplication(id as string),
    enabled: id !== null,
    retry: retryServerErrors,
  })

  const docs = useQuery({
    queryKey: ['account', 'application-documents', id],
    queryFn: () => fetchApplicationDocuments(id as string),
    enabled: id !== null && detail.isSuccess,
    retry: retryServerErrors,
  })

  const notFound = id === null || (detail.isError && isNotFound(detail.error))
  const app = detail.data

  return (
    <AccountShell title={app ? `Demande ${app.reference}` : 'Demande de financement'}>
      <div className="page-enter">
        <Link
          to={LIST_PATH}
          className="inline-flex items-center gap-1.5 mb-6 text-sm font-bold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Toutes mes demandes
        </Link>

        {notFound ? (
          <EmptyState
            icon={<FileSearch size={44} aria-hidden="true" className="text-[var(--color-text-3)] opacity-60" />}
            title="Demande introuvable"
            desc="Cette demande n'existe pas ou n'est pas rattachée à votre compte."
            action={(
              <Link to={LIST_PATH} className={cn(LINK_BASE, LINK_OUTLINE)}>
                Voir mes demandes
              </Link>
            )}
          />
        ) : detail.isPending ? (
          <div role="status" className="flex items-center justify-center gap-3 py-20 text-[var(--color-text-3)]">
            <Spinner size={24} className="text-[var(--color-electric-blue)]" />
            <span className="text-sm">Chargement de la demande…</span>
          </div>
        ) : detail.isError && !detail.data ? (
          // Only when nothing ever loaded: a failed BACKGROUND refresh keeps
          // showing the application instead of replacing it with an error.
          <LoadError
            error={detail.error}
            onRetry={() => detail.refetch()}
            retrying={detail.isFetching}
            loginNext={`${LIST_PATH}/${id}`}
            message="Impossible de charger cette demande pour le moment. Vérifiez votre connexion puis réessayez."
          />
        ) : (
          <DetailBody app={detail.data} docs={docs} />
        )}
      </div>
    </AccountShell>
  )
}

type DocsQuery = UseQueryResult<DocumentChecklist, Error>

function DetailBody({ app, docs }: { app: ApplicationDetail; docs: DocsQuery }) {
  const isDraft = app.status === 'DRAFT'
  const applyPath = `/apply/${encodeURIComponent(app.id)}`
  const selfPath = `${LIST_PATH}/${encodeURIComponent(app.id)}`

  return (
    <div className="flex flex-col gap-6">
      {isDraft && (
        <div className="glass-strong rounded-xl p-5 sm:p-6 relative overflow-hidden flex flex-col sm:flex-row sm:items-center gap-4">
          <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <p className="flex-1 text-sm text-[var(--color-text-2)] leading-relaxed">
            Reprenez votre demande là où vous l'avez laissée pour la compléter et l'envoyer.
          </p>
          <Link to={applyPath} className={cn(LINK_BASE, LINK_ACCENT, 'text-base px-6 py-3 shrink-0')}>
            Continuer ma demande <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {/* Summary + figures */}
          <section aria-labelledby="application-figures-title" className="glass rounded-xl p-5 sm:p-6">
            <h2 id="application-figures-title" className="sr-only">Récapitulatif de la demande</h2>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
                  Référence
                </div>
                <div className="num text-2xl font-black text-[var(--color-neon-yellow)] break-all">
                  {app.reference}
                </div>
              </div>
              <ApplicationStatusBadge status={app.status} label={app.status_label} />
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6 text-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                  Date de création
                </dt>
                <dd className="font-semibold text-[var(--color-text-1)] mt-0.5">{fmtDate(app.created_at)}</dd>
              </div>
              {app.submitted_at && (
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                    Date d'envoi
                  </dt>
                  <dd className="font-semibold text-[var(--color-text-1)] mt-0.5">{fmtDate(app.submitted_at)}</dd>
                </div>
              )}
            </dl>

            <h3 className={SECTION_TITLE}>Montants</h3>

            <div className="rounded-xl border border-[var(--color-surface-4)] bg-[var(--color-surface-3)]/40 p-4 mb-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                Remboursement mensuel estimé
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="num text-2xl sm:text-3xl font-black text-[var(--color-text-1)]">
                  {fmtAmount(app.monthly_instalment)}
                </span>
                <span className="num text-sm font-semibold text-[var(--color-text-2)]">
                  × {app.duration_months} mois
                </span>
              </div>
            </div>
            <EstimateLabel presentation={app} className="mb-5" />

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <Figure label="Montant total comptant" value={fmtAmount(app.cash_total)} />
              <Figure label="Apport" value={fmtAmount(app.down_payment)} />
              <Figure label="Montant financé" value={fmtAmount(app.financed_amount)} />
              <Figure label="Coût du financement" value={fmtAmount(app.markup_amount)} />
              <Figure label="Total à rembourser" value={fmtAmount(app.total_repayable)} strong />
              <Figure label="Durée" value={`${app.duration_months} mois`} />
            </dl>
          </section>

          {/* Items */}
          <section aria-labelledby="application-items-title" className="glass rounded-xl p-5 sm:p-6">
            <h2 id="application-items-title" className={SECTION_TITLE}>
              Articles ({app.items.length})
            </h2>
            {app.items.length === 0 ? (
              <p className="text-sm text-[var(--color-text-3)]">Aucun article dans cette demande.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {app.items.map((it, i) => (
                  <li
                    key={`${it.offer_id}-${i}`}
                    className="glass-sm rounded-xl flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <Package size={16} aria-hidden="true" className="text-[var(--color-text-3)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[var(--color-text-1)] break-words">
                        {it.product_name}
                      </div>
                      <div className="num text-[11px] text-[var(--color-text-3)] break-all">
                        {it.variant_sku} · {fmtAmount(it.unit_price)} × {it.quantity}
                      </div>
                    </div>
                    {it.line_total != null && (
                      <div className="num text-sm font-bold text-[var(--color-text-1)] shrink-0">
                        {fmtAmount(it.line_total)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <DocumentsSection docs={docs} isDraft={isDraft} loginNext={selfPath} />
          <HistorySection history={app.history} />
        </div>
      </div>
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-surface-4)]/60 pb-2">
      <dt className="text-xs text-[var(--color-text-3)]">{label}</dt>
      <dd className={cn('num text-sm text-right', strong ? 'font-black text-[var(--color-text-1)]' : 'font-bold text-[var(--color-text-2)]')}>
        {value}
      </dd>
    </div>
  )
}

function HistorySection({ history }: { history: ApplicationDetail['history'] }) {
  return (
    <section aria-labelledby="application-history-title" className="glass rounded-xl p-5 sm:p-6">
      <h2 id="application-history-title" className={SECTION_TITLE}>Historique</h2>
      {history.length === 0 ? (
        <p className="text-sm text-[var(--color-text-3)]">Aucun évènement enregistré.</p>
      ) : (
        <ol className="relative flex flex-col gap-4 pl-5 border-l border-[var(--color-surface-4)] ml-1.5">
          {history.map((entry, i) => {
            const latest = i === history.length - 1
            return (
              <li
                key={`${entry.status}-${entry.at ?? 'na'}-${i}`}
                aria-current={latest ? 'step' : undefined}
                className="relative"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -left-[27px] top-1 w-3 h-3 rounded-full border-2',
                    latest
                      ? 'bg-[var(--color-electric-blue)] border-[var(--color-electric-blue)] glow-brand'
                      : 'bg-[var(--color-surface-2)] border-[var(--color-surface-4)]',
                  )}
                />
                <div className={cn('text-sm font-bold', latest ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-2)]')}>
                  {entry.label}
                </div>
                {entry.at ? (
                  <time dateTime={entry.at} className="text-xs text-[var(--color-text-3)]">
                    {fmtDate(entry.at, true)}
                  </time>
                ) : (
                  <span className="text-xs text-[var(--color-text-3)]">—</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function DocumentsSection({
  docs, isDraft, loginNext,
}: { docs: DocsQuery; isDraft: boolean; loginNext: string }) {
  return (
    <section aria-labelledby="application-documents-title" className="glass rounded-xl p-5 sm:p-6">
      <h2 id="application-documents-title" className={SECTION_TITLE}>Documents</h2>

      {docs.isPending ? (
        <div role="status" className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-3)]">
          <Spinner size={16} className="text-[var(--color-electric-blue)]" />
          Chargement des documents…
        </div>
      ) : docs.isError ? (
        <LoadError
          error={docs.error}
          onRetry={() => { docs.refetch() }}
          retrying={docs.isFetching}
          loginNext={loginNext}
          message="Impossible de charger les documents pour le moment."
          compact
        />
      ) : docs.data && docs.data.items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-3)]">
          Aucun document n'est demandé pour cette demande.
        </p>
      ) : docs.data ? (
        <>
          <ul className="flex flex-col gap-4">
            {docs.data.items.map(kind => (
              <li key={kind.code}>
                <div className="text-sm font-bold text-[var(--color-text-1)]">{kind.label}</div>
                {kind.description && (
                  <p className="text-xs text-[var(--color-text-3)] mt-0.5 leading-relaxed">{kind.description}</p>
                )}
                {kind.uploaded.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-3)] mt-2 italic">Aucun fichier déposé.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 mt-2">
                    {kind.uploaded.map(doc => (
                      <li
                        key={doc.id}
                        className="glass-sm rounded-lg flex items-center gap-2.5 px-3 py-2"
                      >
                        <FileText size={14} aria-hidden="true" className="text-[var(--color-text-3)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-[var(--color-text-1)] break-all">
                            {doc.original_filename}
                          </div>
                          <div className="text-[10px] text-[var(--color-text-3)]">
                            {[fmtBytes(doc.byte_size), doc.uploaded_at ? fmtDate(doc.uploaded_at) : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </div>
                        <Tag label={doc.status_label} tone={DOCUMENT_TONE[doc.status] ?? 'muted'} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {isDraft && !docs.data.complete && (
            <p className="mt-4 pt-3 border-t border-[var(--color-surface-4)] text-xs text-[var(--color-text-2)] leading-relaxed">
              Des documents restent à déposer. Continuez votre demande pour les ajouter.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}

function LoadError({
  error, onRetry, retrying, loginNext, message, compact,
}: {
  error: Error
  onRetry: () => void
  retrying: boolean
  loginNext: string
  message: string
  compact?: boolean
}) {
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div
        role="alert"
        className="glass-sm rounded-xl p-4 flex items-start gap-3 border border-[var(--color-hot-pink)]/30"
      >
        <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--color-text-2)]">
          Votre session a expiré.{' '}
          <Link to={loginPath(loginNext)} className="font-bold text-[var(--color-electric-blue)] hover:underline">
            Reconnectez-vous
          </Link>{' '}
          pour consulter cette demande.
        </p>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className={cn(
        'glass-sm rounded-xl p-4 flex gap-3 border border-[var(--color-hot-pink)]/30',
        compact ? 'flex-col' : 'flex-col sm:flex-row sm:items-center',
      )}
    >
      <div className="flex items-start gap-3 flex-1">
        <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--color-text-2)]">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} loading={retrying} className="self-start sm:self-auto">
        {!retrying && <RefreshCw size={14} aria-hidden="true" />} Réessayer
      </Button>
    </div>
  )
}
