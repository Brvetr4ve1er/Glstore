import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Menu, X as XIcon, ChevronDown, Phone, Truck, Shield } from 'lucide-react'
import { fetchCategories } from '@/lib/api'
import { useCart } from '@/lib/cart'
import { categoryIcon } from '@/lib/format'
import { BrandLogo } from './BrandLogo'
import { SearchBox } from './SearchBox'

const TOP_LINKS = [
  { to: '/c/all',          label: 'Tout le matériel' },
  { to: '/c/Headsets',     label: 'Casques' },
  { to: '/c/Keyboards',    label: 'Claviers' },
  { to: '/c/Mice',         label: 'Souris' },
  { to: '/c/Controllers',  label: 'Manettes' },
]

export function Navbar() {
  const { count } = useCart()
  const [megaOpen, setMegaOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const megaRef = useRef<HTMLDivElement>(null)

  const { data: cats } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 5 * 60_000,
  })

  // Click-outside for mega menu
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (megaRef.current && !megaRef.current.contains(e.target as Node)) setMegaOpen(false)
    }
    if (megaOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [megaOpen])

  return (
    <header className="sticky top-0 z-40">
      {/* Promo strip */}
      <div className="brand-stripe text-[11px] font-bold text-[var(--color-jet-black)] py-1.5 text-center tracking-wide flex items-center justify-center gap-6 flex-wrap px-4">
        <span className="flex items-center gap-1.5"><Truck size={12} /> LIVRAISON 48H · 58 WILAYAS</span>
        <span className="flex items-center gap-1.5"><Shield size={12} /> PAIEMENT À LA LIVRAISON</span>
        <span className="flex items-center gap-1.5 hidden sm:flex"><Phone size={12} /> MATÉRIEL GAMING PRO · FOR GLORY</span>
      </div>

      {/* Main bar */}
      <div className="glass-strong border-b border-[var(--color-surface-4)] backdrop-blur-2xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 py-3">
            {/* Mobile menu */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-2)]"
              aria-label="Ouvrir le menu"
            >
              <Menu size={20} />
            </button>

            {/* Logo */}
            <Link to="/" className="shrink-0" aria-label="GLAIVE — Accueil">
              <BrandLogo size={36} />
            </Link>

            {/* Search (centered, hidden on small) */}
            <div className="hidden md:block flex-1 max-w-xl">
              <SearchBox variant="navbar" />
            </div>

            {/* Cart */}
            <div className="ml-auto flex items-center gap-2">
              <Link
                to="/cart"
                className="relative inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-electric-blue)]/10 border border-[var(--color-electric-blue)]/25 hover:bg-[var(--color-electric-blue)]/20 transition-colors"
                aria-label={`Panier — ${count} article${count !== 1 ? 's' : ''}`}
              >
                <ShoppingBag size={16} className="text-[var(--color-electric-blue)]" />
                <span className="text-sm font-bold text-[var(--color-text-1)] hidden sm:inline">Panier</span>
                <AnimatePresence>
                  {count > 0 && (
                    <motion.span
                      key={count}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] text-[10px] font-black flex items-center justify-center px-1"
                    >
                      {count}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>
            </div>
          </div>

          {/* Mobile search */}
          <div className="md:hidden pb-3">
            <SearchBox variant="navbar" />
          </div>

          {/* Category strip */}
          <div className="hidden md:flex items-center gap-1 pb-2 -mx-2 overflow-x-auto" ref={megaRef}>
            <button
              type="button"
              onClick={() => setMegaOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--color-text-1)] hover:bg-[var(--color-surface-3)] transition-colors"
              aria-expanded={megaOpen}
            >
              <Menu size={14} /> Toutes les catégories
              <ChevronDown size={12} className={`transition-transform ${megaOpen ? 'rotate-180' : ''}`} />
            </button>
            {TOP_LINKS.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? 'text-[var(--color-electric-blue)] bg-[var(--color-electric-blue)]/8'
                      : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-3)]'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}

            {/* Mega menu */}
            <AnimatePresence>
              {megaOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 right-0 top-full mt-1 px-4 sm:px-6"
                >
                  <div className="max-w-[1400px] mx-auto glass-strong p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {(cats?.items ?? []).map(c => (
                        <Link
                          key={c.name}
                          to={`/c/${encodeURIComponent(c.name)}`}
                          onClick={() => setMegaOpen(false)}
                          className="flex flex-col gap-1 px-3 py-3 rounded-xl border border-[var(--color-surface-4)] hover:border-[var(--color-electric-blue)]/50 hover:bg-[var(--color-surface-3)] transition-colors group"
                        >
                          <span className="text-2xl">{categoryIcon(c.name)}</span>
                          <span className="text-sm font-bold text-[var(--color-text-1)] truncate">{c.name}</span>
                          <span className="text-[10px] text-[var(--color-text-3)] num">{c.count} produits</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed top-0 left-0 bottom-0 w-[85vw] max-w-[340px] glass-strong z-50 flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-[var(--color-surface-4)]">
                <BrandLogo size={32} />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-lg hover:bg-[var(--color-surface-3)]"
                  aria-label="Fermer le menu"
                >
                  <XIcon size={18} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-2">
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-3)]">
                  Catégories
                </div>
                {(cats?.items ?? []).map(c => (
                  <Link
                    key={c.name}
                    to={`/c/${encodeURIComponent(c.name)}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-3)]"
                  >
                    <span className="flex items-center gap-3 text-sm font-semibold text-[var(--color-text-1)]">
                      <span className="text-lg">{categoryIcon(c.name)}</span>
                      {c.name}
                    </span>
                    <span className="text-[10px] num text-[var(--color-text-3)]">{c.count}</span>
                  </Link>
                ))}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </header>
  )
}
