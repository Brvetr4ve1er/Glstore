/**
 * Review Queue — customer review moderation.
 *
 * Mirrors the ImageReview global queue's shape (FilterPill filter,
 * useQuery/useMutation, pagination) but for text reviews instead of images:
 * reviewers approve or reject PENDING reviews submitted by anonymous
 * customers via POST /products/{id}/reviews before they go public.
 *
 * SECURITY: customer_name / title / body are untrusted free text from
 * anonymous visitors. They are rendered as plain React text content only
 * (JSX escapes by default) — never via dangerouslySetInnerHTML, and never
 * used to build a URL or href.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Check, X as XIcon, MessageSquare, Star, User } from 'lucide-react'
import { fetchReviewQueue, moderateReview, type AdminReviewItem } from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

const PAGE_SIZE = 20

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED'

export default function ReviewQueue() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('PENDING')
  const [page, setPage] = useState(1)

  const { data, isPending } = useQuery({
    queryKey: ['review-queue', status, page],
    queryFn: () => fetchReviewQueue(status, page, PAGE_SIZE),
    placeholderData: prev => prev,
  })

  const moderateMut = useMutation({
    mutationFn: (args: { id: string; next: 'APPROVED' | 'REJECTED' }) =>
      moderateReview(args.id, args.next),
    onSuccess: (_r, args) => {
      toast.success(args.next === 'APPROVED' ? 'Avis approuvé' : 'Avis rejeté')
      qc.invalidateQueries({ queryKey: ['review-queue'] })
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
        title="Avis clients"
        sub="Validation des avis soumis par les clients avant publication"
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill
          active={status === 'PENDING'}
          label={`En attente${status === 'PENDING' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('PENDING')}
        />
        <FilterPill
          active={status === 'APPROVED'}
          label={`Approuvés${status === 'APPROVED' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('APPROVED')}
        />
        <FilterPill
          active={status === 'REJECTED'}
          label={`Rejetés${status === 'REJECTED' && data ? ` · ${total}` : ''}`}
          onClick={() => changeStatus('REJECTED')}
        />
      </div>

      {/* List */}
      {isPending && items.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Rien à valider"
          desc={
            status === 'PENDING'
              ? "Aucun avis en attente pour le moment."
              : status === 'APPROVED'
                ? "Aucun avis approuvé pour le moment."
                : "Aucun avis rejeté pour le moment."
          }
          icon={<MessageSquare size={24} className="text-[var(--color-text-3)]" />}
        />
      ) : (
        <motion.div className="flex flex-col gap-3" layout>
          <AnimatePresence>
            {items.map(item => (
              <ReviewRow
                key={item.id}
                item={item}
                pending={moderateMut.isPending}
                onApprove={() => moderateMut.mutate({ id: item.id, next: 'APPROVED' })}
                onReject={() => moderateMut.mutate({ id: item.id, next: 'REJECTED' })}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-3)]">
            Page {page} sur {totalPages} · {total} avis au total
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


function ReviewRow({
  item, onApprove, onReject, pending,
}: {
  item: AdminReviewItem
  onApprove: () => void
  onReject: () => void
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
          <Link
            to={`/products/${item.product_id}`}
            className="text-sm font-bold text-[var(--color-text-1)] hover:text-[var(--color-electric-blue)] transition-colors w-fit truncate max-w-full"
          >
            {item.product_name}
          </Link>
          <div className="flex items-center gap-2.5 text-xs text-[var(--color-text-3)] flex-wrap">
            <span className="flex items-center gap-1">
              <User size={11} /> {item.customer_name}
            </span>
            <StarRating rating={item.rating} />
            <span>· {fmtDate(item.created_at)}</span>
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>

      {(item.title || item.body) && (
        <div className="flex flex-col gap-1 pl-0.5">
          {item.title && (
            <p className="text-sm font-bold text-[var(--color-text-1)]">{item.title}</p>
          )}
          {item.body && (
            <p className="text-sm text-[var(--color-text-2)] leading-relaxed whitespace-pre-wrap">
              {item.body}
            </p>
          )}
        </div>
      )}

      {item.status === 'PENDING' && (
        <div className="flex items-center gap-2 pt-2 mt-1 border-t border-[var(--color-surface-4)]">
          <Button
            variant="outline"
            size="sm"
            loading={pending}
            onClick={onReject}
            aria-label="Rejeter l'avis"
          >
            <XIcon size={13} /> Rejeter
          </Button>
          <Button
            variant="accent"
            size="sm"
            loading={pending}
            onClick={onApprove}
            aria-label="Approuver l'avis"
          >
            <Check size={13} /> Approuver
          </Button>
        </div>
      )}
    </motion.div>
  )
}


function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${rating} sur 5 étoiles`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={12}
          aria-hidden="true"
          className={i < rating ? 'text-[var(--color-neon-yellow)]' : 'text-[var(--color-surface-4)]'}
          fill={i < rating ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  )
}


function StatusBadge({ status }: { status: AdminReviewItem['status'] }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING:  { bg: 'var(--color-neon-yellow)', fg: 'var(--color-jet-black)', label: 'En attente' },
    APPROVED: { bg: 'var(--color-success)',     fg: 'white',                  label: 'Approuvé' },
    REJECTED: { bg: 'var(--color-hot-pink)',    fg: 'white',                  label: 'Rejeté' },
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
