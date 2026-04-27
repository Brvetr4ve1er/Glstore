import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { SEO } from '@/components/SEO'

export default function NotFound() {
  return (
    <div className="page-enter min-h-[60vh] flex items-center justify-center px-6 py-20">
      <SEO title="Page introuvable" description="Cette page n'existe pas." noIndex />
      <div className="text-center max-w-md">
        <div className="font-display text-8xl font-black text-[var(--color-electric-blue)] mb-2">404</div>
        <h1 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] mb-3">
          Page introuvable
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mb-8 leading-relaxed">
          Le lien que vous avez suivi est cassé ou la page a été déplacée.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link to="/"><Button variant="accent">Accueil</Button></Link>
          <Link to="/c/all"><Button variant="outline">Catalogue</Button></Link>
        </div>
      </div>
    </div>
  )
}
