/* Public storefront API client — no auth required for browse endpoints. */

const BASE = '/api/v1'

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
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
