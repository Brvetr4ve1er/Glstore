import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtMoney(
  amount: number | null | undefined,
  currency = 'DZD',
): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(new Date(iso), 'dd MMM yyyy, HH:mm')
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  return formatDistanceToNow(new Date(iso), { addSuffix: true })
}

export function fmtPercent(n: number): string {
  return `${Math.round(n * 100)}%`
}

/* ── Brand-aligned status palettes ──────────────────────────
 *  electric-blue → in-flight states
 *  neon-yellow   → review / needs-action
 *  hot-pink      → terminal failure / cancelled
 *  emerald       → success completion
 */
const YELLOW = 'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border border-[var(--color-neon-yellow)]/30'
const ELECTRIC = 'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30'
const BOLD = 'bg-[var(--color-bold-blue)]/30 text-[var(--color-electric-blue)] border border-[var(--color-bold-blue)]/40'
const PINK = 'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/30'
const SUCCESS = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
const NEUTRAL = 'bg-[var(--color-surface-3)] text-[var(--color-text-3)] border border-[var(--color-surface-4)]'

export const ORDER_STATUS_COLORS: Record<string, string> = {
  PENDING:   YELLOW,
  RESERVED:  ELECTRIC,
  CONFIRMED: BOLD,
  PACKED:    BOLD,
  SHIPPED:   ELECTRIC,
  DELIVERED: SUCCESS,
  CANCELLED: PINK,
  RETURNED:  YELLOW,
  FAILED:    PINK,
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  UNPAID:   NEUTRAL,
  PENDING:  YELLOW,
  PAID:     SUCCESS,
  REFUNDED: ELECTRIC,
  PARTIAL:  YELLOW,
  FAILED:   PINK,
}

export const PRODUCT_STATUS_COLORS: Record<string, string> = {
  RAW:        NEUTRAL,
  NORMALIZED: ELECTRIC,
  CLASSIFIED: BOLD,
  VERIFIED:   ELECTRIC,
  ACTIVE:     SUCCESS,
  NEEDS_FIX:  YELLOW,
  ARCHIVED:   NEUTRAL,
}
