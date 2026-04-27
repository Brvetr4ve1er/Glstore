import { describe, expect, it } from 'vitest'
import { fmtMoney, slugify, categoryIcon } from '@/lib/format'

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
  it('returns known icons', () => {
    expect(categoryIcon('TV')).toBe('📺')
    expect(categoryIcon('Smartphone')).toBe('📱')
    expect(categoryIcon('Refrigerator')).toBe('🧊')
  })

  it('returns box for unknown', () => {
    expect(categoryIcon('Made-up category')).toBe('📦')
    expect(categoryIcon(null)).toBe('📦')
  })
})
