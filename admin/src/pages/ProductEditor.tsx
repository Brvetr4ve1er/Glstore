import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Save, Trash2, Plus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchProduct,
  createProduct,
  patchProduct,
  deleteProduct,
  type ProductInput,
  type OfferInput,
} from '@/lib/api'
import { Button, Card, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'

const CATEGORIES = [
  '', 'Smartphone', 'Laptop', 'Tablet', 'TV', 'Refrigerator',
  'Washing Machine', 'Audio', 'Gaming', 'Microwave', 'Oven',
  'Vacuum', 'Iron', 'Coffee Machine', 'Fan', 'AC', 'Accessory',
]

const STATUSES = ['RAW', 'NORMALIZED', 'CLASSIFIED', 'VERIFIED', 'ACTIVE', 'NEEDS_FIX', 'ARCHIVED']

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ''

interface FormState {
  sku: string
  slug: string
  name: string
  brand: string
  model: string
  category: string
  subcategory: string
  description: string
  barcode: string
  mpn: string
  status: string
  // initial offer (only used in create-mode)
  offer_sku: string
  offer_purchase_price: string
  offer_retail_price: string
  offer_sale_price: string
  offer_stock: string
}

const empty: FormState = {
  sku: '', slug: '', name: '', brand: '', model: '',
  category: '', subcategory: '', description: '',
  barcode: '', mpn: '', status: 'NORMALIZED',
  offer_sku: '', offer_purchase_price: '', offer_retail_price: '',
  offer_sale_price: '', offer_stock: '0',
}

export default function ProductEditor() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: existing, isPending: loading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id!),
    enabled: isEdit,
  })

  const [form, setForm] = useState<FormState>(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [slugTouched, setSlugTouched] = useState(false)

  // Hydrate form when editing
  useEffect(() => {
    if (!existing) return
    setForm({
      sku: existing.sku ?? '',
      slug: existing.slug ?? '',
      name: existing.name ?? '',
      brand: existing.brand ?? '',
      model: existing.model ?? '',
      category: existing.category ?? '',
      subcategory: existing.subcategory ?? '',
      description: existing.description ?? '',
      barcode: existing.barcode ?? '',
      mpn: existing.mpn ?? '',
      status: existing.status ?? 'NORMALIZED',
      offer_sku: '', offer_purchase_price: '', offer_retail_price: '',
      offer_sale_price: '', offer_stock: '0',
    })
    setSlugTouched(true)
  }, [existing])

  // Auto-derive slug from name in create mode unless user touched it
  useEffect(() => {
    if (isEdit) return
    if (slugTouched) return
    setForm(f => ({ ...f, slug: slugify(f.name) }))
  }, [form.name, slugTouched, isEdit])

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: '' }))
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!form.sku.trim())  next.sku  = 'Required'
    if (!form.name.trim()) next.name = 'Required'
    if (!form.slug.trim()) next.slug = 'Required'
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) next.slug = 'Lowercase letters, digits, hyphens only'

    if (!isEdit) {
      // initial offer is optional but if any offer field is set, both prices must be valid
      const anyOffer =
        form.offer_sku || form.offer_retail_price || form.offer_purchase_price || form.offer_stock !== '0'
      if (anyOffer) {
        if (!form.offer_sku.trim())              next.offer_sku = 'Required if adding offer'
        if (!form.offer_retail_price.trim())     next.offer_retail_price = 'Required'
        if (Number(form.offer_retail_price) < 0) next.offer_retail_price = 'Must be ≥ 0'
        if (form.offer_purchase_price && Number(form.offer_purchase_price) < 0)
          next.offer_purchase_price = 'Must be ≥ 0'
        if (form.offer_sale_price &&
            Number(form.offer_sale_price) > Number(form.offer_retail_price))
          next.offer_sale_price = 'Must be ≤ retail price'
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function buildPayload(): ProductInput {
    const offer: OfferInput | null =
      !isEdit && form.offer_sku
        ? {
            variant_sku: form.offer_sku,
            variant_attrs: {},
            purchase_price: Number(form.offer_purchase_price || 0),
            retail_price:   Number(form.offer_retail_price),
            sale_price:     form.offer_sale_price ? Number(form.offer_sale_price) : null,
            currency: 'DZD',
            stock_quantity: Number(form.offer_stock || 0),
            low_stock_threshold: 5,
          }
        : null

    return {
      sku: form.sku.trim(),
      slug: form.slug.trim(),
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      category: form.category || null,
      subcategory: form.subcategory.trim() || null,
      description: form.description.trim() || null,
      specs: {},
      barcode: form.barcode.trim() || null,
      mpn: form.mpn.trim() || null,
      ean: null,
      ...(offer ? { initial_offer: offer } : {}),
    }
  }

  const createMut = useMutation({
    mutationFn: () => createProduct(buildPayload()),
    onSuccess: (p) => {
      toast.success('Product created')
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate(`/products/${p.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const patchMut = useMutation({
    mutationFn: () => {
      const payload = buildPayload()
      // delete fields irrelevant to PATCH
      const { initial_offer, ...rest } = payload
      void initial_offer
      return patchProduct(id!, { ...rest, status: form.status as never })
    },
    onSuccess: () => {
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product', id] })
      navigate(`/products/${id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteProduct(id!, false),
    onSuccess: () => {
      toast.success('Product archived')
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate('/products')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    if (isEdit) patchMut.mutate()
    else        createMut.mutate()
  }

  function onDelete() {
    if (!isEdit) return
    if (!confirm(`Archive "${form.name}"? Offers will be deactivated. Order history is preserved.`)) return
    deleteMut.mutate()
  }

  if (isEdit && loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} className="text-[var(--color-electric-blue)]" />
      </div>
    )
  }

  const saving = createMut.isPending || patchMut.isPending

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Link to={isEdit ? `/products/${id}` : '/products'}
        className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] transition-colors w-fit">
        <ArrowLeft size={14} /> {isEdit ? 'Cancel · back to product' : 'Back to products'}
      </Link>

      <PageHeader
        title={isEdit ? 'Edit product' : 'New product'}
        sub={isEdit ? form.name : 'Add a product to your catalog'}
        actions={
          isEdit ? (
            <Button variant="danger" size="sm" onClick={onDelete} loading={deleteMut.isPending}>
              <Trash2 size={14} /> Archive
            </Button>
          ) : null
        }
      />

      <motion.form
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* ── Identity ── */}
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-4">
            Identity
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Name *"
              value={form.name}
              onChange={e => update('name', e.target.value)}
              error={errors.name}
              placeholder="TV SAMSUNG 55 4K UHD"
              autoFocus={!isEdit}
            />
            <Input
              label="SKU *"
              value={form.sku}
              onChange={e => update('sku', e.target.value)}
              error={errors.sku}
              placeholder="TV-SAM-55"
            />
            <Input
              label="Slug *"
              value={form.slug}
              onChange={e => { update('slug', e.target.value); setSlugTouched(true) }}
              error={errors.slug}
              placeholder="tv-samsung-55"
            />
            <Input
              label="Brand"
              value={form.brand}
              onChange={e => update('brand', e.target.value)}
              placeholder="SAMSUNG"
            />
            <Input
              label="Model"
              value={form.model}
              onChange={e => update('model', e.target.value)}
              placeholder="UE55AU7100"
            />
            <Select
              label="Category"
              value={form.category}
              onChange={e => update('category', e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c || 'none'} value={c}>{c || '— None —'}</option>
              ))}
            </Select>
            <Input
              label="Subcategory"
              value={form.subcategory}
              onChange={e => update('subcategory', e.target.value)}
              placeholder="Smart TV"
            />
            {isEdit && (
              <Select
                label="Status"
                value={form.status}
                onChange={e => update('status', e.target.value)}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
          </div>
        </Card>

        {/* ── Identifiers ── */}
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-4">
            Identifiers
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Barcode (EAN)"
              value={form.barcode}
              onChange={e => update('barcode', e.target.value)}
              placeholder="20675262366730"
            />
            <Input
              label="MPN"
              value={form.mpn}
              onChange={e => update('mpn', e.target.value)}
              placeholder="UE55AU7100UXXC"
            />
          </div>
        </Card>

        {/* ── Description ── */}
        <Card>
          <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em] mb-4">
            Description
          </h3>
          <Textarea
            value={form.description}
            onChange={e => update('description', e.target.value)}
            placeholder="Smart TV 55 pouces 4K UHD avec Tizen OS, 3 HDMI, WiFi…"
          />
        </Card>

        {/* ── Initial Offer (create mode only) ── */}
        {!isEdit && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-[var(--color-text-3)] uppercase tracking-[0.2em]">
                Initial offer
              </h3>
              <span className="text-[10px] text-[var(--color-text-3)]">Optional — leave blank to skip</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Variant SKU"
                value={form.offer_sku}
                onChange={e => update('offer_sku', e.target.value)}
                error={errors.offer_sku}
                placeholder="TV-SAM-55-BLK"
              />
              <Input
                label="Stock quantity"
                type="number" min={0}
                value={form.offer_stock}
                onChange={e => update('offer_stock', e.target.value)}
              />
              <Input
                label="Purchase price (DZD)"
                type="number" step="0.01" min={0}
                value={form.offer_purchase_price}
                onChange={e => update('offer_purchase_price', e.target.value)}
                error={errors.offer_purchase_price}
                placeholder="80000"
              />
              <Input
                label="Retail price (DZD)"
                type="number" step="0.01" min={0}
                value={form.offer_retail_price}
                onChange={e => update('offer_retail_price', e.target.value)}
                error={errors.offer_retail_price}
                placeholder="93000"
              />
              <Input
                label="Sale price (DZD)"
                type="number" step="0.01" min={0}
                value={form.offer_sale_price}
                onChange={e => update('offer_sale_price', e.target.value)}
                error={errors.offer_sale_price}
                placeholder="(optional)"
              />
            </div>
            <p className="mt-3 text-[11px] text-[var(--color-text-3)] flex items-start gap-2">
              <AlertTriangle size={12} className="text-[var(--color-neon-yellow)] mt-0.5 shrink-0" />
              You can add more variants & offers later from the product page.
            </p>
          </Card>
        )}

        {/* ── Submit row ── */}
        <div className="flex items-center justify-end gap-3">
          <Link to={isEdit ? `/products/${id}` : '/products'}>
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
          <Button type="submit" variant="accent" loading={saving} size="lg">
            {isEdit ? <Save size={15} /> : <Plus size={15} />}
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </motion.form>
    </div>
  )
}
