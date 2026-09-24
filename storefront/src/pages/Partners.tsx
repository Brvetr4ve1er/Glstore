/**
 * /partenaires — a point of sale applies to work with the store.
 *
 * Claims discipline, strictest here: no partner benefits, commissions,
 * volumes, response times, partner counts or logos. The page says what
 * happens (the request is recorded and studied) and nothing it cannot back.
 *
 * The server answers every submission — first or repeat — with the same
 * message, so the form reveals nothing about who has already applied.
 */
import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import {
  applyAsPartner, PARTNER_ACTIVITY_LABELS,
  type PartnerActivity, type PartnerApplicationInput,
} from '@/lib/api'
import { WILAYAS } from '@/lib/wilayas'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { SEO } from '@/components/SEO'

interface FormState {
  business_name: string
  activity: PartnerActivity | ''
  contact_name: string
  owner_name: string
  phone: string
  email: string
  wilaya_code: string
  commune: string
  address: string
  reason: string
}

const EMPTY: FormState = {
  business_name: '', activity: '', contact_name: '', owner_name: '', phone: '',
  email: '', wilaya_code: '', commune: '', address: '', reason: '',
}

type Errors = Partial<Record<keyof FormState, string>>

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function validatePartnerForm(f: FormState): Errors {
  const e: Errors = {}
  if (!f.business_name.trim()) e.business_name = 'Nom du point de vente requis'
  if (!f.activity) e.activity = 'Choisissez une activité'
  if (!f.contact_name.trim()) e.contact_name = 'Nom du contact requis'
  if (f.phone.replace(/\D/g, '').length < 8) e.phone = 'Numéro incomplet (fixe ou mobile)'
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Adresse e-mail invalide'
  if (!f.wilaya_code) e.wilaya_code = 'Choisissez une wilaya'
  if (!f.commune.trim()) e.commune = 'Commune requise'
  if (!f.address.trim()) e.address = 'Adresse requise'
  return e
}

export default function PartnersPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const mut = useMutation({ mutationFn: (dto: PartnerApplicationInput) => applyAsPartner(dto) })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validatePartnerForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0 || !form.activity) return
    mut.mutate({
      business_name: form.business_name.trim(),
      activity: form.activity,
      contact_name: form.contact_name.trim(),
      owner_name: form.owner_name.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      wilaya_code: form.wilaya_code,
      commune: form.commune.trim(),
      address: form.address.trim(),
      reason: form.reason.trim() || null,
    })
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Devenir partenaire"
        description="Point de vente en Algérie ? Présentez votre commerce à AMANTCOM."
      />
      <Breadcrumbs items={[{ label: 'Devenir partenaire' }]} />

      <div className="mt-4 mb-8">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          <span className="punk-stripe">Devenir partenaire</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2 max-w-xl leading-relaxed">
          Vous tenez un point de vente et souhaitez travailler avec AMANTCOM ? Présentez votre
          commerce : votre demande est enregistrée et étudiée par notre équipe.
        </p>
      </div>

      {mut.isSuccess ? (
        <div role="status" className="glass-strong p-6 flex items-start gap-3">
          <CheckCircle2 size={20} aria-hidden="true" className="text-[var(--color-success)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-[var(--color-text-1)]">{mut.data.message}</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setForm(EMPTY); mut.reset() }}>
              Envoyer une autre demande
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="glass p-6 flex flex-col gap-5">
          <fieldset className="grid sm:grid-cols-2 gap-4">
            <legend className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)] mb-3">
              Votre point de vente
            </legend>
            <Input label="Nom du point de vente" value={form.business_name} maxLength={160}
                   onChange={e => update('business_name', e.target.value)} error={errors.business_name} required />
            <Select label="Activité" value={form.activity} error={errors.activity}
                    onChange={e => update('activity', e.target.value as PartnerActivity | '')} required>
              <option value="">Choisir…</option>
              {(Object.keys(PARTNER_ACTIVITY_LABELS) as PartnerActivity[]).map(a => (
                <option key={a} value={a}>{PARTNER_ACTIVITY_LABELS[a]}</option>
              ))}
            </Select>
            <Select label="Wilaya" value={form.wilaya_code} error={errors.wilaya_code}
                    onChange={e => update('wilaya_code', e.target.value)} required>
              <option value="">Choisir…</option>
              {WILAYAS.map(w => <option key={w.code} value={w.code}>{w.code} · {w.name}</option>)}
            </Select>
            <Input label="Commune" value={form.commune} maxLength={120}
                   onChange={e => update('commune', e.target.value)} error={errors.commune} required />
            <div className="sm:col-span-2">
              <Input label="Adresse" value={form.address} maxLength={300} autoComplete="street-address"
                     onChange={e => update('address', e.target.value)} error={errors.address} required />
            </div>
          </fieldset>

          <fieldset className="grid sm:grid-cols-2 gap-4">
            <legend className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)] mb-3">
              Contact
            </legend>
            <Input label="Nom du contact" value={form.contact_name} maxLength={120} autoComplete="name"
                   onChange={e => update('contact_name', e.target.value)} error={errors.contact_name} required />
            <Input label="Téléphone (fixe ou mobile)" type="tel" inputMode="tel" autoComplete="tel"
                   value={form.phone} maxLength={30}
                   onChange={e => update('phone', e.target.value)} error={errors.phone} required />
            <Input label="E-mail (facultatif)" type="email" autoComplete="email" value={form.email} maxLength={320}
                   onChange={e => update('email', e.target.value)} error={errors.email} />
            <Input label="Propriétaire du commerce (facultatif)" value={form.owner_name} maxLength={120}
                   onChange={e => update('owner_name', e.target.value)} />
            <div className="sm:col-span-2">
              <Textarea label="Votre demande (facultatif)" value={form.reason} maxLength={2000}
                        onChange={e => update('reason', e.target.value)} />
            </div>
          </fieldset>

          {mut.isError && (
            <p role="alert" className="text-sm text-[var(--color-hot-pink)]">
              La demande n’a pas pu être envoyée. Vérifiez les champs puis réessayez.
            </p>
          )}

          <Button type="submit" variant="accent" size="lg" loading={mut.isPending} className="self-start">
            Envoyer ma demande
          </Button>
        </form>
      )}
    </div>
  )
}
