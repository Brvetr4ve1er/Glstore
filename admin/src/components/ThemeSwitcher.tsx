/**
 * ThemeSwitcher — compact preset switcher for the admin sidebar.
 *
 * Lets the user cycle the admin theme without navigating to /settings/theme.
 * Click → toggle dropdown → click a preset → applies + saves to server.
 *
 * Saving on click (rather than just live-applying) is intentional: we want
 * the choice to persist across reloads and across devices. The full Theme
 * Studio handles the rich edit case (overrides, JSON, etc.).
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette, Check, Settings, Sun, Moon } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchTheme, saveTheme, type ThemeConfig } from '@/lib/api'
import { PRESETS, applyTheme } from '@/lib/theme'


export function ThemeSwitcher() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const { data: theme } = useQuery({ queryKey: ['theme', 'admin'], queryFn: () => fetchTheme('admin') })

  const saveMut = useMutation({
    mutationFn: (cfg: ThemeConfig) => saveTheme(cfg, 'admin'),
    onSuccess: (saved) => {
      qc.setQueryData(['theme', 'admin'], saved)
      applyTheme(saved, 'admin')
      toast.success(`Thème : ${PRESETS[saved.preset]?.label ?? saved.preset}`, { icon: '🎨', duration: 1500 })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const onPick = (presetKey: string) => {
    if (!theme) return
    const p = PRESETS[presetKey]
    saveMut.mutate({
      preset: presetKey,
      overrides: theme.overrides ?? {},   // preserve user's per-token tweaks
      mode: p?.mode,
    })
  }

  const current = theme ? PRESETS[theme.preset] : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-4)] border border-[var(--color-surface-4)] transition-colors text-left"
        title="Changer de thème"
      >
        <Palette size={14} className="text-[var(--color-electric-blue)] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-3)]">
            Thème
          </div>
          <div className="text-xs font-semibold text-[var(--color-text-1)] truncate flex items-center gap-1.5">
            {current?.emoji ?? '🎨'} {current?.label ?? 'Default'}
          </div>
        </div>
        {current?.mode === 'light'
          ? <Sun size={11} className="text-[var(--color-neon-yellow)] shrink-0" />
          : <Moon size={11} className="text-[var(--color-text-3)] shrink-0" />}
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 bottom-full mb-1 z-50 glass overflow-hidden"
          style={{ borderRadius: 'var(--radius-lg)' }}
        >
          <div className="max-h-[280px] overflow-y-auto py-1">
            {Object.entries(PRESETS).map(([key, p]) => {
              const active = theme?.preset === key
              return (
                <button
                  key={key}
                  onClick={() => onPick(key)}
                  disabled={saveMut.isPending}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    active
                      ? 'bg-[var(--color-electric-blue)]/10 text-[var(--color-electric-blue)]'
                      : 'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-1)]'
                  }`}
                >
                  {/* Mini swatch */}
                  <span
                    className="w-5 h-5 rounded shrink-0 ring-1 ring-black/20"
                    style={{
                      background: `linear-gradient(135deg, ${p.tokens['--color-bold-blue'] ?? '#1E466B'}, ${p.tokens['--color-electric-blue'] ?? '#3DA9FC'} 60%, ${p.tokens['--color-hot-pink'] ?? '#FF2E7A'})`,
                    }}
                  />
                  <span className="text-base">{p.emoji}</span>
                  <span className="flex-1 min-w-0 text-xs font-semibold truncate">{p.label}</span>
                  {active && <Check size={11} className="shrink-0" />}
                </button>
              )
            })}
          </div>
          <Link
            to="/settings/theme"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-electric-blue)] hover:bg-[var(--color-surface-3)] border-t border-[var(--color-surface-4)]"
          >
            <Settings size={11} /> Studio complet
          </Link>
        </div>
      )}
    </div>
  )
}
