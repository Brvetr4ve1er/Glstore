/**
 * Contact Inbox — moderation queue for the storefront's "Nous contacter" form.
 *
 * Mirrors ReviewQueue.tsx's shape (FilterPill filter, useQuery/useMutation,
 * pagination) but for contact messages instead of reviews: an operator
 * triages messages submitted by anonymous visitors via POST /contact
 * (NEW → READ → ARCHIVED).
 *
 * SECURITY: name / message (and phone / email) are untrusted free text from
 * anonymous visitors. They are rendered as plain React text content only
 * (JSX escapes by default) — never via dangerouslySetInnerHTML, and never
 * used to build a URL or href (no `mailto:`/`tel:` links built from them).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Mail, Phone, User, Archive, MailOpen, Inbox } from 'lucide-react'
import { fetchContactInbox, moderateContactMessage, type ContactMessage } from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

const PAGE_SIZE = 20

type StatusFilter = 'NEW' | 'READ' | 'ARCHIVED'

export default function ContactInbox() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('NEW')
  const [page, setPage] = useState(1)

  const { data, isPending } = useQuery({
    queryKey: ['contact-inbox', status, page],
    queryFn: () => fetchContactInbox(status, page, PAGE_SIZE),
    placeholderData: prev => prev,
  })

  const moderateMut = useMutation({
    mutationFn: (args: { id: string; next: 'READ' | 'ARCHIVED' }) =>
      moderateContactMessage(args.id, args.next),
    onSuccess: (_r, args) => {
      toast.success(args.next === 'READ' ? 'Message marqué comme lu' : 'Message archivé')
      qc.invalidateQueries({ queryKey: ['contact-inbox'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const changeStatus = (next: StatusFilter) => {
    setStatus(next)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-5 page-enter">
      <PageHeader
        title="Messages de contact"
        sub="Triage des messages soumis via le formulaire de contact"
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill
          active={status === 'NEW'}
          label={`Nouveaux${status === 'NEW' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('NEW')}
        />
        <FilterPill
          active={status === 'READ'}
          label={`Lus${status === 'READ' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('READ')}
        />
        <FilterPill
          active={status === 'ARCHIVED'}
          label={`Archivés${status === 'ARCHIVED' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('ARCHIVED')}
        />
      </div>

      {/* List */}
      {isPending && items.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Boîte vide"
          desc={
            status === 'NEW'
              ? "Aucun nouveau message pour le moment."
              : status === 'READ'
                ? "Aucun message lu pour le moment."
                : "Aucun message archivé pour le moment."
          }
          icon={<Inbox size={24} className="text-[var(--color-text-3)]" />}
        />
      ) : (
        <motion.div className="flex flex-col gap-3" layout>
          <AnimatePresence>
            {items.map(item => (
              <ContactRow
                key={item.id}
                item={item}
                pending={moderateMut.isPending}
                onMarkRead={() => moderateMut.mutate({ id: item.id, next: 'READ' })}
                onArchive={() => moderateMut.mutate({ id: item.id, next: 'ARCHIVED' })}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-3)]">
            Page {page} sur {totalPages} · {total} messages au total
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}


function ContactRow({
  item, onMarkRead, onArchive, pending,
}: {
  item: ContactMessage
  onMarkRead: () => void
  onArchive: () => void
  pending: boolean
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="glass p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-text-1)]">
            <User size={13} className="text-[var(--color-text-3)]" aria-hidden="true" />
            {item.name}
          </span>
          <div className="flex items-center gap-2.5 text-xs text-[var(--color-text-3)] flex-wrap">
            {item.phone && (
              <span className="flex items-center gap-1">
                <Phone size={11} aria-hidden="true" /> {item.phone}
              </span>
            )}
            {item.email && (
              <span className="flex items-center gap-1">
                <Mail size={11} aria-hidden="true" /> {item.email}
              </span>
            )}
            <span>· {fmtDate(item.created_at)}</span>
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className="text-sm text-[var(--color-text-2)] leading-relaxed whitespace-pre-wrap pl-0.5">
        {item.message}
      </p>

      {item.status !== 'ARCHIVED' && (
        <div className="flex items-center gap-2 pt-2 mt-1 border-t border-[var(--color-surface-4)]">
          {item.status === 'NEW' && (
            <Button
              variant="outline"
              size="sm"
              loading={pending}
              onClick={onMarkRead}
              aria-label="Marquer le message comme lu"
            >
              <MailOpen size={13} aria-hidden="true" /> Marquer lu
            </Button>
          )}
          <Button
            variant="accent"
            size="sm"
            loading={pending}
            onClick={onArchive}
            aria-label="Archiver le message"
          >
            <Archive size={13} aria-hidden="true" /> Archiver
          </Button>
        </div>
      )}
    </motion.div>
  )
}


function StatusBadge({ status }: { status: ContactMessage['status'] }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    NEW:      { bg: 'var(--color-neon-yellow)', fg: 'var(--color-jet-black)', label: 'Nouveau' },
    READ:     { bg: 'var(--color-electric-blue)', fg: 'white',                label: 'Lu' },
    ARCHIVED: { bg: 'var(--color-surface-4)',   fg: 'var(--color-text-3)',    label: 'Archivé' },
  }
  const m = map[status] ?? { bg: 'var(--color-surface-4)', fg: 'var(--color-text-3)', label: status }
  return (
    <span className="badge shrink-0" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  )
}


function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
        active
          ? 'bg-[var(--color-electric-blue)]/20 border-[var(--color-electric-blue)] text-[var(--color-electric-blue)]'
          : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
      }`}
    >
      {label}
    </button>
  )
}
