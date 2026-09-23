/**
 * Contact — AMANTCOM.
 *
 * Ordered deliberately: real contact channels first, the form second.
 * Algerian retail shoppers default to phone, not web forms — but this
 * codebase does not ship a real phone number today. `Footer.tsx` renders
 * `+213 …` (a literal ellipsis placeholder, never completed), so it is
 * treated as absent rather than as a fact to repeat. What IS real and
 * sourced from the shipped code:
 *   · "Alger, Algérie" — Footer.tsx contact list
 *   · "58 wilayas" coverage — Home.tsx / Footer.tsx
 *   · "Paiement à la livraison" — Home.tsx / Footer.tsx / Checkout.tsx
 *   · `/order/track` — an existing route for shoppers who already ordered
 *
 * No delivery timeframe, no warranty/return claim: none of those exist
 * anywhere in this codebase, so none are written here.
 *
 * The form itself talks to the reviews/contact backend already shipped this
 * session (`POST /contact` via `submitContactMessage` in `@/lib/api`).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  MapPin, Truck, Wallet, PackageSearch, Send,
  CheckCircle2, AlertTriangle, MessageSquare,
} from 'lucide-react'
import { submitContactMessage, type ContactSubmission } from '@/lib/api'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ScrollReveal } from '@/components/ScrollReveal'
import { Button, Input, Textarea } from '@/components/ui'
import { SEO } from '@/components/SEO'

interface FormState {
  name: string
  phone: string
  email: string
  message: string
}

const EMPTY: FormState = { name: '', phone: '', email: '', message: '' }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type FieldErrors = Partial<Record<'name' | 'contact' | 'message', string>>

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})

  const mut = useMutation({
    mutationFn: (dto: ContactSubmission) => submitContactMessage(dto),
  })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function validate(): boolean {
    const next: FieldErrors = {}
    if (!form.name.trim() || form.name.trim().length < 2) {
      next.name = 'Nom requis'
    }
    if (!form.phone.trim() && !form.email.trim()) {
      next.contact = 'Indiquez un téléphone ou un email pour vous répondre'
    } else if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
      next.contact = 'Adresse email invalide'
    }
    if (!form.message.trim() || form.message.trim().length < 5) {
      next.message = 'Message trop court'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    mut.mutate({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      message: form.message.trim(),
    })
  }

  function resetForm() {
    setForm(EMPTY)
    setErrors({})
    mut.reset()
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Contact"
        description="Contactez AMANTCOM — coordonnées, livraison dans les 58 wilayas et formulaire de contact."
      />
      <Breadcrumbs items={[{ label: 'Contact' }]} />

      <div className="mt-4 mb-8">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Contact</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2 max-w-xl leading-relaxed">
          Une question sur une commande ou un produit ? Voici comment nous joindre.
        </p>
      </div>

      {/* ── Real contact channels — primary content ── */}
      <ScrollReveal variant="fade-up-sm">
        <div className="glass-strong p-6 mb-8 relative overflow-hidden">
          <div aria-hidden className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <h2 className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)] mb-4">
            Nos coordonnées
          </h2>
          <ul className="flex flex-col gap-4">
            <li className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                <MapPin size={16} className="text-[var(--color-electric-blue)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">Alger, Algérie</div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5">Adresse de l’entreprise</div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                <Truck size={16} className="text-[var(--color-electric-blue)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">Livraison dans les 58 wilayas</div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5">Toute l’Algérie est couverte</div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                <Wallet size={16} className="text-[var(--color-electric-blue)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">Paiement à la livraison</div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5">Vous payez à la réception, en espèces</div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--color-electric-blue)]/12 flex items-center justify-center shrink-0">
                <PackageSearch size={16} className="text-[var(--color-electric-blue)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">
                  Déjà commandé ?{' '}
                  <Link to="/order/track" className="text-[var(--color-electric-blue)] hover:underline">
                    Suivez votre commande
                  </Link>
                </div>
                <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                  Avec votre numéro de commande et votre téléphone
                </div>
              </div>
            </li>
          </ul>
          <p className="text-xs text-[var(--color-text-3)] mt-5 pt-4 border-t border-[var(--color-surface-4)] leading-relaxed">
            Aucune ligne téléphonique n’est publiée pour le moment. Écrivez-nous via le formulaire
            ci-dessous, nous reviendrons vers vous.
          </p>
        </div>
      </ScrollReveal>

      {/* ── Form — secondary content ── */}
      <ScrollReveal variant="fade-up-sm">
        <div className="glass p-6">
          <h2 className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4 flex items-center gap-2">
            <MessageSquare size={13} /> Écrivez-nous
          </h2>

          <AnimatePresence mode="wait">
            {mut.isSuccess ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center text-center gap-3 py-6"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 size={26} className="text-emerald-400" />
                </div>
                <p className="text-sm font-bold text-[var(--color-text-1)] max-w-sm">
                  {mut.data.message}
                </p>
                <Button variant="outline" size="sm" onClick={resetForm}>
                  Envoyer un autre message
                </Button>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={onSubmit}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="contact-name"
                    className="text-xs font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]"
                  >
                    Nom complet *
                  </label>
                  <Input
                    id="contact-name"
                    autoComplete="name"
                    value={form.name}
                    onChange={e => update('name', e.target.value)}
                    error={errors.name}
                    placeholder="Votre nom"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="contact-phone"
                      className="text-xs font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]"
                    >
                      Téléphone
                    </label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={e => update('phone', e.target.value)}
                      placeholder="0555 12 34 56"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="contact-email"
                      className="text-xs font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]"
                    >
                      Email
                    </label>
                    <Input
                      id="contact-email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={e => update('email', e.target.value)}
                      placeholder="vous@exemple.dz"
                    />
                  </div>
                </div>
                {errors.contact && (
                  <p className="-mt-2 text-xs text-[var(--color-hot-pink)]">{errors.contact}</p>
                )}
                {!errors.contact && (
                  <p className="-mt-2 text-xs text-[var(--color-text-3)]">
                    Au moins un des deux, pour que nous puissions vous répondre.
                  </p>
                )}

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="contact-message"
                    className="text-xs font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]"
                  >
                    Message *
                  </label>
                  <Textarea
                    id="contact-message"
                    value={form.message}
                    onChange={e => update('message', e.target.value)}
                    error={errors.message}
                    placeholder="Votre question ou votre message…"
                    rows={5}
                  />
                </div>

                {mut.isError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-[var(--color-hot-pink)]/30 bg-[var(--color-hot-pink)]/10 p-3.5">
                    <AlertTriangle size={15} className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
                    <p className="text-xs text-[var(--color-text-2)] leading-relaxed">
                      {(mut.error as Error).message || 'Une erreur est survenue. Réessayez.'}
                    </p>
                  </div>
                )}

                <Button type="submit" variant="accent" size="lg" loading={mut.isPending} className="mt-1 w-full sm:w-fit">
                  <Send size={14} /> Envoyer le message
                </Button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </ScrollReveal>
    </div>
  )
}
