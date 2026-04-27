import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Check, ShoppingBag, Truck, ShieldCheck, Sparkles, AlertTriangle,
  Minus, Plus, ThumbsUp, ThumbsDown, Quote,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchProduct, fetchProducts } from '@/lib/api'
import { fmtMoney, categoryIcon } from '@/lib/format'
import { deriveTags } from '@/lib/tags'
import { useCart } from '@/lib/cart'
import { pushRecent } from '@/lib/recently-viewed'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductGallery } from '@/components/ProductGallery'
import { ProductCard } from '@/components/ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { Button, Tag, EmptyState } from '@/components/ui'
import { SEO } from '@/components/SEO'

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const cart = useCart()

  const { data: p, isPending, isError } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug!),
    enabled: !!slug,
  })

  // Push to recently-viewed
  useEffect(() => {
    if (p?.id) pushRecent(p.id)
  }, [p?.id])

  // Default offer = first active with stock, else first
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  useEffect(() => {
    if (!p) return
    const activeOffers = p.offers.filter(o => o.is_active !== false)
    const inStock = activeOffers.find(o => (o.available ?? 0) > 0)
    setSelectedOfferId((inStock ?? activeOffers[0])?.id ?? p.offers[0]?.id ?? null)
  }, [p])

  const [qty, setQty] = useState(1)

  const offer = p?.offers.find(o => o.id === selectedOfferId) ?? p?.offers[0]
  const unitPrice = offer ? (offer.sale_price ?? offer.retail_price) : null
  const oos = !offer || offer.available <= 0

  // Related (same category, exclude this product)
  const { data: related } = useQuery({
    queryKey: ['related', p?.category, p?.id],
    queryFn: () => fetchProducts({ category: p!.category!, page_size: 8 }),
    enabled: !!p?.category,
    staleTime: 60_000,
  })
  const relatedItems = useMemo(
    () => (related?.items ?? []).filter(x => x.id !== p?.id).slice(0, 4),
    [related, p?.id],
  )

  if (isPending) return <SkeletonProduct />
  if (isError || !p) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-20">
        <EmptyState
          title="Produit introuvable"
          desc="Le lien est peut-être obsolète."
          action={<Link to="/c/all"><Button variant="accent">Retour au catalogue</Button></Link>}
        />
      </div>
    )
  }

  const tags = deriveTags(p)
  const images = p.media.filter(m => m.kind === 'image' && m.url)

  // LLM-generated aux fields (namespaced under specs._*)
  const sp = (p.specs ?? {}) as Record<string, unknown>
  const seoDesc      = pickStr(sp, '_seo_description')
  const sellingAngs  = pickArr(sp, '_selling_angles')
  const hooks        = pickArr(sp, '_marketing_hooks')
  const buyerFit     = pickStr(sp, '_buyer_fit')
  const pros         = pickArr(sp, '_pros')
  const cons         = pickArr(sp, '_cons')
  const recommendation = pickStr(sp, '_recommendation')

  // Surface specs (drop _-prefixed aux + ignore very long values)
  const surfaceSpecs = Object.entries(sp)
    .filter(([k]) => !k.startsWith('_') && k !== 'brand' && k !== 'sku')
    .filter(([, v]) => v != null && (typeof v === 'string' ? v.length < 120 : true))
    .slice(0, 12)

  function addToCart() {
    if (!p || !offer) return
    if (oos) return
    cart.add({
      productId: p.id,
      productName: p.name,
      productSlug: p.slug,
      primaryImage: images[0]?.url ?? null,
      offerId: offer.id,
      variantSku: offer.variant_sku,
      unitPrice: unitPrice ?? 0,
      currency: offer.currency,
      quantity: qty,
      available: offer.available,
      addedAt: Date.now(),
    })
    toast.success(`${p.name} ajouté au panier`)
  }

  function buyNow() {
    addToCart()
    setTimeout(() => navigate('/cart'), 100)
  }

  // SEO description: prefer the LLM-generated SEO description, fall back to a
  // built one from category + brand + price.
  const seoDescription = (
    seoDesc
    || (p.description && p.description.length >= 50 ? p.description.slice(0, 156) : null)
    || `${[p.brand, p.category].filter(Boolean).join(' · ')}${unitPrice ? ' · ' + fmtMoney(unitPrice) : ''}. Livraison 48h en Algérie, paiement à la livraison.`
  )
  const ogImage = images[0]?.url ?? null

  return (
    <div className="page-enter max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <SEO
        title={p.name}
        description={seoDescription}
        image={ogImage}
        type="product"
      />
      <Breadcrumbs items={[
        { to: '/c/all', label: 'Catalogue' },
        ...(p.category ? [{ to: `/c/${encodeURIComponent(p.category)}`, label: p.category }] : []),
        { label: p.name },
      ]} />

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-8 lg:gap-12">
        {/* ── Gallery ── */}
        <ProductGallery
          images={images.map(i => ({ url: i.url, alt: i.alt }))}
          productName={p.name}
          category={p.category}
        />

        {/* ── Buy box ── */}
        <ScrollReveal variant="fade-up-sm" className="flex flex-col gap-4">
          {/* Brand chip */}
          {p.brand && p.brand.toUpperCase() !== 'INCONNU' && (
            <Link
              to={`/c/all?brand=${encodeURIComponent(p.brand)}`}
              className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-electric-blue)] w-fit hover:underline"
            >
              {p.brand}
            </Link>
          )}

          <h1 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)] leading-tight">
            {p.name}
          </h1>

          {/* SEO description as lead */}
          {seoDesc && (
            <p className="text-sm md:text-base text-[var(--color-text-2)] leading-relaxed">
              {seoDesc}
            </p>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {tags.map((t, i) => <Tag key={i} label={t.label} tone={t.tone} />)}
            </div>
          )}

          {/* Variant picker */}
          {p.offers.length > 1 && (
            <div className="mt-3 glass-sm p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-2">
                Variante
              </div>
              <div className="flex flex-wrap gap-2">
                {p.offers.filter(o => o.is_active !== false).map(o => {
                  const active = o.id === selectedOfferId
                  const oos2 = (o.available ?? 0) <= 0
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={oos2}
                      onClick={() => { setSelectedOfferId(o.id); setQty(1) }}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                        active
                          ? 'border-[var(--color-electric-blue)] bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)]'
                          : oos2
                            ? 'border-[var(--color-surface-4)] text-[var(--color-text-3)] line-through cursor-not-allowed'
                            : 'border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)]/40'
                      }`}
                    >
                      {o.variant_sku}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Price */}
          <div className="glass p-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                {offer?.sale_price && offer.sale_price < offer.retail_price && (
                  <div className="num text-sm text-[var(--color-text-3)] line-through">
                    {fmtMoney(offer.retail_price, offer.currency)}
                  </div>
                )}
                <div className="num text-3xl md:text-4xl font-black text-[var(--color-text-1)] flex items-center gap-2">
                  {unitPrice != null ? fmtMoney(unitPrice, offer?.currency ?? 'DZD') : '—'}
                  {offer?.sale_price && offer.sale_price < offer.retail_price && (
                    <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--color-hot-pink)] text-[var(--color-jet-black)]">
                      Promo
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--color-text-3)] mt-1 uppercase tracking-wider">
                  TVA incluse · livraison calculée à la commande
                </div>
              </div>
              <StockBadge oos={oos} available={offer?.available ?? 0} />
            </div>

            {/* Qty + Add to cart */}
            <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_1fr] gap-2 mt-5">
              <QtyStepper
                value={qty}
                onChange={setQty}
                max={Math.max(1, offer?.available ?? 1)}
                disabled={oos}
              />
              <Button
                variant="outline"
                size="lg"
                onClick={addToCart}
                disabled={oos}
                className="col-span-2 sm:col-span-1"
              >
                <ShoppingBag size={16} /> Ajouter au panier
              </Button>
              <Button
                variant="accent"
                size="lg"
                onClick={buyNow}
                disabled={oos}
                className="col-span-2 sm:col-span-1"
              >
                Commander · {fmtMoney((unitPrice ?? 0) * qty, offer?.currency ?? 'DZD')}
              </Button>
            </div>
          </div>

          {/* Trust strip */}
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {[
              { icon: Truck,       title: 'Livraison 48h',   desc: '58 wilayas' },
              { icon: ShieldCheck, title: 'COD',              desc: 'À la livraison' },
              { icon: Sparkles,    title: 'Vérifié',          desc: 'Stock honnête' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass-sm p-2.5 text-center">
                <Icon size={14} className="mx-auto text-[var(--color-electric-blue)] mb-1" />
                <div className="font-bold text-[var(--color-text-1)]">{title}</div>
                <div className="text-[9px] text-[var(--color-text-3)]">{desc}</div>
              </div>
            ))}
          </div>

          {/* SKU + identifiers */}
          <div className="text-[10px] text-[var(--color-text-3)] flex flex-wrap gap-x-4 gap-y-1 num">
            <span>SKU: <span className="text-[var(--color-text-2)]">{p.sku}</span></span>
            {p.barcode && <span>EAN: <span className="text-[var(--color-text-2)]">{p.barcode}</span></span>}
            {p.mpn && <span>MPN: <span className="text-[var(--color-text-2)]">{p.mpn}</span></span>}
          </div>
        </ScrollReveal>
      </div>

      {/* ── Editorial body (description + pros/cons + buyer-fit) ── */}
      <section className="mt-16 grid lg:grid-cols-[1fr_360px] gap-8">
        <div className="flex flex-col gap-8">
          {/* Description */}
          {p.description && (
            <ScrollReveal variant="fade-up-sm">
              <article>
                <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] mb-3">
                  À propos de ce produit
                </h2>
                <p className="text-base text-[var(--color-text-2)] leading-relaxed">
                  {p.description}
                </p>
              </article>
            </ScrollReveal>
          )}

          {/* Hooks (pull-quote) */}
          {hooks && hooks.length > 0 && (
            <ScrollReveal variant="zoom-in">
              <blockquote className="glass-strong p-6 relative">
                <Quote size={28} className="absolute top-4 left-4 text-[var(--color-neon-yellow)] opacity-60" />
                <div className="pl-12 text-lg md:text-xl font-display italic text-[var(--color-text-1)] leading-snug">
                  {hooks[0]}
                </div>
                {hooks.length > 1 && (
                  <ul className="mt-4 pl-12 flex flex-col gap-2 text-sm text-[var(--color-text-2)]">
                    {hooks.slice(1, 3).map((h, i) => <li key={i}>· {h}</li>)}
                  </ul>
                )}
              </blockquote>
            </ScrollReveal>
          )}

          {/* Pros & Cons */}
          {(pros || cons) && ((pros?.length ?? 0) > 0 || (cons?.length ?? 0) > 0) && (
            <ScrollReveal variant="fade-up-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(pros?.length ?? 0) > 0 && (
                  <div className="glass p-5">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-3 flex items-center gap-1.5">
                      <ThumbsUp size={12} /> On aime
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {pros!.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-2)]">
                          <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(cons?.length ?? 0) > 0 && (
                  <div className="glass p-5">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-hot-pink)] mb-3 flex items-center gap-1.5">
                      <ThumbsDown size={12} /> À considérer
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {cons!.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-2)]">
                          <AlertTriangle size={13} className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollReveal>
          )}

          {/* Specs table */}
          {surfaceSpecs.length > 0 && (
            <ScrollReveal variant="fade-up-sm">
              <div>
                <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] mb-4">
                  Caractéristiques
                </h2>
                <div className="glass overflow-hidden">
                  {surfaceSpecs.map(([k, v], idx) => (
                    <div
                      key={k}
                      className={`grid grid-cols-[120px_1fr] sm:grid-cols-[180px_1fr] gap-4 px-5 py-3 text-sm ${
                        idx % 2 === 0 ? 'bg-transparent' : 'bg-[var(--color-surface-3)]/40'
                      }`}
                    >
                      <span className="text-[var(--color-text-3)] font-medium uppercase tracking-wide text-xs">
                        {prettyKey(k)}
                      </span>
                      <span className="text-[var(--color-text-1)] num">{prettyValue(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>
          )}
        </div>

        {/* Right column — sticky info */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-32 lg:self-start">
          {/* Buyer fit */}
          {buyerFit && (
            <ScrollReveal variant="slide-right">
              <div className="glass-strong p-5">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)] mb-2 flex items-center gap-1.5">
                  <Sparkles size={12} /> Pour qui ?
                </div>
                <p className="text-sm text-[var(--color-text-2)] leading-relaxed">{buyerFit}</p>
              </div>
            </ScrollReveal>
          )}

          {/* Selling angles */}
          {sellingAngs && sellingAngs.length > 0 && (
            <ScrollReveal variant="slide-right">
              <div className="glass p-5">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-electric-blue)] mb-3">
                  Pourquoi ce modèle
                </div>
                <ul className="flex flex-col gap-2.5">
                  {sellingAngs.slice(0, 5).map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-2)]">
                      <span className="num text-[10px] text-[var(--color-electric-blue)] font-black mt-0.5">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollReveal>
          )}

          {/* Recommendation badge */}
          {recommendation && (
            <ScrollReveal variant="slide-right">
              <div className={`glass-strong p-4 text-center ${
                recommendation === 'Bon Achat' ? 'glow-yellow' : ''
              }`}>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-1">
                  Verdict éditorial
                </div>
                <div className={`font-display text-2xl font-black ${
                  recommendation === 'Bon Achat' ? 'text-[var(--color-neon-yellow)]'
                  : recommendation === 'À éviter' ? 'text-[var(--color-hot-pink)]'
                  : 'text-[var(--color-text-1)]'
                }`}>
                  {recommendation}
                </div>
              </div>
            </ScrollReveal>
          )}
        </aside>
      </section>

      {/* ── Related products ── */}
      {relatedItems.length > 0 && (
        <section className="mt-20">
          <ScrollReveal variant="fade-up-sm">
            <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] mb-6 flex items-center gap-3">
              <span>{categoryIcon(p.category)}</span>
              <span className="punk-stripe">Vous aimerez peut-être</span>
            </h2>
          </ScrollReveal>
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
            variants={STAGGER_CONTAINER}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
          >
            {relatedItems.map(rp => (
              <motion.div key={rp.id} variants={STAGGER_ITEM}>
                <ProductCard product={rp} />
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}
    </div>
  )
}


// ── helpers ────────────────────────────────────────────────────────────────

function pickStr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k]
  if (typeof v === 'string' && v.trim()) return v
  if (typeof v === 'number') return String(v)
  return null
}
function pickArr(o: Record<string, unknown>, k: string): string[] | null {
  const v = o[k]
  if (Array.isArray(v)) return v.map(String).filter(s => !!s)
  return null
}
function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function prettyValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.map(String).join(' · ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}


function StockBadge({ oos, available }: { oos: boolean; available: number }) {
  if (oos) {
    return (
      <span className="badge bg-[var(--color-surface-3)] text-[var(--color-text-3)] border border-[var(--color-surface-4)]">
        Rupture
      </span>
    )
  }
  if (available <= 3) {
    return (
      <span className="badge bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/30">
        Plus que {available} !
      </span>
    )
  }
  return (
    <span className="badge bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
      En stock
    </span>
  )
}


function QtyStepper({
  value, onChange, max, disabled,
}: { value: number; onChange: (n: number) => void; max: number; disabled: boolean }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-[var(--color-surface-4)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={disabled || value <= 1}
        className="w-10 h-12 flex items-center justify-center text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Diminuer la quantité"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        value={value}
        min={1}
        max={max}
        onChange={e => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(Math.max(1, Math.min(max, n)))
        }}
        disabled={disabled}
        aria-label="Quantité"
        className="w-12 h-12 bg-transparent text-center num font-bold text-[var(--color-text-1)] outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        className="w-10 h-12 flex items-center justify-center text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Augmenter la quantité"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}


function SkeletonProduct() {
  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="grid lg:grid-cols-[1fr_420px] gap-8">
        <div className="aspect-square shimmer rounded-2xl" />
        <div className="flex flex-col gap-4">
          <div className="shimmer h-6 w-1/3 rounded" />
          <div className="shimmer h-10 w-full rounded" />
          <div className="shimmer h-4 w-3/4 rounded" />
          <div className="shimmer h-32 w-full rounded-2xl mt-4" />
        </div>
      </div>
    </div>
  )
}
