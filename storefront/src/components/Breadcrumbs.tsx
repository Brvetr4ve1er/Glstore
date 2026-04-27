import { Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

export interface Crumb {
  to?: string
  label: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Fil d’Ariane" className="flex items-center text-xs text-[var(--color-text-3)] gap-1.5 flex-wrap">
      <Link to="/" className="flex items-center gap-1 hover:text-[var(--color-electric-blue)] transition-colors">
        <Home size={12} />
        <span className="sr-only">Accueil</span>
      </Link>
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={11} className="opacity-50" />
          {c.to ? (
            <Link to={c.to} className="hover:text-[var(--color-electric-blue)] transition-colors truncate max-w-[180px]">
              {c.label}
            </Link>
          ) : (
            <span className="text-[var(--color-text-2)] font-medium truncate max-w-[260px]" aria-current="page">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
