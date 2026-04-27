import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Cpu, Wifi, WifiOff, AlertTriangle, CheckCircle2, Save, Eye, EyeOff,
  Sparkles, RotateCcw, Palette, ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchLLMConfig, saveLLMConfig, pingLLM, enqueueIntelBulk, fetchIntelBatch,
  fetchTheme, saveTheme,
  type LLMConfig, type LLMConfigInput, type LLMKind, type LLMPing,
} from '@/lib/api'
import { PRESETS, applyTheme } from '@/lib/theme'
import { Button, Card, Input, PageHeader, Select, Spinner } from '@/components/ui'

const KIND_OPTIONS: { value: LLMKind; label: string; hint: string }[] = [
  { value: 'ollama',         label: 'Ollama (local)',          hint: 'http://host.docker.internal:11434' },
  { value: 'openai_compat',  label: 'OpenAI-compatible',       hint: 'LM Studio, vLLM, OpenAI itself, etc.' },
  { value: 'anthropic',      label: 'Anthropic',                hint: 'Native /v1/messages' },
]

const DEFAULT_ENDPOINTS: Record<LLMKind, string> = {
  ollama:        'http://host.docker.internal:11434',
  openai_compat: 'http://host.docker.internal:1234/v1',
  anthropic:     'https://api.anthropic.com',
}

const SUGGESTED_MODELS: Record<LLMKind, string[]> = {
  ollama:        ['llama3.1:8b', 'llama3.2:3b', 'mistral:7b', 'qwen2.5:7b', 'gemma2:9b'],
  openai_compat: ['gpt-4o-mini', 'gpt-4o', 'local-model'],
  anthropic:     ['claude-sonnet-4-5', 'claude-haiku-4-1', 'claude-opus-4-1'],
}

export default function Settings() {
  const qc = useQueryClient()

  const cfgQuery = useQuery({ queryKey: ['llm-config'], queryFn: fetchLLMConfig })

  const [form, setForm] = useState<LLMConfigInput | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [touched, setTouched] = useState(false)
  const [pingResult, setPingResult] = useState<LLMPing | null>(null)

  // Hydrate form from server config once
  useEffect(() => {
    if (!form && cfgQuery.data) {
      const c = cfgQuery.data
      setForm({
        kind: c.kind,
        endpoint: c.endpoint,
        model: c.model,
        api_key: '',                      // empty = keep existing on save
        temperature: c.temperature,
        max_tokens: c.max_tokens,
        timeout_seconds: c.timeout_seconds,
        json_mode: c.json_mode,
      })
    }
  }, [cfgQuery.data, form])

  const saveMut = useMutation({
    mutationFn: (cfg: LLMConfigInput) => saveLLMConfig(cfg),
    onSuccess: (saved) => {
      toast.success('LLM config saved')
      setTouched(false)
      qc.setQueryData(['llm-config'], saved)
      setPingResult(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pingMut = useMutation({
    mutationFn: () => pingLLM(),
    onSuccess: (r) => {
      setPingResult(r)
      if (r.online) toast.success(`${r.kind} reachable · ${r.models.length} models`)
      else          toast.error(r.error || 'LLM unreachable')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [activeBatch, setActiveBatch] = useState<string | null>(null)

  const bulkMut = useMutation({
    mutationFn: (target: 'missing_brand' | 'needs_fix' | 'all_active') => {
      if (target === 'missing_brand') return enqueueIntelBulk({ missing_brand: true, limit: 200 })
      if (target === 'needs_fix')     return enqueueIntelBulk({ only_status: ['NEEDS_FIX'], limit: 200 })
      return enqueueIntelBulk({ only_status: ['CLASSIFIED','NORMALIZED'], limit: 200 })
    },
    onSuccess: (r) => {
      if (!r.batch_id || r.queued === 0) {
        toast(`Aucun produit à enrichir (${r.matched} matched, ${r.skipped_in_flight} déjà en cours)`)
        return
      }
      toast.success(`${r.queued} job(s) en file · batch ${r.batch_id.slice(0, 8)}`)
      setActiveBatch(r.batch_id)
      qc.invalidateQueries({ queryKey: ['jobs-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const batchProgress = useQuery({
    queryKey: ['intel-batch', activeBatch],
    queryFn: () => fetchIntelBatch(activeBatch!),
    enabled: !!activeBatch,
    refetchInterval: (q) => {
      const data = q.state.data
      return data && !data.is_terminal ? 3000 : false
    },
  })

  // When batch finishes, refresh dependent data
  useEffect(() => {
    if (batchProgress.data?.is_terminal && activeBatch) {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['enrichment-stats'] })
      qc.invalidateQueries({ queryKey: ['issues-summary'] })
      qc.invalidateQueries({ queryKey: ['catalog-graph'] })
    }
  }, [batchProgress.data?.is_terminal, activeBatch, qc])

  const setField = <K extends keyof LLMConfigInput>(k: K, v: LLMConfigInput[K]) => {
    setForm(prev => (prev ? { ...prev, [k]: v } : prev))
    setTouched(true)
  }

  const onKindChange = (k: LLMKind) => {
    setForm(prev => prev ? {
      ...prev,
      kind: k,
      // Auto-suggest endpoint if user is on the default for previous kind
      endpoint: prev.endpoint === DEFAULT_ENDPOINTS[prev.kind] ? DEFAULT_ENDPOINTS[k] : prev.endpoint,
    } : prev)
    setTouched(true)
  }

  const onReset = () => {
    if (cfgQuery.data) {
      setForm({
        kind: cfgQuery.data.kind,
        endpoint: cfgQuery.data.endpoint,
        model: cfgQuery.data.model,
        api_key: '',
        temperature: cfgQuery.data.temperature,
        max_tokens: cfgQuery.data.max_tokens,
        timeout_seconds: cfgQuery.data.timeout_seconds,
        json_mode: cfgQuery.data.json_mode,
      })
      setTouched(false)
      setPingResult(null)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    saveMut.mutate(form)
  }

  if (cfgQuery.isPending || !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} className="text-[var(--color-electric-blue)]" />
      </div>
    )
  }

  const cfg: LLMConfig = cfgQuery.data!
  const apiKeyRequired = form.kind !== 'ollama'

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader
        title="Settings"
        sub="Apparence · LLM enrichment backend · ping it · roll out"
      />

      {/* Theme — outside the LLM form so saving the LLM config doesn't accidentally roll back theme changes */}
      <ThemeCard />

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {/* Backend */}
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <Cpu size={13} className="text-[var(--color-electric-blue)]" /> Backend
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {KIND_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onKindChange(opt.value)}
                className={`text-left p-3 rounded-xl border transition-colors ${
                  form.kind === opt.value
                    ? 'bg-[var(--color-electric-blue)]/10 border-[var(--color-electric-blue)]/40'
                    : 'border-[var(--color-surface-4)] hover:border-[var(--color-surface-3)]'
                }`}
              >
                <div className="text-sm font-bold text-[var(--color-text-1)]">{opt.label}</div>
                <div className="text-[10px] text-[var(--color-text-3)] mt-1 truncate font-mono">{opt.hint}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Endpoint"
              value={form.endpoint}
              onChange={e => setField('endpoint', e.target.value)}
              placeholder={DEFAULT_ENDPOINTS[form.kind]}
            />
            <ModelInput
              kind={form.kind}
              value={form.model}
              suggestions={pingResult?.online ? pingResult.models : SUGGESTED_MODELS[form.kind]}
              onChange={v => setField('model', v)}
            />
          </div>

          {/* API key (collapsed for ollama) */}
          {apiKeyRequired && (
            <div className="mt-4">
              <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
                API key {cfg.api_key_set && '(stored — leave blank to keep)'}
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={form.api_key ?? ''}
                  onChange={e => setField('api_key', e.target.value)}
                  placeholder={cfg.api_key_set ? '•••••••• (saved)' : 'Paste API key'}
                  className="h-10 w-full pl-3 pr-10 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] outline-none transition-colors font-mono"
                />
                <button
                  type="button" tabIndex={-1}
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)]"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Generation params */}
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-4">
            Generation
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Input
              label="Temperature"
              type="number" step={0.05} min={0} max={2}
              value={form.temperature}
              onChange={e => setField('temperature', Number(e.target.value))}
            />
            <Input
              label="Max tokens"
              type="number" min={64} max={32000}
              value={form.max_tokens}
              onChange={e => setField('max_tokens', Number(e.target.value))}
            />
            <Input
              label="Timeout (sec)"
              type="number" min={5} max={600}
              value={form.timeout_seconds}
              onChange={e => setField('timeout_seconds', Number(e.target.value))}
            />
            <Select
              label="JSON mode"
              value={form.json_mode ? '1' : '0'}
              onChange={e => setField('json_mode', e.target.value === '1')}
            >
              <option value="1">On</option>
              <option value="0">Off</option>
            </Select>
          </div>
        </Card>

        {/* Status / ping */}
        <PingCard ping={pingResult} loading={pingMut.isPending} onPing={() => pingMut.mutate()} />

        {/* Bulk Full Intel — scrape + LLM + merge as background worker */}
        <Card>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <h3 className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2 uppercase tracking-wide">
                <Sparkles size={14} className="text-[var(--color-neon-yellow)]" />
                Bulk Full Intel · scrape + LLM
              </h3>
              <p className="text-xs text-[var(--color-text-3)] mt-1 leading-relaxed">
                Queue les produits pour un cycle complet : recherche web → LLM → merge.
                Tourne dans <code className="text-[10px] bg-[var(--color-surface-3)] px-1 rounded">intel_worker</code>.
                ~30-90s par produit. Suivez la progression en bas, ou via <code className="text-[10px] bg-[var(--color-surface-3)] px-1 rounded">/jobs</code>.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button" variant="accent"
              loading={bulkMut.isPending}
              onClick={() => bulkMut.mutate('missing_brand')}
              disabled={!pingResult?.online && !cfg.api_key_set && form.kind !== 'ollama'}
            >
              <Sparkles size={13} /> Marques manquantes
            </Button>
            <Button
              type="button" variant="outline"
              loading={bulkMut.isPending}
              onClick={() => bulkMut.mutate('needs_fix')}
              disabled={!pingResult?.online && !cfg.api_key_set && form.kind !== 'ollama'}
            >
              NEEDS_FIX uniquement
            </Button>
            <Button
              type="button" variant="ghost"
              loading={bulkMut.isPending}
              onClick={() => bulkMut.mutate('all_active')}
              disabled={!pingResult?.online && !cfg.api_key_set && form.kind !== 'ollama'}
            >
              Tous (CLASSIFIED + NORMALIZED)
            </Button>
          </div>

          {/* Live batch progress */}
          {batchProgress.data && (
            <div className="mt-5 glass-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-3)]">
                  Batch {(activeBatch ?? '').slice(0, 8)} · {batchProgress.data.is_terminal ? 'Terminé' : 'En cours'}
                </div>
                {!batchProgress.data.is_terminal && (
                  <Spinner size={14} className="text-[var(--color-electric-blue)]" />
                )}
              </div>

              {/* Progress bar */}
              <div className="relative h-2 rounded-full bg-[var(--color-surface-4)] overflow-hidden mb-3">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${batchProgress.data.percent_done}%` }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    background: batchProgress.data.failed > 0
                      ? 'linear-gradient(90deg, var(--color-electric-blue), var(--color-hot-pink))'
                      : 'linear-gradient(90deg, var(--color-electric-blue), var(--color-neon-yellow))',
                  }}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat label="Total"     value={batchProgress.data.total}     accent="muted" />
                <Stat label="Enrichis"  value={batchProgress.data.completed} accent="emerald" />
                <Stat label="En cours"  value={batchProgress.data.running + batchProgress.data.pending} accent="yellow" />
                <Stat label="Échecs"    value={batchProgress.data.failed}    accent={batchProgress.data.failed > 0 ? 'pink' : 'muted'} />
              </div>

              {batchProgress.data.is_terminal && batchProgress.data.completed > 0 && (
                <div className="mt-3 text-[11px] text-[var(--color-text-3)] flex items-center gap-3 flex-wrap">
                  <span>
                    Δ complétude moyenne : <span className="num font-bold text-emerald-400">
                      +{Math.round(batchProgress.data.avg_completeness_delta * 100)}%
                    </span>
                  </span>
                  <span>
                    Images ajoutées : <span className="num font-bold text-[var(--color-neon-yellow)]">
                      {batchProgress.data.images_added}
                    </span>
                    <span className="text-[var(--color-text-3)] italic"> (en attente de validation)</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Submit row */}
        <div className="flex items-center justify-end gap-3 sticky bottom-4 z-10">
          <Button type="button" variant="ghost" onClick={onReset} disabled={!touched || saveMut.isPending}>
            <RotateCcw size={13} /> Reset
          </Button>
          <Button type="button" variant="outline" loading={pingMut.isPending} onClick={() => pingMut.mutate()}>
            <Wifi size={13} /> Test connection
          </Button>
          <Button type="submit" variant="accent" loading={saveMut.isPending} disabled={!touched}>
            <Save size={13} /> Save settings
          </Button>
        </div>
      </form>
    </div>
  )
}


// ── Sub-components ──────────────────────────────────────────────────────────

function ModelInput({
  kind, value, suggestions, onChange,
}: {
  kind: LLMKind
  value: string
  suggestions: string[]
  onChange: (v: string) => void
}) {
  const listId = useMemo(() => `model-options-${kind}`, [kind])
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
        Model {suggestions.length > 0 && <span className="text-[var(--color-electric-blue)] normal-case font-medium">· {suggestions.length} options</span>}
      </label>
      <input
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. llama3.1:8b"
        className="h-10 px-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] outline-none transition-colors font-mono"
      />
      <datalist id={listId}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  )
}


function PingCard({ ping, loading, onPing }: { ping: LLMPing | null; loading: boolean; onPing: () => void }) {
  return (
    <Card>
      <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-3">
        Status
      </h3>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div key="loading" className="flex items-center gap-3 py-2"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Spinner size={16} className="text-[var(--color-electric-blue)]" />
            <span className="text-sm text-[var(--color-text-3)]">Pinging endpoint…</span>
          </motion.div>
        ) : ping ? (
          <motion.div key={ping.online ? 'on' : 'off'}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-start gap-3"
          >
            {ping.online
              ? <CheckCircle2 size={20} className="text-emerald-400 mt-0.5 shrink-0" />
              : <WifiOff size={20} className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[var(--color-text-1)]">
                {ping.online ? 'Online' : 'Unreachable'}
              </div>
              <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                {ping.kind} · <span className="font-mono">{ping.endpoint}</span>
              </div>
              {ping.error && (
                <div className="mt-2 text-xs text-[var(--color-hot-pink)] bg-[var(--color-hot-pink)]/10 border border-[var(--color-hot-pink)]/20 px-2 py-1.5 rounded font-mono">
                  {ping.error.slice(0, 200)}
                </div>
              )}
              {ping.online && ping.models.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ping.models.slice(0, 16).map(m => (
                    <span key={m} className="px-2 py-0.5 rounded-md bg-[var(--color-surface-3)] text-[10px] font-mono text-[var(--color-text-2)]">
                      {m}
                    </span>
                  ))}
                  {ping.models.length > 16 && (
                    <span className="text-[10px] text-[var(--color-text-3)] self-center">+{ping.models.length - 16} more</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="empty" className="flex items-center gap-3 py-2"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <AlertTriangle size={16} className="text-[var(--color-text-3)]" />
            <span className="text-sm text-[var(--color-text-3)]">Click "Test connection" to ping the endpoint and discover models.</span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={onPing}>
          <Wifi size={12} /> Test connection
        </Button>
      </div>
    </Card>
  )
}


function Stat({ label, value, accent }: { label: string; value: number | string; accent: 'emerald' | 'pink' | 'yellow' | 'muted' }) {
  const accentColor = {
    emerald: 'var(--color-success)',
    pink:    'var(--color-hot-pink)',
    yellow:  'var(--color-neon-yellow)',
    muted:   'var(--color-text-3)',
  }[accent]
  return (
    <div className="glass-sm p-2.5 flex flex-col gap-0.5 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accentColor }} />
      <div className="text-[9px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.18em]">{label}</div>
      <div className="text-base font-black num text-[var(--color-text-1)]">{value}</div>
    </div>
  )
}


// ── Theme studio entry card (Phase 9 Push 3) ───────────────────────────────
//
// The full editor lives at /settings/theme. This card is just a shortcut +
// quick preset switcher so you don't have to navigate for a one-click swap.

function ThemeCard() {
  const qc = useQueryClient()
  const adminThemeQuery      = useQuery({ queryKey: ['theme', 'admin'],      queryFn: () => fetchTheme('admin') })
  const storefrontThemeQuery = useQuery({ queryKey: ['theme', 'storefront'], queryFn: () => fetchTheme('storefront') })

  const adminTheme      = adminThemeQuery.data
  const storefrontTheme = storefrontThemeQuery.data

  // Quick preset switcher → save + apply on click. Same pattern as ThemeSwitcher
  // in the sidebar — preserves any per-token overrides the admin already set.
  const presetMut = useMutation({
    mutationFn: ({ presetKey }: { presetKey: string }) => {
      if (!adminTheme) throw new Error('Theme not loaded')
      const p = PRESETS[presetKey]
      return saveTheme({
        preset: presetKey,
        overrides: adminTheme.overrides ?? {},
        mode: p?.mode,
      }, 'admin')
    },
    onSuccess: (saved) => {
      qc.setQueryData(['theme', 'admin'], saved)
      applyTheme(saved, 'admin')
      toast.success(`Thème : ${PRESETS[saved.preset]?.label ?? saved.preset}`, { icon: '🎨', duration: 1500 })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (adminThemeQuery.isPending || !adminTheme) {
    return (
      <Card>
        <div className="flex items-center gap-3 py-2">
          <Palette size={14} className="text-[var(--color-electric-blue)]" />
          <Spinner size={14} className="text-[var(--color-electric-blue)]" />
          <span className="text-sm text-[var(--color-text-3)]">Chargement du thème…</span>
        </div>
      </Card>
    )
  }

  const adminPreset      = PRESETS[adminTheme.preset]
  const storefrontPreset = storefrontTheme ? PRESETS[storefrontTheme.preset] : null

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2 uppercase tracking-wide">
            <Palette size={14} className="text-[var(--color-electric-blue)]" />
            Apparence · Thèmes admin & vitrine
          </h3>
          <p className="text-xs text-[var(--color-text-3)] mt-1 leading-relaxed">
            Le studio complet contrôle couleurs, typo, rayons, verre liquide et mouvement — séparément pour l'admin et la vitrine.
          </p>
        </div>
        <Link to="/settings/theme">
          <Button type="button" variant="accent" size="sm">
            Ouvrir le studio <ArrowRight size={12} />
          </Button>
        </Link>
      </div>

      {/* Two scope summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ScopeSummaryCard
          label="Thème admin"
          preset={adminPreset}
          presetKey={adminTheme.preset}
          overrides={adminTheme.overrides}
          updatedAt={adminTheme.updated_at}
        />
        <ScopeSummaryCard
          label="Thème storefront"
          preset={storefrontPreset}
          presetKey={storefrontTheme?.preset ?? 'default'}
          overrides={storefrontTheme?.overrides ?? {}}
          updatedAt={storefrontTheme?.updated_at}
        />
      </div>

      <div className="mt-4 text-[11px] text-[var(--color-text-3)] flex items-center gap-2">
        <Sparkles size={11} className="text-[var(--color-neon-yellow)]" />
        Astuce : utilisez le sélecteur de thème dans la sidebar pour basculer rapidement.
      </div>

      {/* Quick preset switcher (admin only — fires save on click) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([key, p]) => {
          const isActive = adminTheme.preset === key
          return (
            <button
              key={key}
              type="button"
              disabled={presetMut.isPending}
              onClick={() => presetMut.mutate({ presetKey: key })}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all disabled:opacity-50 ${
                isActive
                  ? 'border-[var(--color-electric-blue)] bg-[var(--color-electric-blue)]/10 text-[var(--color-electric-blue)]'
                  : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:border-[var(--color-surface-3)]'
              }`}
              title={p.label}
            >
              <span>{p.emoji}</span>
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}


function ScopeSummaryCard({
  label, preset, presetKey, overrides, updatedAt,
}: {
  label: string
  preset: typeof PRESETS[keyof typeof PRESETS] | null
  presetKey: string
  overrides: Record<string, string>
  updatedAt?: string | null
}) {
  const overrideCount = Object.keys(overrides ?? {}).length
  return (
    <div className="glass-sm p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)]">{label}</span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{preset?.emoji ?? '🎨'}</span>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-[var(--color-text-1)] truncate">
            {preset?.label ?? presetKey}
          </span>
          <span className="text-[10px] text-[var(--color-text-3)]">
            {overrideCount} override{overrideCount === 1 ? '' : 's'}
            {updatedAt && ` · maj ${new Date(updatedAt).toLocaleDateString()}`}
          </span>
        </div>
      </div>
      <div className="flex gap-1">
        {[
          preset?.tokens['--color-bold-blue']     ?? '#1E466B',
          preset?.tokens['--color-electric-blue'] ?? '#3DA9FC',
          preset?.tokens['--color-neon-yellow']   ?? '#FFD400',
          preset?.tokens['--color-hot-pink']      ?? '#FF2E7A',
          preset?.tokens['--color-jet-black']     ?? '#0D0D0D',
        ].map((c, i) => (
          <span key={i} className="w-5 h-5 rounded ring-1 ring-black/20" style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}
