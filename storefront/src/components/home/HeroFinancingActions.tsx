/**
 * The hero's call-to-action row.
 *
 * "Parcourir le catalogue" is always there. "Simuler un financement" appears
 * only once GET /financing/terms says an operator has activated a rule — the
 * same ['financing','terms'] query the Navbar reads, so the home page costs no
 * extra request. While the terms load, or if they fail, the row is simply the
 * catalogue link: an optional CTA does not deserve an error message in a hero.
 *
 * No figure, duration or rate is shown here — those exist only as a computed
 * /financing/simulate result, captioned by <EstimateLabel>.
 *
 * Both CTAs are router <Link>s styled like the lg Button, not <Link><Button>:
 * a <button> nested inside an <a> is invalid interactive content (same reasoning
 * as the "Parcourir par catégorie" anchor in pages/Home.tsx). The class strings
 * mirror ui.tsx's accent/outline Button variants so the row reads as one.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Calculator } from 'lucide-react'
import { fetchFinancingTerms } from '@/lib/api'
import { cn } from '@/lib/format'

const CTA =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 tracking-wide text-base px-6 py-3 select-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'
const ACCENT =
  'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]'
const OUTLINE =
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5'

export function HeroFinancingActions({ className }: { className?: string } = {}) {
  const { data: terms } = useQuery({
    queryKey: ['financing', 'terms'],
    queryFn: fetchFinancingTerms,
    staleTime: 5 * 60_000,
  })
  const financingAvailable = terms?.available === true

  return (
    <div className={cn('flex flex-wrap gap-3 justify-center mt-2', className)}>
      <Link to="/c/all" className={cn(CTA, ACCENT)}>
        Parcourir le catalogue <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {financingAvailable && (
        <Link to="/simulate" className={cn(CTA, OUTLINE)}>
          <Calculator size={16} aria-hidden="true" /> Simuler un financement
        </Link>
      )}
    </div>
  )
}
