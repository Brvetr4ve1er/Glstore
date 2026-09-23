import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  fmtMoney,
  slugify,
  categoryIcon,
  categoryIconComponent,
  resolveCategorySlug,
  resolveProductSlug,
  ICON_BY_SLUG,
  NoImageIllustration,
} from '@/lib/format'
import { AUTRE_SLUG, CATEGORIES } from '@/lib/taxonomy'

/** Anything that would put an emoji back into the UI. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

const draw = (cat: string | null | undefined) => renderToStaticMarkup(categoryIcon(cat))

describe('fmtMoney', () => {
  it('formats DZD as integer with no decimals', () => {
    const out = fmtMoney(89500)
    expect(out).toMatch(/89\s*500/)
    expect(out).toMatch(/DA|DZD/i)
  })

  it('returns em-dash for null/undefined', () => {
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
  })

  it('accepts custom currency', () => {
    const out = fmtMoney(1234, 'EUR')
    expect(out).toMatch(/€|EUR/)
  })
})

describe('slugify', () => {
  it('strips accents and special chars', () => {
    expect(slugify('Réfrigérateur Côté')).toBe('refrigerateur-cote')
  })

  it('lowercases', () => {
    expect(slugify('TV SAMSUNG')).toBe('tv-samsung')
  })

  it('handles consecutive separators', () => {
    expect(slugify('TV  ---  Samsung')).toBe('tv-samsung')
  })

  it('returns empty for empty input', () => {
    expect(slugify('')).toBe('')
  })
})

describe('categoryIcon', () => {
  it('draws SVG, never an emoji', () => {
    // The old implementation returned a gamepad glyph for every appliance in the
    // catalogue. Emoji as UI iconography is audit signal #22.
    const markup = draw('froid')
    expect(markup).toContain('<svg')
    expect(PICTOGRAPHIC.test(markup)).toBe(false)
  })

  it('covers every taxonomy category', () => {
    for (const cat of CATEGORIES) {
      const Icon = ICON_BY_SLUG[cat.slug]
      expect(Icon, `no icon registered for ${cat.slug}`).toBeDefined()
      expect(renderToStaticMarkup(createElement(Icon)), cat.slug).toContain('<svg')
    }
    expect(Object.keys(ICON_BY_SLUG)).toHaveLength(CATEGORIES.length)
  })

  it('keeps all 13 marks in one family at one stroke weight', () => {
    // Audit signals #21 (icons from multiple families) and #23 (inconsistent
    // stroke widths). Eight icons come from lucide-react and five are drawn
    // here; every one must render the identical SVG contract.
    for (const cat of CATEGORIES) {
      const markup = draw(cat.slug)
      expect(markup, cat.slug).toContain('viewBox="0 0 24 24"')
      expect(markup, cat.slug).toContain('stroke-width="2"')
      expect(markup, cat.slug).toContain('stroke-linecap="round"')
      expect(markup, cat.slug).toContain('stroke-linejoin="round"')
      expect(markup, cat.slug).toContain('stroke="currentColor"')
      expect(markup, cat.slug).toContain('fill="none"')
    }
  })

  it('gives each category a distinct mark', () => {
    const drawn = new Set(CATEGORIES.map((c) => draw(c.slug)))
    expect(drawn.size).toBe(CATEGORIES.length)
  })

  it('inherits the surrounding font size by default', () => {
    // The seven existing call sites wrap the result in text-lg / text-2xl /
    // text-3xl / text-6xl. `1em` keeps every one of them at its intended scale.
    expect(draw('cuisson')).toContain('width="1em"')
    expect(renderToStaticMarkup(categoryIcon('cuisson', { size: 32 }))).toContain('width="32"')
  })

  it('is decorative unless asked to be announced', () => {
    expect(draw('lavage')).toContain('aria-hidden="true"')
    const announced = renderToStaticMarkup(categoryIcon('lavage', { label: true }))
    expect(announced).toContain('aria-label="Lavage"')
    expect(announced).toContain('role="img"')
  })

  it('falls back to the Autre mark for anything unrecognised', () => {
    const autre = draw(AUTRE_SLUG)
    expect(draw(null)).toBe(autre)
    expect(draw(undefined)).toBe(autre)
    expect(draw('')).toBe(autre)
    expect(draw('Made-up category')).toBe(autre)
    // Every one of the 567 real products carries this single source category.
    expect(draw('Electromenager')).toBe(autre)
  })

  it('accepts a slug, a French label or a product name', () => {
    const froid = draw('froid')
    expect(draw('Froid')).toBe(froid)
    expect(draw('REFRIGIRATEUR 400L INOX')).toBe(froid) // real supplier spelling
    expect(froid).not.toBe(draw(AUTRE_SLUG))

    expect(draw('Petit déjeuner')).toBe(draw('petit-dejeuner'))
    expect(draw('BOULOIRE 1.7L')).toBe(draw('petit-dejeuner')) // real misspelling
  })
})

describe('resolveCategorySlug / resolveProductSlug', () => {
  it('resolves slugs, labels and names', () => {
    expect(resolveCategorySlug('lavage')).toBe('lavage')
    expect(resolveCategorySlug('Hottes & Encastrable')).toBe('hottes-encastrable')
    expect(resolveCategorySlug('HOTTE 60CM INOX')).toBe('hottes-encastrable')
    expect(resolveCategorySlug('Electromenager')).toBe(AUTRE_SLUG)
    expect(resolveCategorySlug(null)).toBe(AUTRE_SLUG)
  })

  it('lets the product name win over a useless category', () => {
    // The shape every product in the real catalogue arrives in.
    expect(resolveProductSlug('Electromenager', 'CAFITIER SONIFER')).toBe('petit-dejeuner')
    expect(resolveProductSlug('Electromenager', 'MACHINE A LAVER 10KG')).toBe('lavage')
    expect(resolveProductSlug(null, null)).toBe(AUTRE_SLUG)
  })

  it('does not override a category that already carries signal', () => {
    expect(resolveProductSlug('froid', 'MACHINE A LAVER 10KG')).toBe('froid')
  })
})

describe('categoryIconComponent', () => {
  it('returns a component new code can size itself', () => {
    const Icon = categoryIconComponent('tv-image')
    expect(Icon).toBeDefined()
    const markup = renderToStaticMarkup(createElement(Icon, { size: 48 }))
    expect(markup).toContain('<svg')
    expect(markup).toContain('width="48"')
  })
})

describe('NoImageIllustration', () => {
  const render = (props: Parameters<typeof NoImageIllustration>[0]) =>
    renderToStaticMarkup(createElement(NoImageIllustration, props))

  it('reuses the shared placeholder surface', () => {
    expect(render({ category: 'froid' })).toContain('no-img-placeholder')
  })

  it('draws the category mark and its French label', () => {
    const markup = render({ category: 'Electromenager', name: 'REFRIGRATEUR 350L' })
    expect(markup).toContain('<svg')
    expect(markup).toContain('Froid')
    expect(PICTOGRAPHIC.test(markup)).toBe(false)
  })

  it('never reaches for a raster image', () => {
    expect(render({ category: 'cuisson' })).not.toContain('<img')
  })

  it('drops the label and hides itself at thumbnail size', () => {
    const markup = render({ category: 'cuisson', size: 'sm' })
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('Cuisson')
  })

  it('stays off the banned 10px type size', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(render({ category: 'lavage', size })).not.toContain('text-[10px]')
    }
  })
})
