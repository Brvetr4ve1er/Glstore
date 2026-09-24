import { createElement, type ReactElement } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { CategoryIcon, type CategoryIconProps } from '@/lib/icons'

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

/** Money the financing API returns as an exact decimal string ("9450.00"). */
export function fmtAmount(v: string | number | null | undefined, currency = 'DZD'): string {
  if (v == null || v === '') return '—'
  return fmtMoney(typeof v === 'number' ? v : Number(v), currency)
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

/**
 * ── Category icons ────────────────────────────────────────────────────────
 *
 * This used to be an emoji lookup over GLAIVE's gaming categories, defaulting
 * to a gamepad glyph. On an appliance catalogue every product misses that map,
 * so all 567 of them drew a gamepad — worse than drawing nothing at all. Emoji
 * as UI iconography is audit signal #22 besides.
 *
 * It now draws real SVG from `@/lib/icons` — one Lucide-grammar mark per
 * taxonomy category, 24×24, 2px stroke, round caps and joins, `currentColor`.
 *
 * `categoryIcon()` returns a ready-made ELEMENT rather than a component type,
 * and that is load-bearing. The brief for this change said ProductCard was the
 * only caller; it is one of SEVEN (ProductCard, ProductGallery, SearchBox,
 * Navbar ×2, Catalog, Home, ProductDetail), none of which this task may edit,
 * and every one renders it as `{categoryIcon(x)}` — a JSX child. A component
 * type is not a `ReactNode`: returning one fails `tsc -b` in six files owned by
 * other agents. An element keeps them all compiling and rendering, and the
 * default `size="1em"` means their `text-2xl` / `text-6xl` wrappers still
 * control the scale exactly as they did with the emoji.
 *
 * New code should prefer the component:
 *
 *   <CategoryIcon category={p.category} name={p.name} size={20} />
 *   <NoImageIllustration category={p.category} name={p.name} size="md" />
 *
 * Pass the product NAME whenever you have it: the catalogue's `category` column
 * is `"Electromenager"` on all 567 rows, so the name is the only real signal.
 */
export {
  CategoryIcon,
  NoImageIllustration,
  ICON_BY_SLUG,
  categoryIconComponent,
  resolveCategorySlug,
  resolveProductSlug,
  iconSlugFor,
} from '@/lib/icons'
export type {
  CategoryIconProps,
  NoImageIllustrationProps,
  IconComponent,
  IconProps,
} from '@/lib/icons'

/**
 * Draw the icon for a category. Accepts a slug (`'froid'`), a French label
 * (`'Froid'`) or a raw product name, and always returns an element.
 *
 * @param cat   slug, label or product name
 * @param props anything `<CategoryIcon>` takes — `size`, `className`, `name`, …
 */
export function categoryIcon(
  cat: string | null | undefined,
  props?: Omit<CategoryIconProps, 'category'>,
): ReactElement {
  return createElement(CategoryIcon, { category: cat, ...props })
}
