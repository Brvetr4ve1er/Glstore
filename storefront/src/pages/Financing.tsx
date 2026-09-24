/**
 * Financement — the public explainer at /financement.
 *
 * What this page may say, and where each part comes from:
 *   · the process — five factual steps that mirror the real product: a
 *     simulation (POST /financing/simulate), an application opened with a
 *     phone + one-time SMS code (customer_auth), a declared profile and
 *     uploaded documents (financing_workflow), a review by the team
 *     (financing_review), then signature. No review time, no promise of
 *     speed or of acceptance.
 *   · the terms — ONLY what GET /financing/terms returns: durations, minimum
 *     down payment and the financed-amount bounds, captioned by the server's
 *     own label through <EstimateLabel>. Markups are never in that payload
 *     and no figure is computed here: a repayment figure only ever exists as
 *     a /simulate result, on the simulator page.
 *   · the documents — ONLY what GET /financing/required-documents returns
 *     (operator-configured; an empty list means nothing is asked).
 *
 * No eligibility criteria, rates, ages, income thresholds or document lists
 * are written into this file: every business term is the operator's to set.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, Calculator, CircleHelp, ClipboardList,
  FileSearch, FileText, LayoutGrid, PenLine, RefreshCw, Smartphone,
  type LucideIcon,
} from 'lucide-react'
import {
  fetchFinancingTerms, fetchRequiredDocuments,
  type FinancingTerms, type RequiredDocumentType,
} from '@/lib/api'
import { cn, fmtAmount, fmtNumber } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ScrollReveal } from '@/components/ScrollReveal'
import { SEO } from '@/components/SEO'
import { Button, Spinner } from '@/components/ui'
import { EstimateLabel } from '@/components/financing/EstimateLabel'

// Public, store-wide data — not account-scoped, so not under 'account'.
const TERMS_KEY = ['financing', 'terms'] as const
const REQUIRED_DOCUMENTS_KEY = ['financing', 'required-documents'] as const

const STEPS: { title: string; Icon: LucideIcon }[] = [
  { title: 'Simulez votre financement sur un produit ou votre panier', Icon: Calculator },
  { title: 'Ouvrez votre demande avec votre numéro de mobile (code par SMS)', Icon: Smartphone },
  { title: 'Renseignez votre situation et déposez vos pièces justificatives', Icon: ClipboardList },
  { title: 'Notre équipe étudie votre dossier', Icon: FileSearch },
  { title: 'Signature du contrat', Icon: PenLine },
]

// The ui.tsx Button recipe, applied to a router <Link>: a <button> nested in
// an <a> is two tab stops and invalid HTML, so the CTAs are links styled alike.
const LINK_BASE =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] active:scale-[0.97] select-none ' +
  'tracking-wide text-sm px-4 py-2.5 w-full sm:w-auto'
const LINK_VARIANTS = {
  accent:  'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]',
  outline: 'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5',
  ghost:   'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-1)]',
} as const

export default function FinancingPage() {
  const terms = useQuery({
    queryKey: TERMS_KEY,
    queryFn: fetchFinancingTerms,
    staleTime: 5 * 60_000,
  })
  const documents = useQuery({
    queryKey: REQUIRED_DOCUMENTS_KEY,
    queryFn: fetchRequiredDocuments,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Financement"
        description="Comment se déroule une demande de financement : simulation, demande, pièces justificatives, étude du dossier et signature du contrat."
      />
      <Breadcrumbs items={[{ label: 'Financement' }]} />

      <div className="mt-4 mb-8">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Financement</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2 max-w-xl leading-relaxed">
          Voici comment se déroule une demande de financement, étape par étape, et ce que nous
          vous demandons.
        </p>
      </div>

      {/* ── Process ── */}
      <ScrollReveal variant="fade-up-sm">
        <section aria-labelledby="financing-process" className="glass-strong p-6 mb-6 relative overflow-hidden">
          <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <h2 id="financing-process" className="text-xl font-black text-[var(--color-text-1)] mb-5">
            Comment ça marche
          </h2>
          <ol className="flex flex-col gap-3">
            {STEPS.map(({ title, Icon }, i) => (
              <li key={title} className="glass-sm flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="num w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-black bg-[var(--color-electric-blue)] text-[var(--color-jet-black)]"
                >
                  {i + 1}
                </span>
                <Icon size={16} aria-hidden="true" className="shrink-0 text-[var(--color-electric-blue)]" />
                <span className="text-sm font-bold text-[var(--color-text-1)] leading-snug">{title}</span>
              </li>
            ))}
          </ol>
        </section>
      </ScrollReveal>

      {/* ── Terms (GET /financing/terms) ── */}
      <ScrollReveal variant="fade-up-sm">
        <section aria-labelledby="financing-terms" className="glass p-6 mb-6">
          <h2 id="financing-terms" className="text-xl font-black text-[var(--color-text-1)] mb-4">
            Conditions actuelles
          </h2>
          {terms.isPending ? (
            <Loading label="Chargement des conditions de financement" />
          ) : terms.isError ? (
            <LoadError
              message="Impossible de charger les conditions de financement pour le moment."
              retrying={terms.isFetching}
              onRetry={() => { void terms.refetch() }}
            />
          ) : (
            <TermsBody terms={terms.data} />
          )}
        </section>
      </ScrollReveal>

      {/* ── Documents (GET /financing/required-documents) ── */}
      <ScrollReveal variant="fade-up-sm">
        <section aria-labelledby="financing-documents" className="glass p-6 mb-6">
          <h2 id="financing-documents" className="text-xl font-black text-[var(--color-text-1)] mb-4">
            Pièces justificatives
          </h2>
          {documents.isPending ? (
            <Loading label="Chargement des pièces justificatives" />
          ) : documents.isError ? (
            <LoadError
              message="Impossible de charger la liste des pièces justificatives pour le moment."
              retrying={documents.isFetching}
              onRetry={() => { void documents.refetch() }}
            />
          ) : (
            <DocumentList items={documents.data.items} />
          )}
        </section>
      </ScrollReveal>

      {/* ── Next steps ── */}
      <ScrollReveal variant="fade-up-sm">
        <section aria-labelledby="financing-next" className="glass-strong p-6 relative overflow-hidden">
          <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <h2 id="financing-next" className="text-xl font-black text-[var(--color-text-1)] mb-4">
            Et maintenant ?
          </h2>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
            <Link to="/simulate" className={cn(LINK_BASE, LINK_VARIANTS.accent)}>
              <Calculator size={14} aria-hidden="true" /> Simuler un financement
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link to="/c/all" className={cn(LINK_BASE, LINK_VARIANTS.outline)}>
              <LayoutGrid size={14} aria-hidden="true" /> Parcourir le catalogue
            </Link>
            <Link to="/faq" className={cn(LINK_BASE, LINK_VARIANTS.ghost)}>
              <CircleHelp size={14} aria-hidden="true" /> Questions fréquentes
            </Link>
          </div>
        </section>
      </ScrollReveal>
    </div>
  )
}

function TermsBody({ terms }: { terms: FinancingTerms }) {
  if (!terms.available) {
    return (
      <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
        Le financement n'est pas disponible pour le moment.
      </p>
    )
  }

  const durations = [...(terms.durations ?? [])].sort((a, b) => a - b)
  const pct = terms.min_down_payment_pct != null ? Number(terms.min_down_payment_pct) : NaN
  const hasBounds = terms.min_financed != null && terms.max_financed != null

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {durations.length > 0 && (
          <div className="glass-sm px-4 py-3">
            <dt className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-2">
              Durées proposées
            </dt>
            <dd>
              <ul className="flex flex-wrap gap-1.5">
                {durations.map(n => (
                  <li
                    key={n}
                    className="badge bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30"
                  >
                    <span className="num">{n}</span> mois
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {Number.isFinite(pct) && (
          <div className="glass-sm px-4 py-3">
            <dt className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-2">
              Apport minimum
            </dt>
            <dd>
              <span className="num text-xl font-black text-[var(--color-text-1)]">{fmtNumber(pct)}{' '}%</span>
              <span className="block text-xs text-[var(--color-text-3)] mt-0.5">du montant de l'achat</span>
            </dd>
          </div>
        )}
        {hasBounds && (
          <div className="glass-sm px-4 py-3">
            <dt className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-2">
              Montant financé
            </dt>
            <dd>
              <span className="num text-sm font-black text-[var(--color-text-1)]">
                {fmtAmount(terms.min_financed)} – {fmtAmount(terms.max_financed)}
              </span>
              <span className="block text-xs text-[var(--color-text-3)] mt-0.5">
                Montant de l'achat, déduction faite de l'apport
              </span>
            </dd>
          </div>
        )}
      </dl>
      <EstimateLabel presentation={terms} />
    </div>
  )
}

function DocumentList({ items }: { items: RequiredDocumentType[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
        Aucune pièce justificative n'est demandée pour le moment.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map(doc => (
        <li key={doc.code} className="glass-sm flex items-start gap-3 px-4 py-3">
          <FileText size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-[var(--color-electric-blue)]" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-text-1)]">{doc.label}</p>
            {doc.description && (
              <p className="text-xs text-[var(--color-text-3)] mt-0.5 leading-relaxed">{doc.description}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-4 text-sm text-[var(--color-text-3)]">
      <Spinner size={18} className="text-[var(--color-electric-blue)]" />
      <span>{label}…</span>
    </div>
  )
}

function LoadError({
  message, retrying, onRetry,
}: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5">
      <p role="alert" className="flex items-start gap-2.5 flex-1 text-sm text-[var(--color-text-2)] leading-relaxed">
        <AlertTriangle size={15} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
        <span>{message}</span>
      </p>
      <Button variant="outline" size="sm" loading={retrying} onClick={onRetry} className="self-start sm:self-auto">
        {!retrying && <RefreshCw size={13} aria-hidden="true" />} Réessayer
      </Button>
    </div>
  )
}
