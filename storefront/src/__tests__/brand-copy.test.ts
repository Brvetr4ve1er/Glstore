/**
 * Brand and claims guard for every page and component.
 *
 * The Phase F audit found the storefront still telling search engines it was
 * "Ghir Laffaire" on five pages, and an empty cart promising free delivery
 * above 50 000 DZD — a commercial term nothing in the code implements. The
 * credit-copy guard could not see either (it looks for financing wording).
 *
 *  · no retired brand names in code: Ghir Laffaire, GLAIVE, gaming copy
 *  · no delivery or price promises: "offerte", "gratuit", "dès … DZD/DA",
 *    delivery times, "garantie", "meilleur prix", "remboursé"
 *  · no speed promises on a decision: blueprint §10 — "avoid promises like
 *    instant approval unless the operation truly supports it"
 *
 * Comments are stripped first: files may explain the history.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob(
  ['../pages/**/*.{ts,tsx}', '../components/**/*.{ts,tsx}', '../lib/**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const FORBIDDEN: [RegExp, string][] = [
  [/Ghir Laffaire/i, 'the retired brand "Ghir Laffaire"'],
  [/\bGLAIVE\b/, 'the retired gaming brand "GLAIVE"'],
  [/\bgaming\b/i, 'gaming copy on an appliance store'],
  [/livraison (offerte|gratuite|rapide|express)/i, 'a delivery promise'],
  [/\b(24|48|72)\s?h\b/i, 'a delivery time'],
  [/\bdès\s+[0-9][0-9\s ]*(DZD|DA)\b/i, 'a price threshold promise'],
  [/\bgaranti/i, 'a warranty claim'],
  [/meilleur(s)? prix|moins cher/i, 'a price-comparison claim'],
  [/satisfait ou rembours/i, 'a refund promise'],
  [/instantan|imm[ée]diat|en quelques (minutes|heures)|r[ée]ponse rapide/i, 'a speed promise (§10: no instant approval)'],
]

describe('brand and claims copy', () => {
  it('scans real files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30)
  })

  for (const [name, source] of Object.entries(SOURCES)) {
    const code = stripComments(source)
    it(`${name} carries no retired brand and no unbacked promise`, () => {
      for (const [rx, why] of FORBIDDEN) {
        expect(rx.test(code), `${name}: ${why}`).toBe(false)
      }
    })
  }
})
