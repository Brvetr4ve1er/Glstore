/**
 * Floema-style navigation: paper background, ink wordmark on the left,
 * pill-shaped link list in the centre, language toggle + bag on the
 * right. Collapses to a single hamburger pill below md.
 */

import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Menu, X as XIcon, ChevronDown, Search } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { BrandLogo } from './BrandLogo'
import { SearchBox } from './SearchBox'

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/c/all',         label: 'Products' },
  { to: '/c/laptops',     label: 'Laptops' },
  { to: '/c/audio',       label: 'Audio' },
  { to: '/c/gaming',      label: 'Gaming' },
  { to: '/c/smart-home',  label: 'Smart Home' },
  { to: '/c/accessories', label: 'Accessories' },
]

export function Navbar() {
  const { count } = useCart()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // close the search overlay on route change
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSearchOpen(false); setMobileOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="sticky top-0 z-40 bg-[var(--color-surface-0)]/95 backdrop-blur-md">
      <div className="px-4 sm:px-8 lg:px-10">
        <div className="flex items-center gap-4 h-[72px]">
          {/* Left — logo + search trigger */}
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/" aria-label="Ghir Laffaire — Home">
              <BrandLogo size={28} />
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen(o => !o)}
              aria-label="Open search"
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--color-jet-black)] hover:bg-[var(--color-surface-1)] transition-colors"
            >
              <Search size={16} strokeWidth={1.8} />
            </button>
          </div>

          {/* Centre — pill nav (md+) */}
          <nav className="hidden md:flex items-center gap-1 mx-auto">
            {NAV_LINKS.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/c/all' ? false : undefined}
                className="fl-nav-pill"
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          {/* Right — language + bag */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="hidden md:inline-flex items-center gap-1 text-[12px] font-semibold tracking-wider uppercase text-[var(--color-jet-black)] px-3 py-2 rounded-full hover:bg-[var(--color-surface-1)] transition-colors"
              aria-label="Change language"
            >
              EN <ChevronDown size={12} />
            </button>

            <Link
              to="/cart"
              className="relative inline-flex items-center gap-2 px-3 py-2 rounded-full hover:bg-[var(--color-surface-1)] transition-colors"
              aria-label={`Bag — ${count} item${count !== 1 ? 's' : ''}`}
            >
              <ShoppingBag size={16} strokeWidth={1.6} className="text-[var(--color-jet-black)]" />
              <span className="text-xs font-semibold uppercase tracking-wider hidden lg:inline">Bag</span>
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    key={count}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[var(--color-jet-black)] text-[var(--color-soft-white)] text-[10px] font-bold flex items-center justify-center px-1"
                  >
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>

            {/* Mobile menu */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-9 h-9 rounded-full grid place-items-center hover:bg-[var(--color-surface-1)]"
              aria-label="Open menu"
            >
              <Menu size={18} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* Inline search panel */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.22, ease: [0.19, 1, 0.22, 1] }}
              className="overflow-hidden"
            >
              <div className="pb-4 pt-1 max-w-3xl mx-auto">
                <SearchBox variant="page" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[var(--color-jet-black)]/30 backdrop-blur-sm z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed top-0 right-0 bottom-0 w-[80vw] max-w-[340px] bg-[var(--color-surface-0)] z-50 flex flex-col"
            >
              <div className="flex items-center justify-between p-4">
                <BrandLogo size={26} />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="w-9 h-9 rounded-full grid place-items-center hover:bg-[var(--color-surface-1)]"
                  aria-label="Close menu"
                >
                  <XIcon size={18} strokeWidth={1.8} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1">
                {NAV_LINKS.map(l => (
                  <Link
                    key={l.to}
                    to={l.to}
                    onClick={() => setMobileOpen(false)}
                    className="px-4 py-3 rounded-lg text-base font-semibold tracking-wide text-[var(--color-jet-black)] hover:bg-[var(--color-surface-1)]"
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="border-t border-[var(--color-surface-4)] mt-3 pt-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-[var(--color-text-3)] px-4 mb-2">
                    Language
                  </div>
                  <div className="flex gap-2 px-4">
                    {['EN', 'PT', 'FR'].map(l => (
                      <button key={l} className="fl-nav-pill" type="button">{l}</button>
                    ))}
                  </div>
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </header>
  )
}
