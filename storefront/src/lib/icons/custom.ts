/**
 * Hand-drawn appliance icons — the gaps Lucide does not cover.
 *
 * WHY THESE EXIST AND WHY THEY LOOK THE WAY THEY DO
 *
 * The catalogue has 0% images across 567 products, so the icon set *is* the
 * visual layer of this shop. Two audit signals hang over that: #21 "icons from
 * multiple families" and #23 "inconsistent stroke widths". Hand-drawing five
 * SVGs next to eight imported Lucide ones is exactly how a set drifts.
 *
 * So these are not free-hand `<svg>` blocks. Every one is built with Lucide's
 * own `createLucideIcon`, which renders through Lucide's `Icon` and its
 * `defaultAttributes`:
 *
 *     xmlns · width/height=size · viewBox="0 0 24 24" · fill="none"
 *     stroke="currentColor" · stroke-width="2"
 *     stroke-linecap="round" · stroke-linejoin="round"
 *
 * One family and one stroke weight are therefore guaranteed by construction,
 * not by discipline — a hand-drawn icon here cannot drift from an imported one
 * without editing Lucide itself. `format.test.ts` asserts those attributes on
 * all 13 category icons so a later contributor cannot quietly break it.
 *
 * Geometry follows Lucide's grammar: 24×24 grid, ~2px optical padding, whole
 * or half units, dots written as `h.01` (Lucide's own idiom — see `Heater`).
 */
import { createLucideIcon } from 'lucide-react'

/**
 * Hottes & Encastrable — a cooker hood seen head-on.
 * Chimney box, trapezoid canopy, extraction lip, two work lights.
 */
export const RangeHood = createLucideIcon('RangeHood', [
  ['rect', { width: '4', height: '4', x: '10', y: '2', rx: '1', key: 'hood-flue' }],
  ['path', { d: 'M9 6h6l4.5 6h-15Z', key: 'hood-canopy' }],
  ['path', { d: 'M3 12h18', key: 'hood-lip' }],
  ['path', { d: 'M9 16h.01', key: 'hood-lamp-l' }],
  ['path', { d: 'M15 16h.01', key: 'hood-lamp-r' }],
])

/**
 * Friture & Grill — a frying pan in side view with heat rising.
 * Covers friteuse, gaufrier, crêpière, panineuse, barbecue: all pan-shaped.
 */
export const FryingPan = createLucideIcon('FryingPan', [
  ['path', { d: 'M7 8c2-3-2-3 0-6', key: 'pan-heat-l' }],
  ['path', { d: 'M12 8c2-3-2-3 0-6', key: 'pan-heat-r' }],
  // The rim runs past the bowl on the right: that overhang is the handle.
  ['path', { d: 'M2 11h20', key: 'pan-rim' }],
  ['path', { d: 'M4 11v1a5 5 0 0 0 5 5h2a5 5 0 0 0 5-5v-1', key: 'pan-bowl' }],
])

/**
 * Préparation culinaire — a blender: lid, tapered jug, motor base.
 * Stands in for pétrin, batteur, mixeur, robot, hachoir.
 */
export const Blender = createLucideIcon('Blender', [
  ['rect', { width: '14', height: '3', x: '5', y: '2', rx: '1', key: 'blender-lid' }],
  ['path', { d: 'M6.5 5h11l-1.3 9.9a2 2 0 0 1-2 1.6H9.8a2 2 0 0 1-2-1.6Z', key: 'blender-jug' }],
  ['rect', { width: '10', height: '4', x: '7', y: '17', rx: '1', key: 'blender-base' }],
  ['path', { d: 'M14.5 19h.01', key: 'blender-dial' }],
])

/**
 * Entretien & Repassage — a steam iron in side view, three steam dots.
 */
export const SteamIron = createLucideIcon('SteamIron', [
  ['path', { d: 'M9 10V8a3 3 0 0 1 6 0v2', key: 'iron-handle' }],
  // Asymmetry is what makes this an iron and not a dome: a long nose sloping
  // down to the left, a flat sole, a blunt back. Two earlier drafts kept the
  // silhouette symmetric and came out indistinguishable from RangeHood.
  ['path', { d: 'M3 16h15a3 3 0 0 0 3-3v-1a2 2 0 0 0-2-2H8L3.4 14.2A1 1 0 0 0 3 16Z', key: 'iron-body' }],
  ['path', { d: 'M6 19h.01', key: 'iron-steam-l' }],
  ['path', { d: 'M11 19h.01', key: 'iron-steam-c' }],
  ['path', { d: 'M16 19h.01', key: 'iron-steam-r' }],
])

/**
 * Soin & Beauté — a hair dryer: barrel, nozzle, grip, power dot.
 */
export const HairDryer = createLucideIcon('HairDryer', [
  ['rect', { width: '13', height: '8', x: '2', y: '4', rx: '4', key: 'dryer-barrel' }],
  ['path', { d: 'M15 6h4a2 2 0 0 1 0 4h-4', key: 'dryer-nozzle' }],
  ['path', { d: 'M6 12v5a3 3 0 0 0 6 0v-5', key: 'dryer-grip' }],
  ['path', { d: 'M6 8h.01', key: 'dryer-switch' }],
])
