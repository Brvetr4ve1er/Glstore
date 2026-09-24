/**
 * Partners — point-of-sale applications and the approved partners.
 *
 * The queue follows ContactInbox/ReviewQueue: status tabs, oldest first,
 * every action a button with visible text (audit Critical #3 — the image
 * queue's icon-only buttons are the defect these screens must not repeat).
 * Approving creates the partner and its first location server-side in one
 * transaction; refusing needs a note.
 *
 * SECURITY: every application field is anonymous free text. Rendered as
 * plain React text only — never dangerouslySetInnerHTML, never in an href
 * (no tel:/mailto: built from it).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Store } from 'lucide-react'
import {
  approvePartnerApplication, fetchPartnerApplications, fetchPartners, PARTNER_ACTIVITY_LABELS,
  rejectPartnerApplication, setPartnerActive, startPartnerReview,
  type PartnerApplication, type PartnerApplicationStatus,
} from '@/lib/api'
import { WILAYAS } from '@/lib/wilayas'
import { Button, EmptyState, Modal, PageHeader, Spinner, Textarea } from '@/components/ui'
import { FilterTab, Section } from '@/components/FinancingBits'
import { fmtDate } from '@/lib/utils'

const TABS: { status: PartnerApplicationStatus; label: string }[] = [
  { status: 'NEW', label: 'Nouvelles' },
  { status: 'UNDER_REVIEW', label: 'En cours' },
  { status: 'APPROVED', label: 'Approuvées' },
  { status: 'REJECTED', label: 'Refusées' },
]

function wilayaName(code: string): string {
  const w = WILAYAS.find(x => x.code === code)
  return w ? `${code} · ${w.name}` : `Wilaya ${code}`
}

type Dialog = { kind: 'approve' | 'reject'; app: PartnerApplication } | null

export default function Partners() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<PartnerApplicationStatus>('NEW')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [note, setNote] = useState('')

  const queue = useQuery({
    queryKey: ['partner-applications', status],
    queryFn: () => fetchPartnerApplications(status),
    placeholderData: prev => prev,
  })
  const partners = useQuery({ queryKey: ['partners'], queryFn: fetchPartners })

  const closeDialog = () => { setDialog(null); setNote('') }
  const done = (msg: string) => () => {
    toast.success(msg)
    closeDialog()
    qc.invalidateQueries({ queryKey: ['partner-applications'] })
    qc.invalidateQueries({ queryKey: ['partners'] })
  }
  const failed = (e: Error) => toast.error(e.message)

  const reviewMut = useMutation({ mutationFn: startPartnerReview, onSuccess: done('Étude ouverte'), onError: failed })
  const approveMut = useMutation({
    mutationFn: (id: string) => approvePartnerApplication(id, note.trim()),
    onSuccess: done('Partenaire créé'), onError: failed,
  })
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectPartnerApplication(id, note.trim()),
    onSuccess: done('Demande refusée'), onError: failed,
  })
  const activeMut = useMutation({
    mutationFn: (args: { id: string; active: boolean }) => setPartnerActive(args.id, args.active),
    onSuccess: done('Partenaire mis à jour'), onError: failed,
  })

  const items = queue.data?.items ?? []
  const counts = queue.data?.counts ?? {}

  return (
    <div className="flex flex-col gap-5 page-enter">
      <PageHeader title="Partenaires" sub="Demandes des points de vente et partenaires approuvés" />

      <Section title="Demandes de partenariat">
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filtrer par statut">
          {TABS.map(t => (
            <FilterTab
              key={t.status}
              active={status === t.status}
              label={`${t.label} · ${counts[t.status] ?? 0}`}
              onClick={() => setStatus(t.status)}
            />
          ))}
        </div>

        {queue.isPending && items.length === 0 ? (
          <div className="flex justify-center py-10"><Spinner size={24} className="text-[var(--color-electric-blue)]" /></div>
        ) : queue.error ? (
          <EmptyState title="Chargement impossible" desc={(queue.error as Error).message} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucune demande"
            desc="Aucune demande dans ce statut."
            icon={<Store size={24} aria-hidden="true" className="text-[var(--color-text-3)]" />}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map(a => (
              <li key={a.id} className="border border-[var(--color-surface-4)] rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[var(--color-text-1)]">{a.business_name}</p>
                    <p className="text-xs text-[var(--color-text-3)]">
                      {PARTNER_ACTIVITY_LABELS[a.activity]} · {wilayaName(a.wilaya_code)} · {a.commune}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--color-text-3)]">{fmtDate(a.created_at)}</span>
                </div>
                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div><dt className="inline text-[var(--color-text-3)]">Contact : </dt><dd className="inline text-[var(--color-text-1)]">{a.contact_name}</dd></div>
                  <div><dt className="inline text-[var(--color-text-3)]">Téléphone : </dt><dd className="inline text-[var(--color-text-1)]">{a.phone}</dd></div>
                  {a.email && <div><dt className="inline text-[var(--color-text-3)]">E-mail : </dt><dd className="inline text-[var(--color-text-1)]">{a.email}</dd></div>}
                  {a.owner_name && <div><dt className="inline text-[var(--color-text-3)]">Propriétaire : </dt><dd className="inline text-[var(--color-text-1)]">{a.owner_name}</dd></div>}
                  <div className="sm:col-span-2"><dt className="inline text-[var(--color-text-3)]">Adresse : </dt><dd className="inline text-[var(--color-text-1)]">{a.address}</dd></div>
                </dl>
                {a.reason && <p className="text-sm text-[var(--color-text-2)] whitespace-pre-wrap">{a.reason}</p>}
                {a.prior_applications > 0 && (
                  <p className="text-xs text-[var(--color-neon-yellow)]">
                    {a.prior_applications} demande(s) antérieure(s) avec ce numéro
                  </p>
                )}
                {a.review_note && <p className="text-xs text-[var(--color-text-3)]">Note interne : {a.review_note}</p>}

                {(a.status === 'NEW' || a.status === 'UNDER_REVIEW') && (
                  <div className="flex items-center gap-2 pt-2 mt-1 border-t border-[var(--color-surface-4)] flex-wrap">
                    {a.status === 'NEW' && (
                      <Button variant="ghost" size="sm" loading={reviewMut.isPending}
                              onClick={() => reviewMut.mutate(a.id)}
                              aria-label={`Ouvrir l'étude de ${a.business_name}`}>
                        Ouvrir l'étude
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'reject', app: a })}
                            aria-label={`Refuser ${a.business_name}`}>
                      Refuser
                    </Button>
                    <Button variant="accent" size="sm" onClick={() => setDialog({ kind: 'approve', app: a })}
                            aria-label={`Approuver ${a.business_name}`}>
                      Approuver
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Partenaires approuvés">
        {partners.isPending ? (
          <div className="flex justify-center py-10"><Spinner size={24} className="text-[var(--color-electric-blue)]" /></div>
        ) : (partners.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-text-3)]">Aucun partenaire pour le moment.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {partners.data!.items.map(p => (
              <li key={p.id} className="border border-[var(--color-surface-4)] rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className={`text-sm font-black ${p.is_active ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-3)] line-through'}`}>
                      {p.name}
                    </p>
                    <p className="text-xs text-[var(--color-text-3)]">
                      {PARTNER_ACTIVITY_LABELS[p.activity]} · {p.contact_name} · {p.phone}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" loading={activeMut.isPending}
                          onClick={() => activeMut.mutate({ id: p.id, active: !p.is_active })}
                          aria-label={`${p.is_active ? 'Désactiver' : 'Réactiver'} ${p.name}`}>
                    {p.is_active ? 'Désactiver' : 'Réactiver'}
                  </Button>
                </div>
                <ul className="text-xs text-[var(--color-text-2)] flex flex-col gap-0.5">
                  {p.locations.map(l => (
                    <li key={l.id}>{wilayaName(l.wilaya_code)} · {l.commune} · {l.address}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Modal open={dialog?.kind === 'approve'} onClose={closeDialog}
             title={dialog ? `Approuver ${dialog.app.business_name}` : 'Approuver'}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-2)]">
            Le partenaire et son premier point de vente seront créés à partir de cette demande.
          </p>
          <Textarea label="Note interne (facultative)" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
          <Button variant="accent" loading={approveMut.isPending} onClick={() => dialog && approveMut.mutate(dialog.app.id)}>
            Confirmer l'approbation
          </Button>
        </div>
      </Modal>

      <Modal open={dialog?.kind === 'reject'} onClose={closeDialog}
             title={dialog ? `Refuser ${dialog.app.business_name}` : 'Refuser'}>
        <div className="flex flex-col gap-4">
          <Textarea label="Motif (interne, obligatoire)" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
          <Button variant="danger" disabled={!note.trim()} loading={rejectMut.isPending}
                  onClick={() => dialog && rejectMut.mutate(dialog.app.id)}>
            Confirmer le refus
          </Button>
        </div>
      </Modal>
    </div>
  )
}
