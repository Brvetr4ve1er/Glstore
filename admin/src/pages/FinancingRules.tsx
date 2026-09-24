/**
 * Financing rules and required documents — the operator's lending policy.
 *
 * Nothing on this screen suggests a number. Durations, markups, bounds, down
 * payment, debt ratio and the list of required documents are the operator's
 * business and regulatory terms; the fields start empty and carry no example
 * values, so no figure here can be mistaken for a recommendation.
 *
 * Rules are versions: a rule is never edited, a change is a new DRAFT, and
 * activating it retires the previous ACTIVE version (enforced server-side
 * and by a database trigger).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus } from 'lucide-react'
import {
  activateFinancingRule, createFinancingRule, createRequiredDocument, deleteFinancingRule,
  fetchFinancingRules, fetchRequiredDocuments, retireFinancingRule, updateRequiredDocument,
  type FinancingRule, type FinancingTerm,
} from '@/lib/api'
import { Button, EmptyState, Input, PageHeader, Spinner, Textarea } from '@/components/ui'
import { Section, money } from '@/components/FinancingBits'
import { fmtDate } from '@/lib/utils'

const RULE_STATUS: Record<FinancingRule['status'], { label: string; bg: string; fg: string }> = {
  DRAFT:   { label: 'Brouillon', bg: 'var(--color-surface-4)', fg: 'var(--color-text-2)' },
  ACTIVE:  { label: 'Active',    bg: 'var(--color-success)',   fg: 'white' },
  RETIRED: { label: 'Retirée',   bg: 'var(--color-surface-3)', fg: 'var(--color-text-3)' },
}

type TermRow = { months: string; markup_pct: string }

export default function FinancingRules() {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['financing-rules'], queryFn: fetchFinancingRules })
  const docs = useQuery({ queryKey: ['required-documents'], queryFn: fetchRequiredDocuments })

  const refresh = (msg: string) => () => {
    toast.success(msg)
    qc.invalidateQueries({ queryKey: ['financing-rules'] })
    qc.invalidateQueries({ queryKey: ['required-documents'] })
  }
  const failed = (e: Error) => toast.error(e.message)

  const activateMut = useMutation({ mutationFn: activateFinancingRule, onSuccess: refresh('Version activée'), onError: failed })
  const retireMut = useMutation({ mutationFn: retireFinancingRule, onSuccess: refresh('Version retirée'), onError: failed })
  const deleteMut = useMutation({ mutationFn: deleteFinancingRule, onSuccess: refresh('Brouillon supprimé'), onError: failed })

  // ── New rule form ──
  const [minF, setMinF] = useState('')
  const [maxF, setMaxF] = useState('')
  const [minDown, setMinDown] = useState('')
  const [maxRatio, setMaxRatio] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState<TermRow[]>([{ months: '', markup_pct: '' }])

  const createMut = useMutation({
    mutationFn: () => createFinancingRule({
      min_financed: minF,
      max_financed: maxF,
      min_down_payment_pct: minDown,
      max_debt_ratio_pct: maxRatio.trim() ? maxRatio : null,
      terms: terms.map<FinancingTerm>(t => ({ months: Number(t.months), markup_pct: t.markup_pct })),
      notes: notes.trim() || null,
    }),
    onSuccess: () => {
      refresh('Brouillon créé — activez-le pour le publier')()
      setMinF(''); setMaxF(''); setMinDown(''); setMaxRatio(''); setNotes('')
      setTerms([{ months: '', markup_pct: '' }])
    },
    onError: failed,
  })
  const formComplete = [minF, maxF, minDown].every(v => v.trim()) && terms.every(t => t.months.trim() && t.markup_pct.trim())

  // ── Required documents ──
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const createDocMut = useMutation({
    mutationFn: () => createRequiredDocument({ code, label, description: description.trim() || null }),
    onSuccess: () => { refresh('Pièce ajoutée')(); setCode(''); setLabel(''); setDescription('') },
    onError: failed,
  })
  const toggleDocMut = useMutation({
    mutationFn: (args: { id: string; is_active: boolean }) => updateRequiredDocument(args.id, { is_active: args.is_active }),
    onSuccess: refresh('Pièce mise à jour'),
    onError: failed,
  })

  return (
    <div className="flex flex-col gap-5 page-enter">
      <Link to="/financing/applications" className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-3)] hover:text-[var(--color-text-1)] w-fit">
        <ArrowLeft size={13} aria-hidden="true" /> Retour aux demandes
      </Link>
      <PageHeader
        title="Règles de financement"
        sub="Chaque modification est une nouvelle version ; une seule version est active à la fois"
      />

      <Section title="Versions">
        {rules.isPending ? (
          <Spinner size={24} className="text-[var(--color-electric-blue)]" />
        ) : rules.error ? (
          <EmptyState title="Chargement impossible" desc={(rules.error as Error).message} />
        ) : (rules.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-text-3)]">
            Aucune règle. Tant qu'aucune version n'est active, le financement est indisponible sur la boutique.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rules.data!.items.map(r => {
              const s = RULE_STATUS[r.status]
              return (
                <li key={r.id} className="border border-[var(--color-surface-4)] rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[var(--color-text-1)]">Version {r.version}</span>
                      <span className="badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === 'DRAFT' && (
                        <>
                          <Button variant="ghost" size="sm" loading={deleteMut.isPending}
                                  onClick={() => deleteMut.mutate(r.id)}
                                  aria-label={`Supprimer le brouillon version ${r.version}`}>
                            Supprimer
                          </Button>
                          <Button variant="accent" size="sm" loading={activateMut.isPending}
                                  onClick={() => {
                                    if (window.confirm(`Activer la version ${r.version} ? La version active actuelle sera retirée.`)) {
                                      activateMut.mutate(r.id)
                                    }
                                  }}
                                  aria-label={`Activer la version ${r.version}`}>
                            Activer
                          </Button>
                        </>
                      )}
                      {r.status === 'ACTIVE' && (
                        <Button variant="outline" size="sm" loading={retireMut.isPending}
                                onClick={() => {
                                  if (window.confirm('Retirer la version active ? Le financement deviendra indisponible.')) {
                                    retireMut.mutate(r.id)
                                  }
                                }}
                                aria-label={`Retirer la version ${r.version}`}>
                          Retirer
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-text-2)]">
                    Financé de {money(r.min_financed)} à {money(r.max_financed)} · apport minimum {r.min_down_payment_pct} %
                    · taux d'endettement max {r.max_debt_ratio_pct ? `${r.max_debt_ratio_pct} %` : 'non évalué'}
                  </p>
                  <p className="text-xs text-[var(--color-text-2)]">
                    Durées : {r.terms.map(t => `${t.months} mois (marge ${t.markup_pct} %)`).join(' · ')}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-3)]">
                    Créée {fmtDate(r.created_at)}
                    {r.activated_at && ` · activée ${fmtDate(r.activated_at)}`}
                    {r.retired_at && ` · retirée ${fmtDate(r.retired_at)}`}
                  </p>
                  {r.notes && <p className="text-xs text-[var(--color-text-3)] whitespace-pre-wrap">{r.notes}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Nouvelle version (brouillon)">
        <form
          className="flex flex-col gap-4"
          onSubmit={e => { e.preventDefault(); if (formComplete) createMut.mutate() }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Montant financé minimum (DA)" inputMode="decimal" value={minF} onChange={e => setMinF(e.target.value)} required />
            <Input label="Montant financé maximum (DA)" inputMode="decimal" value={maxF} onChange={e => setMaxF(e.target.value)} required />
            <Input label="Apport minimum (%)" inputMode="decimal" value={minDown} onChange={e => setMinDown(e.target.value)} required />
            <Input label="Taux d'endettement maximum (%) — vide : non évalué" inputMode="decimal" value={maxRatio} onChange={e => setMaxRatio(e.target.value)} />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em] mb-1">
              Durées proposées
            </legend>
            {terms.map((t, i) => (
              <div key={i} className="flex items-end gap-2">
                <Input label={`Durée ${i + 1} (mois)`} inputMode="numeric" value={t.months}
                       onChange={e => setTerms(ts => ts.map((x, j) => j === i ? { ...x, months: e.target.value } : x))} required />
                <Input label={`Marge ${i + 1} (%)`} inputMode="decimal" value={t.markup_pct}
                       onChange={e => setTerms(ts => ts.map((x, j) => j === i ? { ...x, markup_pct: e.target.value } : x))} required />
                {terms.length > 1 && (
                  <Button type="button" variant="ghost" size="sm"
                          onClick={() => setTerms(ts => ts.filter((_, j) => j !== i))}
                          aria-label={`Retirer la durée ${i + 1}`}>
                    Retirer
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit"
                    onClick={() => setTerms(ts => [...ts, { months: '', markup_pct: '' }])}>
              <Plus size={13} aria-hidden="true" /> Ajouter une durée
            </Button>
          </fieldset>

          <Textarea label="Note interne (facultative)" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} />
          <Button type="submit" variant="accent" className="w-fit" disabled={!formComplete} loading={createMut.isPending}>
            Créer le brouillon
          </Button>
        </form>
      </Section>

      <Section title="Pièces justificatives demandées">
        <p className="text-xs text-[var(--color-text-3)]">
          Liste définie par vous. Sans pièce active, aucune n'est exigée à l'envoi d'une demande.
        </p>
        {(docs.data?.items.length ?? 0) > 0 && (
          <ul className="flex flex-col gap-2">
            {docs.data!.items.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 flex-wrap text-sm">
                <div className="min-w-0">
                  <span className={`font-bold ${d.is_active ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-3)] line-through'}`}>
                    {d.label}
                  </span>
                  <span className="text-xs text-[var(--color-text-3)] font-mono"> · {d.code}</span>
                  {d.description && <p className="text-xs text-[var(--color-text-3)]">{d.description}</p>}
                </div>
                <Button variant="outline" size="sm" loading={toggleDocMut.isPending}
                        onClick={() => toggleDocMut.mutate({ id: d.id, is_active: !d.is_active })}
                        aria-label={`${d.is_active ? 'Désactiver' : 'Réactiver'} ${d.label}`}>
                  {d.is_active ? 'Désactiver' : 'Réactiver'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={e => { e.preventDefault(); if (code && label) createDocMut.mutate() }}
        >
          <Input label="Code (minuscules, chiffres, _)" value={code} pattern="[a-z0-9]+(_[a-z0-9]+)*"
                 onChange={e => setCode(e.target.value)} required />
          <Input label="Libellé affiché au client" value={label} onChange={e => setLabel(e.target.value)} required maxLength={120} />
          <div className="sm:col-span-2">
            <Textarea label="Précisions (facultatives)" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
          </div>
          <Button type="submit" variant="accent" className="w-fit" disabled={!code || !label} loading={createDocMut.isPending}>
            Ajouter la pièce
          </Button>
        </form>
      </Section>
    </div>
  )
}
