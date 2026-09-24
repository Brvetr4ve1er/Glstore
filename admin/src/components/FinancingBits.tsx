/**
 * Small pieces shared by the financing admin screens.
 *
 * Accessibility is the point of several of these: the image queue these
 * screens descend from shipped icon-only buttons with no accessible name
 * (audit Critical #3). Every control here carries visible text, icons are
 * aria-hidden, and toggles expose their state with aria-pressed.
 */
import type { ReactNode } from 'react'
import type { ApplicationStatus } from '@/lib/api'
import { fmtMoney } from '@/lib/utils'

export function money(v: string | null | undefined): string {
  return v == null ? '—' : fmtMoney(Number(v))
}

const STATUS_STYLE: Record<ApplicationStatus, { bg: string; fg: string }> = {
  DRAFT:        { bg: 'var(--color-surface-4)',   fg: 'var(--color-text-2)' },
  SUBMITTED:    { bg: 'var(--color-neon-yellow)', fg: 'var(--color-jet-black)' },
  UNDER_REVIEW: { bg: 'var(--color-electric-blue)', fg: 'var(--color-jet-black)' },
  APPROVED:     { bg: 'var(--color-success)',     fg: 'white' },
  REJECTED:     { bg: 'var(--color-hot-pink)',    fg: 'white' },
  SIGNED:       { bg: 'var(--color-success)',     fg: 'white' },
}

export function ApplicationStatusBadge({ status, label }: { status: ApplicationStatus; label: string }) {
  const s = STATUS_STYLE[status]
  return (
    <span className="badge shrink-0" style={{ background: s.bg, color: s.fg }}>
      {label}
    </span>
  )
}

export function FilterTab({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
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

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass p-5 flex flex-col gap-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-[var(--color-text-1)] uppercase tracking-[0.12em]">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-3)]">{label}</dt>
      <dd className="text-sm text-[var(--color-text-1)]">{children}</dd>
    </div>
  )
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  FONCTIONNAIRE: 'Fonctionnaire',
  INDEPENDANT: 'Indépendant',
  RETRAITE: 'Retraité',
  AUTRE: 'Autre',
}
