import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtMoney(amount: number | null | undefined, currency = 'DZD'): string {
  if (amount == null || isNaN(amount)) return '—'
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat('fr-DZ').format(n)
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? singular + 's')
}

/** Human-readable category icon emoji — gaming map. */
const CATEGORY_ICONS: Record<string, string> = {
  // Gaming categories (GLAIVE)
  Headsets: '🎧', Keyboards: '⌨️', Mice: '🖱️',
  Mousepads: '🟧', Controllers: '🎮', Accessories: '🎚️',
  Streaming: '📹', Chairs: '🪑', Monitors: '🖥️',
  Audio: '🎧', Gaming: '🎮', Accessory: '🔌',
}

export function categoryIcon(cat: string | null | undefined): string {
  if (!cat) return '🎮'
  return CATEGORY_ICONS[cat] ?? '🎮'
}
