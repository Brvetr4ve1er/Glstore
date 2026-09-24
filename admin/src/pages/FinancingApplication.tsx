/**
 * One financing application — the whole file, and the decisions on it.
 *
 * Actions follow the status machine the database enforces:
 *   SUBMITTED    → "Ouvrir l'étude"
 *   UNDER_REVIEW → examine each document, then accept or refuse the file
 *   APPROVED     → record the signature
 * The server re-checks every step (roles, documents examined, legal
 * transition); these buttons only offer what could succeed.
 *
 * Everything the customer typed — names, employer, filenames — is untrusted
 * text and is rendered as plain React text only.
 */
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft, Check, Download, X as XIcon } from 'lucide-react'
import {
  acceptApplicationDocument, approveApplication, downloadApplicationDocument, fetchApplicationDetail,
  markApplicationSigned, rejectApplication, rejectApplicationDocument, startApplicationReview,
  type ApplicationDocument,
} from '@/lib/api'
import { Button, EmptyState, Input, Modal, Spinner, Textarea } from '@/components/ui'
import { ApplicationStatusBadge, EMPLOYMENT_LABELS, Field, Section, money } from '@/components/FinancingBits'
import { fmtDate } from '@/lib/utils'

type Dialog =
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'sign' }
  | { kind: 'reject-document'; doc: ApplicationDocument }
  | null

const ACTOR_LABELS: Record<string, string> = { CUSTOMER: 'Client', ADMIN: 'Équipe', SYSTEM: 'Système' }

export default function FinancingApplication() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [text, setText] = useState('')
  const [signature, setSignature] = useState('')

  const { data: a, isPending, error } = useQuery({
    queryKey: ['financing-application', id],
    queryFn: () => fetchApplicationDetail(id),
  })

  const done = (msg: string) => () => {
    toast.success(msg)
    setDialog(null)
    setText('')
    setSignature('')
    qc.invalidateQueries({ queryKey: ['financing-application', id] })
    qc.invalidateQueries({ queryKey: ['financing-queue'] })
  }
  const failed = (e: Error) => toast.error(e.message)
  // One reset for every way a dialog closes, so a refusal reason typed and
  // abandoned never pre-fills the next dialog.
  const closeDialog = () => {
    setDialog(null)
    setText('')
    setSignature('')
  }

  const startMut = useMutation({ mutationFn: () => startApplicationReview(id), onSuccess: done('Étude ouverte'), onError: failed })
  const approveMut = useMutation({ mutationFn: () => approveApplication(id, text), onSuccess: done('Demande acceptée'), onError: failed })
  const rejectMut = useMutation({ mutationFn: () => rejectApplication(id, text), onSuccess: done('Demande refusée'), onError: failed })
  const signMut = useMutation({ mutationFn: () => markApplicationSigned(id, signature.trim(), text), onSuccess: done('Signature enregistrée'), onError: failed })
  const acceptDocMut = useMutation({
    mutationFn: (docId: string) => acceptApplicationDocument(id, docId),
    onSuccess: done('Document validé'), onError: failed,
  })
  const rejectDocMut = useMutation({
    mutationFn: (docId: string) => rejectApplicationDocument(id, docId, text),
    onSuccess: done('Document marqué non conforme'), onError: failed,
  })

  if (isPending) {
    return <div className="flex justify-center py-16"><Spinner size={28} className="text-[var(--color-electric-blue)]" /></div>
  }
  if (error || !a) {
    return <EmptyState title="Demande introuvable" desc={(error as Error | null)?.message} />
  }

  const reviewing = a.status === 'UNDER_REVIEW'
  const sd = a.submission_decision
  const signatureValid = signature.trim() === '' || /^[0-9a-f]{64}$/.test(signature.trim())

  return (
    <div className="flex flex-col gap-5 page-enter">
      <Link to="/financing/applications" className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-3)] hover:text-[var(--color-text-1)] w-fit">
        <ArrowLeft size={13} aria-hidden="true" /> Retour aux demandes
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-black text-[var(--color-text-1)] font-mono">{a.reference}</h1>
          <ApplicationStatusBadge status={a.status} label={a.status_label} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {a.status === 'SUBMITTED' && (
            <Button variant="accent" loading={startMut.isPending} onClick={() => startMut.mutate()}>
              Ouvrir l'étude
            </Button>
          )}
          {reviewing && (
            <>
              <Button variant="outline" onClick={() => setDialog({ kind: 'reject' })}>
                <XIcon size={14} aria-hidden="true" /> Refuser la demande
              </Button>
              <Button variant="accent" onClick={() => setDialog({ kind: 'approve' })}>
                <Check size={14} aria-hidden="true" /> Accepter la demande
              </Button>
            </>
          )}
          {a.status === 'APPROVED' && (
            <Button variant="accent" onClick={() => setDialog({ kind: 'sign' })}>
              Enregistrer la signature
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Montants">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Total comptant">{money(a.figures.cash_total)}</Field>
            <Field label="Apport">{money(a.figures.down_payment)}</Field>
            <Field label="Montant financé">{money(a.figures.financed_amount)}</Field>
            <Field label="Marge">{money(a.figures.markup_amount)}</Field>
            <Field label="Total à rembourser">{money(a.figures.total_repayable)}</Field>
            <Field label="Mensualité">{money(a.figures.monthly_instalment)} × {a.figures.duration_months} mois</Field>
          </dl>
        </Section>

        <Section title="Client">
          {a.customer ? (
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Nom">{a.customer.full_name ?? 'Non renseigné'}</Field>
              <Field label="Téléphone">{a.customer.phone}</Field>
              <Field label="E-mail">{a.customer.email ?? '—'}</Field>
              <Field label="Téléphone vérifié le">{fmtDate(a.customer.phone_verified_at)}</Field>
            </dl>
          ) : <p className="text-sm text-[var(--color-text-3)]">Client introuvable.</p>}
        </Section>

        <Section title="Situation déclarée">
          {a.profile.financial || a.profile.employment ? (
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Revenu mensuel net">{money(a.profile.financial?.monthly_income)}</Field>
              <Field label="Remboursements en cours">{money(a.profile.financial?.monthly_obligations)}</Field>
              <Field label="Personnes à charge">{a.profile.financial?.dependents ?? '—'}</Field>
              <Field label="Situation">{EMPLOYMENT_LABELS[a.profile.employment?.employment_type ?? ''] ?? '—'}</Field>
              <Field label="Employeur">{a.profile.employment?.employer_name ?? '—'}</Field>
              <Field label="Poste">{a.profile.employment?.job_title ?? '—'}</Field>
              <Field label="En poste depuis">{a.profile.employment?.employed_since?.slice(0, 10) ?? '—'}</Field>
              {sd && (
                <Field label="Taux d'endettement (à l'envoi)">
                  {sd.debt_ratio_pct ? `${sd.debt_ratio_pct} %` : '—'}
                  {sd.max_debt_ratio_pct && <span className="text-[var(--color-text-3)]"> · plafond {sd.max_debt_ratio_pct} %</span>}
                </Field>
              )}
            </dl>
          ) : <p className="text-sm text-[var(--color-text-3)]">Pas encore renseignée.</p>}
        </Section>

        <Section title="Articles">
          <ul className="flex flex-col gap-2">
            {a.items.map((i, n) => {
              const short = i.offer_active === false || (i.available_now != null && i.available_now < i.quantity)
              return (
                <li key={n} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--color-text-1)] truncate">{i.product_name}</p>
                    <p className="text-xs text-[var(--color-text-3)] font-mono">{i.variant_sku} · {i.quantity} × {money(i.unit_price)}</p>
                    {short && (
                      <p className="text-xs text-[var(--color-hot-pink)] flex items-center gap-1 mt-0.5">
                        <AlertTriangle size={12} aria-hidden="true" />
                        {i.offer_active === false ? "L'offre n'est plus active" : `Stock actuel : ${i.available_now}`}
                      </p>
                    )}
                  </div>
                  <span className="font-bold text-[var(--color-text-1)] shrink-0">{money(i.line_total)}</span>
                </li>
              )
            })}
          </ul>
        </Section>
      </div>

      <Section title="Pièces justificatives">
        {a.documents.length === 0 ? (
          <p className="text-sm text-[var(--color-text-3)]">Aucun document déposé.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {a.documents.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 flex-wrap border-b border-[var(--color-surface-4)] pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-[var(--color-text-1)]">{d.label}</span>
                  <span className="text-xs text-[var(--color-text-3)] truncate">
                    {d.original_filename} · {(d.byte_size / 1024).toFixed(0)} Ko · {d.status_label}
                  </span>
                  {d.rejection_reason && <span className="text-xs text-[var(--color-hot-pink)]">{d.rejection_reason}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => downloadApplicationDocument(a.id, d).catch(failed)}
                    aria-label={`Télécharger ${d.label} (${d.original_filename})`}
                  >
                    <Download size={13} aria-hidden="true" /> Télécharger
                  </Button>
                  {reviewing && d.status !== 'ACCEPTED' && (
                    <Button
                      variant="outline" size="sm" loading={acceptDocMut.isPending}
                      onClick={() => acceptDocMut.mutate(d.id)}
                      aria-label={`Valider ${d.label}`}
                    >
                      Valider
                    </Button>
                  )}
                  {reviewing && d.status !== 'REJECTED' && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setDialog({ kind: 'reject-document', doc: d })}
                      aria-label={`Marquer ${d.label} comme non conforme`}
                    >
                      Non conforme
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Historique">
        <ol className="flex flex-col gap-2">
          {a.history.map((h, n) => (
            <li key={n} className="text-sm flex flex-wrap gap-x-2">
              <span className="text-[var(--color-text-3)]">{fmtDate(h.at)}</span>
              <span className="font-bold text-[var(--color-text-1)]">{h.from_status ?? '—'} → {h.to_status}</span>
              <span className="text-[var(--color-text-3)]">par {ACTOR_LABELS[h.actor_type] ?? h.actor_type}</span>
              {h.note && <span className="text-[var(--color-text-2)] w-full whitespace-pre-wrap">{h.note}</span>}
            </li>
          ))}
        </ol>
        {a.rejection_reason && (
          <p className="text-sm text-[var(--color-hot-pink)]">Motif interne du refus : {a.rejection_reason}</p>
        )}
      </Section>

      <Modal open={dialog?.kind === 'approve'} onClose={closeDialog} title="Accepter la demande">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-2)]">
            Tant que les conditions ne sont pas publiées, le client voit « accord de principe, sous réserve ».
          </p>
          <Textarea label="Note interne (facultative)" value={text} onChange={e => setText(e.target.value)} maxLength={2000} />
          <Button variant="accent" loading={approveMut.isPending} onClick={() => approveMut.mutate()}>
            Confirmer l'acceptation
          </Button>
        </div>
      </Modal>

      <Modal open={dialog?.kind === 'reject'} onClose={closeDialog} title="Refuser la demande">
        <div className="flex flex-col gap-4">
          <Textarea label="Motif (interne, obligatoire)" value={text} onChange={e => setText(e.target.value)} maxLength={2000} />
          <Button variant="danger" disabled={!text.trim()} loading={rejectMut.isPending} onClick={() => rejectMut.mutate()}>
            Confirmer le refus
          </Button>
        </div>
      </Modal>

      <Modal open={dialog?.kind === 'sign'} onClose={closeDialog} title="Enregistrer la signature">
        <div className="flex flex-col gap-4">
          <Input
            label="Empreinte SHA-256 du contrat signé (facultative)"
            value={signature}
            onChange={e => setSignature(e.target.value.toLowerCase())}
            error={signatureValid ? undefined : '64 caractères hexadécimaux attendus'}
            spellCheck={false}
          />
          <Textarea label="Note interne (facultative)" value={text} onChange={e => setText(e.target.value)} maxLength={2000} />
          <Button variant="accent" disabled={!signatureValid} loading={signMut.isPending} onClick={() => signMut.mutate()}>
            Confirmer la signature
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog?.kind === 'reject-document'}
        onClose={closeDialog}
        title={dialog?.kind === 'reject-document' ? `Non conforme : ${dialog.doc.label}` : 'Document non conforme'}
      >
        <div className="flex flex-col gap-4">
          <Textarea label="Motif (obligatoire)" value={text} onChange={e => setText(e.target.value)} maxLength={1000} />
          <Button
            variant="danger"
            disabled={!text.trim()}
            loading={rejectDocMut.isPending}
            onClick={() => dialog?.kind === 'reject-document' && rejectDocMut.mutate(dialog.doc.id)}
          >
            Confirmer
          </Button>
        </div>
      </Modal>
    </div>
  )
}
