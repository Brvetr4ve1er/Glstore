/**
 * Financing applications — the review queue.
 *
 * Third use of the image-queue shape (status filter, list, pagination), and
 * the first that must not inherit its accessibility defect: every control has
 * visible text. Oldest submission first, so nobody waits behind newer files.
 *
 * Customer names are untrusted text, rendered as plain React text only.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import { fetchApplicationQueue, type ApplicationStatus } from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { ApplicationStatusBadge, FilterTab, money } from '@/components/FinancingBits'
import { fmtDate } from '@/lib/utils'

const PAGE_SIZE = 25

const TABS: { status: ApplicationStatus; label: string }[] = [
  { status: 'SUBMITTED', label: 'Envoyées' },
  { status: 'UNDER_REVIEW', label: "En cours d'étude" },
  { status: 'APPROVED', label: 'Acceptées' },
  { status: 'SIGNED', label: 'Signées' },
  { status: 'REJECTED', label: 'Refusées' },
  { status: 'DRAFT', label: 'Brouillons' },
]

export default function FinancingQueue() {
  const [status, setStatus] = useState<ApplicationStatus>('SUBMITTED')
  const [page, setPage] = useState(1)

  const { data, isPending, error } = useQuery({
    queryKey: ['financing-queue', status, page],
    queryFn: () => fetchApplicationQueue(status, page),
    placeholderData: prev => prev,
  })

  const items = data?.items ?? []
  const counts = data?.counts ?? {}

  return (
    <div className="flex flex-col gap-5 page-enter">
      <PageHeader
        title="Demandes de financement"
        sub="Étude des dossiers envoyés par les clients, du plus ancien au plus récent"
        actions={
          <Link to="/financing/rules" className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline">
            Règles et pièces justificatives
          </Link>
        }
      />

      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filtrer par statut">
        {TABS.map(t => (
          <FilterTab
            key={t.status}
            active={status === t.status}
            label={`${t.label} · ${counts[t.status] ?? 0}`}
            onClick={() => { setStatus(t.status); setPage(1) }}
          />
        ))}
      </div>

      {error ? (
        <EmptyState title="Chargement impossible" desc={(error as Error).message} />
      ) : isPending && items.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune demande"
          desc="Aucune demande dans ce statut pour le moment."
          icon={<Landmark size={24} aria-hidden="true" className="text-[var(--color-text-3)]" />}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map(a => (
            <li key={a.id}>
              <Link
                to={`/financing/applications/${a.id}`}
                className="glass p-4 flex items-center justify-between gap-4 flex-wrap hover:border-[var(--color-electric-blue)] transition-colors"
              >
                <div className="min-w-0 flex flex-col gap-1">
                  <span className="text-sm font-bold text-[var(--color-text-1)] font-mono">{a.reference}</span>
                  <span className="text-xs text-[var(--color-text-3)]">
                    {a.customer_name ?? 'Nom non renseigné'} · {a.customer_phone}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 text-right">
                  <span className="text-sm font-bold text-[var(--color-text-1)]">{money(a.financed_amount)} financés</span>
                  <span className="text-xs text-[var(--color-text-3)]">
                    {money(a.monthly_instalment)} × {a.duration_months} mois
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--color-text-3)]">{fmtDate(a.submitted_at ?? a.created_at)}</span>
                  <ApplicationStatusBadge status={a.status} label={a.status_label} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || items.length === PAGE_SIZE) && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Précédent
          </Button>
          <Button variant="outline" size="sm" disabled={items.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>
            Suivant
          </Button>
        </div>
      )}
    </div>
  )
}
