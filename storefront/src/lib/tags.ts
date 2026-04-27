/**
 * Smart tags — derive useful, scannable chips from product data.
 *
 * Driven by:
 *   - LLM-enriched specs (selling angles, price position, marketing hooks)
 *   - rule-engine specs (capacity, screen size, watts, …)
 *   - inventory state (low stock, in-stock urgency)
 *   - completeness (verified, fresh data)
 *
 * Returns ordered, deduped, French-localised tags ready for a chip row.
 */
import type { ProductListItem, ProductDetail } from './api'

export type TagTone = 'electric' | 'yellow' | 'pink' | 'success' | 'muted'

export interface SmartTag {
  label: string
  tone: TagTone
}

const TONE_PRIORITY: Record<TagTone, number> = {
  pink: 0, yellow: 1, electric: 2, success: 3, muted: 4,
}


function pickStr(specs: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  if (!specs) return null
  for (const k of keys) {
    const v = specs[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}


export function deriveTags(p: ProductListItem | ProductDetail): SmartTag[] {
  const specs = (p.specs ?? {}) as Record<string, unknown>
  const tags: SmartTag[] = []

  // Inventory urgency
  if (p.available > 0 && p.available <= 3) {
    tags.push({ label: `Plus que ${p.available} en stock`, tone: 'pink' })
  } else if (p.available === 0) {
    tags.push({ label: 'Bientôt de retour', tone: 'muted' })
  }

  // Price position from LLM
  const pos = pickStr(specs, '_price_position')
  if (pos === 'budget') tags.push({ label: 'Bon prix', tone: 'success' })
  else if (pos === 'premium') tags.push({ label: 'Premium', tone: 'electric' })
  else if (pos === 'midrange') tags.push({ label: 'Milieu de gamme', tone: 'electric' })

  // Recommendation from LLM
  const rec = pickStr(specs, '_recommendation')
  if (rec === 'Bon Achat') tags.push({ label: 'Bon achat', tone: 'yellow' })

  // Auto specs → human-readable chips
  const screen = pickStr(specs, 'screen_size', 'size_or_feux')
  if (screen) tags.push({ label: `${screen}${/["”]/.test(screen) ? '' : '"'}`, tone: 'electric' })

  const cap_l = pickStr(specs, 'capacity_l')
  if (cap_l) tags.push({ label: `${cap_l} L`, tone: 'muted' })
  const cap_kg = pickStr(specs, 'capacity_kg')
  if (cap_kg) tags.push({ label: `${cap_kg} kg`, tone: 'muted' })
  const watts = pickStr(specs, 'power_w', 'watts')
  if (watts) tags.push({ label: `${watts} W`, tone: 'muted' })
  const btu = pickStr(specs, 'btu')
  if (btu) tags.push({ label: `${btu} BTU`, tone: 'muted' })
  const hp = pickStr(specs, 'power_hp', 'hp')
  if (hp) tags.push({ label: `${hp} HP`, tone: 'muted' })
  const energy = pickStr(specs, 'energy_class')
  if (energy) tags.push({ label: `Classe ${energy}`, tone: 'success' })

  const panel = pickStr(specs, 'panel_type')
  if (panel === 'QLED' || panel === 'OLED') tags.push({ label: panel, tone: 'pink' })

  if (specs.smart_tv === true || pickStr(specs, 'os')) {
    const os = pickStr(specs, 'os')
    if (os && os.toLowerCase() !== 'sans os') {
      tags.push({ label: os, tone: 'electric' })
    }
  }

  if (p.brand && p.brand.toUpperCase() !== 'INCONNU') {
    // Surface brand only if not already obvious in name (rough check)
    if (!p.name.toUpperCase().includes(p.brand.toUpperCase())) {
      tags.push({ label: p.brand, tone: 'muted' })
    }
  }

  // Verified / fresh data
  if (p.completeness_score >= 0.85) {
    tags.push({ label: 'Fiche vérifiée', tone: 'success' })
  }

  // Dedupe (label-insensitive) + cap
  const seen = new Set<string>()
  const deduped: SmartTag[] = []
  for (const t of tags) {
    const key = t.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(t)
  }
  deduped.sort((a, b) => TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone])
  return deduped.slice(0, 6)
}
