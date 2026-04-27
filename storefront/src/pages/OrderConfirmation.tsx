import { Link, useLocation, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, Phone, Truck, Sparkles, ArrowRight } from 'lucide-react'
import type { OrderConfirmation } from '@/lib/api'
import { fmtMoney } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Button } from '@/components/ui'
import { SEO } from '@/components/SEO'

interface LocationState {
  order?: OrderConfirmation
}

export default function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const state = location.state as LocationState | undefined
  const order = state?.order

  // Defensive: if user refreshed, the location.state is gone — but we still
  // confirm with a generic success view based on the URL id.
  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO title="Commande confirmée" description="Votre commande a été enregistrée — Ghir Laffaire" noIndex />
      <Breadcrumbs items={[{ label: 'Confirmation' }]} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="glass-strong p-8 md:p-12 mt-6 text-center relative overflow-hidden"
      >
        <div aria-hidden className="absolute top-0 left-0 right-0 h-1 brand-stripe" />

        <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center mb-6 glow-yellow">
          <CheckCircle2 size={40} className="text-emerald-400" />
        </div>

        <h1 className="font-display text-3xl md:text-4xl font-black text-[var(--color-text-1)] leading-tight">
          Commande confirmée
        </h1>
        <p className="text-[var(--color-text-3)] text-sm mt-3 max-w-md mx-auto leading-relaxed">
          Votre commande a bien été enregistrée. Un agent vous appellera dans les 24h pour la confirmer et organiser la livraison.
        </p>

        {order ? (
          <div className="mt-8 flex flex-col gap-4">
            <div className="flex items-center justify-center gap-3 text-[var(--color-text-2)]">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
                Numéro de commande
              </span>
              <span className="num text-xl font-black text-[var(--color-neon-yellow)]">
                {order.order_number}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto mt-4">
              <Stat label="Articles" value={String(order.items.length)} />
              <Stat label="Total" value={fmtMoney(order.total, order.currency)} accent />
            </div>

            <ul className="text-left flex flex-col gap-2 max-w-md mx-auto mt-4 text-sm">
              {order.items.map(it => (
                <li key={it.id} className="flex items-center justify-between gap-3 glass-sm px-3 py-2">
                  <span className="text-[var(--color-text-1)] truncate flex-1">{it.product_name} <span className="text-[var(--color-text-3)] num">×{it.quantity}</span></span>
                  <span className="num font-bold text-[var(--color-text-1)] shrink-0">{fmtMoney(it.line_total, order.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : id ? (
          <div className="num text-sm text-[var(--color-text-3)] mt-6">
            ID interne : <span className="text-[var(--color-text-1)]">{id}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto mt-10 text-left">
          {[
            { icon: Phone,    title: 'Appel sous 24h',     desc: 'Un agent confirme la commande' },
            { icon: Truck,    title: 'Livraison 48h',       desc: 'À votre adresse en Algérie' },
            { icon: Sparkles, title: 'Paiement à la porte', desc: 'Vous payez à la réception' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-sm p-4 flex items-start gap-3">
              <Icon size={16} className="text-[var(--color-electric-blue)] mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-bold text-[var(--color-text-1)]">{title}</div>
                <div className="text-[11px] text-[var(--color-text-3)] mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
          <Link to="/c/all">
            <Button variant="accent">Continuer mes achats <ArrowRight size={14} /></Button>
          </Link>
          <Link to="/order/track">
            <Button variant="outline">Suivre ma commande</Button>
          </Link>
          <Link to="/">
            <Button variant="ghost">Retour à l’accueil</Button>
          </Link>
        </div>
      </motion.div>
    </div>
  )
}


function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass-sm p-3 flex flex-col items-center text-center">
      <div className="text-[9px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.2em]">{label}</div>
      <div className={`num text-xl font-black mt-1 ${accent ? 'text-[var(--color-neon-yellow)]' : 'text-[var(--color-text-1)]'}`}>
        {value}
      </div>
    </div>
  )
}
