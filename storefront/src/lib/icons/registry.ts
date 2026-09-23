/**
 * The category icon registry — one mark per taxonomy slug.
 *
 * Eight come straight from `lucide-react`, five are hand-drawn in `./custom`
 * on Lucide's own `createLucideIcon`, so every icon in this map renders the
 * identical SVG contract: 24×24 viewBox, 2px stroke, round caps and joins,
 * `currentColor`, no fill.
 *
 * Input resolution is deliberately forgiving. The brief for this file claimed
 * `categoryIcon()` had a single caller; it actually has seven, and every one of
 * them passes a RAW API string — `p.category` or `c.name` — not a taxonomy
 * slug. On the real catalogue that string is `"Electromenager"` for all 567
 * products. So `resolveCategorySlug` accepts any of:
 *
 *   · a slug            'froid'
 *   · a French label    'Froid', 'Petit déjeuner' (accent-insensitive)
 *   · a product name    'REFRIGIRATEUR 400L INOX'  → classified by keyword
 *
 * and only then falls back to `autre`. That makes today's call sites degrade to
 * a neutral mark instead of a gamepad, and lets new code pass a slug directly.
 *
 * `resolveProductSlug` is the path new code should take: a product carries a
 * useless `category` and a meaningful `name`, so the name decides whenever the
 * category tells us nothing.
 */
import {
  AirVent,
  Blocks,
  Coffee,
  CookingPot,
  Heater,
  Refrigerator,
  Tv,
  WashingMachine,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import {
  AUTRE_SLUG,
  CATEGORIES,
  categoryBySlug,
  classifyProductName,
  foldName,
} from '@/lib/taxonomy'
import { Blender, FryingPan, HairDryer, RangeHood, SteamIron } from './custom'

/**
 * The shape every icon in the registry satisfies. Lucide does not export its
 * `LucideProps` type from the package root, so this mirrors it: the SVG props
 * plus Lucide's `size`, which sets both `width` and `height`.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Sets width AND height. Accepts `24` or `"1em"` to inherit the font size. */
  size?: string | number
}

export type IconComponent = ComponentType<IconProps>

/** One icon per slug in `CATEGORIES`. Completeness is asserted in the tests. */
export const ICON_BY_SLUG: Record<string, IconComponent> = {
  'eau-chauffage': Heater, //          radiator + heat wisps
  froid: Refrigerator, //              two-door fridge
  climatisation: AirVent, //           wall split unit
  lavage: WashingMachine, //           drum + porthole
  'hottes-encastrable': RangeHood, //  hand-drawn
  'friture-grill': FryingPan, //       hand-drawn
  'petit-dejeuner': Coffee, //         cup + steam
  cuisson: CookingPot, //              lidded pot
  preparation: Blender, //             hand-drawn
  entretien: SteamIron, //             hand-drawn
  'soin-beaute': HairDryer, //         hand-drawn
  'tv-image': Tv, //                   screen + antenna
  autre: Blocks, //                    assorted items — a first-class category,
  //                                   never a bin, so it gets a real mark
}

/** Folded French label -> slug, built once. 'PETIT DEJEUNER' -> 'petit-dejeuner'. */
const SLUG_BY_LABEL = new Map(CATEGORIES.map((c) => [foldName(c.label), c.slug]))

/**
 * Turn anything a caller has — slug, French label, or a raw product name —
 * into a taxonomy slug. Always returns a real slug; never throws.
 */
export function resolveCategorySlug(input: string | null | undefined): string {
  const raw = (input ?? '').trim()
  if (!raw) return AUTRE_SLUG

  // 1. already a slug
  if (categoryBySlug(raw)) return raw

  // 2. a French label, with or without accents
  const folded = foldName(raw)
  const byLabel = SLUG_BY_LABEL.get(folded)
  if (byLabel) return byLabel

  // 3. a product name (or a category name close enough to one) — keyword match
  return classifyProductName(raw)
}

/**
 * Resolve for a product. The catalogue's `category` column is a single useless
 * value for all 567 rows, so the NAME wins whenever the category resolves to
 * nothing better than `autre`.
 */
export function resolveProductSlug(
  category: string | null | undefined,
  name?: string | null,
): string {
  const fromCategory = resolveCategorySlug(category)
  if (fromCategory !== AUTRE_SLUG) return fromCategory
  return classifyProductName(name)
}

/**
 * The icon COMPONENT for a category — for callers that need to own rendering
 * (`const Icon = categoryIconComponent(slug); <Icon size={32} />`).
 * `categoryIcon()` in `@/lib/format` returns a ready-made element instead.
 */
export function categoryIconComponent(
  category: string | null | undefined,
  name?: string | null,
): IconComponent {
  const slug = name != null ? resolveProductSlug(category, name) : resolveCategorySlug(category)
  return ICON_BY_SLUG[slug] ?? ICON_BY_SLUG[AUTRE_SLUG]!
}
