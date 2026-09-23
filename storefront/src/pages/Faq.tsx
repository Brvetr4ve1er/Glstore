/**
 * FAQ — AMANATKOM.
 *
 * Answers only what is already true elsewhere in this codebase. Every answer
 * below is traceable to a specific file, listed in its comment. Two claims
 * are deliberately absent because nothing in the codebase backs them:
 *
 *   · A delivery timeframe (e.g. "48h"). Home.tsx's own header comment
 *     records that "Livraison 48h" was already removed once for being
 *     unbacked — this page does not reintroduce it.
 *   · A warranty or return/refund policy. No such policy exists anywhere in
 *     `db/`, `api/` or the storefront today.
 *
 * Sources used:
 *   · Checkout.tsx  — COD is the only payment method presented, an agent
 *     confirms by phone, shipping cost is set by that agent (not shown at
 *     checkout).
 *   · Home.tsx / Footer.tsx — 58 wilayas coverage, "paiement à la livraison".
 *   · OrderTracking.tsx — /order/track takes an order number + the phone
 *     number used to place the order.
 *   · lib/taxonomy.ts + Home.tsx category grid — the catalogue is organised
 *     into named categories (Cuisson, Froid, Lavage, …) plus "Autre" and
 *     "Tout le catalogue", reachable at /c/:slug and /c/all.
 *   · Contact.tsx — the support channel this page links to.
 *
 * Gaps (asked for in the brief, not answered — no fact to point to):
 *   · Whether a customer account is required to order (no account/login page
 *     exists in `storefront/src/pages/`, but no code confirms "guest
 *     checkout only" as a designed policy either — left out rather than
 *     asserted).
 *   · The delivery cost amount and how long delivery takes.
 *   · Any warranty or return/refund terms.
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown, Wallet, Truck, PackageSearch, LayoutGrid, MessageSquare, HelpCircle,
} from 'lucide-react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { Button } from '@/components/ui'
import { SEO } from '@/components/SEO'

interface FaqEntry {
  icon: typeof Wallet
  q: string
  a: React.ReactNode
}

const ENTRIES: FaqEntry[] = [
  {
    icon: Wallet,
    q: 'Comment fonctionne la commande et le paiement ?',
    a: (
      <>
        Vous ajoutez des produits au panier puis renseignez vos coordonnées et votre adresse de
        livraison (wilaya, commune, adresse). Le paiement se fait <strong className="text-[var(--color-text-1)]">à la livraison</strong> :
        vous payez en espèces au livreur, sans carte ni paiement en ligne. Après validation, un
        agent vous appelle pour confirmer la commande avant expédition.
      </>
    ),
  },
  {
    icon: Truck,
    q: 'Livrez-vous dans toute l’Algérie ?',
    a: (
      <>
        Oui, la livraison couvre les <strong className="text-[var(--color-text-1)]">58 wilayas</strong>. Le coût de
        livraison est calculé par l’agent qui confirme votre commande par téléphone — il n’est pas
        affiché au moment de la commande en ligne.
      </>
    ),
  },
  {
    icon: PackageSearch,
    q: 'Comment suivre ma commande ?',
    a: (
      <>
        Rendez-vous sur la page{' '}
        <Link to="/order/track" className="text-[var(--color-electric-blue)] hover:underline font-bold">
          Suivre ma commande
        </Link>{' '}
        et indiquez le numéro de commande ainsi que le numéro de téléphone utilisé lors de la
        commande.
      </>
    ),
  },
  {
    icon: LayoutGrid,
    q: 'Comment le catalogue est-il organisé ?',
    a: (
      <>
        Les produits sont classés par catégories — Cuisson, Froid, Lavage, Préparation culinaire,
        Petit déjeuner et d’autres familles d’électroménager — accessibles depuis la page d’accueil
        ou en parcourant{' '}
        <Link to="/c/all" className="text-[var(--color-electric-blue)] hover:underline font-bold">
          tout le catalogue
        </Link>
        .
      </>
    ),
  },
  {
    icon: MessageSquare,
    q: 'Comment vous contacter ?',
    a: (
      <>
        Via notre{' '}
        <Link to="/contact" className="text-[var(--color-electric-blue)] hover:underline font-bold">
          page Contact
        </Link>
        , qui liste nos coordonnées et un formulaire pour nous écrire directement.
      </>
    ),
  },
]

function FaqItem({ entry, isOpen, onToggle }: { entry: FaqEntry; isOpen: boolean; onToggle: () => void }) {
  const panelId = useId()
  const Icon = entry.icon
  return (
    <div className="glass overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center gap-3.5 px-5 py-4 text-left cursor-pointer select-none"
      >
        <div className="w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-[var(--color-electric-blue)]" />
        </div>
        <span className="flex-1 text-sm font-bold text-[var(--color-text-1)]">{entry.q}</span>
        <ChevronDown
          size={16}
          className={`text-[var(--color-text-3)] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="px-5 pb-5 pl-[3.375rem] text-sm text-[var(--color-text-2)] leading-relaxed">
              {entry.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function FaqPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Questions fréquentes"
        description="Commande, paiement à la livraison, couverture des 58 wilayas, suivi de commande et catégories du catalogue AMANATKOM."
      />
      <Breadcrumbs items={[{ label: 'Questions fréquentes' }]} />

      <div className="mt-4 mb-8 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[var(--color-neon-yellow)]/15 flex items-center justify-center shrink-0">
          <HelpCircle size={20} className="text-[var(--color-neon-yellow)]" />
        </div>
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
            <span className="punk-stripe">Questions fréquentes</span>
          </h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1 max-w-xl leading-relaxed">
            Commande, livraison et suivi — l’essentiel avant d’acheter chez AMANATKOM.
          </p>
        </div>
      </div>

      <motion.div
        className="flex flex-col gap-3"
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="show"
      >
        {ENTRIES.map((entry, i) => (
          <motion.div key={entry.q} variants={STAGGER_ITEM}>
            <FaqItem
              entry={entry}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex(openIndex === i ? null : i)}
            />
          </motion.div>
        ))}
      </motion.div>

      <ScrollReveal variant="fade-up-sm" className="mt-8">
        <div className="glass-strong p-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left relative overflow-hidden">
          <div aria-hidden className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <div>
            <div className="text-sm font-bold text-[var(--color-text-1)]">Une autre question ?</div>
            <div className="text-xs text-[var(--color-text-3)] mt-0.5">
              Écrivez-nous via la page Contact, nous reviendrons vers vous.
            </div>
          </div>
          <Link to="/contact">
            <Button variant="accent">Contactez-nous</Button>
          </Link>
        </div>
      </ScrollReveal>
    </div>
  )
}
