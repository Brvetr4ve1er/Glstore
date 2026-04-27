import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ShoppingBag, Lock, ChevronLeft, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCart } from '@/lib/cart'
import { createOrder, type OrderCreateInput } from '@/lib/api'
import { fmtMoney } from '@/lib/format'
import { WILAYAS } from '@/lib/wilayas'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Button, Input, Select, Textarea, EmptyState } from '@/components/ui'
import { SEO } from '@/components/SEO'

interface FormState {
  customer_name: string
  customer_phone: string
  customer_email: string
  wilaya: string
  commune: string
  street: string
  notes: string
}

const EMPTY: FormState = {
  customer_name: '', customer_phone: '', customer_email: '',
  wilaya: '', commune: '', street: '', notes: '',
}

const PHONE_RE = /^(\+213|0)?[5-7]\d{8}$/

export default function CheckoutPage() {
  const cart = useCart()
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  const mut = useMutation({
    mutationFn: (dto: OrderCreateInput) => createOrder(dto),
    onSuccess: (order) => {
      toast.success(`Commande ${order.order_number} créée`)
      cart.clear()
      navigate(`/order/confirmation/${order.id}`, {
        replace: true,
        state: { order },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (cart.items.length === 0) {
    return (
      <div className="page-enter max-w-[1400px] mx-auto px-6 py-12">
        <SEO title="Commande" description="Finaliser votre commande — Ghir Laffaire" noIndex />
        <Breadcrumbs items={[{ to: '/cart', label: 'Panier' }, { label: 'Commande' }]} />
        <div className="mt-12">
          <EmptyState
            icon={<ShoppingBag size={32} className="text-[var(--color-neon-yellow)] opacity-70" />}
            title="Aucun article à commander"
            desc="Votre panier est vide."
            action={<Link to="/c/all"><Button variant="accent">Explorer le catalogue</Button></Link>}
          />
        </div>
      </div>
    )
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.customer_name.trim() || form.customer_name.trim().length < 2) next.customer_name = 'Nom requis'
    if (!PHONE_RE.test(form.customer_phone.replace(/\s/g, ''))) {
      next.customer_phone = 'Téléphone invalide (ex. 0555123456 ou +213555123456)'
    }
    if (form.customer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.customer_email.trim())) {
      next.customer_email = 'Adresse email invalide'
    }
    if (!form.wilaya) next.wilaya = 'Wilaya requise'
    if (!form.commune.trim()) next.commune = 'Commune requise'
    if (!form.street.trim() || form.street.trim().length < 4) next.street = 'Adresse trop courte'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    const dto: OrderCreateInput = {
      customer_phone: form.customer_phone.replace(/\s/g, ''),
      customer_name: form.customer_name.trim(),
      customer_email: form.customer_email.trim() || undefined,
      items: cart.items.map(i => ({ offer_id: i.offerId, quantity: i.quantity })),
      shipping_address: {
        wilaya: form.wilaya,
        commune: form.commune.trim(),
        street: form.street.trim(),
        notes: form.notes.trim() || undefined,
      },
      payment_method: 'COD',
      idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      notes: form.notes.trim() || undefined,
    }
    mut.mutate(dto)
  }

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO title="Commande" description="Finaliser votre commande — Ghir Laffaire" noIndex />
      <Breadcrumbs items={[{ to: '/cart', label: 'Panier' }, { label: 'Commande' }]} />

      <div className="mt-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Commande</span>
        </h1>
        <Link to="/cart" className="text-xs text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] flex items-center gap-1">
          <ChevronLeft size={12} /> Retour au panier
        </Link>
      </div>

      <form onSubmit={onSubmit} className="grid lg:grid-cols-[1fr_360px] gap-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-6"
        >
          {/* Contact */}
          <Section title="Vos coordonnées">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Nom complet *"
                autoComplete="name"
                value={form.customer_name}
                onChange={e => update('customer_name', e.target.value)}
                error={errors.customer_name}
                placeholder="Sofiane Bouali"
              />
              <Input
                label="Téléphone *"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.customer_phone}
                onChange={e => update('customer_phone', e.target.value)}
                error={errors.customer_phone}
                placeholder="0555 12 34 56"
              />
              <div className="sm:col-span-2">
                <Input
                  label="Email (optionnel)"
                  type="email"
                  autoComplete="email"
                  value={form.customer_email}
                  onChange={e => update('customer_email', e.target.value)}
                  error={errors.customer_email}
                  hint="Pour recevoir la confirmation par email"
                  placeholder="vous@exemple.dz"
                />
              </div>
            </div>
          </Section>

          {/* Address */}
          <Section title="Adresse de livraison">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Wilaya *"
                value={form.wilaya}
                onChange={e => update('wilaya', e.target.value)}
                error={errors.wilaya}
              >
                <option value="">— Choisir —</option>
                {WILAYAS.map(w => (
                  <option key={w.code} value={w.name}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Commune *"
                value={form.commune}
                onChange={e => update('commune', e.target.value)}
                error={errors.commune}
                placeholder="Bab Ezzouar"
              />
              <div className="sm:col-span-2">
                <Input
                  label="Adresse complète *"
                  value={form.street}
                  onChange={e => update('street', e.target.value)}
                  error={errors.street}
                  placeholder="Cité 1000 logements, Bât B, Apt 12"
                />
              </div>
              <div className="sm:col-span-2">
                <Textarea
                  label="Indications complémentaires"
                  value={form.notes}
                  onChange={e => update('notes', e.target.value)}
                  placeholder="Étage, point de repère, horaires…"
                />
              </div>
            </div>
          </Section>

          {/* Payment */}
          <Section title="Paiement">
            <label className="glass p-5 cursor-pointer flex items-center gap-4">
              <input type="radio" checked readOnly className="accent-[var(--color-neon-yellow)]" />
              <div className="flex-1">
                <div className="font-bold text-[var(--color-text-1)] text-sm">Paiement à la livraison</div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                  Vous payez en espèces au livreur. Aucune carte requise.
                </div>
              </div>
              <Lock size={14} className="text-[var(--color-text-3)]" />
            </label>
          </Section>
        </motion.div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="glass-strong p-5">
            <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-4">
              Votre commande
            </h2>
            <ul className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1 mb-4">
              {cart.items.map(i => (
                <li key={i.offerId} className="flex gap-3 items-center">
                  <div className="w-12 h-12 rounded-md overflow-hidden no-img-placeholder shrink-0 flex items-center justify-center">
                    {i.primaryImage
                      ? <img src={i.primaryImage} alt="" className="w-full h-full object-contain p-1" />
                      : <ImageIcon size={14} className="text-[var(--color-text-3)] opacity-40" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[var(--color-text-1)] line-clamp-1">{i.productName}</div>
                    <div className="text-[10px] num text-[var(--color-text-3)]">{i.variantSku} · ×{i.quantity}</div>
                  </div>
                  <div className="num text-xs font-bold text-[var(--color-text-1)]">
                    {fmtMoney(i.unitPrice * i.quantity)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--color-surface-4)] pt-4 flex flex-col gap-2 text-sm">
              <Row label="Sous-total" value={fmtMoney(cart.subtotal)} />
              <Row label="Livraison" value="Calculée par l’agent" muted />
            </div>
            <div className="flex items-center justify-between mt-4 mb-5">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">Total</span>
              <span className="num text-2xl font-black text-[var(--color-text-1)]">{fmtMoney(cart.subtotal)}</span>
            </div>
            <Button
              type="submit"
              variant="accent"
              size="lg"
              loading={mut.isPending}
              className="w-full"
            >
              Confirmer la commande
            </Button>
            <p className="text-[10px] text-[var(--color-text-3)] text-center mt-3 leading-relaxed">
              Un agent vous appellera dans les <span className="text-[var(--color-text-1)] font-bold">24h</span> pour confirmer.
              Aucun paiement n'est prélevé maintenant.
            </p>
          </div>
        </aside>
      </form>
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-6">
      <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-text-3)] uppercase tracking-wider text-[10px] font-bold">{label}</span>
      <span className={muted ? 'text-[var(--color-text-3)] text-xs' : 'text-[var(--color-text-1)] num font-bold text-sm'}>{value}</span>
    </div>
  )
}
