/**
 * The storefront icon system.
 *
 * With `Liens Média` filled on 0% of 567 products, this directory is the whole
 * visual layer of the shop. One family, one stroke weight, no emoji, no raster.
 *
 *   import { CategoryIcon, NoImageIllustration } from '@/lib/icons'
 *
 * `@/lib/format` re-exports all of this, so either import path works and the
 * seven existing `categoryIcon()` callers keep compiling untouched.
 */
export { CategoryIcon, iconSlugFor } from './CategoryIcon'
export type { CategoryIconProps } from './CategoryIcon'

export { NoImageIllustration } from './NoImageIllustration'
export type { NoImageIllustrationProps, IllustrationSize } from './NoImageIllustration'

export {
  ICON_BY_SLUG,
  categoryIconComponent,
  resolveCategorySlug,
  resolveProductSlug,
} from './registry'
export type { IconComponent, IconProps } from './registry'

export { Blender, FryingPan, HairDryer, RangeHood, SteamIron } from './custom'
