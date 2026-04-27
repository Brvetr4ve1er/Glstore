import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Minus, Plus, Trash2, ShoppingBag, ArrowRight, Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useCart, type CartItem } from '@/lib/cart'
import { fmtMoney } from '@/lib/format'
import { fetchOffersAvailability, type OfferAvailability } from '@/lib/api'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Button, EmptyState } from '@/components/ui'
import { SEO } from '@/components/SEO'


export default function CartPage() {
  const cart = useCart()
  const offerIds = cart.items.map(i => i.offerId)

  // Live re-validation on cart visit — checks current stock + price + buyability.
  // Skipped silently when cart is empty.
  const { data: avail } = useQuery({
    queryKey: ['offer-availability', offerIds.sort().join(',')],
    queryFn: () => fetchOffersAvailability(offerIds),
    enabled: offerIds.length > 0,
    staleTime: 0,                  // always fresh on visit
    refetchOnMount: 'always',
  })

  // Reconcile cart against live availability.
  // - if offer is not buyable → remove + toast
  // - if available < cart qty → reduce + toast
  // - if unit_price differs → update silently (no surprise on checkout)
  const reconciledRef = useRef<string>('')
  useEffect(() => {
    if (!avail) return
    const sig = avail.items.map(i => `${i.offer_id}:${i.available}:${i.unit_price}:${i.buyable}`).join('|')
    if (reconciledRef.current === sig) return
    reconciledRef.current = sig

    let removed = 0
    let reduced = 0
    let priced = 0
    for (const live of avail.items) {
      const item = cart.items.find(i => i.offerId === live.offer_id)
      if (!item) continue

      if (!live.buyable) {
        cart.remove(item.offerId)
        removed++
        continue
      }
      if (live.available < item.quantity) {
        cart.setQty(item.offerId, live.available)
        reduced++
      }
      if (live.unit_price > 0 && live.unit_price !== item.unitPrice) {
        // Update price silently — but only if the live price is positive.
        // Re-add merges-by-offerId, preserves quantity (clamped to available).
        cart.add({
          ...item,
          unitPrice: live.unit_price,
          available: live.available,
          quantity: 0,                 // add() merges; quantity 0 is a no-op
        })
        priced++
      }
    }
    if (removed) toast.error(`${removed} article${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} (indisponible)`)
    if (reduced) toast(`${reduced} quantité${reduced > 1 ? 's' : ''} ajustée${reduced > 1 ? 's' : ''} au stock`, { icon: '⚠️' })
    if (priced && !removed && !reduced) toast(`${priced} prix actualisé${priced > 1 ? 's' : ''}`, { icon: '💱' })
  }, [avail, cart])

  if (cart.items.length === 0) {
    return (
      <div className="page-enter max-w-[1400px] mx-auto px-6 py-8">
        <SEO title="Panier" description="Votre panier — Ghir Laffaire" noIndex />
        <Breadcrumbs items={[{ label: 'Panier' }]} />
        <div className="mt-12">
          <EmptyState
            icon={<ShoppingBag size={32} className="text-[var(--color-neon-yellow)] opacity-70" />}
            title="Votre panier est vide"
            desc="Ajoutez des produits pour passer commande. La livraison est offerte dès 50 000 DZD."
            action={<Link to="/c/all"><Button variant="accent">Explorer le catalogue</Button></Link>}
          />
        </div>
      </div>
    )
  }

  // Compute warnings to surface inline beside affected items
  const liveByOfferId = new Map((avail?.items ?? []).map(i => [i.offer_id, i]))

  const shipping = 0
  const total = cart.subtotal + shipping

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO title="Panier" description="Votre panier — Ghir Laffaire" noIndex />
      <Breadcrumbs items={[{ label: 'Panier' }]} />

      <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)] mt-4 mb-6">
        <span className="punk-stripe">Panier</span>
        <span className="text-[var(--color-text-3)] text-base font-medium ml-3">
          {cart.count} article{cart.count !== 1 ? 's' : ''}
        </span>
      </h1>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {cart.items.map(item => (
              <CartLine
                key={item.offerId}
                item={item}
                live={liveByOfferId.get(item.offerId)}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="glass-strong p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)]">
                Récapitulatif
              </h2>
            </div>
            <div className="flex flex-col gap-2 text-sm border-b border-[var(--color-surface-4)] pb-4 mb-4">
              <Row label="Sous-total" value={fmtMoney(cart.subtotal)} />
              <Row label="Livraison" value={shipping === 0 ? 'Calculée à la commande' : fmtMoney(shipping)} muted />
            </div>
            <div className="flex items-center justify-between mb-5">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">Total</span>
              <span className="num text-2xl font-black text-[var(--color-text-1)]">{fmtMoney(total)}</span>
            </div>
            <Link to="/checkout" className="block">
              <Button variant="accent" size="lg" className="w-full">
                Passer la commande <ArrowRight size={16} />
              </Button>
            </Link>
            <p className="text-[10px] text-[var(--color-text-3)] text-center mt-3 leading-relaxed">
              Paiement à la livraison dans toutes les wilayas. Un agent vous appellera pour confirmer.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}


function CartLine({ item, live }: { item: CartItem; live: OfferAvailability | undefined }) {
  const cart = useCart()

  // Inline warning state
  const warnings: string[] = []
  if (live) {
    if (!live.buyable) warnings.push("Indisponible")
    else if (live.available <= 0) warnings.push("En rupture")
    else if (live.available < item.quantity) warnings.push(`Stock limité à ${live.available}`)
    if (live.unit_price > 0 && live.unit_price !== item.unitPrice) {
      warnings.push(`Prix mis à jour : ${fmtMoney(live.unit_price)}`)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, height: 0 }}
      transition={{ duration: 0.2 }}
      className="glass p-4 flex gap-4 items-center"
    >
      <Link to={`/p/${item.productSlug}`} className="shrink-0 block">
        <div className="w-20 h-20 rounded-xl overflow-hidden no-img-placeholder flex items-center justify-center">
          {item.primaryImage
            ? <img src={item.primaryImage} alt="" className="w-full h-full object-contain p-2" />
            : <ImageIcon size={20} className="text-[var(--color-text-3)] opacity-40" />
          }
        </div>
      </Link>

      <div className="flex-1 min-w-0">
        <Link to={`/p/${item.productSlug}`} className="text-sm font-bold text-[var(--color-text-1)] line-clamp-2 hover:text-[var(--color-electric-blue)]">
          {item.productName}
        </Link>
        <div className="text-[10px] num text-[var(--color-text-3)] mt-1">{item.variantSku}</div>
        <div className="num text-xs text-[var(--color-text-2)] mt-1">{fmtMoney(item.unitPrice)} l’unité</div>
        {warnings.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {warnings.map((w, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[var(--color-hot-pink)]">
                <AlertTriangle size={10} /> {w}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="num text-base font-black text-[var(--color-text-1)]">
          {fmtMoney(item.unitPrice * item.quantity)}
        </div>
        <div className="inline-flex items-center rounded-lg border border-[var(--color-surface-4)] overflow-hidden">
          <button
            type="button"
            onClick={() => cart.setQty(item.offerId, item.quantity - 1)}
            className="w-8 h-8 flex items-center justify-center text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]"
            aria-label="Diminuer"
          >
            <Minus size={12} />
          </button>
          <span className="w-9 text-center num text-xs font-bold text-[var(--color-text-1)]">
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => cart.setQty(item.offerId, item.quantity + 1)}
            disabled={item.quantity >= (live?.available ?? item.available ?? 999)}
            className="w-8 h-8 flex items-center justify-center text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Augmenter"
          >
            <Plus size={12} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => cart.remove(item.offerId)}
          className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] flex items-center gap-1"
        >
          <Trash2 size={11} /> Retirer
        </button>
      </div>
    </motion.div>
  )
}


function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-text-3)] uppercase tracking-wider text-[10px] font-bold">{label}</span>
      <span className={muted ? 'text-[var(--color-text-3)]' : 'text-[var(--color-text-1)] num font-bold'}>{value}</span>
    </div>
  )
}
