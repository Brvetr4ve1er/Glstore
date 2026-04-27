/**
 * Theme system — Phase 9 (Push 3 expansion).
 *
 * One theme is a (scope, preset, overrides, mode) tuple where:
 *   - scope     : 'admin' or 'storefront' — which surface this theme paints
 *   - preset    : a curated palette key (e.g. 'midnight', 'sakura')
 *   - overrides : per-token user tweaks layered on top of the preset
 *   - mode      : 'dark' or 'light' — flips `color-scheme` for native widgets
 *
 * Why this is a vanilla module rather than a React context:
 *   - The theme has to apply BEFORE React mounts to avoid a flash of canon
 *     palette on first paint. localStorage caching makes the first frame
 *     correct; the API roundtrip then refreshes if anything changed.
 *   - Once CSS vars are set on `document.documentElement`, every component
 *     reads them via `var(--…)` without provider plumbing.
 *
 * Token catalog (server-whitelisted in api/routes/settings.py — keep in sync):
 *   18 colors  (palette + surface ramp + text ramp + status)
 *   3  fonts   (sans / display / mono)
 *   6  radii   (sm / md / lg / xl / 2xl / full)
 *   3  glass   (blur / saturate / opacity)
 *   3  motion  (duration-fast / base / slow)
 *   3  bg      (radial gradient anchors for the body backdrop)
 *
 * Dispatched events:
 *   'gl:theme-changed' { detail: ThemeConfig } — fired after every applyTheme
 *                       so canvas-painted surfaces (e.g. the catalog graph)
 *                       can re-read CSS vars and repaint.
 */
import type { ThemeConfig, ThemeOverrides, ThemeScope } from './api'

const CACHE_KEY_PREFIX = 'gl.theme.cache.v2.'  // bumped from v1 (color-only)

export function cacheKey(scope: ThemeScope) {
  return `${CACHE_KEY_PREFIX}${scope}`
}


// ── Token registry ───────────────────────────────────────────────────────
//
// Every theme-controlled CSS variable lives here. The registry drives:
//   · the server-side whitelist (mirrored in api/routes/settings.py)
//   · the Theme Studio UI grid (auto-built from this list)
//   · the sanity-check fallback values

export type TokenGroup =
  | 'palette' | 'surface' | 'text' | 'status'
  | 'typography' | 'radius' | 'glass' | 'motion' | 'background'

export interface TokenSpec {
  key:      string                    // CSS custom-property name
  label:    string                    // human label for the studio
  group:    TokenGroup
  kind:     'color' | 'font' | 'length' | 'unitless' | 'duration' | 'gradient'
  fallback: string                    // canonical default if everything else fails
  // For numeric tokens, the studio renders a slider instead of a free-text field
  range?:   { min: number; max: number; step: number; unit?: string }
}

export const TOKENS: TokenSpec[] = [
  // — Palette ——————————————————————————————————————————————
  { key: '--color-bold-blue',     label: 'Bold Blue',     group: 'palette', kind: 'color', fallback: '#1E466B' },
  { key: '--color-electric-blue', label: 'Electric Blue', group: 'palette', kind: 'color', fallback: '#3DA9FC' },
  { key: '--color-neon-yellow',   label: 'Neon Yellow',   group: 'palette', kind: 'color', fallback: '#FFD400' },
  { key: '--color-hot-pink',      label: 'Hot Pink',      group: 'palette', kind: 'color', fallback: '#FF2E7A' },
  { key: '--color-jet-black',     label: 'Jet Black',     group: 'palette', kind: 'color', fallback: '#0D0D0D' },
  { key: '--color-soft-white',    label: 'Soft White',    group: 'palette', kind: 'color', fallback: '#F7F7F7' },
  // — Surface ——————————————————————————————————————————————
  { key: '--color-surface-0', label: 'Surface 0 (page)',    group: 'surface', kind: 'color', fallback: '#0a0a0d' },
  { key: '--color-surface-1', label: 'Surface 1 (sidebar)', group: 'surface', kind: 'color', fallback: '#0f0f15' },
  { key: '--color-surface-2', label: 'Surface 2 (card)',    group: 'surface', kind: 'color', fallback: '#15151d' },
  { key: '--color-surface-3', label: 'Surface 3 (hover)',   group: 'surface', kind: 'color', fallback: '#1c1c28' },
  { key: '--color-surface-4', label: 'Surface 4 (border)',  group: 'surface', kind: 'color', fallback: '#2a2a3d' },
  // — Text —————————————————————————————————————————————————
  { key: '--color-text-1', label: 'Text · primary',   group: 'text', kind: 'color', fallback: '#f7f7f7' },
  { key: '--color-text-2', label: 'Text · secondary', group: 'text', kind: 'color', fallback: '#b6b6c6' },
  { key: '--color-text-3', label: 'Text · muted',     group: 'text', kind: 'color', fallback: '#6b6b85' },
  // — Status ————————————————————————————————————————————————
  { key: '--color-success', label: 'Success', group: 'status', kind: 'color', fallback: '#22c55e' },
  { key: '--color-warning', label: 'Warning', group: 'status', kind: 'color', fallback: '#FFD400' },
  { key: '--color-danger',  label: 'Danger',  group: 'status', kind: 'color', fallback: '#FF2E7A' },
  { key: '--color-info',    label: 'Info',    group: 'status', kind: 'color', fallback: '#3DA9FC' },

  // — Typography ——————————————————————————————————————————
  { key: '--font-sans',    label: 'Sans-serif font',    group: 'typography', kind: 'font', fallback: '"Inter", "Segoe UI", system-ui, sans-serif' },
  { key: '--font-display', label: 'Display font',       group: 'typography', kind: 'font', fallback: '"Bricolage Grotesque", "Inter", sans-serif' },
  { key: '--font-mono',    label: 'Monospace font',     group: 'typography', kind: 'font', fallback: '"JetBrains Mono", monospace' },

  // — Radius ——————————————————————————————————————————————
  { key: '--radius-sm',   label: 'Radius · small',  group: 'radius', kind: 'length', fallback: '6px',   range: { min: 0,  max: 16, step: 1, unit: 'px' } },
  { key: '--radius-md',   label: 'Radius · medium', group: 'radius', kind: 'length', fallback: '10px',  range: { min: 0,  max: 24, step: 1, unit: 'px' } },
  { key: '--radius-lg',   label: 'Radius · large',  group: 'radius', kind: 'length', fallback: '14px',  range: { min: 0,  max: 32, step: 1, unit: 'px' } },
  { key: '--radius-xl',   label: 'Radius · xl',     group: 'radius', kind: 'length', fallback: '18px',  range: { min: 0,  max: 40, step: 1, unit: 'px' } },
  { key: '--radius-2xl',  label: 'Radius · 2xl',    group: 'radius', kind: 'length', fallback: '24px',  range: { min: 0,  max: 56, step: 1, unit: 'px' } },
  { key: '--radius-full', label: 'Radius · full',   group: 'radius', kind: 'length', fallback: '9999px' },

  // — Glass material ——————————————————————————————————————
  { key: '--glass-blur',           label: 'Glass · blur',           group: 'glass', kind: 'length',   fallback: '24px',  range: { min: 0,  max: 60, step: 1, unit: 'px' } },
  { key: '--glass-saturate',       label: 'Glass · saturation',     group: 'glass', kind: 'length',   fallback: '150%',  range: { min: 80, max: 220, step: 5, unit: '%' } },
  { key: '--glass-opacity',        label: 'Glass · opacity',        group: 'glass', kind: 'unitless', fallback: '0.62',  range: { min: 0.1, max: 1, step: 0.02 } },

  // — Motion ——————————————————————————————————————————————
  { key: '--duration-fast', label: 'Motion · fast',  group: 'motion', kind: 'duration', fallback: '150ms', range: { min: 50,  max: 600, step: 10, unit: 'ms' } },
  { key: '--duration-base', label: 'Motion · base',  group: 'motion', kind: 'duration', fallback: '240ms', range: { min: 80,  max: 800, step: 10, unit: 'ms' } },
  { key: '--duration-slow', label: 'Motion · slow',  group: 'motion', kind: 'duration', fallback: '480ms', range: { min: 120, max: 1200, step: 20, unit: 'ms' } },

  // — Background gradient anchors (radial glows on the page bg) —————
  { key: '--bg-glow-1', label: 'Background glow 1', group: 'background', kind: 'color', fallback: 'rgba(61,169,252,0.07)' },
  { key: '--bg-glow-2', label: 'Background glow 2', group: 'background', kind: 'color', fallback: 'rgba(255,46,122,0.05)' },
  { key: '--bg-glow-3', label: 'Background glow 3', group: 'background', kind: 'color', fallback: 'rgba(255,212,0,0.03)' },
]

export const ALL_TOKEN_KEYS = TOKENS.map(t => t.key)

const TOKEN_BY_KEY: Record<string, TokenSpec> = Object.fromEntries(
  TOKENS.map(t => [t.key, t]),
)
export function tokenSpec(key: string): TokenSpec | undefined {
  return TOKEN_BY_KEY[key]
}


// ── Curated presets ─────────────────────────────────────────────────────
//
// Each preset is a (token → value) map. Empty preset = canonical defaults.
// User overrides are layered on top so they always win.
//
// Presets only have to declare the tokens they want to change. Anything
// they don't list is taken from the fallbacks.

export interface PresetMeta {
  label: string
  emoji: string
  tags:  string[]    // 'dark' | 'light' | 'high-contrast' | 'soft' | 'punk' | 'mono'
  tokens: ThemeOverrides
  mode:  'dark' | 'light'
}

export const PRESETS: Record<string, PresetMeta> = {
  default: {
    label: 'Ghir Laffaire (canon)',
    emoji: '⚡',
    tags: ['dark', 'punk'],
    mode: 'dark',
    tokens: {},
  },

  midnight: {
    label: 'Midnight Tokyo',
    emoji: '🌃',
    tags: ['dark', 'cool'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#0F1B3D',
      '--color-electric-blue': '#56CCF2',
      '--color-neon-yellow':   '#FFD400',
      '--color-hot-pink':      '#EB5757',
      '--color-jet-black':     '#06070D',
      '--color-surface-0':     '#06070d',
      '--color-surface-1':     '#0a0d18',
      '--color-surface-2':     '#10141f',
      '--color-surface-3':     '#1a1f2e',
      '--color-surface-4':     '#2a3145',
      '--bg-glow-1':           'rgba(86,204,242,0.08)',
      '--bg-glow-2':           'rgba(235,87,87,0.04)',
    },
  },

  sakura: {
    label: 'Sakura Punk',
    emoji: '🌸',
    tags: ['dark', 'soft', 'punk'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#3B1F47',
      '--color-electric-blue': '#FF8AB1',
      '--color-neon-yellow':   '#FFEAA7',
      '--color-hot-pink':      '#FF2E7A',
      '--color-jet-black':     '#1A0F1A',
      '--color-surface-0':     '#15121a',
      '--color-surface-1':     '#1f1722',
      '--color-surface-2':     '#2a1f30',
      '--color-surface-3':     '#3a2c41',
      '--color-surface-4':     '#4d3a55',
      '--bg-glow-1':           'rgba(255,138,177,0.10)',
      '--bg-glow-2':           'rgba(255,46,122,0.07)',
      '--radius-md':           '14px',
      '--radius-lg':           '20px',
      '--radius-xl':           '26px',
    },
  },

  matcha: {
    label: 'Matcha CRT',
    emoji: '🍵',
    tags: ['dark', 'mono'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#1F4032',
      '--color-electric-blue': '#7DD3A1',
      '--color-neon-yellow':   '#E8FF63',
      '--color-hot-pink':      '#FF7AB6',
      '--color-jet-black':     '#0A1410',
      '--color-surface-0':     '#091310',
      '--color-surface-1':     '#0d1c17',
      '--color-surface-2':     '#11241e',
      '--color-surface-3':     '#1a3327',
      '--color-surface-4':     '#284937',
      '--bg-glow-1':           'rgba(125,211,161,0.07)',
      '--bg-glow-3':           'rgba(232,255,99,0.04)',
      '--font-sans':           '"JetBrains Mono", monospace',
    },
  },

  sunset: {
    label: 'Algiers Sunset',
    emoji: '🌅',
    tags: ['dark', 'warm'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#5D2C2C',
      '--color-electric-blue': '#FFA94D',
      '--color-neon-yellow':   '#FFD43B',
      '--color-hot-pink':      '#FF4D6D',
      '--color-jet-black':     '#1A0F0E',
      '--color-surface-0':     '#160e0c',
      '--color-surface-1':     '#1f1612',
      '--color-surface-2':     '#2a1d18',
      '--color-surface-3':     '#3a2820',
      '--color-surface-4':     '#523a30',
      '--bg-glow-1':           'rgba(255,169,77,0.10)',
      '--bg-glow-2':           'rgba(255,77,109,0.07)',
    },
  },

  paper: {
    label: 'Paper Edge',
    emoji: '📜',
    tags: ['light', 'soft'],
    mode: 'light',
    tokens: {
      '--color-bold-blue':     '#1E466B',
      '--color-electric-blue': '#1E66D1',
      '--color-neon-yellow':   '#F1C40F',
      '--color-hot-pink':      '#D81B60',
      '--color-jet-black':     '#1B1B1F',
      '--color-soft-white':    '#FAFAF7',
      '--color-surface-0':     '#F4F4F0',
      '--color-surface-1':     '#FFFFFF',
      '--color-surface-2':     '#F7F7F2',
      '--color-surface-3':     '#EAEAE1',
      '--color-surface-4':     '#D4D4C9',
      '--color-text-1':        '#1B1B1F',
      '--color-text-2':        '#3F3F46',
      '--color-text-3':        '#71717A',
      '--bg-glow-1':           'rgba(30,102,209,0.06)',
      '--bg-glow-2':           'rgba(216,27,96,0.04)',
      '--bg-glow-3':           'rgba(241,196,15,0.04)',
      '--glass-opacity':       '0.85',
    },
  },

  cyberpunk: {
    label: 'Cyberpunk',
    emoji: '🤖',
    tags: ['dark', 'punk', 'high-contrast'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#3D1B6E',
      '--color-electric-blue': '#00F0FF',
      '--color-neon-yellow':   '#F9F002',
      '--color-hot-pink':      '#FF006E',
      '--color-jet-black':     '#020014',
      '--color-surface-0':     '#020014',
      '--color-surface-1':     '#080026',
      '--color-surface-2':     '#0e0036',
      '--color-surface-3':     '#1a0a4a',
      '--color-surface-4':     '#3a14a0',
      '--color-text-1':        '#FBFBFF',
      '--color-text-2':        '#A8B0FF',
      '--color-text-3':        '#7B72CC',
      '--bg-glow-1':           'rgba(0,240,255,0.10)',
      '--bg-glow-2':           'rgba(255,0,110,0.08)',
      '--bg-glow-3':           'rgba(249,240,2,0.04)',
      '--radius-md':           '4px',
      '--radius-lg':           '6px',
      '--radius-xl':           '8px',
      '--glass-blur':          '12px',
    },
  },

  dune: {
    label: 'Dune',
    emoji: '🏜️',
    tags: ['light', 'warm', 'soft'],
    mode: 'light',
    tokens: {
      '--color-bold-blue':     '#5C3B17',
      '--color-electric-blue': '#A8753D',
      '--color-neon-yellow':   '#E8B048',
      '--color-hot-pink':      '#C03A2B',
      '--color-jet-black':     '#2A1B0F',
      '--color-soft-white':    '#F4ECDD',
      '--color-surface-0':     '#EFE4D0',
      '--color-surface-1':     '#F7EFE0',
      '--color-surface-2':     '#FBF5E8',
      '--color-surface-3':     '#E8DCC2',
      '--color-surface-4':     '#C9B998',
      '--color-text-1':        '#2A1B0F',
      '--color-text-2':        '#5C3B17',
      '--color-text-3':        '#7E5E33',
      '--bg-glow-1':           'rgba(168,117,61,0.08)',
      '--bg-glow-2':           'rgba(232,176,72,0.06)',
      '--bg-glow-3':           'rgba(192,58,43,0.03)',
      '--radius-md':           '14px',
      '--radius-lg':           '22px',
      '--radius-xl':           '32px',
      '--glass-opacity':       '0.78',
    },
  },

  mono: {
    label: 'Monokrom',
    emoji: '⚪',
    tags: ['dark', 'mono', 'high-contrast'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#444444',
      '--color-electric-blue': '#FFFFFF',
      '--color-neon-yellow':   '#FFFFFF',
      '--color-hot-pink':      '#888888',
      '--color-jet-black':     '#000000',
      '--color-surface-0':     '#000000',
      '--color-surface-1':     '#0a0a0a',
      '--color-surface-2':     '#161616',
      '--color-surface-3':     '#222222',
      '--color-surface-4':     '#3a3a3a',
      '--color-text-1':        '#FFFFFF',
      '--color-text-2':        '#bbbbbb',
      '--color-text-3':        '#777777',
      '--bg-glow-1':           'rgba(255,255,255,0.04)',
      '--bg-glow-2':           'rgba(255,255,255,0.02)',
      '--bg-glow-3':           'rgba(255,255,255,0.02)',
      '--radius-md':           '2px',
      '--radius-lg':           '4px',
      '--radius-xl':           '4px',
      '--radius-2xl':          '8px',
    },
  },

  spring: {
    label: 'Spring Garden',
    emoji: '🌷',
    tags: ['light', 'soft'],
    mode: 'light',
    tokens: {
      '--color-bold-blue':     '#2A6B6B',
      '--color-electric-blue': '#4FD1C5',
      '--color-neon-yellow':   '#F6E05E',
      '--color-hot-pink':      '#ED64A6',
      '--color-jet-black':     '#1A2530',
      '--color-soft-white':    '#FFFFFE',
      '--color-surface-0':     '#F0FAF7',
      '--color-surface-1':     '#FFFFFF',
      '--color-surface-2':     '#F7FCFA',
      '--color-surface-3':     '#E1F2EB',
      '--color-surface-4':     '#B7DFD2',
      '--color-text-1':        '#1A2530',
      '--color-text-2':        '#4A5568',
      '--color-text-3':        '#718096',
      '--bg-glow-1':           'rgba(79,209,197,0.08)',
      '--bg-glow-2':           'rgba(237,100,166,0.06)',
      '--bg-glow-3':           'rgba(246,224,94,0.05)',
    },
  },

  neotokyo: {
    label: 'Neo-Tokyo',
    emoji: '🗼',
    tags: ['dark', 'punk', 'high-contrast'],
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#1A0033',
      '--color-electric-blue': '#FF0080',
      '--color-neon-yellow':   '#FFEE00',
      '--color-hot-pink':      '#9B00FF',
      '--color-jet-black':     '#010003',
      '--color-surface-0':     '#010003',
      '--color-surface-1':     '#06000c',
      '--color-surface-2':     '#0c0018',
      '--color-surface-3':     '#1a0033',
      '--color-surface-4':     '#3a0066',
      '--color-text-1':        '#FFEEFF',
      '--color-text-2':        '#FFAAEE',
      '--color-text-3':        '#9F66BB',
      '--bg-glow-1':           'rgba(255,0,128,0.10)',
      '--bg-glow-2':           'rgba(155,0,255,0.08)',
      '--bg-glow-3':           'rgba(255,238,0,0.04)',
    },
  },
}

export function isPresetKey(s: string): s is keyof typeof PRESETS {
  return Object.prototype.hasOwnProperty.call(PRESETS, s)
}

export function presetKeys(): string[] {
  return Object.keys(PRESETS)
}


// ── Apply ────────────────────────────────────────────────────────────────

export function applyTheme(theme: ThemeConfig, scope: ThemeScope = 'admin'): void {
  // The admin runs in its own document; the storefront in its own document.
  // Each reads from `document.documentElement` so we only ever touch one
  // root — but the stored config tells us which *scope* it represents so we
  // cache / sync correctly.
  const root = document.documentElement
  const presetMeta = isPresetKey(theme.preset) ? PRESETS[theme.preset] : null
  const presetTokens = presetMeta?.tokens ?? {}

  // 1) Reset every known token so a slimmer preset doesn't inherit ghosts.
  for (const key of ALL_TOKEN_KEYS) {
    root.style.removeProperty(key)
  }

  // 2) Layer: preset → user overrides.
  for (const [k, v] of Object.entries(presetTokens)) {
    if (typeof v === 'string' && v.length > 0) root.style.setProperty(k, v)
  }
  for (const [k, v] of Object.entries(theme.overrides ?? {})) {
    if (typeof v === 'string' && v.length > 0) root.style.setProperty(k, v)
  }

  // 3) Light/dark hint for native form controls + scrollbars.
  const mode = theme.mode ?? presetMeta?.mode ?? 'dark'
  root.style.colorScheme = mode

  // Tag the body so CSS can use [data-theme="paper"] selectors if needed.
  document.documentElement.dataset.themePreset = theme.preset
  document.documentElement.dataset.themeMode   = mode

  cacheTheme(theme, scope)
  window.dispatchEvent(new CustomEvent('gl:theme-changed', { detail: { theme, scope } }))
}


// ── Cache (first-paint ready) ────────────────────────────────────────────

export function loadCachedTheme(scope: ThemeScope = 'admin'): ThemeConfig | null {
  try {
    const raw = localStorage.getItem(cacheKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ThemeConfig
    if (!parsed || typeof parsed !== 'object') return null
    return {
      preset:    parsed.preset || 'default',
      overrides: parsed.overrides ?? {},
      mode:      parsed.mode,
      updated_at: parsed.updated_at,
    }
  } catch {
    return null
  }
}

export function cacheTheme(theme: ThemeConfig, scope: ThemeScope = 'admin'): void {
  try { localStorage.setItem(cacheKey(scope), JSON.stringify(theme)) } catch { /* noop */ }
}


// ── Cross-tab sync ───────────────────────────────────────────────────────
//
// `storage` events fire on every OTHER tab in the same origin when one
// tab writes to localStorage. We use this so a theme change in tab A
// (sidebar switcher, studio save) propagates to tabs B/C/D without a
// hard reload. We only honor the cache-key writes — anything else is
// ignored.

let _crossTabBound = false

export function bindCrossTabSync(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (_crossTabBound) return () => {}
  _crossTabBound = true

  const handler = (e: StorageEvent) => {
    if (!e.key) return
    if (e.key === cacheKey('admin') && e.newValue) {
      try {
        const theme = JSON.parse(e.newValue) as ThemeConfig
        applyTheme(theme, 'admin')
      } catch { /* noop */ }
    }
    // Storefront cross-tab sync is handled in storefront/src/lib/theme.ts
    // because the admin and storefront live in different documents.
  }

  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener('storage', handler)
    _crossTabBound = false
  }
}


// ── Effective resolution (preset + overrides → flat map) ────────────────
//
// Useful for the studio's swatch grid and for JSON export — gives the
// fully-resolved theme even if the user has only set a few overrides.

export function resolveTheme(theme: ThemeConfig): Record<string, string> {
  const preset = isPresetKey(theme.preset) ? PRESETS[theme.preset].tokens : {}
  const out: Record<string, string> = {}
  for (const t of TOKENS) {
    const fromOverride = theme.overrides?.[t.key as keyof ThemeOverrides]
    const fromPreset   = (preset as Record<string, string | undefined>)[t.key]
    out[t.key] = (fromOverride ?? fromPreset ?? t.fallback)
  }
  return out
}


// ── Effective live value (read what the document is actually showing) ───

export function readLive(key: string): string {
  if (typeof window === 'undefined') return tokenSpec(key)?.fallback ?? ''
  const cs = getComputedStyle(document.documentElement)
  return cs.getPropertyValue(key).trim() || tokenSpec(key)?.fallback || ''
}


// ── JSON import/export ──────────────────────────────────────────────────

export function exportThemeJson(theme: ThemeConfig): string {
  return JSON.stringify({
    preset:    theme.preset,
    mode:      theme.mode ?? null,
    overrides: theme.overrides ?? {},
    exported_at: new Date().toISOString(),
    schema:    'gl.theme.v2',
  }, null, 2)
}

export function importThemeJson(raw: string): ThemeConfig {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid theme JSON: not an object')
  }
  const preset = typeof parsed.preset === 'string' ? parsed.preset : 'default'
  const mode   = parsed.mode === 'light' ? 'light' as const : parsed.mode === 'dark' ? 'dark' as const : undefined
  const overrides: ThemeOverrides = {}
  for (const [k, v] of Object.entries(parsed.overrides ?? {})) {
    if (TOKEN_BY_KEY[k] && typeof v === 'string' && v.length > 0) {
      ;(overrides as Record<string, string>)[k] = v
    }
  }
  return { preset, mode, overrides }
}


// ── Conveniences ────────────────────────────────────────────────────────

export function blankTheme(): ThemeConfig {
  return { preset: 'default', overrides: {}, mode: 'dark' }
}

export function withOverride(theme: ThemeConfig, key: string, value: string | undefined): ThemeConfig {
  const next = { ...theme.overrides }
  if (value === undefined || value === '') delete (next as Record<string, string>)[key]
  else (next as Record<string, string>)[key] = value
  return { ...theme, overrides: next }
}
