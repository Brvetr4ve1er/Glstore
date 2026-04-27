import { describe, expect, it } from 'vitest'
import { deriveTags } from '@/lib/tags'
import type { ProductListItem } from '@/lib/api'

function product(over: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'x', sku: 'X-1', slug: 'x', name: 'Sample',
    brand: null, category: null, specs: {},
    completeness_score: 0.5, primary_image: null, min_price: 100, available: 10,
    ...over,
  }
}

describe('deriveTags', () => {
  it('flags low stock urgency', () => {
    const tags = deriveTags(product({ available: 2 }))
    expect(tags.some(t => /Plus que/.test(t.label))).toBe(true)
    expect(tags.some(t => t.tone === 'pink')).toBe(true)
  })

  it('flags out of stock', () => {
    const tags = deriveTags(product({ available: 0 }))
    expect(tags.some(t => /retour/.test(t.label))).toBe(true)
  })

  it('surfaces LLM price position', () => {
    const tags = deriveTags(product({ specs: { _price_position: 'budget' } }))
    expect(tags.some(t => /Bon prix/.test(t.label))).toBe(true)
  })

  it('shows screen size with quote when missing', () => {
    const tags = deriveTags(product({ specs: { screen_size: 55 } }))
    expect(tags.some(t => /55"/.test(t.label))).toBe(true)
  })

  it('does not duplicate already-quoted screen', () => {
    const tags = deriveTags(product({ specs: { screen_size: '65"' } }))
    expect(tags.some(t => t.label === '65"')).toBe(true)
    // No double-quote
    expect(tags.some(t => /""/.test(t.label))).toBe(false)
  })

  it('shows verified badge above 0.85 completeness', () => {
    const tags = deriveTags(product({ completeness_score: 0.92 }))
    expect(tags.some(t => /vérifiée/i.test(t.label))).toBe(true)
  })

  it('caps to 6 tags max', () => {
    const tags = deriveTags(product({
      available: 2,
      brand: 'SAMSUNG',
      completeness_score: 0.92,
      specs: {
        _price_position: 'premium',
        _recommendation: 'Bon Achat',
        screen_size: 55,
        capacity_l: 350,
        power_w: 800,
        btu: 18000,
        energy_class: 'A++',
        panel_type: 'QLED',
      },
    }))
    expect(tags.length).toBeLessThanOrEqual(6)
  })

  it('orders by tone priority (pink first, muted last)', () => {
    const tags = deriveTags(product({
      available: 2,
      completeness_score: 0.92,
      brand: 'SAMSUNG',
      specs: { capacity_l: 350 },
    }))
    if (tags.length >= 2) {
      const order = ['pink', 'yellow', 'electric', 'success', 'muted']
      const indices = tags.map(t => order.indexOf(t.tone))
      const sorted = [...indices].sort((a, b) => a - b)
      expect(indices).toEqual(sorted)
    }
  })

  it('handles empty specs', () => {
    const tags = deriveTags(product({ specs: {} }))
    expect(Array.isArray(tags)).toBe(true)
  })
})
