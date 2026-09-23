/**
 * Coverage guard for CategoryTile's glyph registry — the same discipline
 * `taxonomy.test.ts` applies to category classification: completeness is
 * asserted, not assumed.
 *
 * The risk this catches: `CategoryTile` silently falls back to the `autre`
 * glyph for any slug it doesn't recognise (`GLYPHS[slug] ?? GLYPHS.autre!`),
 * which is the right behaviour for a genuinely unknown slug but the WRONG
 * behaviour for a real taxonomy category that simply never got a glyph
 * written for it — that would render silently as "autre" everywhere, with
 * nothing failing to say so. These tests make a missing glyph a red test
 * instead of a quiet visual bug on the live category grid.
 */
import { describe, it, expect } from 'vitest'
import { GLYPHS } from './CategoryTile'
import { CATEGORIES } from '@/lib/taxonomy'

describe('CategoryTile glyph registry', () => {
  it('has an explicit glyph for every real taxonomy category', () => {
    const missing = CATEGORIES.map((c) => c.slug).filter((slug) => !(slug in GLYPHS))
    expect(missing).toEqual([])
  })

  it('has no orphaned glyph for a slug outside the real taxonomy', () => {
    const known = new Set(CATEGORIES.map((c) => c.slug))
    const orphans = Object.keys(GLYPHS).filter((slug) => !known.has(slug))
    expect(orphans).toEqual([])
  })

  it('every glyph declares a real motion (or explicitly none)', () => {
    const valid = new Set(['sheen', 'pulse', 'spin', 'air', 'slide', 'none'])
    for (const [slug, glyph] of Object.entries(GLYPHS)) {
      expect(valid.has(glyph.motion), `${slug} has an unrecognised motion "${glyph.motion}"`).toBe(true)
    }
  })

  it('every glyph renders at least one SVG shape', () => {
    // A stub-only entry (e.g. `render: () => null` left behind mid-edit)
    // would pass typechecking but draw nothing. Rendering isn't available
    // without a DOM/testing-library, so this checks the render function is
    // present and callable, and returns something non-nullish.
    for (const [slug, glyph] of Object.entries(GLYPHS)) {
      expect(typeof glyph.render, `${slug}.render is not a function`).toBe('function')
      expect(glyph.render(), `${slug}.render() returned nothing`).not.toBeNull()
    }
  })
})
