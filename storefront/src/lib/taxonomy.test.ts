/**
 * The taxonomy is only worth anything if it holds against the REAL catalogue.
 *
 * These run against `dev/catalog.fixture.json` — all 567 products from the
 * actual supplier database, not a handful of invented samples. The coverage
 * figure quoted in the spec (92.4%) is asserted here, so it cannot silently rot
 * when someone edits a keyword list.
 */
import { describe, it, expect } from 'vitest'
import fixture from '../dev/catalog.fixture.json'
import {
  CATEGORIES,
  AUTRE_SLUG,
  classifyProductName,
  countByCategory,
  categoryLabel,
  foldName,
} from './taxonomy'

const products = fixture as Array<{ name: string; brand: string | null }>

describe('taxonomy against the real catalogue', () => {
  it('has the full 567-product fixture to test against', () => {
    expect(products.length).toBe(567)
  })

  it('classifies at least 92% of real products', () => {
    const counts = countByCategory(products)
    const autre = counts.get(AUTRE_SLUG) ?? 0
    const coverage = (products.length - autre) / products.length
    // Measured at 0.924 when the spec was written.
    expect(coverage).toBeGreaterThanOrEqual(0.92)
  })

  it('never leaves a product unclassified — everything gets a slug', () => {
    for (const p of products) {
      const slug = classifyProductName(p.name)
      expect(CATEGORIES.some((c) => c.slug === slug)).toBe(true)
    }
  })

  it('puts the two largest buckets where the data says they are', () => {
    const counts = countByCategory(products)
    // Cuisson and Préparation culinaire are ~24% each in the real file.
    expect(counts.get('cuisson')!).toBeGreaterThan(100)
    expect(counts.get('preparation')!).toBeGreaterThan(100)
  })

  it('keeps Autre a real bucket, not an empty alibi', () => {
    const counts = countByCategory(products)
    const autre = counts.get(AUTRE_SLUG) ?? 0
    // If this ever hits 0 the keywords have gone greedy and are mis-filing.
    expect(autre).toBeGreaterThan(0)
    expect(autre).toBeLessThan(products.length * 0.15)
  })
})

describe('the three traps confirmed in the live data', () => {
  // Brands are not categories. MULTISMART alone is 175 of 567 products; if a
  // brand token ever drove classification, a third of the shop would collapse
  // into one wrong bucket.
  it.each(['MULTISMART', 'GEANT', 'CONTIGLOBAL', 'MIDEA', 'SONIFER'])(
    'brand %s does not by itself decide a category',
    (brand) => {
      expect(classifyProductName(brand)).toBe(AUTRE_SLUG)
    },
  )

  // Colours are not categories.
  it.each(['INOX', 'NOIR', 'BLANC', 'GRIS', 'ROUGE'])(
    'colour %s does not by itself decide a category',
    (colour) => {
      expect(classifyProductName(colour)).toBe(AUTRE_SLUG)
    },
  )

  // Specs are not categories.
  it.each(['13 ELEMENT', '6L', '40P', '14K'])(
    'spec token %s does not by itself decide a category',
    (spec) => {
      expect(classifyProductName(spec)).toBe(AUTRE_SLUG)
    },
  )
})

describe('real misspellings from the supplier file still classify', () => {
  // Every one of these strings is really in the catalogue. Dropping them
  // loses sellable products.
  it.each([
    ['BOULOIRE MULTISMART', 'petit-dejeuner'],
    ['CAFITIER GEANT ROUGE', 'petit-dejeuner'],
    ['REFRIGRATEUR 458L INOX GEANT', 'froid'],
    ['CENTRE FIGEUSE SONIFER', 'preparation'],
    ['MACHINE A GOFFRE BOMANN', 'friture-grill'],
    ['MACHINE A VAISSELLE CRISTOR 12K GRIS  METAL', 'lavage'],
  ])('%s -> %s', (name, expected) => {
    expect(classifyProductName(name)).toBe(expected)
  })
})

describe('accent folding', () => {
  it('matches regardless of accents or case', () => {
    expect(foldName('Réfrigérateur')).toBe('REFRIGERATEUR')
    expect(classifyProductName('Réfrigérateur Midea')).toBe('froid')
    expect(classifyProductName('réfrigérateur midea')).toBe('froid')
  })

  it('handles empty and null names without throwing', () => {
    expect(classifyProductName('')).toBe(AUTRE_SLUG)
    expect(classifyProductName(null)).toBe(AUTRE_SLUG)
    expect(classifyProductName(undefined)).toBe(AUTRE_SLUG)
  })
})

describe('labels', () => {
  it('every category has a French label and a url-safe slug', () => {
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.slug).toMatch(/^[a-z0-9-]+$/)
      expect(categoryLabel(c.slug)).toBe(c.label)
    }
  })

  it('falls back to Autre for an unknown slug', () => {
    expect(categoryLabel('not-a-category')).toBe('Autre')
  })
})
