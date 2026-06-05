import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin, Truck, ShieldCheck, Sparkles } from 'lucide-react'
import { BrandLogo } from './BrandLogo'

const COLS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: 'Boutique',
    links: [
      { to: '/c/all',         label: 'Tout le matériel' },
      { to: '/c/Headsets',    label: 'Casques' },
      { to: '/c/Keyboards',   label: 'Claviers' },
      { to: '/c/Mice',        label: 'Souris' },
      { to: '/c/Controllers', label: 'Manettes' },
    ],
  },
  {
    title: 'Service',
    links: [
      { to: '/order/track',    label: 'Suivre ma commande' },
      { to: '/help/livraison', label: 'Livraison' },
      { to: '/help/garantie',  label: 'Garantie' },
      { to: '/help/retours',   label: 'Retours' },
      { to: '/help/contact',   label: 'Contact' },
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
            { icon: Truck,       title: 'Livraison rapide',       desc: '48h à travers les 58 wilayas' },
            { icon: ShieldCheck, title: 'Paiement à la livraison', desc: 'Pas de surprise, payez sur place' },
            { icon: Sparkles,    title: 'Matériel pro authentique', desc: 'Garantie 2 ans · qualité esport' },
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
      <div className="max-w-[1400px] mx-auto px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <BrandLogo size={36} showTagline />
          <p className="text-xs text-[var(--color-text-3)] mt-4 leading-relaxed max-w-xs">
            Matériel gaming de niveau esport, conçu avec et pour les joueurs. Livré vite en Algérie, garanti fiable. For Glory.
          </p>
        </div>
        {COLS.map(col => (
          <div key={col.title}>
            <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-3">
              {col.title}
            </h3>
            <ul className="flex flex-col gap-2 text-sm text-[var(--color-text-2)]">
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
          <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-3">
            Contact
          </h3>
          <ul className="flex flex-col gap-3 text-sm text-[var(--color-text-2)]">
            <li className="flex items-center gap-2"><Phone size={13} /> +213 …</li>
            <li className="flex items-center gap-2"><Mail size={13} /> contact@glaive.dz</li>
            <li className="flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> Alger, Algérie</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--color-surface-4)] py-5 text-center text-[10px] text-[var(--color-text-3)] uppercase tracking-[0.18em]">
        © GLAIVE Gaming · For Glory
      </div>
    </footer>
  )
}
