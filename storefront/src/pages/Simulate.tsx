/**
 * /simulate — the full financing simulator.
 *
 *   /simulate?offer=<offerId>&qty=<n>&product=<slug>&down=<amount>&months=<n>
 *       one product; `product` is only used to show its name and picture
 *   /simulate
 *       the cart's lines (offer + quantity; the server re-prices them)
 *
 * `down` and `months` prefill the panel — they are what the panel itself
 * adds to the return URL when a signed-out shopper is sent to sign in. The
 * page renders no figure of its own: every financing figure lives in
 * <SimulatorPanel>, next to its <EstimateLabel>.
 */
import { useMemo, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Calculator, Info, ShoppingCart, Store } from 'lucide-react'
import { fetchProduct, type FinancingLineInput } from '@/lib/api'
import { useCart, type CartItem } from '@/lib/cart'
import { fmtMoney, NoImageIllustration } from '@/lib/format'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { EmptyState, Spinner } from '@/components/ui'
import { SEO } from '@/components/SEO'
import { SimulatorPanel } from '@/components/financing/SimulatorPanel'

// ── Query-string parsing ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[A-Za-z0-9_-]{1,200}$/
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/

function parseQuantity(raw: string | null): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

function parseMonths(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

function parseDown(raw: string | null): string | undefined {
  const v = raw?.trim()
  return v && DECIMAL_RE.test(v) ? v : undefined
}

/** Catalogue image URLs only: http(s) or a same-site path. */
function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url
  return null
}

const LINK_PRIMARY =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 transition-all ' +
  'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110 ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'
const LINK_OUTLINE =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl text-sm px-4 py-2.5 transition-all ' +
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'

// ── Page ──────────────────────────────────────────────────────────────────

export default function SimulatePage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const cart = useCart()

  const offerParam = params.get('offer')
  const offerId = offerParam && UUID_RE.test(offerParam) ? offerParam : null
  const quantity = parseQuantity(params.get('qty'))
  const productParam = params.get('product')
  const slug = productParam && SLUG_RE.test(productParam) ? productParam : null
  const initialDown = parseDown(params.get('down'))
  const initialMonths = parseMonths(params.get('months'))
  const returnTo = `${location.pathname}${location.search}`

  const lines = useMemo<FinancingLineInput[]>(
    () => offerId
      ? [{ offer_id: offerId, quantity }]
      : cart.items.map(i => ({ offer_id: i.offerId, quantity: i.quantity })),
    [offerId, quantity, cart.items],
  )

  let content: ReactNode
  if (offerParam !== null && offerId === null) {
    content = (
      <EmptyState
        icon={<Calculator size={44} aria-hidden="true" className="text-[var(--color-text-3)] opacity-40" />}
        title="Ce lien de simulation n’est pas valide."
        desc="Choisissez un produit dans le catalogue, ou simulez le financement de votre panier."
        action={<EmptyActions />}
      />
    )
  } else if (offerId) {
    content = (
      <>
        <SelectedProduct slug={slug} offerId={offerId} quantity={quantity} />
        <SimulatorPanel
          key={`offer:${offerId}`}
          lines={lines}
          initialDown={initialDown}
          initialMonths={initialMonths}
          returnTo={returnTo}
        />
      </>
    )
  } else if (cart.items.length > 0) {
    content = (
      <>
        <CartLines items={cart.items} subtotal={cart.subtotal} />
        <SimulatorPanel
          key="cart"
          lines={lines}
          initialDown={initialDown}
          initialMonths={initialMonths}
          returnTo={returnTo}
        />
      </>
    )
  } else {
    content = (
      <EmptyState
        icon={<Calculator size={44} aria-hidden="true" className="text-[var(--color-text-3)] opacity-40" />}
        title="Rien à simuler pour le moment"
        desc="Ajoutez un produit à votre panier, ou lancez une simulation depuis la fiche d’un produit."
        action={<EmptyActions />}
      />
    )
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SEO
        title="Simuler un financement"
        description="Estimez le financement de vos achats : choisissez une durée et votre apport, l’estimation est calculée selon les conditions en vigueur."
        noIndex
      />
      <Breadcrumbs items={[{ label: 'Simuler un financement' }]} />

      <div className="mt-4 mb-6">
        <h1 className="text-3xl md:text-4xl font-black text-[var(--color-text-1)]">
          Simuler un <span className="punk-stripe">financement</span>
        </h1>
        <p className="text-sm text-[var(--color-text-3)] mt-2 max-w-xl leading-relaxed">
          Choisissez une durée et votre apport pour obtenir une estimation calculée selon les
          conditions en vigueur.
        </p>
        <Link
          to="/financement"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-electric-blue)] hover:underline"
        >
          <Info size={14} aria-hidden="true" /> Comment fonctionne le financement
        </Link>
      </div>

      {content}
    </div>
  )
}

function EmptyActions() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link to="/c/all" className={LINK_PRIMARY}>
        <Store size={15} aria-hidden="true" /> Parcourir le catalogue
      </Link>
      <Link to="/cart" className={LINK_OUTLINE}>
        <ShoppingCart size={15} aria-hidden="true" /> Voir mon panier
      </Link>
    </div>
  )
}

// ── What is being simulated ───────────────────────────────────────────────

function SelectedProduct({
  slug, offerId, quantity,
}: { slug: string | null; offerId: string; quantity: number }) {
  const productQuery = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug as string),
    enabled: slug !== null,
  })

  if (slug !== null && productQuery.isPending) {
    return (
      <div role="status" className="glass p-4 mb-6 flex items-center gap-3 text-sm text-[var(--color-text-3)]">
        <Spinner size={16} className="text-[var(--color-electric-blue)]" />
        Chargement du produit…
      </div>
    )
  }

  const product = productQuery.data
  // Only name the product when the offer really is one of its own — a hand-
  // edited link must not put one product's name on another's simulation.
  const offer = product?.offers.find(o => o.id === offerId)

  if (!product || !offer) {
    return (
      <section aria-label="Article simulé" className="glass p-4 mb-6">
        <p className="text-sm text-[var(--color-text-2)]">
          Article sélectionné · Quantité : <span className="num font-bold text-[var(--color-text-1)]">{quantity}</span>
        </p>
      </section>
    )
  }

  const src = safeImageSrc(product.primary_image)
  const price = offer.sale_price ?? offer.retail_price

  return (
    <section aria-labelledby="simulate-product" className="glass p-4 mb-6 flex items-center gap-4">
      <div className="w-20 h-20 rounded-xl overflow-hidden no-img-placeholder flex items-center justify-center shrink-0">
        {src
          ? <img src={src} alt="" className="w-full h-full object-contain p-2" />
          : <NoImageIllustration category={product.category} name={product.name} size="sm" showLabel={false} />}
      </div>
      <div className="flex-1 min-w-0">
        <h2 id="simulate-product" className="text-sm font-bold text-[var(--color-text-1)] line-clamp-2">
          {product.name}
        </h2>
        <p className="text-xs text-[var(--color-text-3)] mt-1">
          <span className="num">{offer.variant_sku}</span> · Quantité : <span className="num">{quantity}</span>
        </p>
        <p className="text-xs text-[var(--color-text-3)] mt-0.5">
          Prix comptant : <span className="num font-bold text-[var(--color-text-2)]">{fmtMoney(price, offer.currency)}</span>
        </p>
        <Link
          to={`/p/${encodeURIComponent(slug as string)}`}
          className="mt-1.5 inline-block text-xs font-bold text-[var(--color-electric-blue)] hover:underline"
        >
          Voir le produit
        </Link>
      </div>
    </section>
  )
}

function CartLines({ items, subtotal }: { items: CartItem[]; subtotal: number }) {
  const currency = items[0]?.currency || 'DZD'
  return (
    <section aria-labelledby="simulate-cart" className="glass p-4 sm:p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="simulate-cart" className="text-sm font-black text-[var(--color-text-1)]">
          Articles de votre panier
        </h2>
        <Link to="/cart" className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline shrink-0">
          Modifier le panier
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li key={item.offerId} className="glass-sm flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text-1)] truncate">{item.productName}</p>
              <p className="text-[11px] num text-[var(--color-text-3)]">{item.variantSku} · ×{item.quantity}</p>
            </div>
            <p className="num text-sm font-bold text-[var(--color-text-1)] shrink-0">
              {fmtMoney(item.unitPrice * item.quantity, item.currency)}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t border-[var(--color-surface-4)] flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Sous-total</span>
        <span className="num text-base font-black text-[var(--color-text-1)]">{fmtMoney(subtotal, currency)}</span>
      </div>
      <p className="text-xs text-[var(--color-text-3)] mt-2 leading-relaxed">
        Les prix sont vérifiés auprès du catalogue au moment de l’estimation.
      </p>
    </section>
  )
}
