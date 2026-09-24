/**
 * An application's status. The WORDS come from the server (`status_label`),
 * which never says "approuvé" while terms are not public — this component
 * only chooses a colour, and must never substitute its own wording.
 */
import type { ApplicationStatus } from '@/lib/api'
import { cn } from '@/lib/format'

const TONE: Record<ApplicationStatus, string> = {
  DRAFT:        'bg-[var(--color-surface-3)] text-[var(--color-text-2)] border-[var(--color-surface-4)]',
  SUBMITTED:    'bg-[var(--color-electric-blue)]/12 text-[var(--color-text-1)] border-[var(--color-electric-blue)]/40',
  UNDER_REVIEW: 'bg-[var(--color-electric-blue)]/12 text-[var(--color-text-1)] border-[var(--color-electric-blue)]/40',
  APPROVED:     'bg-[var(--color-success)]/12 text-[var(--color-text-1)] border-[var(--color-success)]/40',
  SIGNED:       'bg-[var(--color-success)]/12 text-[var(--color-text-1)] border-[var(--color-success)]/40',
  REJECTED:     'bg-[var(--color-hot-pink)]/10 text-[var(--color-text-1)] border-[var(--color-hot-pink)]/35',
}

export function ApplicationStatusBadge({
  status, label, className,
}: { status: ApplicationStatus; label: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold', TONE[status], className)}>
      {label}
    </span>
  )
}
