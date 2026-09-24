/* Public storefront API client — no auth required for browse endpoints. */

// Same-origin by default: on the all-Vercel deploy the storefront and the API
// share a domain, so "/api/v1" is rewritten to the Python function — no config
// needed. Set VITE_API_URL to an absolute base only if you split them apart.
const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

// ── Customer session token ───────────────────────────────────
// An opaque token from POST /auth/customer/verify (never a JWT; see
// api/routes/customer_auth.py). Held here rather than in lib/session.tsx so
// the request helper can attach it without a React import cycle.
const SESSION_KEY = 'amc.session'
export const SESSION_EXPIRED_EVENT = 'amc:session-expired'

export function getSessionToken(): string | null {
  try { return localStorage.getItem(SESSION_KEY) } catch { return null }
}
export function setSessionToken(token: string): void {
  try { localStorage.setItem(SESSION_KEY, token) } catch { /* private mode */ }
}
export function clearSessionToken(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* private mode */ }
}

/** A failed request. `detail` is the server's raw payload: a string, a list
 *  of validation errors, or — on the financing routes — an object such as
 *  `{message, missing_profile, missing_documents, reasons}`. */
export class ApiError extends Error {
  status: number
  detail: unknown
  /** Seconds from the server's Retry-After header (429s), when it sent one. */
  retryAfter: number | null
  constructor(status: number, message: string, detail: unknown, retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

function detailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map(d => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : '')).filter(Boolean).join(' · ') || fallback
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return fallback
}

async function send<T>(method: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('x-request-id', crypto.randomUUID())
  const token = getSessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${BASE}${path}`, { ...init, method, headers, signal })
  if (!res.ok) {
    const text = await res.text()
    let detail: unknown = undefined
    let msg = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.detail ?? parsed?.error
      msg = detailMessage(detail, msg)
    } catch {
      /* noop */
    }
    if (res.status === 401 && token) {
      clearSessionToken()
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
    const retry = Number(res.headers.get('Retry-After'))
    throw new ApiError(res.status, msg, detail, Number.isFinite(retry) && retry > 0 ? retry : null)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return send<T>(method, path, {
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, signal)
}

/** multipart/form-data: no Content-Type header, the browser sets the boundary. */
async function reqMultipart<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return send<T>('POST', path, { body: form }, signal)
}

/** One path segment. Every id or slug that reaches a URL path goes through
 *  this: a route param like `..%2F..%2Fauth%2Fcustomer%2Flogout` would
 *  otherwise walk the request — carrying the session token — to another
 *  endpoint. Encoded, it stays one (invalid) segment and the API rejects it. */
function seg(v: string): string {
  // "." and ".." survive encodeURIComponent, and the URL parser treats even
  // "%2e%2e" as a parent-directory segment — so a pure-dot segment is replaced
  // outright with one no route can match.
  if (/^\.+$/.test(v)) return '_'
  return encodeURIComponent(v)
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
  req<ProductDetail>('GET', `/products/${seg(idOrSlug)}`)

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

// ── Reviews (migration 008) ─────────────────────────────────────
export interface ReviewItem {
  id: string
  customer_name: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
}

export interface ReviewList {
  items: ReviewItem[]
  page: number
  page_size: number
  total: number
  avg_rating: number | null
}

export interface ReviewSubmission {
  customer_name: string
  rating: number
  title?: string | null
  body?: string | null
}

export const fetchReviews = (productId: string, pageSize = 6) =>
  req<ReviewList>('GET', `/products/${seg(productId)}/reviews?page_size=${pageSize}`)

export const submitReview = (productId: string, dto: ReviewSubmission) =>
  req<{ id: string; status: string; created_at: string; message: string }>(
    'POST', `/products/${seg(productId)}/reviews`, dto,
  )

// ── Newsletter (migration 008) ──────────────────────────────────
export const subscribeNewsletter = (email: string) =>
  req<{ subscribed: boolean; message: string }>('POST', '/newsletter', { email })

// ── Contact (migration 009) ─────────────────────────────────────
export interface ContactSubmission {
  name: string
  phone?: string | null
  email?: string | null
  message: string
}

export const submitContactMessage = (dto: ContactSubmission) =>
  req<{ id: string; created_at: string; message: string }>('POST', '/contact', dto)

// ── Partner applications (migration 014) ────────────────────────
export type PartnerActivity = 'ELECTROMENAGER' | 'MULTIMEDIA' | 'MEUBLE' | 'GENERALISTE' | 'AUTRE'

export const PARTNER_ACTIVITY_LABELS: Record<PartnerActivity, string> = {
  ELECTROMENAGER: 'Électroménager',
  MULTIMEDIA: 'Multimédia',
  MEUBLE: 'Meuble',
  GENERALISTE: 'Commerce généraliste',
  AUTRE: 'Autre activité',
}

export interface PartnerApplicationInput {
  business_name: string
  activity: PartnerActivity
  contact_name: string
  owner_name?: string | null
  /** Landlines accepted — at least 8 digits. */
  phone: string
  email?: string | null
  /** "01"…"58" */
  wilaya_code: string
  commune: string
  address: string
  reason?: string | null
}

/** Always the same success message, first application or repeat. 422: invalid field. */
export const applyAsPartner = (dto: PartnerApplicationInput) =>
  req<{ message: string }>('POST', '/partners/apply', dto)

// ══ Phase D — customer identity, financing, account ══════════════
// Every type below mirrors a backend response field for field. Money that
// the financing API returns is a decimal STRING (exact); format it with
// fmtMoney(Number(v)) only at render time.

// ── Customer sign-in (migration 010, api/routes/customer_auth.py) ──
export interface Customer {
  id: string
  phone: string
  full_name: string | null
  email: string | null
  phone_verified_at: string | null
}

export interface OtpRequestResult {
  sent: boolean
  expires_in: number
  resend_after: number
}

export interface CustomerSession {
  token: string
  token_type: string
  expires_in: number
  customer: Customer
}

/** 202 on success. 422: not an Algerian mobile. 429: throttled (Retry-After).
 *  503: SMS not configured on this deployment. */
export const requestOtp = (phone: string) =>
  req<OtpRequestResult>('POST', '/auth/customer/request-otp', { phone })

/** 400: wrong/expired code (detail says which). 429: too many attempts. */
export const verifyOtp = (phone: string, code: string) =>
  req<CustomerSession>('POST', '/auth/customer/verify', { phone, code })

export const fetchMe = () => req<Customer>('GET', '/auth/customer/me')
export const logoutCustomer = () => req<void>('POST', '/auth/customer/logout')

// ── Financing presentation (FINANCING_TERMS_PUBLIC) ──
/** Present on every financing response. While `kind === 'ESTIMATE'` every
 *  figure is an estimate and must be shown with `label` beside it — render
 *  it through <EstimateLabel>, never as hand-written copy. */
export interface FinancingPresentation {
  terms_public: boolean
  kind: 'ESTIMATE' | 'TERMS'
  label: string
}

/** No rule active → `available: false` and nothing else. Markups are never
 *  exposed here; a figure only exists as a computed /simulate result. */
export interface FinancingTerms extends FinancingPresentation {
  available: boolean
  rule_version?: number
  durations?: number[]
  min_down_payment_pct?: string
  min_financed?: string
  max_financed?: string
}

export const fetchFinancingTerms = () => req<FinancingTerms>('GET', '/financing/terms')

export interface FinancingLineInput {
  offer_id: string
  quantity: number
}

/** Prices are never sent: the server reads them from the catalogue. Offers
 *  must be unique across `lines` (duplicate → 422). */
export interface FinancingRequestInput {
  lines: FinancingLineInput[]
  down_payment: string
  duration_months: number
}

export type FinancingReasonCode =
  | 'NO_ITEMS' | 'NOTHING_TO_FINANCE' | 'DOWN_PAYMENT_BELOW_MINIMUM'
  | 'BELOW_MIN_FINANCED' | 'ABOVE_MAX_FINANCED' | 'DURATION_NOT_OFFERED' | 'DEBT_RATIO_EXCEEDED'

export interface FinancingReason {
  code: FinancingReasonCode
  label: string
}

export interface FinancingDecision {
  eligible: boolean
  reasons: FinancingReason[]
  rule_version: number
  cash_total: string
  down_payment: string
  minimum_down_payment: string
  financed_amount: string
  duration_months: number
  markup_pct: string | null
  markup_amount: string | null
  total_repayable: string | null
  monthly_instalment: string | null
  schedule: string[]
  debt_ratio_assessed: boolean
}

export interface SimulationResult extends FinancingPresentation {
  simulation_id: string
  decision: FinancingDecision
}

/** 404: financing unavailable or an offer not found/inactive. 422: bad input.
 *  An ineligible cart still answers 200 with `decision.reasons`. */
export const simulateFinancing = (body: FinancingRequestInput) =>
  req<SimulationResult>('POST', '/financing/simulate', body)

// ── Applications (migrations 011/013) ──
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SIGNED'

export interface ApplicationSummary {
  id: string
  reference: string
  status: ApplicationStatus
  /** Server-worded; never "approuvé" while terms are not public. Show as-is. */
  status_label: string
  cash_total: string
  down_payment: string
  financed_amount: string
  markup_amount: string
  total_repayable: string
  duration_months: number
  monthly_instalment: string
  created_at: string | null
  submitted_at: string | null
}

export interface ApplicationLine {
  offer_id: string
  product_id: string
  product_name: string
  variant_sku: string
  unit_price: string
  quantity: number
  line_total?: string
}

export interface ApplicationCreated extends FinancingPresentation, ApplicationSummary {
  items: ApplicationLine[]
  decision: FinancingDecision
}

export interface ApplicationDetail extends FinancingPresentation, ApplicationSummary {
  items: ApplicationLine[]
  history: { status: ApplicationStatus; label: string; at: string | null }[]
}

/** Needs a session (401 otherwise). 422 with `detail.decision` when the cart
 *  cannot be financed as asked. */
export const createApplication = (body: FinancingRequestInput) =>
  req<ApplicationCreated>('POST', '/financing/applications', body)

export const fetchMyApplications = () =>
  req<FinancingPresentation & { items: ApplicationSummary[] }>('GET', '/financing/applications')

export const fetchMyApplication = (id: string) =>
  req<ApplicationDetail>('GET', `/financing/applications/${seg(id)}`)

export type EmploymentType = 'CDI' | 'CDD' | 'FONCTIONNAIRE' | 'INDEPENDANT' | 'RETRAITE' | 'AUTRE'

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  CDI: 'Salarié en CDI',
  CDD: 'Salarié en CDD',
  FONCTIONNAIRE: 'Fonctionnaire',
  INDEPENDANT: 'Indépendant / commerçant',
  RETRAITE: 'Retraité',
  AUTRE: 'Autre situation',
}

export interface ApplicationProfile {
  financial: { monthly_income: string; monthly_obligations: string; dependents: number | null } | null
  employment: {
    employment_type: EmploymentType
    employer_name: string | null
    job_title: string | null
    employed_since: string | null
  } | null
}

export interface ApplicationProfileInput {
  financial: { monthly_income: string; monthly_obligations: string; dependents: number | null }
  employment: {
    employment_type: EmploymentType
    employer_name: string | null
    job_title: string | null
    /** YYYY-MM-DD, not in the future. */
    employed_since: string | null
  }
}

export const fetchApplicationProfile = (id: string) =>
  req<ApplicationProfile>('GET', `/financing/applications/${seg(id)}/profile`)

/** DRAFT only (409 once submitted). */
export const saveApplicationProfile = (id: string, body: ApplicationProfileInput) =>
  req<ApplicationProfile>('PUT', `/financing/applications/${seg(id)}/profile`, body)

// ── Documents ──
/** Accepted by the server, which checks the real bytes — this is only for
 *  the file picker and an early size check. */
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export interface RequiredDocumentType {
  code: string
  label: string
  description: string | null
}

export interface UploadedDocument {
  id: string
  original_filename: string
  content_type: string
  byte_size: number
  status: 'UPLOADED' | 'ACCEPTED' | 'REJECTED'
  status_label: string
  uploaded_at: string | null
}

export interface DocumentChecklist {
  items: (RequiredDocumentType & { uploaded: UploadedDocument[] })[]
  complete: boolean
}

/** Operator-configured. An empty list means nothing is required. */
export const fetchRequiredDocuments = () =>
  req<{ items: RequiredDocumentType[] }>('GET', '/financing/required-documents')

export const fetchApplicationDocuments = (id: string) =>
  req<DocumentChecklist>('GET', `/financing/applications/${seg(id)}/documents`)

/** 413 too large · 415 not PDF/JPEG/PNG/WebP · 409 not DRAFT or too many
 *  files · 503 document storage not configured on this deployment. */
export const uploadApplicationDocument = (id: string, code: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return reqMultipart<UploadedDocument>(`/financing/applications/${seg(id)}/documents/${seg(code)}`, form)
}

export const deleteApplicationDocument = (id: string, documentId: string) =>
  req<void>('DELETE', `/financing/applications/${seg(id)}/documents/${seg(documentId)}`)

/** 422 lists EVERYTHING missing at once in `ApiError.detail`:
 *  `{message, missing_profile?, missing_documents?: {code,label}[], reasons?: FinancingReason[]}`.
 *  409: already submitted, or the terms it was opened under were retired. */
export interface SubmitProblems {
  message: string
  missing_profile?: boolean
  missing_documents?: { code: string; label: string }[]
  reasons?: FinancingReason[]
}

export const submitApplication = (id: string) =>
  req<{ id: string; reference: string; status: ApplicationStatus; status_label: string }>(
    'POST', `/financing/applications/${seg(id)}/submit`,
  )

// ── Account orders (api/routes/customer_account.py) ──
export interface MyOrderSummary {
  id: string
  order_number: string
  status: string
  total: number
  currency: string
  created_at: string | null
  item_count: number
}

export const fetchMyOrders = () => req<{ items: MyOrderSummary[] }>('GET', '/account/orders')

/** Same shape as the public tracking lookup. */
export const fetchMyOrder = (id: string) => req<TrackedOrder>('GET', `/account/orders/${seg(id)}`)
