/**
 * `<CategoryIcon />` — the one way to draw a category mark.
 *
 * Give it whatever you have: a slug, a French label, or a product name. Pass
 * both `category` and `name` for a product and the name decides, because the
 * real catalogue's `category` column reads `"Electromenager"` on all 567 rows.
 *
 *   <CategoryIcon category="froid" size={32} />
 *   <CategoryIcon category={p.category} name={p.name} size={20} />
 *
 * Sizing defaults to `1em` so the icon inherits the surrounding font size. That
 * is what keeps the seven existing `categoryIcon()` call sites — which wrap the
 * result in `text-lg` / `text-2xl` / `text-3xl` / `text-6xl` — rendering at the
 * scale they were written for, without one of them being edited.
 *
 * Decorative by default (`aria-hidden`), because every call site already names
 * the category in adjacent text. Pass `label` to have it announced instead.
 */
import type { IconProps } from './registry'
import { categoryIconComponent, resolveCategorySlug, resolveProductSlug } from './registry'
import { categoryLabel } from '@/lib/taxonomy'

// `name` is omitted from the SVG props on purpose: SVG has its own `name`
// attribute typed `string | undefined`, and this component needs to accept the
// `string | null` that `ProductListItem.name` and friends actually carry.
export interface CategoryIconProps extends Omit<IconProps, 'name'> {
  /** Slug (`'froid'`), French label (`'Froid'`) or a product name. */
  category?: string | null
  /** Product name — wins when `category` carries no usable signal. */
  name?: string | null
  /** Announce to assistive tech: `true` uses the category label, a string overrides it. */
  label?: string | boolean
}

/** Resolve the slug the same way whether or not a product name was supplied. */
export function iconSlugFor(category?: string | null, name?: string | null): string {
  return name != null ? resolveProductSlug(category, name) : resolveCategorySlug(category)
}

export function CategoryIcon({
  category,
  name,
  size = '1em',
  className,
  label,
  ...rest
}: CategoryIconProps) {
  const Icon = categoryIconComponent(category, name)
  const slug = iconSlugFor(category, name)
  const announced =
    label === true ? categoryLabel(slug) : typeof label === 'string' ? label : null

  return (
    <Icon
      size={size}
      className={['inline-block shrink-0 align-middle', className].filter(Boolean).join(' ')}
      role={announced ? 'img' : undefined}
      aria-label={announced ?? undefined}
      aria-hidden={announced ? undefined : true}
      focusable={false}
      {...rest}
    />
  )
}
