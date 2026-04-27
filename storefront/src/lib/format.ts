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

/** Human-readable category icon emoji (subset of admin's mapping). */
const CATEGORY_ICONS: Record<string, string> = {
  TV: '📺', Smartphone: '📱', Laptop: '💻', Tablet: '📟',
  Refrigerator: '🧊', Freezer: '🧊',
  'Washing Machine': '🫧', Dishwasher: '🫗',
  Microwave: '📡', Oven: '🔥', Cooktop: '🍳',
  Cooker: '🍳', AC: '❄️', Fan: '🌀',
  Mixer: '⚙️', Blender: '🫙', Kettle: '☕',
  Iron: '👔', 'Coffee Machine': '☕', Toaster: '🍞',
  Vacuum: '🌀', Fryer: '🍟', 'Hair Dryer': '💨',
  Beauty: '💅', Audio: '🎧', Gaming: '🎮',
  Accessory: '🔌',
}

export function categoryIcon(cat: string | null | undefined): string {
  if (!cat) return '📦'
  return CATEGORY_ICONS[cat] ?? '📦'
}
