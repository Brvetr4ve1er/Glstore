/**
 * Guards the plan's Decision 2 in the storefront: a monthly figure is a credit
 * offer, so it only ever appears as a computed, server-labelled result.
 *
 *  · no marketing credit copy ("à partir de … DA/mois", "par mois",
 *    "mensualité") hand-written into a page or component
 *  · nothing reads as approved — the server words application statuses
 *  · no app-store promotion (there is no app)
 *  · any file that renders `monthly_instalment` also imports EstimateLabel
 *
 * Source-level, like the backend guards. Comments are stripped first so a
 * file may explain the rule without tripping it.
 */
import { describe, expect, it } from 'vitest'

// Vite loads every page and component's source as text — new files are
// picked up automatically, with no Node APIs in the browser-typed project.
const SOURCES = import.meta.glob(
  ['../pages/**/*.{ts,tsx}', '../components/**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const FORBIDDEN: [RegExp, string][] = [
  [/DA\s*\/\s*mois/i, 'a hand-written "DA/mois" figure'],
  [/par mois/i, '"par mois" marketing copy'],
  [/mensualit/i, '"mensualité" copy — say "remboursement mensuel estimé" beside an EstimateLabel'],
  [/à partir de/i, '"à partir de" pricing copy'],
  [/approuv/i, 'an "approuvé" wording — statuses are worded by the server'],
  [/App Store|Google Play/i, 'app-store promotion — there is no app'],
]

describe('credit copy', () => {
  it('scans real files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)
  })

  for (const [name, source] of Object.entries(SOURCES)) {
    const code = stripComments(source)

    it(`${name} has no hand-written credit copy`, () => {
      for (const [rx, why] of FORBIDDEN) {
        expect(rx.test(code), `${name}: ${why}`).toBe(false)
      }
    })

    if (code.includes('monthly_instalment')) {
      it(`${name} captions its monthly figure with EstimateLabel`, () => {
        expect(code.includes('EstimateLabel'), `${name} renders monthly_instalment without <EstimateLabel>`).toBe(true)
      })
    }
  }
})
