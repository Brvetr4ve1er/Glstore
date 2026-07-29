import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Package, ShoppingCart, LogOut, Sparkles, Stethoscope, Settings as SettingsIcon, Activity, Network, Images, Store as StoreIcon, ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { BrandLogo } from '@/components/BrandLogo'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

const NAV = [
  { to: '/',                  label: 'Dashboard',       icon: LayoutDashboard },
  { to: '/products',          label: 'Products',        icon: Package },
  { to: '/products/issues',   label: 'Catalog Quality', icon: Stethoscope },
  { to: '/images',            label: 'Image Review',    icon: Images },
  { to: '/orders',            label: 'Orders',          icon: ShoppingCart },
  { to: '/jobs',              label: 'Jobs Console',    icon: Activity },
  { to: '/graph',             label: 'Catalog Graph',   icon: Network },
  { to: '/settings',          label: 'Settings',        icon: SettingsIcon },
]

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: React.FC<{ size?: number; className?: string }> }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold tracking-wide relative overflow-hidden group transition-colors',
          isActive
            ? 'text-[var(--color-jet-black)]'
            : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-3)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-active-bg"
              className="absolute inset-0 rounded-xl bg-[var(--color-neon-yellow)]"
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            />
          )}
          <Icon size={16} className="relative z-10 shrink-0" />
          <span className="relative z-10">{label}</span>
          {isActive && (
            <motion.span
              className="relative z-10 ml-auto text-[10px] font-black tracking-widest"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
            >
              GO
            </motion.span>
          )}
        </>
      )}
    </NavLink>
  )
}

/** Store switcher. Interactive for platform operators managing multiple
 *  brands; a fixed label for a store-scoped operator or a single-store setup. */
function StorePicker() {
  const { stores, currentId, setCurrent, isPlatformOperator } = useStore()

  if (stores.length === 0) return null

  const canSwitch = isPlatformOperator && stores.length > 1
  const current = stores.find(s => s.id === currentId) ?? stores[0]

  return (
    <div className="px-3 pt-3">
      <div className="px-1 mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-3)]">
        Store
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-surface-3)] border border-[var(--color-surface-4)]">
          <StoreIcon size={15} className="text-[var(--color-electric-blue)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--color-text-1)] truncate">{current.name}</div>
            <div className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider truncate">
              {current.order_prefix} · {current.currency}
            </div>
          </div>
          {canSwitch && <ChevronsUpDown size={13} className="text-[var(--color-text-3)] shrink-0" />}
        </div>
        {canSwitch && (
          <select
            aria-label="Switch store"
            value={currentId ?? ''}
            onChange={e => setCurrent(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.order_prefix})</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const { email, role, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[240px] shrink-0 flex flex-col bg-[var(--color-surface-1)] border-r border-[var(--color-surface-4)] relative">
        {/* punk top stripe */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />

        {/* Logo */}
        <div className="flex items-center px-5 py-5 border-b border-[var(--color-surface-4)]">
          <BrandLogo size={34} showTagline />
        </div>

        {/* Store switcher */}
        <StorePicker />

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-3)]">
            Console
          </div>
          {NAV.map(n => <NavItem key={n.to} {...n} />)}
        </nav>

        {/* Easter / accent */}
        <div className="px-5 py-3 mx-3 mb-3 rounded-xl bg-[var(--color-bold-blue)]/30 border border-[var(--color-electric-blue)]/20 flex items-start gap-2.5">
          <Sparkles size={14} className="text-[var(--color-neon-yellow)] mt-0.5 shrink-0" />
          <p className="text-[11px] leading-snug text-[var(--color-text-2)]">
            <span className="font-bold text-[var(--color-text-1)]">Punk mode</span> on.<br />
            Move fast. Stay reliable.
          </p>
        </div>

        {/* Theme switcher (cycle palettes from anywhere) */}
        <div className="px-3 py-2 border-t border-[var(--color-surface-4)]">
          <ThemeSwitcher />
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-[var(--color-surface-4)]">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-electric-blue)]/15 flex items-center justify-center text-xs font-black text-[var(--color-electric-blue)] uppercase shrink-0 border border-[var(--color-electric-blue)]/25">
              {email?.[0] ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[var(--color-text-1)] truncate">{email}</div>
              <div className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">{role}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] hover:bg-[var(--color-hot-pink)]/10 transition-all"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto bg-[var(--color-surface-0)]">
        <div className="page-enter max-w-[1400px] mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
