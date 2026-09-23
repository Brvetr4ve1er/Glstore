/**
 * `<NoImageIllustration />` — what 567 products actually look like.
 *
 * `Liens Média` is filled on **0%** of the catalogue. Not "most products lack a
 * photo": none of them have one. So this component is not an error state or a
 * fallback — it is the primary visual treatment for every card, every gallery
 * and every line item in the shop, and it has to look like a decision rather
 * than a missing asset.
 *
 * The composition, from back to front:
 *   1. `.no-img-placeholder` (index.css:304) — the existing tonal surface, two
 *      brand-tinted radial gradients over `--color-surface-3`. Reused, not
 *      reinvented, so it re-themes with the rest of the storefront.
 *   2. A dashed ring — the visual grammar of "a frame with nothing in it",
 *      which is honest about what is missing instead of pretending otherwise.
 *      Dropped at `sm`, where the host boxes are too small to clear it.
 *   3. A lighter medallion disc, giving the mark a lit surface to sit on so it
 *      reads as an object rather than a stain on the background.
 *   4. The category icon at display scale, tinted with the text ramp and
 *      warming to the brand colour on card hover (inert outside a `group`).
 *   5. The French category label, on the type scale — never the banned 10px
 *      arbitrary size.
 *
 * Decorative by default: with a visible label the text carries the meaning, and
 * with `showLabel={false}` the whole block is `aria-hidden` because every call
 * site renders the product name next to it.
 */
import { CategoryIcon, iconSlugFor } from './CategoryIcon'
import { cx } from './cx'
import { categoryLabel } from '@/lib/taxonomy'

export type IllustrationSize = 'sm' | 'md' | 'lg'

export interface NoImageIllustrationProps {
  /** Slug, French label, or a product name. */
  category?: string | null
  /** Product name — wins when `category` carries no usable signal. */
  name?: string | null
  /** `sm` for 40px thumbnails, `md` for cards, `lg` for the detail gallery. */
  size?: IllustrationSize
  /** Show the French category label. Defaults to true except at `sm`. */
  showLabel?: boolean
  /** Override the caption text. Defaults to the category label. */
  label?: string
  className?: string
}

const SIZES: Record<
  IllustrationSize,
  { icon: number; medallion: string; ring: string | null; gap: string; text: string }
> = {
  // No ring at `sm`: the hosts are 40px (SearchBox) and 48px (Checkout) boxes
  // with overflow-hidden, so any ring wide enough to clear the medallion gets
  // its corners clipped and reads as a rendering fault rather than a frame.
  sm: { icon: 18, medallion: 'w-9 h-9', ring: null, gap: 'gap-1', text: 'text-xs' },
  md: { icon: 34, medallion: 'w-20 h-20', ring: 'w-[6.5rem] h-[6.5rem]', gap: 'gap-3', text: 'text-xs' },
  lg: { icon: 56, medallion: 'w-32 h-32', ring: 'w-[10.5rem] h-[10.5rem]', gap: 'gap-4', text: 'text-sm' },
}

export function NoImageIllustration({
  category,
  name,
  size = 'md',
  showLabel,
  label,
  className,
}: NoImageIllustrationProps) {
  const s = SIZES[size]
  const withLabel = showLabel ?? size !== 'sm'
  const caption = label ?? categoryLabel(iconSlugFor(category, name))

  return (
    <div
      className={cx(
        'no-img-placeholder relative w-full h-full overflow-hidden',
        'flex flex-col items-center justify-center',
        s.gap,
        className,
      )}
      {...(withLabel ? {} : { 'aria-hidden': true })}
    >
      <div className="relative flex items-center justify-center">
        {/* Dashed ring — a frame with nothing in it. */}
        {s.ring && (
          <span
            aria-hidden
            className={cx(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              // The surface ramp is too close to itself to read as a line here —
              // surface-4 on surface-3 is a ~5% step and disappears. The text
              // ramp at low alpha is the only value that stays visible while
              // still reading as a hint rather than a border.
              'rounded-full border border-dashed border-[var(--color-text-3)]/30',
              s.ring,
            )}
          />
        )}

        {/* Medallion — a lit surface for the mark to sit on. */}
        <div
          className={cx(
            'relative rounded-full flex items-center justify-center',
            'bg-[var(--color-surface-2)]/70 border border-[var(--color-surface-4)]/60',
            s.medallion,
          )}
        >
          <CategoryIcon
            category={category}
            name={name}
            size={s.icon}
            className={cx(
              'text-[var(--color-text-3)] transition-colors duration-[var(--duration-base)]',
              'group-hover:text-[var(--color-electric-blue)]',
            )}
          />
        </div>
      </div>

      {withLabel && (
        <span
          className={cx(
            'relative font-bold uppercase tracking-widest text-center px-2 line-clamp-1',
            'text-[var(--color-text-3)]',
            s.text,
          )}
        >
          {caption}
        </span>
      )}
    </div>
  )
}
