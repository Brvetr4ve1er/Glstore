/**
 * Storefront theme bootstrap (Phase 9 Push 3).
 *
 * The storefront does not author themes — the admin does. This module is
 * the receive-end:
 *
 *   1. Synchronously load the cached theme from localStorage so first paint
 *      is correct (no flash of canon palette). main.tsx calls this before
 *      React mounts.
 *   2. Asynchronously fetch the authoritative theme from
 *      GET /api/v1/storefront/theme (no auth) and reapply it. Any drift
 *      between cache and server is corrected on the next paint frame.
 *
 * Storage key: 'gl.storefront.theme.v2' (bumped from v1 to invalidate
 * older color-only caches that don't have radius/glass/motion tokens).
 *
 * The token list and presets are mirrored from admin/src/lib/theme.ts
 * deliberately — keeping these as separate copies is simpler than
 * extracting a shared package while we have one repo, two SPAs.
 */

const CACHE_KEY = 'gl.storefront.theme.v2'

// ── Public types (mirror admin/src/lib/api.ts ThemeConfig) ──────────────

export interface ThemeConfig {
  preset:    string
  overrides: Record<string, string>
  mode?:     'light' | 'dark'
  updated_at?: string | null
}


// ── Token list (mirror admin/src/lib/theme.ts TOKENS keys) ──────────────
//
// We only need the keys (not metadata) because we just push values to CSS
// vars and never render an editor here.

const ALL_TOKEN_KEYS: readonly string[] = [
  // Palette
  '--color-bold-blue', '--color-electric-blue', '--color-neon-yellow',
  '--color-hot-pink',  '--color-jet-black',     '--color-soft-white',
  // Surface
  '--color-surface-0', '--color-surface-1', '--color-surface-2',
  '--color-surface-3', '--color-surface-4',
  // Text
  '--color-text-1', '--color-text-2', '--color-text-3',
  // Status
  '--color-success', '--color-warning', '--color-danger', '--color-info',
  // Typography
  '--font-sans', '--font-display', '--font-mono',
  // Radii
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl', '--radius-full',
  // Glass
  '--glass-blur', '--glass-saturate', '--glass-opacity',
  // Motion
  '--duration-fast', '--duration-base', '--duration-slow',
  // Background
  '--bg-glow-1', '--bg-glow-2', '--bg-glow-3',
]

// Set form for O(1) lookup in applyTheme. Defense-in-depth: even though the
// server already whitelists, we re-check here so a compromised endpoint or
// a polluted localStorage cache can't inject arbitrary CSS custom properties.
const ALLOWED_KEY_SET: Set<string> = new Set(ALL_TOKEN_KEYS)

// Lightweight value validators mirroring the server. Mirrors admin/src/lib/theme.ts
// — exists so a tampered cache that survives storage events can't poison the
// page even if it predates the server's tightened validation.
const VALUE_VALIDATORS: Record<string, RegExp> = {
  color:    /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|hsla?\(\s*-?\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/,
  font:     /^[A-Za-z0-9 ,"'\-]+$/,
  length:   /^\d+(\.\d+)?(px|rem|em|%)$/,
  duration: /^\d+(\.\d+)?(ms|s)$/,
  unitless: /^\d+(\.\d+)?$/,
}

function validateTokenValue(key: string, val: string): boolean {
  if (typeof val !== 'string' || val.length === 0 || val.length > 200) return false
  if (key.startsWith('--color-') || key.startsWith('--bg-glow-')) return VALUE_VALIDATORS.color.test(val)
  if (key.startsWith('--font-'))     return VALUE_VALIDATORS.font.test(val)
  if (key.startsWith('--radius-'))   return VALUE_VALIDATORS.length.test(val)
  if (key.startsWith('--duration-')) return VALUE_VALIDATORS.duration.test(val)
  if (key === '--glass-blur' || key === '--glass-saturate') return VALUE_VALIDATORS.length.test(val)
  if (key === '--glass-opacity')     return VALUE_VALIDATORS.unitless.test(val)
  return false
}


// ── Presets (subset — just enough so a server returning {preset:'midnight'}
//   with no overrides still paints correctly even if the network later fails
//   and the storefront has nothing else to fall back on).

const PRESETS: Record<string, { tokens: Record<string, string>; mode: 'dark' | 'light' }> = {
  default: { mode: 'dark', tokens: {} },

  midnight: {
    mode: 'dark',
    tokens: {
      '--color-bold-blue':     '#0F1B3D',
      '--color-electric-blue': '#56CCF2',
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


// ── Apply ────────────────────────────────────────────────────────────────

export function applyTheme(theme: ThemeConfig): void {
  const root = document.documentElement
  const presetMeta = PRESETS[theme.preset]
  const presetTokens = presetMeta?.tokens ?? {}

  // 1) Reset every known token so a slimmer payload doesn't leave ghosts.
  for (const key of ALL_TOKEN_KEYS) root.style.removeProperty(key)

  // 2) Apply preset tokens (these are static, baked-into-source values
  //    so we don't need to re-validate — only the keys must be known).
  for (const [k, v] of Object.entries(presetTokens)) {
    if (!ALLOWED_KEY_SET.has(k)) continue
    if (typeof v === 'string' && v.length > 0) root.style.setProperty(k, v)
  }

  // 3) Apply user overrides — but ONLY if both key and value pass the
  //    whitelist + per-kind validator. The server already does this, but
  //    a polluted localStorage cache or a man-in-the-middled response
  //    could otherwise inject arbitrary CSS custom properties.
  for (const [k, v] of Object.entries(theme.overrides ?? {})) {
    if (!ALLOWED_KEY_SET.has(k)) continue
    if (typeof v !== 'string' || !validateTokenValue(k, v)) continue
    root.style.setProperty(k, v)
  }

  const mode = theme.mode ?? presetMeta?.mode ?? 'dark'
  root.style.colorScheme = mode
  root.dataset.themePreset = theme.preset
  root.dataset.themeMode   = mode
}


// ── Cache ────────────────────────────────────────────────────────────────

export function loadCached(): ThemeConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      preset:    parsed.preset || 'default',
      overrides: parsed.overrides ?? {},
      mode:      parsed.mode === 'light' ? 'light' : parsed.mode === 'dark' ? 'dark' : undefined,
    }
  } catch { return null }
}

export function cache(theme: ThemeConfig): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(theme)) } catch { /* noop */ }
}


// ── Fetch + apply with stale-while-revalidate ──────────────────────────

export async function refreshThemeFromServer(): Promise<void> {
  try {
    const res = await fetch('/api/v1/storefront/theme', {
      headers: { 'x-request-id': crypto.randomUUID() },
    })
    if (!res.ok) return
    const theme = (await res.json()) as ThemeConfig
    applyTheme(theme)
    cache(theme)
  } catch {
    // Network or parse failure — keep the cached/default theme. The next
    // page load tries again. We never throw here; the storefront should
    // never blank-screen because of a theme miss.
  }
}


// ── Cross-tab sync ───────────────────────────────────────────────────────
//
// localStorage `storage` events fire on every OTHER same-origin tab
// when a tab writes. We listen for the storefront cache key so a theme
// change made in one storefront tab (e.g. user opens the admin in another
// tab and triggers a refresh) is mirrored across every open storefront
// tab without a hard refresh.

let _crossTabBound = false

export function bindCrossTabSync(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (_crossTabBound) return () => {}
  _crossTabBound = true

  const handler = (e: StorageEvent) => {
    if (e.key !== CACHE_KEY || !e.newValue) return
    try {
      const theme = JSON.parse(e.newValue) as ThemeConfig
      applyTheme(theme)
    } catch { /* malformed payload — ignore */ }
  }

  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener('storage', handler)
    _crossTabBound = false
  }
}


// ── Theme Studio preview channel (postMessage) ──────────────────────────
//
// When the storefront is loaded inside an <iframe> from the Theme Studio,
// the parent page (admin) posts a message of the form:
//
//   { type: 'gl:theme:preview', theme: ThemeConfig }
//
// and we apply it WITHOUT writing to localStorage — preview-only, never
// persisted. This lets the admin see live storefront changes before
// hitting "Publier".
//
// Security: we only accept messages whose `source` is the parent window.
// We don't validate origin (the iframe and the admin can be at different
// hosts in production), and we delegate value-level validation to
// applyTheme's own whitelist + per-kind regex.

let _previewBound = false

export function bindPreviewChannel(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (_previewBound) return () => {}
  _previewBound = true

  const handler = (e: MessageEvent) => {
    // Only accept messages from the embedder, never from a random pop-up
    // or an unrelated iframe.
    if (e.source !== window.parent || e.source === window) return
    const data = e.data
    if (!data || typeof data !== 'object') return
    if (data.type !== 'gl:theme:preview') return
    const theme = data.theme as ThemeConfig | undefined
    if (!theme || typeof theme !== 'object') return
    // Apply but do NOT cache — preview is volatile by design.
    try {
      applyTheme(theme)
    } catch { /* never crash the storefront from a preview message */ }
  }

  window.addEventListener('message', handler)
  // Announce readiness so the parent can stop posting blindly and start
  // posting only when the iframe is up.
  try { window.parent?.postMessage({ type: 'gl:theme:preview-ready' }, '*') } catch { /* noop */ }

  return () => {
    window.removeEventListener('message', handler)
    _previewBound = false
  }
}
