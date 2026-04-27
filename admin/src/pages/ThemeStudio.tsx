/**
 * Theme Studio — full customization interface (Phase 9 Push 3).
 *
 * One screen for everything theme-related:
 *   · Preset gallery (curated palettes)
 *   · Color tokens (palette / surface / text / status / background gradients)
 *   · Typography (font families)
 *   · Radius (border radius scale)
 *   · Effects (glass blur/saturate/opacity, motion durations)
 *   · Storefront tab — same controls but bound to the storefront scope
 *   · JSON tab — import/export, copy to clipboard, sync admin↔storefront
 *
 * Live preview applies overrides to document.documentElement on every change
 * so the admin sees the result immediately. Saving persists to the backend
 * (admin.theme or storefront.theme). The storefront theme is broadcast via
 * the public-no-auth GET /storefront/theme endpoint that the public site
 * polls on bootstrap.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Palette, Type, Wand2, Layers, Save, RotateCcw, Check, Copy, Download, Upload,
  Sun, Moon, ArrowLeft, Sparkles, Globe, Eye, EyeOff, RefreshCw, ArrowLeftRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  fetchTheme, saveTheme,
  type ThemeConfig, type ThemeScope,
} from '@/lib/api'
import {
  TOKENS, PRESETS, presetKeys, applyTheme, resolveTheme, exportThemeJson,
  importThemeJson, withOverride,
  type TokenSpec, type TokenGroup,
} from '@/lib/theme'
import { Button, Card, PageHeader, Spinner } from '@/components/ui'


// ── Tabs ────────────────────────────────────────────────────────────────

type TabKey = 'presets' | 'colors' | 'typography' | 'radius' | 'effects' | 'storefront' | 'json'

const TABS: { key: TabKey; label: string; icon: React.FC<{ size?: number; className?: string }>; }[] = [
  { key: 'presets',    label: 'Presets',    icon: Sparkles },
  { key: 'colors',     label: 'Couleurs',   icon: Palette },
  { key: 'typography', label: 'Typo',       icon: Type },
  { key: 'radius',     label: 'Rayons',     icon: Wand2 },
  { key: 'effects',    label: 'Effets',     icon: Layers },
  { key: 'storefront', label: 'Storefront', icon: Globe },
  { key: 'json',       label: 'JSON',       icon: Download },
]


// ── Helpers ─────────────────────────────────────────────────────────────

function tokensInGroup(group: TokenGroup): TokenSpec[] {
  return TOKENS.filter(t => t.group === group)
}

function normaliseHex(s: string): string {
  const v = (s || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7)  // strip alpha for native picker
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const r = v[1], g = v[2], b = v[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  // rgba(...) — convert to closest hex (lossy, only for the picker control)
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const r = Math.min(255, +m[1]).toString(16).padStart(2, '0')
    const g = Math.min(255, +m[2]).toString(16).padStart(2, '0')
    const b = Math.min(255, +m[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return '#666666'
}

function parseNumeric(value: string): number | null {
  const m = value.match(/^([\d.]+)/)
  if (!m) return null
  const n = parseFloat(m[1])
  return isNaN(n) ? null : n
}


// ── Component ───────────────────────────────────────────────────────────

export default function ThemeStudio() {
  const qc = useQueryClient()
  const [scope, setScope] = useState<ThemeScope>('admin')
  const [tab, setTab]     = useState<TabKey>('presets')
  const [preview, setPreview] = useState(true)

  // Server-side admin + storefront theme queries
  const adminQuery      = useQuery({ queryKey: ['theme', 'admin'],      queryFn: () => fetchTheme('admin') })
  const storefrontQuery = useQuery({ queryKey: ['theme', 'storefront'], queryFn: () => fetchTheme('storefront') })

  // Snapshot the AUTHORITATIVE server theme (not the document's computed
  // values) so revert-on-bail restores the persisted state — never the
  // user's unsaved edits, never the fallback @theme defaults.
  //
  // Why this matters: getComputedStyle(documentElement) returns every CSS
  // var defined by Tailwind's @theme block, which would inflate "overrides"
  // to all 32 tokens and pollute localStorage when applyTheme caches it.
  const initialAdminSnapshot = useRef<ThemeConfig | null>(null)
  useEffect(() => {
    if (!initialAdminSnapshot.current && adminQuery.data) {
      initialAdminSnapshot.current = adminQuery.data
    }
  }, [adminQuery.data])

  // Working drafts (independent per scope so switching tabs doesn't clobber edits)
  const [adminDraft,      setAdminDraft]      = useState<ThemeConfig | null>(null)
  const [storefrontDraft, setStorefrontDraft] = useState<ThemeConfig | null>(null)

  // Track the last server-known theme we hydrated from so we can detect
  // "draft is clean" — i.e. the user hasn't edited it locally — and safely
  // re-hydrate from a fresher server snapshot. This handles the case where
  // the sidebar ThemeSwitcher saves a new preset while the studio is open.
  const lastSyncedAdmin      = useRef<ThemeConfig | null>(null)
  const lastSyncedStorefront = useRef<ThemeConfig | null>(null)

  useEffect(() => {
    const fresh = adminQuery.data
    if (!fresh) return
    const draftIsClean = adminDraft === null
      || JSON.stringify(adminDraft) === JSON.stringify(lastSyncedAdmin.current)
    if (draftIsClean) {
      setAdminDraft(fresh)
      lastSyncedAdmin.current = fresh
    }
  }, [adminQuery.data, adminDraft])

  useEffect(() => {
    const fresh = storefrontQuery.data
    if (!fresh) return
    const draftIsClean = storefrontDraft === null
      || JSON.stringify(storefrontDraft) === JSON.stringify(lastSyncedStorefront.current)
    if (draftIsClean) {
      setStorefrontDraft(fresh)
      lastSyncedStorefront.current = fresh
    }
  }, [storefrontQuery.data, storefrontDraft])

  const draft = scope === 'admin' ? adminDraft : storefrontDraft
  const setDraft = (next: ThemeConfig) => {
    if (scope === 'admin') setAdminDraft(next)
    else setStorefrontDraft(next)
  }

  // Live preview: applying admin draft to current document so the admin sees
  // it. Storefront draft does NOT auto-apply (different surface) but the
  // JSON tab + the Storefront tab let the user copy + open the storefront
  // separately.
  useEffect(() => {
    if (!preview) return
    if (scope === 'admin' && adminDraft) applyTheme(adminDraft, 'admin')
  }, [adminDraft, scope, preview])

  // Restore on unmount if user never saved
  useEffect(() => {
    return () => {
      if (initialAdminSnapshot.current) applyTheme(initialAdminSnapshot.current, 'admin')
    }
  }, [])

  const saveMut = useMutation({
    mutationFn: ({ cfg, sc }: { cfg: ThemeConfig; sc: ThemeScope }) => saveTheme(cfg, sc),
    onSuccess: (saved, { sc }) => {
      const persisted: ThemeConfig = {
        preset:     saved.preset,
        overrides:  saved.overrides,
        mode:       saved.mode,
        updated_at: saved.updated_at,
      }
      qc.setQueryData(['theme', sc], persisted)
      if (sc === 'admin') {
        setAdminDraft(persisted)
        applyTheme(persisted, 'admin')
        initialAdminSnapshot.current = persisted
        lastSyncedAdmin.current = persisted
      } else {
        setStorefrontDraft(persisted)
        lastSyncedStorefront.current = persisted
      }

      // Surface server-side validation drops — silent rejection used to
      // make the user think their override saved when it didn't.
      const dropped = saved.dropped ?? []
      if (dropped.length === 0) {
        toast.success(sc === 'admin' ? 'Thème admin sauvegardé' : 'Thème storefront sauvegardé', { icon: '🎨' })
      } else {
        const summary = dropped.slice(0, 3)
          .map(d => `${d.key} (${d.reason})`)
          .join(', ')
        const more = dropped.length > 3 ? ` · +${dropped.length - 3} autres` : ''
        toast.success(
          `Sauvegardé · ${dropped.length} override(s) rejeté(s) par le serveur : ${summary}${more}`,
          { icon: '⚠️', duration: 6000 },
        )
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if ((scope === 'admin' && (adminQuery.isPending || !adminDraft)) ||
      (scope === 'storefront' && (storefrontQuery.isPending || !storefrontDraft))) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} className="text-[var(--color-electric-blue)]" />
      </div>
    )
  }

  const overrideCount = Object.keys(draft!.overrides ?? {}).length
  const isDirty = JSON.stringify(scope === 'admin' ? adminDraft : storefrontDraft)
                !== JSON.stringify(scope === 'admin' ? adminQuery.data : storefrontQuery.data)

  return (
    <div className="flex flex-col gap-5 page-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Link to="/settings" className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] w-fit">
          <ArrowLeft size={14} /> Retour aux réglages
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <ScopePill active={scope === 'admin'}      label="Admin"      onClick={() => setScope('admin')} />
          <ScopePill active={scope === 'storefront'} label="Storefront" onClick={() => setScope('storefront')} />
          <Button variant="ghost" size="sm" onClick={() => setPreview(p => !p)} title="Aperçu en direct">
            {preview ? <Eye size={13} /> : <EyeOff size={13} />} Aperçu
          </Button>
        </div>
      </div>

      <PageHeader
        title="Theme Studio"
        sub={
          scope === 'admin'
            ? `Personnalisation du panneau d'administration · ${overrideCount} override${overrideCount === 1 ? '' : 's'}`
            : `Personnalisation de la vitrine publique · ${overrideCount} override${overrideCount === 1 ? '' : 's'}`
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setDraft({ preset: 'default', overrides: {}, mode: 'dark' })}
            >
              <RotateCcw size={12} /> Réinitialiser
            </Button>
            <Button
              variant="accent" size="sm"
              loading={saveMut.isPending}
              disabled={!isDirty}
              onClick={() => saveMut.mutate({ cfg: draft!, sc: scope })}
            >
              <Save size={12} /> Sauvegarder
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap border-b border-[var(--color-surface-4)] -mt-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
              tab === t.key
                ? 'text-[var(--color-electric-blue)]'
                : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
            }`}
          >
            <t.icon size={12} />
            {t.label}
            {tab === t.key && (
              <motion.div
                layoutId="theme-studio-tab"
                className="absolute -bottom-px left-0 right-0 h-[2px] bg-[var(--color-electric-blue)]"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab + scope}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
        >
          {tab === 'presets'    && <PresetsTab    draft={draft!} setDraft={setDraft} />}
          {tab === 'colors'     && <ColorsTab     draft={draft!} setDraft={setDraft} />}
          {tab === 'typography' && <TypographyTab draft={draft!} setDraft={setDraft} />}
          {tab === 'radius'     && <RadiusTab     draft={draft!} setDraft={setDraft} />}
          {tab === 'effects'    && <EffectsTab    draft={draft!} setDraft={setDraft} />}
          {tab === 'storefront' && <StorefrontTab
                                       admin={adminDraft}
                                       storefront={storefrontDraft}
                                       setStorefrontDraft={setStorefrontDraft}
                                       saveMut={saveMut}
                                    />}
          {tab === 'json'       && <JsonTab       draft={draft!} setDraft={setDraft} scope={scope} />}
        </motion.div>
      </AnimatePresence>

      {/* Live swatch preview strip — always on, regardless of tab */}
      <SwatchStrip draft={draft!} />
    </div>
  )
}


// ── Tabs ────────────────────────────────────────────────────────────────

interface TabProps {
  draft: ThemeConfig
  setDraft: (t: ThemeConfig) => void
}

function PresetsTab({ draft, setDraft }: TabProps) {
  return (
    <Card>
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3 flex items-center gap-2">
        <Sparkles size={12} /> Galerie de presets
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {presetKeys().map(key => {
          const p = PRESETS[key]
          const isActive = draft.preset === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDraft({ ...draft, preset: key, mode: p.mode })}
              className={`relative text-left rounded-2xl overflow-hidden border-2 transition-all ${
                isActive
                  ? 'border-[var(--color-electric-blue)] shadow-[0_0_22px_var(--color-brand-glow)]'
                  : 'border-[var(--color-surface-4)] hover:border-[var(--color-surface-3)]'
              }`}
            >
              {/* Big swatch hero */}
              <div
                className="h-20 relative"
                style={{
                  background: `linear-gradient(135deg, ${p.tokens['--color-bold-blue'] ?? '#1E466B'} 0%, ${p.tokens['--color-electric-blue'] ?? '#3DA9FC'} 60%, ${p.tokens['--color-hot-pink'] ?? '#FF2E7A'} 100%)`,
                }}
              >
                <div className="absolute bottom-2 left-2 flex gap-1">
                  {[
                    p.tokens['--color-bold-blue']     ?? '#1E466B',
                    p.tokens['--color-electric-blue'] ?? '#3DA9FC',
                    p.tokens['--color-neon-yellow']   ?? '#FFD400',
                    p.tokens['--color-hot-pink']      ?? '#FF2E7A',
                  ].map((c, i) => (
                    <span key={i} className="w-3.5 h-3.5 rounded-md ring-1 ring-black/30" style={{ background: c }} />
                  ))}
                </div>
                {isActive && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] flex items-center justify-center">
                    <Check size={12} />
                  </div>
                )}
              </div>
              <div className="p-3 bg-[var(--color-surface-2)]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{p.emoji}</span>
                  <span className="text-xs font-bold text-[var(--color-text-1)]">{p.label}</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-[var(--color-text-3)] uppercase tracking-widest">
                  {p.mode === 'light' ? <Sun size={9} /> : <Moon size={9} />}
                  {p.tags.slice(0, 2).join(' · ')}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Mode toggle (overrides preset's intrinsic mode) */}
      <div className="mt-4 pt-4 border-t border-[var(--color-surface-4)] flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">color-scheme</div>
          <div className="text-xs text-[var(--color-text-2)] mt-0.5">
            Force le mode pour les contrôles natifs (scrollbar, autofill, &lt;input&gt; date).
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant={draft.mode === 'dark' ? 'accent' : 'ghost'} size="sm" onClick={() => setDraft({ ...draft, mode: 'dark' })}>
            <Moon size={12} /> Dark
          </Button>
          <Button variant={draft.mode === 'light' ? 'accent' : 'ghost'} size="sm" onClick={() => setDraft({ ...draft, mode: 'light' })}>
            <Sun size={12} /> Light
          </Button>
        </div>
      </div>
    </Card>
  )
}


function ColorsTab({ draft, setDraft }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      {(['palette', 'surface', 'text', 'status', 'background'] as TokenGroup[]).map(g => (
        <Card key={g}>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
            {GROUP_LABELS[g]}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {tokensInGroup(g).map(t => (
              <ColorTokenRow key={t.key} t={t} draft={draft} setDraft={setDraft} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}


function TypographyTab({ draft, setDraft }: TabProps) {
  return (
    <Card>
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
        Familles de police
      </h3>
      <div className="flex flex-col gap-3">
        {tokensInGroup('typography').map(t => {
          const value = draft.overrides?.[t.key] ?? ''
          return (
            <div key={t.key} className="glass-sm p-3">
              <div className="flex items-baseline justify-between mb-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                  {t.label}
                </label>
                {value && (
                  <button
                    onClick={() => setDraft(withOverride(draft, t.key, undefined))}
                    className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)]"
                  >
                    Reset
                  </button>
                )}
              </div>
              <input
                type="text"
                value={value}
                onChange={e => setDraft(withOverride(draft, t.key, e.target.value))}
                placeholder={t.fallback}
                className="w-full h-9 px-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-xs font-mono outline-none transition-colors"
              />
              <div
                className="mt-2 text-base"
                style={{ fontFamily: value || t.fallback }}
              >
                Ghir Laffaire — Aperçu de la police · The quick brown fox jumps · 1234567890
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}


function RadiusTab({ draft, setDraft }: TabProps) {
  return (
    <Card>
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
        Échelle de rayons
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tokensInGroup('radius').filter(t => t.key !== '--radius-full').map(t => (
          <NumericTokenRow key={t.key} t={t} draft={draft} setDraft={setDraft} />
        ))}
      </div>

      {/* Visualizer */}
      <div className="mt-5 pt-5 border-t border-[var(--color-surface-4)]">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-3">Aperçu</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {tokensInGroup('radius').filter(t => t.key !== '--radius-full').map(t => {
            const v = draft.overrides?.[t.key] ?? t.fallback
            return (
              <div key={t.key} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-full h-16 bg-gradient-to-br from-[var(--color-electric-blue)] to-[var(--color-hot-pink)]"
                  style={{ borderRadius: v }}
                />
                <div className="text-[10px] text-[var(--color-text-3)] num">{t.label.split('·')[1]?.trim() ?? t.label}</div>
                <div className="text-[10px] text-[var(--color-text-1)] num">{v}</div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}


function EffectsTab({ draft, setDraft }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
          Verre liquide (Liquid Glass)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tokensInGroup('glass').map(t => (
            <NumericTokenRow key={t.key} t={t} draft={draft} setDraft={setDraft} />
          ))}
        </div>
        <div className="mt-4 glass p-4 text-xs text-[var(--color-text-2)]">
          <div className="font-bold text-[var(--color-text-1)] text-sm mb-1">Aperçu en direct</div>
          Cette carte est rendue avec votre verre actuel. Augmentez le flou et la saturation pour un effet plus "Apple Vision".
        </div>
      </Card>

      <Card>
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
          Mouvement
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tokensInGroup('motion').map(t => (
            <NumericTokenRow key={t.key} t={t} draft={draft} setDraft={setDraft} />
          ))}
        </div>
        <div className="text-[11px] text-[var(--color-text-3)] mt-3 italic">
          Note: les composants utilisent ces durées via <code className="bg-[var(--color-surface-3)] px-1 rounded">var(--duration-base)</code>. Les transitions inline non-tokenisées ne suivent pas.
        </div>
      </Card>
    </div>
  )
}


function StorefrontTab({
  admin, storefront, setStorefrontDraft, saveMut,
}: {
  admin:      ThemeConfig | null
  storefront: ThemeConfig | null
  setStorefrontDraft: (t: ThemeConfig) => void
  saveMut: ReturnType<typeof useMutation<ThemeConfig, Error, { cfg: ThemeConfig; sc: ThemeScope }>>
}) {
  // Iframe preview wiring (Push 3 stress-test fix #5/6).
  //
  // The iframe loads the public storefront (via the Vite dev proxy in dev,
  // or a same-origin path in prod). On mount, the storefront calls
  // bindPreviewChannel() and sends `gl:theme:preview-ready`. We then post
  // the current storefront draft via postMessage on every change so the
  // admin sees the actual public site repaint without saving.
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeReady, setIframeReady] = useState(false)
  const [showPreview, setShowPreview] = useState(true)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'gl:theme:preview-ready') setIframeReady(true)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Push the current draft to the iframe whenever it changes (debounced).
  useEffect(() => {
    if (!iframeReady || !storefront) return
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const t = setTimeout(() => {
      try {
        win.postMessage({ type: 'gl:theme:preview', theme: storefront }, '*')
      } catch { /* noop */ }
    }, 80)
    return () => clearTimeout(t)
  }, [storefront, iframeReady])

  if (!storefront) return null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2">
              <Globe size={14} className="text-[var(--color-electric-blue)]" />
              Thème de la vitrine publique
            </h3>
            <p className="text-xs text-[var(--color-text-3)] mt-1 leading-relaxed">
              Aperçu en direct dans l'iframe ci-dessous : chaque preset/override est envoyé via <code className="bg-[var(--color-surface-3)] px-1 rounded text-[10px]">postMessage</code> sans toucher au serveur.
              Cliquez "Publier" pour persister.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant="ghost" size="sm"
              onClick={() => setShowPreview(v => !v)}
              title={showPreview ? "Masquer l'aperçu" : 'Afficher l\'aperçu'}
            >
              {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
              {showPreview ? 'Masquer' : 'Afficher'}
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={!admin}
              onClick={() => admin && setStorefrontDraft({ ...admin })}
              title="Copier le thème admin vers le storefront"
            >
              <ArrowLeftRight size={12} /> Copier admin → storefront
            </Button>
            <a href="http://localhost:5173" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm">
                <Globe size={12} /> Ouvrir
              </Button>
            </a>
          </div>
        </div>
      </Card>

      {/* Quick preset row for storefront */}
      <Card>
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
          Preset storefront actuel · <span className="text-[var(--color-electric-blue)]">{PRESETS[storefront.preset]?.label ?? storefront.preset}</span>
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
          {presetKeys().map(key => {
            const p = PRESETS[key]
            const isActive = storefront.preset === key
            return (
              <button
                key={key}
                onClick={() => setStorefrontDraft({ ...storefront, preset: key, mode: p.mode })}
                className={`relative h-14 rounded-lg overflow-hidden border-2 transition-all ${
                  isActive ? 'border-[var(--color-electric-blue)]' : 'border-[var(--color-surface-4)] hover:border-[var(--color-surface-3)]'
                }`}
                style={{
                  background: `linear-gradient(135deg, ${p.tokens['--color-bold-blue'] ?? '#1E466B'} 0%, ${p.tokens['--color-electric-blue'] ?? '#3DA9FC'} 60%, ${p.tokens['--color-hot-pink'] ?? '#FF2E7A'} 100%)`,
                }}
                title={p.label}
              >
                <span className="absolute inset-0 flex items-center justify-center text-base">{p.emoji}</span>
                {isActive && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-[var(--color-electric-blue)] rounded-full flex items-center justify-center text-[var(--color-jet-black)]">
                    <Check size={9} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      {/* Live iframe preview */}
      {showPreview && (
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-surface-4)] bg-[var(--color-surface-3)]/50">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              <Globe size={11} />
              Aperçu storefront — postMessage
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span
                className="inline-flex w-2 h-2 rounded-full"
                style={{ background: iframeReady ? 'var(--color-success)' : 'var(--color-text-3)' }}
              />
              <span className="text-[var(--color-text-3)]">
                {iframeReady ? 'Prêt — modifications appliquées en direct' : 'Connexion à la vitrine…'}
              </span>
            </div>
          </div>
          <div className="bg-[var(--color-surface-1)]" style={{ height: 'min(640px, 70vh)' }}>
            <iframe
              ref={iframeRef}
              src="http://localhost:5173/?theme-preview=1"
              title="Aperçu storefront"
              className="w-full h-full block"
              // Sandboxing: allow scripts (the SPA needs JS) and same-origin
              // (so it can fetch /api/v1/* through the same proxy). No allow-forms,
              // allow-popups, etc — preview is read-only.
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </Card>
      )}

      {/* Save action */}
      <div className="flex items-center justify-end">
        <Button
          variant="accent" size="sm"
          loading={saveMut.isPending}
          onClick={() => saveMut.mutate({ cfg: storefront, sc: 'storefront' })}
        >
          <Save size={12} /> Publier sur la vitrine
        </Button>
      </div>
    </div>
  )
}


function JsonTab({ draft, setDraft, scope }: TabProps & { scope: ThemeScope }) {
  const json = useMemo(() => exportThemeJson(draft), [draft])
  const [importVal, setImportVal] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      toast.success('JSON copié')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Impossible de copier')
    }
  }

  const onDownload = () => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gl-theme-${scope}-${draft.preset}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = () => {
    try {
      const cfg = importThemeJson(importVal)
      setDraft(cfg)
      setImportVal('')
      setImportError(null)
      toast.success('Thème importé — n\'oubliez pas de sauvegarder')
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const cfg = importThemeJson(String(reader.result))
        setDraft(cfg)
        toast.success('Thème importé depuis le fichier')
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
      }
    }
    reader.readAsText(f)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)]">
            Export
          </h3>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onCopy}>
              {copied ? <Check size={12} /> : <Copy size={12} />} Copier
            </Button>
            <Button variant="ghost" size="sm" onClick={onDownload}>
              <Download size={12} /> Télécharger
            </Button>
          </div>
        </div>
        <pre className="bg-[var(--color-surface-3)] rounded-lg p-3 text-[11px] font-mono text-[var(--color-text-2)] overflow-auto max-h-96 leading-relaxed">
{json}
        </pre>
      </Card>

      <Card>
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-3">
          Import
        </h3>
        <textarea
          value={importVal}
          onChange={e => { setImportVal(e.target.value); setImportError(null) }}
          placeholder='{ "preset": "midnight", "overrides": { "--color-electric-blue": "#56CCF2" } }'
          className="w-full h-48 p-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-[11px] font-mono outline-none resize-none"
        />
        {importError && (
          <div className="mt-2 text-[11px] text-[var(--color-hot-pink)] bg-[var(--color-hot-pink)]/10 border border-[var(--color-hot-pink)]/20 px-2 py-1.5 rounded">
            {importError}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-3">
          <label className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] cursor-pointer flex items-center gap-1.5">
            <Upload size={12} />
            <span>…ou choisir un fichier .json</span>
            <input type="file" accept="application/json" className="hidden" onChange={onFile} />
          </label>
          <Button variant="outline" size="sm" disabled={!importVal.trim()} onClick={onImport}>
            <RefreshCw size={12} /> Appliquer
          </Button>
        </div>
      </Card>
    </div>
  )
}


// ── Reusable token rows ──────────────────────────────────────────────────

function ColorTokenRow({ t, draft, setDraft }: TabProps & { t: TokenSpec }) {
  const overrideVal = draft.overrides?.[t.key]
  const liveVal     = overrideVal ?? resolveTheme(draft)[t.key] ?? t.fallback
  return (
    <div className="glass-sm p-2.5 flex items-center gap-2.5">
      <input
        type="color"
        value={normaliseHex(liveVal)}
        onChange={e => setDraft(withOverride(draft, t.key, e.target.value))}
        className="w-9 h-9 rounded-md cursor-pointer border-2 border-[var(--color-surface-4)] bg-transparent shrink-0"
        title={t.label}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-2)]">
          {t.label}
        </div>
        <input
          type="text"
          value={overrideVal ?? ''}
          placeholder={liveVal}
          onChange={e => setDraft(withOverride(draft, t.key, e.target.value))}
          className="bg-transparent w-full text-[11px] font-mono text-[var(--color-text-3)] outline-none focus:text-[var(--color-text-1)] truncate"
        />
      </div>
      {overrideVal && (
        <button
          type="button"
          onClick={() => setDraft(withOverride(draft, t.key, undefined))}
          className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] shrink-0"
          title="Reset to preset/default"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  )
}


function NumericTokenRow({ t, draft, setDraft }: TabProps & { t: TokenSpec }) {
  const overrideVal = draft.overrides?.[t.key]
  const liveStr     = overrideVal ?? resolveTheme(draft)[t.key] ?? t.fallback
  const liveNum     = parseNumeric(liveStr)
  const range = t.range
  if (!range) {
    // Tokens like radius-full don't have a range — render as text only
    return (
      <div className="glass-sm p-2.5">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-2)] mb-1">{t.label}</div>
        <input
          type="text"
          value={overrideVal ?? ''}
          placeholder={liveStr}
          onChange={e => setDraft(withOverride(draft, t.key, e.target.value))}
          className="w-full h-8 px-2 rounded bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] text-[11px] font-mono outline-none"
        />
      </div>
    )
  }
  const onSlider = (n: number) => {
    const fmt = range.unit ? `${n}${range.unit}` : String(n)
    setDraft(withOverride(draft, t.key, fmt))
  }
  return (
    <div className="glass-sm p-2.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-2)]">{t.label}</span>
        <div className="flex items-center gap-1.5">
          <span className="num text-[10px] text-[var(--color-electric-blue)]">{liveStr}</span>
          {overrideVal && (
            <button
              onClick={() => setDraft(withOverride(draft, t.key, undefined))}
              className="text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)]"
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={range.min} max={range.max} step={range.step}
        value={liveNum ?? range.min}
        onChange={e => onSlider(Number(e.target.value))}
        className="w-full accent-[var(--color-electric-blue)]"
      />
    </div>
  )
}


// ── Misc ─────────────────────────────────────────────────────────────────

function ScopePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border transition-all ${
        active
          ? 'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] border-[var(--color-electric-blue)]'
          : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
      }`}
    >
      {label}
    </button>
  )
}


function SwatchStrip({ draft }: { draft: ThemeConfig }) {
  const resolved = useMemo(() => resolveTheme(draft), [draft])
  const stripKeys = [
    '--color-bold-blue',
    '--color-electric-blue',
    '--color-neon-yellow',
    '--color-hot-pink',
    '--color-success',
    '--color-warning',
    '--color-danger',
    '--color-info',
    '--color-surface-0',
    '--color-surface-2',
    '--color-surface-4',
    '--color-text-1',
  ]
  return (
    <div className="glass-sm p-2 flex gap-1 overflow-x-auto">
      {stripKeys.map(k => (
        <div key={k} title={k} className="flex flex-col items-center gap-1 shrink-0 w-16">
          <div
            className="w-full h-8 rounded ring-1 ring-black/20"
            style={{ background: resolved[k] }}
          />
          <span className="num text-[9px] text-[var(--color-text-3)] truncate w-full text-center">
            {k.replace('--color-', '')}
          </span>
        </div>
      ))}
    </div>
  )
}


const GROUP_LABELS: Record<TokenGroup, string> = {
  palette:   'Palette de marque',
  surface:   'Surfaces (du fond aux bordures)',
  text:      'Échelle de texte',
  status:    'Couleurs sémantiques',
  typography:'Typographie',
  radius:    'Rayons',
  glass:     'Verre liquide',
  motion:    'Mouvement',
  background:'Halos d\'arrière-plan',
}
