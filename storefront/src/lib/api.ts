/* Public storefront API client — no auth required for browse endpoints. */

import {
  mockCategories,
  mockBrands,
  mockPriceBounds,
  mockFeatured,
  mockProducts,
  mockProduct,
  MOCK_DETAILS,
} from './mock-products'

const BASE = '/api/v1'

/** Mock mode — when `VITE_MOCK=1` (set in `.env.local` or build env),
 * all read endpoints resolve from `mock-products.ts` instead of fetch.
 * Write endpoints (orders, tracking) are stubbed so the cart/checkout
 * flow still produces a confirmation page. */
const MOCK = import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true'

function mockResolve<T>(path: string, method: string, body?: unknown): T | undefined {
  if (!MOCK) return undefined
  if (method === 'GET') {
    if (path === '/categories')             return mockCategories() as unknown as T
    if (path === '/brands/public')          return mockBrands() as unknown as T
    if (path === '/price-bounds')           return mockPriceBounds() as unknown as T
    if (path.startsWith('/products/featured')) {
      const limit = Number(new URLSearchParams(path.split('?')[1] ?? '').get('limit') ?? 12)
      return mockFeatured(limit) as unknown as T
    }
    if (path.startsWith('/products?')) {
      const qs = new URLSearchParams(path.split('?')[1] ?? '')
      const params: Record<string, string> = {}
      qs.forEach((v, k) => { params[k] = v })
      return mockProducts(params) as unknown as T
    }
    if (path.startsWith('/products/')) {
      const slug = path.replace('/products/', '').split('?')[0]
      const d = mockProduct(slug)
      if (d) return d as unknown as T
      throw new Error('Product not found')
    }
  }
  if (method === 'POST') {
    if (path === '/orders/create') {
      const dto = body as any
      const items = (dto.items ?? []).map((it: any, i: number) => {
        const det = Object.values(MOCK_DETAILS).find(p => p.offers.some(o => o.id === it.offer_id))
        return {
          id: `line-${i}`,
          product_name: det?.name ?? 'Item',
          variant_sku: det?.offers[0].variant_sku ?? 'SKU',
          unit_price: det?.offers[0].retail_price ?? 0,
          quantity: it.quantity,
          line_total: (det?.offers[0].retail_price ?? 0) * it.quantity,
        }
      })
      const subtotal = items.reduce((s: number, it: any) => s + it.line_total, 0)
      const orderNumber = 'GL-' + Math.random().toString(36).slice(2, 8).toUpperCase()
      const confirmation = {
        id: orderNumber,
        order_number: orderNumber,
        status: 'confirmed',
        payment_status: 'pending',
        payment_method: dto.payment_method ?? 'COD',
        subtotal,
        shipping_cost: dto.shipping_cost ?? 0,
        discount_amount: dto.discount_amount ?? 0,
        tax_amount: 0,
        total: subtotal + (dto.shipping_cost ?? 0) - (dto.discount_amount ?? 0),
        currency: 'DZD',
        items,
        created_at: new Date().toISOString(),
      }
      return confirmation as unknown as T
    }
    if (path === '/offers/availability') {
      const ids: string[] = (body as any)?.offer_ids ?? []
      const all = Object.values(MOCK_DETAILS).flatMap(p => p.offers.map(o => ({ p, o })))
      const items = ids.map(id => {
        const found = all.find(x => x.o.id === id)
        if (!found) {
          return { offer_id: id, product_id: null, variant_sku: null, unit_price: 0, retail_price: 0, sale_price: null, currency: 'DZD', available: 0, is_active: false, product_slug: null, product_name: null, product_status: null, primary_image: null, buyable: false }
        }
        return {
          offer_id: id,
          product_id: found.p.id,
          variant_sku: found.o.variant_sku,
          unit_price: found.o.sale_price ?? found.o.retail_price,
          retail_price: found.o.retail_price,
          sale_price: found.o.sale_price,
          currency: found.o.currency,
          available: found.o.available,
          is_active: found.o.is_active ?? true,
          product_slug: found.p.slug,
          product_name: found.p.name,
          product_status: found.p.status,
          primary_image: found.p.media[0]?.url ?? null,
          buyable: (found.o.available > 0) && (found.o.is_active ?? true),
        }
      })
      return { items } as unknown as T
    }
    if (path === '/orders/track') {
      throw new Error('Order tracking is unavailable in mock mode.')
    }
  }
  return undefined
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Mock short-circuit
  if (MOCK) {
    const mocked = mockResolve<T>(path, method, body)
    if (mocked !== undefined) {
      // small artificial latency so loading states still render
      await new Promise(r => setTimeout(r, 120))
      return mocked
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': crypto.randomUUID(),
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text)
      msg = parsed?.detail ?? parsed?.error ?? msg
    } catch {
      /* noop */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

// ── Catalog types ────────────────────────────────────────────
export interface ProductListItem {
  id: string
  sku: string
  slug: string
  name: string
  brand: string | null
  category: string | null
  specs: Record<string, unknown>
  completeness_score: number
  primary_image: string | null
  min_price: number | null
  available: number
  status?: string
}

export interface ProductListResult {
  items: ProductListItem[]
  page: number
  page_size: number
  total: number
}

export interface OfferOut {
  id: string
  variant_sku: string
  variant_attrs: Record<string, unknown>
  retail_price: number
  sale_price: number | null
  currency: string
  available: number
  stock_quantity?: number
  is_active?: boolean
}

export interface MediaItem {
  id?: string
  url: string
  kind: string
  is_primary: boolean
  alt: string | null
  position?: number
}

export interface ProductDetail extends ProductListItem {
  model: string | null
  subcategory: string | null
  description: string | null
  status: string
  updated_at: string
  barcode: string | null
  mpn: string | null
  offers: OfferOut[]
  media: MediaItem[]
}

export interface CategoryItem  { name: string; count: number }
export interface BrandItem     { name: string; count: number }
export interface PriceBounds   { min: number; max: number }

// ── Catalog endpoints ────────────────────────────────────────
export const fetchCategories = () =>
  req<{ items: CategoryItem[]; total: number }>('GET', '/categories')

export const fetchBrandsPublic = () =>
  req<{ items: BrandItem[] }>('GET', '/brands/public')

export const fetchPriceBounds = () =>
  req<PriceBounds>('GET', '/price-bounds')

export const fetchFeatured = (limit = 12) =>
  req<{ items: ProductListItem[] }>('GET', `/products/featured?limit=${limit}`)

export const fetchProducts = (params: Record<string, string | number | undefined>) => {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) filtered[k] = String(v)
  }
  const qs = new URLSearchParams(filtered).toString()
  return req<ProductListResult>('GET', `/products?${qs}`)
}

export const fetchProduct = (idOrSlug: string) =>
  req<ProductDetail>('GET', `/products/${idOrSlug}`)

// ── Order ────────────────────────────────────────────────────
export interface OrderLineInput {
  offer_id: string
  quantity: number
}

export interface ShippingAddressInput {
  wilaya: string
  commune: string
  street: string
  notes?: string
}

export interface OrderCreateInput {
  customer_phone: string
  customer_name: string
  customer_email?: string
  items: OrderLineInput[]
  shipping_address: ShippingAddressInput
  payment_method?: 'COD' | 'CARD' | 'BANK_TRANSFER' | 'WALLET'
  shipping_cost?: number
  discount_amount?: number
  notes?: string
  idempotency_key?: string
}

export interface OrderItemOut {
  id: string
  product_name: string
  variant_sku: string
  unit_price: number
  quantity: number
  line_total: number
}

export interface OrderConfirmation {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string
  subtotal: number
  shipping_cost: number
  discount_amount: number
  tax_amount: number
  total: number
  currency: string
  items: OrderItemOut[]
  created_at: string
}

export const createOrder = (dto: OrderCreateInput) =>
  req<OrderConfirmation>('POST', '/orders/create', dto)


// ── Cart re-validation ──────────────────────────────────────────────────
export interface OfferAvailability {
  offer_id: string
  product_id: string | null
  variant_sku: string | null
  unit_price: number
  retail_price: number
  sale_price: number | null
  currency: string
  available: number
  is_active: boolean
  product_slug: string | null
  product_name: string | null
  product_status: string | null
  primary_image: string | null
  buyable: boolean
}

export const fetchOffersAvailability = (offerIds: string[]) =>
  req<{ items: OfferAvailability[] }>(
    'POST',
    '/offers/availability',
    { offer_ids: offerIds },
  )


// ── Public order tracking ───────────────────────────────────────────────
export interface TrackedOrderItem {
  id: string
  product_name: string
  variant_sku: string
  unit_price: number
  quantity: number
  line_total: number
}

export interface TrackedOrder {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string
  subtotal: number
  shipping_cost: number
  discount_amount: number
  tax_amount: number
  total: number
  currency: string
  confirmed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  created_at: string
  customer_name: string
  items: TrackedOrderItem[]
}

export const trackOrder = (orderNumber: string, phone: string) =>
  req<TrackedOrder>('POST', '/orders/track', {
    order_number: orderNumber,
    phone,
  })
