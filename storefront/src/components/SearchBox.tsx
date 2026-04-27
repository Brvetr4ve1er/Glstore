import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X as XIcon, ImageIcon } from 'lucide-react'
import { fetchProducts } from '@/lib/api'
import { fmtMoney, categoryIcon } from '@/lib/format'

interface SearchBoxProps {
  /** "navbar" makes it compact; "page" is the full-width hero search. */
  variant?: 'navbar' | 'page'
  onNavigate?: () => void
}

export function SearchBox({ variant = 'navbar', onNavigate }: SearchBoxProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220)
    return () => clearTimeout(t)
  }, [q])

  // Click-outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Cmd-K / Ctrl-K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['search-suggest', debounced],
    queryFn: () => fetchProducts({ q: debounced, page_size: 6 }),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  })

  function submit() {
    if (!q.trim()) return
    setOpen(false)
    onNavigate?.()
    navigate(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <div ref={ref} className={variant === 'navbar' ? 'relative w-full max-w-md' : 'relative w-full max-w-2xl mx-auto'}>
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder={variant === 'navbar' ? 'Rechercher (⌘K)…' : 'Que cherchez-vous ?'}
          aria-label="Rechercher dans le catalogue"
          className={
            variant === 'navbar'
              ? 'h-10 w-full pl-10 pr-9 rounded-xl bg-[var(--color-surface-3)]/70 border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors backdrop-blur'
              : 'h-14 w-full pl-12 pr-10 rounded-2xl bg-[var(--color-surface-3)] border-2 border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-base text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors'
          }
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] p-1"
            aria-label="Effacer la recherche"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && debounced.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 w-full glass-strong p-2 z-50 max-h-[60vh] overflow-y-auto"
          >
            {isFetching && <div className="px-3 py-2 text-xs text-[var(--color-text-3)]">Recherche…</div>}
            {!isFetching && (data?.items.length ?? 0) === 0 && (
              <div className="px-3 py-3 text-xs text-[var(--color-text-3)]">Aucun résultat pour <span className="text-[var(--color-text-1)] font-bold">"{debounced}"</span></div>
            )}
            {(data?.items ?? []).map(p => (
              <Link
                key={p.id}
                to={`/p/${p.slug}`}
                onClick={() => { setOpen(false); onNavigate?.() }}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--color-surface-3)] transition-colors"
              >
                <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center shrink-0 no-img-placeholder">
                  {p.primary_image
                    ? <img src={p.primary_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <ImageIcon size={14} className="text-[var(--color-text-3)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--color-text-1)] font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2">
                    <span>{categoryIcon(p.category)} {p.category ?? '—'}</span>
                    {p.brand && <span>· {p.brand}</span>}
                  </div>
                </div>
                <div className="text-xs num font-bold text-[var(--color-electric-blue)] shrink-0">
                  {p.min_price != null ? fmtMoney(p.min_price) : ''}
                </div>
              </Link>
            ))}
            {(data?.total ?? 0) > 6 && (
              <button
                onClick={submit}
                className="w-full mt-1 px-3 py-2 text-xs font-bold text-[var(--color-neon-yellow)] hover:bg-[var(--color-surface-3)] rounded-lg text-left"
              >
                Voir tous les {data!.total} résultats →
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
