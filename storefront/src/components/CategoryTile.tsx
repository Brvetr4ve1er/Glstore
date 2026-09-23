/**
 * CategoryTile — the premium, animated version of a category mark.
 *
 * `@/lib/icons` (CategoryIcon / NoImageIllustration) is the workhorse system:
 * small, flat, 24×24, used inline wherever a category needs to sit next to
 * text — product cards, search results, breadcrumbs. This is a DIFFERENT,
 * larger placement: the home category rail, empty/loading states and support
 * modules, where a category is the whole point of the block rather than a
 * detail inside it.
 *
 * Geometry and motion vocabulary come from a first-party design pass done for
 * this project (`amantcom_visual_system/AMANTCOM_ARCHETYPE_ICON_SYSTEM.md`,
 * `archetype_icons_preview.html`) — 10 hand-drawn SVGs, soft dimensional
 * gradients, one calm accent motion per icon, no fake badges, no likeness of
 * any specific copyrighted product. Pure inline `<svg>`, no raster, no photo.
 *
 * That system's own 10-archetype breakdown (small_kitchen, oven_hob_microwave,
 * appliance_other, cooker, refrigerator_freezer, tv_media, washing_machine,
 * climate_air, dishwasher, cleaning) is NOT the taxonomy this storefront ships.
 * `@/lib/taxonomy` is: 13 categories, keyword-classified against the real
 * 567-product catalogue and measured at 92.4% coverage, with 29 tests pinning
 * that number so it cannot silently drift — and it already drives every URL
 * (`/c/:slug`), every filter and every nav link. Swapping to a different
 * category set here would fork the taxonomy in two places. So the geometry and
 * motion style transfer; the categories do not. Seven of these map cleanly
 * onto an archetype and reuse its shape close to verbatim; six have no
 * archetype equivalent (eau-chauffage, hottes-encastrable, friture-grill,
 * petit-dejeuner, soin-beaute, autre) and are drawn fresh in the same grammar:
 * one filled body, thin detail strokes, one accent-coloured moving element,
 * a soft ellipse shadow, `currentColor`-free (brand tokens instead, so it
 * re-themes — see the note on `.no-img-placeholder` this project already
 * flagged for hardcoding retired brand colours as literals).
 *
 * Usage:
 *   <CategoryTile slug="froid" size={92} animated />
 */
import type { CSSProperties } from 'react'
import { categoryLabel } from '@/lib/taxonomy'

export type TileMotion = 'sheen' | 'pulse' | 'spin' | 'air' | 'slide' | 'none'

interface CategoryTileProps {
  slug: string
  size?: number
  /** Plays the one accent motion. Off by default for dense grids (many tiles
   *  animating at once reads as noisy); turn on for a hero/landing placement. */
  animated?: boolean
  className?: string
}

interface Glyph {
  motion: TileMotion
  /** viewBox is always "0 0 72 72". */
  render: () => React.ReactNode
}

const MOTION_CLASS: Record<TileMotion, string> = {
  sheen: 'tile-sheen',
  pulse: 'tile-pulse',
  spin: 'tile-spin',
  air: 'tile-air',
  slide: 'tile-slide',
  none: '',
}

/** Shared stroke treatment — one weight, one join style, across every glyph. */
const bodyProps = {
  fill: 'url(#ct-body)',
  stroke: 'var(--color-brand)',
  strokeWidth: 2.4,
  vectorEffect: 'non-scaling-stroke' as const,
}
const detailProps = {
  fill: 'none',
  stroke: 'var(--color-brand)',
  strokeWidth: 2.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  vectorEffect: 'non-scaling-stroke' as const,
}
const glassProps = {
  fill: 'var(--color-brand-glow)',
  stroke: 'var(--color-brand)',
  strokeWidth: 2.2,
}
const shadowProps = { fill: 'rgba(8,8,10,.32)' }
const accentStroke = {
  fill: 'none',
  stroke: 'var(--color-accent)',
  strokeWidth: 2.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  vectorEffect: 'non-scaling-stroke' as const,
}
const accentFill = { fill: 'var(--color-accent)' }

/**
 * One glyph per taxonomy slug. Seven reuse an archetype shape near-verbatim
 * (credited inline); six are original, drawn in the same grammar.
 */
export const GLYPHS: Record<string, Glyph> = {
  // Reused from refrigerator_freezer — a tall two-door fridge, door-seam
  // detail line, one glass highlight strip that sweeps.
  froid: {
    motion: 'sheen',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={21} ry={5} {...shadowProps} />
        <rect x={23} y={10} width={28} height={50} rx={7} {...bodyProps} />
        <path d="M37 11v48M24 36h26" {...detailProps} />
        <rect x={40} y={18} width={5} height={12} rx={2} className="tile-pulse" {...glassProps} />
        <path d="M29 16v36" className="tile-sheen" fill="none" strokeLinecap="round" strokeWidth={4} stroke="rgba(255,255,255,.75)" />
      </>
    ),
  },
  // Reused from climate_air — wall unit with drifting airflow lines.
  climatisation: {
    motion: 'air',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={22} ry={5} {...shadowProps} />
        <rect x={16} y={18} width={40} height={18} rx={7} {...bodyProps} />
        <path d="M23 30h26" {...detailProps} />
        <path d="M18 45c8-7 17 7 26 0M24 54c7-6 14 5 22 0" className="tile-air" {...accentStroke} />
        <circle cx={49} cy={24} r={2.4} className="tile-pulse" {...accentFill} />
      </>
    ),
  },
  // Reused from washing_machine, and covers dishwashers too (this taxonomy
  // folds "MACHINE A VAISSELLE" into `lavage`) — drum + door, slow spin.
  lavage: {
    motion: 'spin',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={22} ry={5} {...shadowProps} />
        <rect x={19} y={13} width={34} height={48} rx={8} {...bodyProps} />
        <path d="M25 22h15M46 22h1" {...detailProps} />
        <circle cx={36} cy={41} r={12} {...glassProps} />
        <path d="M30 41c2-5 9-6 12-1 2 4-1 8-5 8" className="tile-spin" {...accentStroke} />
      </>
    ),
  },
  // Reused from tv_media — screen + slim stand, diagonal sheen.
  'tv-image': {
    motion: 'sheen',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={23} ry={5} {...shadowProps} />
        <rect x={13} y={18} width={46} height={30} rx={5} {...bodyProps} />
        <path d="M31 55h10M36 48v7" {...detailProps} />
        <path d="M23 23l23 20" className="tile-sheen" fill="none" strokeLinecap="round" strokeWidth={4} stroke="rgba(255,255,255,.75)" />
        <path d="M22 53h28" {...accentStroke} />
      </>
    ),
  },
  // Adapted from oven_hob_microwave — control dots pulsing in sequence reads
  // equally well for ovens, hobs, microwaves and freestanding cookers, so it
  // covers this taxonomy's whole (larger) `cuisson` bucket.
  cuisson: {
    motion: 'pulse',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={23} ry={5} {...shadowProps} />
        <rect x={16} y={16} width={40} height={42} rx={8} {...bodyProps} />
        <rect x={22} y={29} width={28} height={21} rx={4} {...glassProps} />
        <circle cx={25} cy={23} r={2.4} className="tile-pulse" {...accentFill} />
        <circle cx={34} cy={23} r={2.4} className="tile-pulse" style={{ animationDelay: '.4s' }} {...accentFill} />
        <circle cx={43} cy={23} r={2.4} className="tile-pulse" style={{ animationDelay: '.8s' }} {...accentFill} />
        <path d="M25 36h22" {...detailProps} />
      </>
    ),
  },
  // Reused from small_kitchen — countertop appliance with a bowl/jar body
  // and a spout, fitting mixers, blenders, hachoirs and robots alike.
  preparation: {
    motion: 'sheen',
    render: () => (
      <>
        <ellipse cx={36} cy={62} rx={22} ry={5} {...shadowProps} />
        <rect x={22} y={18} width={28} height={38} rx={8} {...bodyProps} />
        <path d="M27 19h18v20H27z" {...glassProps} />
        <path d="M28 47h16" className="tile-pulse" {...accentStroke} />
        <path d="M50 28h5c4 0 6 3 5 7-1 5-5 7-10 7" {...detailProps} />
        <path d="M30 22l12 12" className="tile-sheen" fill="none" strokeLinecap="round" strokeWidth={4} stroke="rgba(255,255,255,.75)" />
      </>
    ),
  },
  // Reused from cleaning — upright body, hose, drifting air-path accent.
  // Also covers `entretien`'s irons and sewing machines under one silhouette.
  entretien: {
    motion: 'air',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={22} ry={5} {...shadowProps} />
        <path d="M25 41c0-8 6-14 14-14h4c7 0 12 5 12 12v7H25z" {...bodyProps} />
        <circle cx={34} cy={48} r={7} {...glassProps} />
        <path d="M44 28c-2-9 6-14 13-10" {...detailProps} />
        <path d="M15 31c7-5 13 5 20 0" className="tile-air" {...accentStroke} />
        <path d="M51 46h7" {...detailProps} />
      </>
    ),
  },

  // ── Original — no archetype equivalent, same grammar ────────────────
  // Wall-mounted heater: flat radiator body, rising heat-wave accent.
  'eau-chauffage': {
    motion: 'air',
    render: () => (
      <>
        <ellipse cx={36} cy={63} rx={22} ry={5} {...shadowProps} />
        <rect x={18} y={22} width={36} height={30} rx={6} {...bodyProps} />
        <path d="M24 28v18M32 28v18M40 28v18M48 28v18" {...detailProps} />
        <path d="M27 16c2 3-2 4 0 7M37 16c2 3-2 4 0 7M47 16c2 3-2 4 0 7" className="tile-air" {...accentStroke} />
      </>
    ),
  },
  // Range hood: canopy over a cooktop line, one duct highlight.
  'hottes-encastrable': {
    motion: 'sheen',
    render: () => (
      <>
        <ellipse cx={36} cy={62} rx={22} ry={5} {...shadowProps} />
        <path d="M20 20h32l-6 16H26z" {...bodyProps} />
        <rect x={31} y={36} width={10} height={20} rx={2} {...glassProps} />
        <path d="M24 52h24" {...detailProps} />
        <path d="M27 24l6 8M45 24l-6 8" className="tile-sheen" fill="none" strokeLinecap="round" strokeWidth={4} stroke="rgba(255,255,255,.75)" />
      </>
    ),
  },
  // Griddle/fryer: shallow pan body, pulsing heat rings.
  'friture-grill': {
    motion: 'pulse',
    render: () => (
      <>
        <ellipse cx={36} cy={62} rx={22} ry={5} {...shadowProps} />
        <path d="M16 34h40v8c0 8-9 14-20 14s-20-6-20-14z" {...bodyProps} />
        <path d="M14 34h44" {...detailProps} />
        <circle cx={28} cy={42} r={2.6} className="tile-pulse" {...accentFill} />
        <circle cx={36} cy={44} r={2.6} className="tile-pulse" style={{ animationDelay: '.3s' }} {...accentFill} />
        <circle cx={44} cy={42} r={2.6} className="tile-pulse" style={{ animationDelay: '.6s' }} {...accentFill} />
      </>
    ),
  },
  // Coffee cup with rising steam — covers cafetières, bouilloires, grille-pain.
  'petit-dejeuner': {
    motion: 'air',
    render: () => (
      <>
        <ellipse cx={36} cy={61} rx={20} ry={5} {...shadowProps} />
        <path d="M20 32h26v14c0 8-6 13-13 13s-13-5-13-13z" {...bodyProps} />
        <path d="M46 36h4c3 0 5 2 5 5s-2 5-5 5h-4" {...detailProps} />
        <path d="M27 18c2 3-2 4 0 7M35 18c2 3-2 4 0 7" className="tile-air" {...accentStroke} />
        <path d="M22 32h24" className="tile-pulse" {...glassProps} strokeWidth={2} fill="none" />
      </>
    ),
  },
  // Hair dryer: nozzle + handle silhouette, warm airflow accent.
  'soin-beaute': {
    motion: 'air',
    render: () => (
      <>
        <ellipse cx={36} cy={62} rx={18} ry={5} {...shadowProps} />
        <path d="M22 28c0-6 5-10 12-10s12 4 12 10-5 8-12 8-12-2-12-8z" {...bodyProps} />
        <path d="M34 36l4 22 8-2-4-21" {...bodyProps} />
        <circle cx={22} cy={28} r={4} {...glassProps} />
        <path d="M10 24c4-2 4 6 8 4M12 32c4-2 4 6 8 4" className="tile-air" {...accentStroke} />
      </>
    ),
  },
  // Modular block — reused from appliance_other, the honest "ambiguous item"
  // shape. `autre` is a first-class bucket here too (~7% of the catalogue),
  // so it gets a real mark, not a question mark or a grey box.
  autre: {
    motion: 'pulse',
    render: () => (
      <>
        <ellipse cx={36} cy={62} rx={22} ry={5} {...shadowProps} />
        <path d="M20 24l16-9 16 9v28l-16 8-16-8z" {...bodyProps} />
        <path d="M20 24l16 9 16-9M36 33v27" {...detailProps} />
        <path d="M28 45h16" className="tile-pulse" {...accentStroke} />
      </>
    ),
  },
}

/**
 * A single small `<svg width=0 height=0>` def block, shared by every tile on
 * the page via one `id`. Safe to render more than once — duplicate `id`s on
 * an invisible, non-interactive defs block cause no visible or a11y issue,
 * but callers rendering many tiles should still prefer mounting this once
 * near the root of a rail/grid rather than per-tile. `<CategoryTile>` renders
 * its own copy so it works correctly in isolation (e.g. Storybook, a single
 * empty-state icon) at the cost of that harmless duplication.
 */
function GradientDefs() {
  return (
    <svg width={0} height={0} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ct-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-surface-2)" />
          <stop offset="1" stopColor="var(--color-surface-1)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function CategoryTile({ slug, size = 92, animated = false, className }: CategoryTileProps) {
  const glyph = GLYPHS[slug] ?? GLYPHS.autre!
  const motionClass = animated ? MOTION_CLASS[glyph.motion] : ''
  const style: CSSProperties = { width: size, height: size }

  return (
    <div
      className={[
        'relative grid place-items-center rounded-[22px] shrink-0',
        'bg-gradient-to-br from-[var(--color-brand-glow)] to-[var(--color-accent-glow)]',
        className ?? '',
      ].join(' ')}
      style={style}
    >
      <GradientDefs />
      <svg
        viewBox="0 0 72 72"
        width="76%"
        height="76%"
        role="img"
        aria-label={categoryLabel(slug)}
        className={motionClass}
      >
        {glyph.render()}
      </svg>
    </div>
  )
}
