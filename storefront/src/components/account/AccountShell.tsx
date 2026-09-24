/**
 * The frame every /account page renders inside: title, the signed-in phone,
 * the account navigation and sign-out. Pages pass their own content only.
 *
 * Wrap the ROUTE in <RequireCustomer> (lib/session.tsx); this shell assumes a
 * customer is signed in and renders nothing account-specific otherwise.
 */
import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { SEO } from '@/components/SEO'
import { Button } from '@/components/ui'
import { cn } from '@/lib/format'
import { useCustomer } from '@/lib/session'

const LINKS = [
  { to: '/account', label: 'Mon compte', end: true },
  { to: '/account/orders', label: 'Mes commandes', end: false },
  { to: '/account/applications', label: 'Mes demandes de financement', end: false },
]

export function AccountShell({
  title, children, actions,
}: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { customer, signOut } = useCustomer()
  const navigate = useNavigate()

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Personal pages: never indexed. */}
      <SEO title={title} noIndex />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[var(--color-text-1)]">{title}</h1>
          {customer && (
            <p className="text-sm text-[var(--color-text-3)] mt-1">
              Connecté avec le {customer.phone}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOut()
              navigate('/')
            }}
          >
            <LogOut size={14} aria-hidden="true" /> Se déconnecter
          </Button>
        </div>
      </div>

      <nav aria-label="Espace client" className="mb-8 border-b border-[var(--color-surface-4)]">
        <ul className="flex gap-1 overflow-x-auto">
          {LINKS.map(l => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) => cn(
                  'inline-block px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors',
                  isActive
                    ? 'border-[var(--color-electric-blue)] text-[var(--color-text-1)]'
                    : 'border-transparent text-[var(--color-text-3)] hover:text-[var(--color-text-1)]',
                )}
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {children}
    </div>
  )
}
