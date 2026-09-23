/**
 * ProductDetail — the hardest page in this catalogue.
 *
 * Measured against the real catalogue export (567 products): **0%** carry a
 * description, **0%** carry specs, **0%** carry an image. The default shape of
 * a product page — big photo, blurb, spec table — therefore renders as three
 * empty boxes on every single product in the shop.
 *
 * So this page is designed for absence instead of in spite of it:
 *
 *   · No image → `<NoImageIllustration size="lg" />`: the category mark at
 *     display scale on the shared tonal surface, captioned. Not a broken
 *     frame, not a grey box, not a gaming emoji.
 *   · No description / no specs → the whole editorial section is *gated*, not
 *     deleted. It stays intact for the day enrichment lands; until then a
 *     "Fiche produit" block presents what IS known — marque, catégorie,
 *     référence, code-barres, prix, disponibilité — as a deliberate identity
 *     record rather than a form with blank fields.
 *   · **Nothing is invented.** No fabricated blurbs, no fabricated specs, no
 *     claims that are not already in the codebase.
 *
 * Two more measured facts drive the layout: the source `category` column reads
 * "Electromenager" on all 567 rows, so the real category comes from
 * `classifyProductName()`; and `Rupture` is 6.7% of the catalogue, so
 * out-of-stock is a designed state, not an edge case.
 *
 * Reviews (migration 008) are wired read-only. 567/567 products have zero
 * today, so the zero state is a quiet verified line inside the fiche rather
 * than an empty "Avis" section shouting on every page.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Check, ShoppingBag, Truck, ShieldCheck, Sparkles, AlertTriangle,
  Minus, Plus, ThumbsUp, ThumbsDown, Quote, Star, Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchProduct, fetchProducts, type ProductDetail } from '@/lib/api'
import { fmtMoney } from '@/lib/format'
import { CategoryIcon, NoImageIllustration } from '@/lib/icons'
import { categoryLabel, classifyProductName } from '@/lib/taxonomy'
import { deriveTags } from '@/lib/tags'
import { useCart } from '@/lib/cart'
import { pushRecent } from '@/lib/recently-viewed'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductGallery } from '@/components/ProductGallery'
import { ProductCard } from '@/components/ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { Button, Tag, EmptyState } from '@/components/ui'
import { SEO } from '@/components/SEO'

/**
 * Reviews client, local on purpose.
 *
 * `lib/api.ts` has no reviews binding and neither `req` nor `BASE` is
 * exported from it — and api.ts is not this task's file to edit. So the one
 * endpoint this page needs is called directly, with the same base-URL rule the
 * rest of the client uses (same-origin `/api/v1` unless `VITE_API_URL` splits
 * the deploy apart). When api.ts grows a `fetchReviews`, delete this block and
 * import it instead.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

interface ReviewItem {
  id: string
  customer_name: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
}

interface ReviewList {
  items: ReviewItem[]
  page: number
  page_size: number
  total: number
  avg_rating: number | null
}

async function fetchProductReviews(productId: string): Promise<ReviewList> {
  const res = await fetch(`${API_BASE}/products/${productId}/reviews?page_size=6`, {
    headers: { 'x-request-id': crypto.randomUUID() },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<ReviewList>
}

/**
 * `GET /products/{id}` returns `avg_rating` / `review_count` since migration
 * 008 (api/routes/products.py:216-221) but `ProductDetail` in api.ts does not
 * declare them yet. Read them through this widening instead of `any`.
 */
type Merchandised = ProductDetail & {
  avg_rating?: number | null
  review_count?: number | null
}

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

  // The real taxonomy. `p.category` is "Electromenager" on all 567 rows, so the
  // product NAME is the only signal that distinguishes a fridge from a kettle.
  const catSlug = classifyProductName(p?.name)
  const catLabel = categoryLabel(catSlug)

  // Related. Filtering server-side on `category` would return "Electromenager",
  // i.e. the whole shop in arbitrary order — four random appliances under a
  // heading that promises relevance. Pull one full page (120 is the API cap)
  // and narrow it with the same classifier the rest of the storefront uses.
  const { data: related } = useQuery({
    queryKey: ['related', p?.category, p?.id],
    queryFn: () => fetchProducts({ category: p!.category!, page_size: 120, in_stock: 'true' }),
    enabled: !!p?.category,
    staleTime: 60_000,
  })
  const { items: relatedItems, sameFamily: relatedSameFamily } = useMemo(() => {
    const pool = (related?.items ?? []).filter(x => x.id !== p?.id)
    const family = pool.filter(x => classifyProductName(x.name) === catSlug)
    const enough = family.length >= 4
    return { items: (enough ? family : pool).slice(0, 4), sameFamily: enough }
  }, [related, p?.id, catSlug])

  // Reviews. Read-only, failure-tolerant: the list endpoint resolves its store
  // differently from the product endpoint, so a 4xx here must never turn into
  // an error state on a page that otherwise rendered fine.
  const { data: reviews } = useQuery({
    queryKey: ['reviews', p?.id],
    queryFn: () => fetchProductReviews(p!.id),
    enabled: !!p?.id,
    retry: false,
    staleTime: 60_000,
  })

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

  const merch = p as Merchandised
  const tags = deriveTags(p)
  const images = p.media.filter(m => m.kind === 'image' && m.url)

  // Rating summary: the list response is authoritative when it arrives, the
  // product payload covers the moment before it does. Both may be absent.
  const reviewItems = reviews?.items ?? []
  const ratingCount = reviews?.total ?? merch.review_count ?? 0
  const ratingAvg =
    reviews?.avg_rating ?? (typeof merch.avg_rating === 'number' ? merch.avg_rating : null)

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

  // Is there anything at all to put in the editorial body? On this catalogue
  // the answer is no for every product, and an ungated section would ship 64px
  // of margin followed by an empty two-column grid on all 567 pages.
  const hasEditorial = Boolean(
    p.description
    || (hooks?.length ?? 0) > 0
    || (pros?.length ?? 0) > 0
    || (cons?.length ?? 0) > 0
    || surfaceSpecs.length > 0
    || buyerFit
    || (sellingAngs?.length ?? 0) > 0
    || recommendation,
  )

  const hasBrand = Boolean(p.brand && p.brand.toUpperCase() !== 'INCONNU')
  // 160 of 567 products carry no brand at all. "Sans marque" is the honest
  // value and the second-largest bucket in the catalogue — it gets a row like
  // any other rather than a hidden field.
  const brandLabel = hasBrand ? p.brand! : 'Sans marque'
  const stockLabel = oos
    ? 'Rupture de stock'
    : (offer?.available ?? 0) <= 3
      ? `Plus que ${offer?.available}`
      : 'En stock'

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
  // built one from the DERIVED category + brand + price. The raw column would
  // put the word "Electromenager" in the meta description of all 567 pages.
  const seoDescription = (
    seoDesc
    || (p.description && p.description.length >= 50 ? p.description.slice(0, 156) : null)
    || `${[hasBrand ? p.brand : null, catLabel].filter(Boolean).join(' · ')}${unitPrice ? ' · ' + fmtMoney(unitPrice) : ''}. Livraison 48h en Algérie, paiement à la livraison.`
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
        { to: `/c/${catSlug}`, label: catLabel },
        { label: p.name },
      ]} />

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-8 lg:gap-12">
        {/* ── Visual ──
            With zero images in the catalogue the illustration IS the product
            shot, so it is rendered here at gallery scale rather than through
            ProductGallery's fallback — which resolves its icon from `category`
            alone and would draw the generic mark on every product. */}
        {images.length > 0 ? (
          <ProductGallery
            images={images.map(i => ({ url: i.url, alt: i.alt }))}
            productName={p.name}
            category={p.category}
          />
        ) : (
          <ScrollReveal variant="fade-up-sm" className="lg:sticky lg:top-32 lg:self-start">
            <div className="aspect-square glass overflow-hidden">
              <NoImageIllustration category={p.category} name={p.name} size="lg" />
            </div>
            <p className="mt-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              Aucun visuel disponible pour ce modèle
            </p>
          </ScrollReveal>
        )}

        {/* ── Buy box ── */}
        <ScrollReveal variant="fade-up-sm" className="flex flex-col gap-4">
          {/* Brand chip */}
          {hasBrand && (
            <Link
              to={`/c/all?brand=${encodeURIComponent(p.brand!)}`}
              className="text-xs font-black uppercase tracking-[0.22em] text-[var(--color-electric-blue)] w-fit hover:underline"
            >
              {p.brand}
            </Link>
          )}

          <h1 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)] leading-tight">
            {p.name}
          </h1>

          {/* Rating summary — only once a product actually has approved reviews */}
          {ratingCount > 0 && ratingAvg != null && (
            <div className="flex items-center gap-2.5">
              <Stars value={ratingAvg} />
              <span className="num text-sm font-black text-[var(--color-text-1)]">
                {ratingAvg.toFixed(1)}
              </span>
              {/* Only a link when the list actually rendered: the reviews
                  endpoint resolves its store differently from the product one,
                  so `review_count` can arrive without the section existing. */}
              {reviewItems.length > 0 ? (
                <a
                  href="#avis"
                  className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)]"
                >
                  {ratingCount} avis
                </a>
              ) : (
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                  {ratingCount} avis
                </span>
              )}
            </div>
          )}

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
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-2">
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
                    <span className="badge bg-[var(--color-hot-pink)] text-[var(--color-jet-black)]">
                      Promo
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--color-text-3)] mt-1 uppercase tracking-wider">
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

            {/* Out of stock is 6.7% of this catalogue — 38 products. It gets an
                explanation, not three greyed-out buttons and silence. */}
            {oos && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--color-surface-4)] bg-[var(--color-surface-3)]/50 p-3.5">
                <AlertTriangle size={15} className="text-[var(--color-text-3)] mt-0.5 shrink-0" />
                <p className="text-xs text-[var(--color-text-2)] leading-relaxed">
                  Ce modèle est en rupture : la commande est indisponible pour le moment.
                  La fiche reste en ligne avec sa référence et son prix.
                </p>
              </div>
            )}
          </div>

          {/* Trust strip */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Truck,       title: 'Livraison 48h',   desc: '58 wilayas' },
              { icon: ShieldCheck, title: 'COD',              desc: 'À la livraison' },
              { icon: Sparkles,    title: 'Vérifié',          desc: 'Stock honnête' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass-sm p-2.5 text-center">
                <Icon size={14} className="mx-auto text-[var(--color-electric-blue)] mb-1" />
                <div className="text-xs font-bold text-[var(--color-text-1)]">{title}</div>
                <div className="text-xs text-[var(--color-text-3)]">{desc}</div>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>

      {/* ── Editorial body — gated ──
          Every block below depends on enrichment that no product in this
          catalogue has yet. Kept whole, rendered only when there is something
          real to render. */}
      {hasEditorial && (
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
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400 mb-3 flex items-center gap-1.5">
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
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-hot-pink)] mb-3 flex items-center gap-1.5">
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
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)] mb-2 flex items-center gap-1.5">
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
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-electric-blue)] mb-3">
                    Pourquoi ce modèle
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {sellingAngs.slice(0, 5).map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-2)]">
                        <span className="num text-xs text-[var(--color-electric-blue)] font-black mt-0.5">{i + 1}</span>
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
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-text-3)] mb-1">
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
      )}

      {/* ── Fiche produit ──
          The page's centre of gravity when there is no description and no spec
          sheet: everything the shop can actually vouch for, laid out as a
          record. Always rendered — these six fields are filled on ~100% of the
          catalogue, so this block never comes up empty. */}
      <section className="mt-14 sm:mt-16">
        <ScrollReveal variant="fade-up-sm">
          <div className={`grid gap-6 ${hasEditorial ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]'}`}>
            <div className="glass p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-5">
                <CategoryIcon
                  category={p.category}
                  name={p.name}
                  size={26}
                  className="text-[var(--color-electric-blue)]"
                />
                <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
                  Fiche produit
                </h2>
              </div>

              <dl className="grid sm:grid-cols-2 gap-x-10">
                <IdRow label="Marque" value={brandLabel} muted={!hasBrand} />
                <IdRow label="Catégorie" value={catLabel} />
                <IdRow label="Référence" value={p.sku} mono />
                <IdRow label="Code-barres" value={p.barcode ?? 'Non communiqué'} mono={!!p.barcode} muted={!p.barcode} />
                {p.mpn && <IdRow label="MPN" value={p.mpn} mono />}
                <IdRow label="Prix" value={unitPrice != null ? fmtMoney(unitPrice, offer?.currency ?? 'DZD') : '—'} mono />
                <IdRow label="Disponibilité" value={stockLabel} muted={oos} />
              </dl>

              {/* Zero reviews is the state of 567/567 products today. One
                  honest line, inside a block that is already full, beats an
                  empty "Avis clients" section on every page in the shop. */}
              {ratingCount === 0 && (
                <p className="mt-5 pt-5 border-t border-[var(--color-surface-4)]/60 text-xs text-[var(--color-text-3)] leading-relaxed">
                  Aucun avis publié pour le moment — les avis clients sont vérifiés avant
                  d’apparaître sur la fiche.
                </p>
              )}
            </div>

            {/* The honest note. Only when there is genuinely nothing else: it
                explains the short page instead of letting it look broken. */}
            {!hasEditorial && (
              <div className="glass-sm p-6 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-[var(--color-text-3)]">
                  <Info size={15} className="shrink-0" />
                  <span className="text-xs font-black uppercase tracking-[0.18em]">
                    Pourquoi cette fiche est courte
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
                  Ni photo, ni description, ni fiche technique ne sont disponibles pour ce
                  modèle.
                </p>
                <p className="text-sm text-[var(--color-text-2)] leading-relaxed">
                  Plutôt que d’inventer un texte, nous n’affichons que ce que nous pouvons
                  vérifier : la référence exacte, le code-barres, le prix en dinars et le
                  stock réel.
                </p>
                <Link
                  to="/c/all"
                  className="mt-1 w-fit text-xs font-black uppercase tracking-[0.18em] text-[var(--color-electric-blue)] hover:underline"
                >
                  Parcourir le catalogue →
                </Link>
              </div>
            )}
          </div>
        </ScrollReveal>
      </section>

      {/* ── Avis clients ──
          Rendered only once approved reviews exist. Read-only by design: a
          submission form would put an unlabelled input on 567 pages. */}
      {reviewItems.length > 0 && (
        <section id="avis" className="mt-16 sm:mt-20">
          <ScrollReveal variant="fade-up-sm">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
                <span className="punk-stripe">Avis clients</span>
              </h2>
              {ratingAvg != null && (
                <div className="flex items-center gap-3">
                  <Stars value={ratingAvg} size={18} />
                  <span className="num text-xl font-black text-[var(--color-text-1)]">
                    {ratingAvg.toFixed(1)}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-3)]">
                    {ratingCount} avis vérifiés
                  </span>
                </div>
              )}
            </div>
          </ScrollReveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reviewItems.map(r => (
              <article key={r.id} className="glass p-5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Stars value={r.rating} />
                  <span className="num text-xs text-[var(--color-text-3)]">{fmtReviewDate(r.created_at)}</span>
                </div>
                {r.title && (
                  <h3 className="text-sm font-black text-[var(--color-text-1)] leading-snug">{r.title}</h3>
                )}
                {r.body && (
                  <p className="text-sm text-[var(--color-text-2)] leading-relaxed">{r.body}</p>
                )}
                <span className="mt-auto pt-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-3)]">
                  {r.customer_name}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Related products ── */}
      {relatedItems.length > 0 && (
        <section className="mt-16 sm:mt-20">
          <ScrollReveal variant="fade-up-sm">
            <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] mb-6 flex items-center gap-3">
              <CategoryIcon
                category={p.category}
                name={p.name}
                size={26}
                className="text-[var(--color-electric-blue)]"
              />
              <span className="punk-stripe">
                {relatedSameFamily ? `Autres produits · ${catLabel}` : 'Vous aimerez peut-être'}
              </span>
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

/** Reviews carry an ISO timestamp; a malformed one must not break the page. */
function fmtReviewDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('fr-DZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}


/** One line of the identity record. `<div>` inside `<dl>` is valid grouping. */
function IdRow({
  label, value, mono, muted,
}: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3 border-b border-[var(--color-surface-4)]/60">
      <dt className="shrink-0 text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
        {label}
      </dt>
      <dd
        className={[
          'text-right text-sm',
          mono ? 'num' : 'font-semibold',
          muted ? 'text-[var(--color-text-3)]' : 'text-[var(--color-text-1)]',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}


/** Five marks from the same family as every other icon on the page. */
function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const filled = Math.round(value)
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
          aria-hidden
          className={i <= filled ? 'text-[var(--color-neon-yellow)]' : 'text-[var(--color-text-3)]/35'}
          fill={i <= filled ? 'currentColor' : 'none'}
        />
      ))}
      <span className="sr-only">{value.toFixed(1)} sur 5</span>
    </span>
  )
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
      {/* A real label/id pair, not an aria-label: audit Critical #1 is that
          htmlFor appears zero times across the storefront's inputs. */}
      <label htmlFor="product-qty" className="sr-only">Quantité</label>
      <input
        id="product-qty"
        type="number"
        value={value}
        min={1}
        max={max}
        onChange={e => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(Math.max(1, Math.min(max, n)))
        }}
        disabled={disabled}
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
