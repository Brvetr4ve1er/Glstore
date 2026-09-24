/**
 * "Payer en plusieurs fois" — the how-it-works band on Home.
 *
 * Renders NOTHING unless GET /financing/terms answers `available: true` (an
 * operator has activated a rule). Same ['financing','terms'] query as the
 * Navbar and the hero CTAs, so it is one request per session.
 *
 * The steps describe the process as the backend actually runs it, and nothing
 * more:
 *   1. /financing/simulate — public, computed from catalogue prices
 *   2. opening a request needs a verified phone (OTP by SMS, migration 010)
 *   3. financial + employment profile, then the operator-configured documents
 *      (possibly none — hence "les justificatifs demandés")
 *   4. SUBMITTED → UNDER_REVIEW, reviewed by the team in the admin queue;
 *      status visible under /account/applications
 *   5. SIGNED is recorded once the contract is signed
 *
 * Deliberately absent: any figure, duration, rate, delay, eligibility
 * criterion or promise. Those come only from /financing/terms, /simulate and
 * /required-documents, on the pages that call them.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ArrowRight, Calculator, ClipboardList, FileSearch, MessageSquareText, Signature,
  type LucideIcon,
} from 'lucide-react'
import { fetchFinancingTerms } from '@/lib/api'
import { cn } from '@/lib/format'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'

const TITLE_ID = 'home-financing-title'

interface Step {
  icon: LucideIcon
  title: string
  desc: string
}

const STEPS: Step[] = [
  {
    icon: Calculator,
    title: 'Simulez',
    desc: 'Choisissez vos produits, votre apport et une durée parmi celles proposées : le simulateur calcule le détail du remboursement.',
  },
  {
    icon: MessageSquareText,
    title: 'Ouvrez votre demande',
    desc: 'Connectez-vous avec votre numéro de téléphone grâce au code reçu par SMS, puis ouvrez votre demande de financement.',
  },
  {
    icon: ClipboardList,
    title: 'Déclarez votre situation',
    // "éventuellement": the operator may require no documents at all.
    desc: 'Renseignez vos revenus, vos charges et votre emploi, et joignez les justificatifs éventuellement demandés.',
  },
  {
    icon: FileSearch,
    title: 'Étude du dossier',
    desc: 'Notre équipe examine votre demande et vos justificatifs. Vous suivez son avancement depuis votre compte.',
  },
  {
    icon: Signature,
    title: 'Signature du contrat',
    // No outcome wording: while terms are not public, nothing on the site
    // speaks of a request being accepted.
    desc: 'Dernière étape de votre demande : la signature du contrat de financement.',
  },
]

const CTA =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 tracking-wide text-sm px-4 py-2.5 select-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'
const PRIMARY =
  'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110 shadow-[0_0_22px_var(--color-brand-glow)]'
const OUTLINE =
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5'

export function HomeFinancingBand() {
  const { data: terms } = useQuery({
    queryKey: ['financing', 'terms'],
    queryFn: fetchFinancingTerms,
    staleTime: 5 * 60_000,
  })

  if (terms?.available !== true) return null

  return (
    <section aria-labelledby={TITLE_ID} className="max-w-[1400px] mx-auto px-6 mb-16">
      <div className="glass-strong p-6 md:p-10 relative overflow-hidden">
        <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />

        <ScrollReveal variant="fade-up-sm">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-8">
            <div className="max-w-2xl">
              <h2
                id={TITLE_ID}
                className="text-2xl md:text-3xl font-black text-[var(--color-text-1)]"
              >
                <span className="punk-stripe">Payer en plusieurs fois</span>
              </h2>
              <p className="text-sm text-[var(--color-text-2)] mt-3 leading-relaxed">
                Le financement se fait sur demande, étudiée par notre équipe. Voici les étapes,
                de la simulation à la signature.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/simulate" className={cn(CTA, PRIMARY)}>
                <Calculator size={16} aria-hidden="true" /> Simuler un financement
              </Link>
              <Link to="/financement" className={cn(CTA, OUTLINE)}>
                En savoir plus sur le financement <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </ScrollReveal>

        {/* role="list": Tailwind's list-style:none makes Safari/VoiceOver drop
            list semantics, and the step numbers rely on them. */}
        <motion.ol
          role="list"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
        >
          {STEPS.map(({ icon: Icon, title, desc }, i) => (
            <motion.li
              key={title}
              variants={STAGGER_ITEM}
              className="glass-sm flex flex-col gap-3 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="w-10 h-10 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                  <Icon size={18} aria-hidden="true" className="text-[var(--color-electric-blue)]" />
                </span>
                {/* The <ol> already announces the position; the digits are visual. */}
                <span
                  aria-hidden="true"
                  className="num text-xs font-black tracking-[0.18em] text-[var(--color-neon-yellow)]"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-sm font-bold text-[var(--color-text-1)]">{title}</h3>
              <p className="text-xs text-[var(--color-text-3)] leading-relaxed">{desc}</p>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  )
}
