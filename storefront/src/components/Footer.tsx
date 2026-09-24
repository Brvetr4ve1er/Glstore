import { Link } from 'react-router-dom'
import { MapPin, Truck, ShieldCheck, Home } from 'lucide-react'
import { CATEGORIES } from '@/lib/taxonomy'
import { BrandLogo } from './BrandLogo'
import { NewsletterForm } from './NewsletterForm'

interface FooterCol {
  title: string
  /** Renders across two grid tracks, in a two-column list. For long lists. */
  wide?: boolean
  links: { to: string; label: string }[]
}

/**
 * The footer used to hardcode `/c/Headsets`, `/c/Keyboards`, `/c/Mice` and
 * `/c/Controllers` — gaming categories that do not exist in this catalogue, so
 * four of the five shop links led to an empty page.
 *
 * The shop column is now generated from `CATEGORIES` in `@/lib/taxonomy`, the
 * same derived taxonomy the navbar and the catalogue use. All thirteen appear
 * here — including `Autre`, which is a first-class bucket, not a bin to hide.
 * The navbar promotes only the six largest; the footer is where the full map
 * lives.
 */
const COLS: FooterCol[] = [
  {
    title: 'Catégories',
    wide: true,
    links: [
      { to: '/c/all', label: 'Tout le catalogue' },
      ...CATEGORIES.map(c => ({ to: `/c/${c.slug}`, label: c.label })),
    ],
  },
  {
    // The 3 links this replaced (/help/livraison, /help/garantie,
    // /help/retours) pointed at pages that were never built and would 404 —
    // a delivery-time page, a warranty page and a returns page all need
    // real policy terms this codebase does not have, so building them
    // would mean inventing claims. Left out rather than faked.
    title: 'Service',
    links: [
      { to: '/order/track', label: 'Suivre ma commande' },
      { to: '/account',      label: 'Mon compte' },
      { to: '/financement',  label: 'Financement' },
      { to: '/faq',          label: 'Questions fréquentes' },
      { to: '/contact',      label: 'Contact' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--color-surface-4)]">
      {/* Trust strip */}
      <div className="bg-[var(--color-surface-1)]">
        <div className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: Truck,       title: 'Livraison',              desc: 'Dans les 58 wilayas' },
            { icon: ShieldCheck, title: 'Paiement à la livraison', desc: 'Pas de surprise, payez sur place' },
            { icon: Home,        title: 'Toute la maison',         desc: 'Cuisson, froid, lavage, entretien' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                <Icon size={18} className="text-[var(--color-electric-blue)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">{title}</div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main footer */}
      <div className="max-w-[1400px] mx-auto px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8">
        <div>
          <BrandLogo size={36} />
          <p className="text-xs text-[var(--color-text-3)] mt-4 leading-relaxed max-w-xs">
            AMANTCOM — l’électroménager pour toute la maison, livré partout en Algérie.
            Paiement à la livraison.
          </p>
          <NewsletterForm className="mt-5 max-w-xs" />
        </div>
        {COLS.map(col => (
          <div key={col.title} className={col.wide ? 'lg:col-span-2' : undefined}>
            <h3 className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-3">
              {col.title}
            </h3>
            <ul
              className={
                col.wide
                  ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-[var(--color-text-2)]'
                  : 'flex flex-col gap-2 text-sm text-[var(--color-text-2)]'
              }
            >
              {col.links.map(l => (
                <li key={l.to}>
                  <Link to={l.to} className="link-underline hover:text-[var(--color-text-1)]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-3">
            Contact
          </h3>
          <ul className="flex flex-col gap-3 text-sm text-[var(--color-text-2)]">
            <li className="flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> Algérie · 58 wilayas</li>
            <li>
              <Link to="/contact" className="link-underline hover:text-[var(--color-text-1)] font-bold">
                Nous contacter
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--color-surface-4)] py-5 text-center text-xs text-[var(--color-text-3)] uppercase tracking-[0.18em]">
        © AMANTCOM · Bouakil Electro
      </div>
    </footer>
  )
}
