/* Typed API client — all requests go through fetch() with JWT injection */

const BASE = '/api/v1'

function getToken() {
  return localStorage.getItem('gl_token')
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': crypto.randomUUID(),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })

  if (res.status === 401) {
    localStorage.removeItem('gl_token')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text()
    let msg = `HTTP ${res.status}`
    try { msg = JSON.parse(text)?.detail ?? msg } catch { /* noop */ }
    throw new Error(msg)
  }

  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

async function reqMultipart<T>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'x-request-id': crypto.randomUUID(),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    signal,
  })
  if (res.status === 401) {
    localStorage.removeItem('gl_token')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text()
    let msg = `HTTP ${res.status}`
    try { msg = JSON.parse(text)?.detail ?? msg } catch { /* noop */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────────
export interface TokenOut {
  access_token: string
  token_type: string
  expires_in: number
}
export const login = (email: string, password: string) =>
  req<TokenOut>('POST', '/auth/login', { email, password })

// ── Products ──────────────────────────────────────────────────
export interface ProductListItem {
  id: string; sku: string; slug: string; name: string
  brand: string | null; category: string | null
  completeness_score: number
  primary_image: string | null
  min_price: number | null
  available: number
  specs: Record<string, unknown>
}
export interface ProductListResult {
  items: ProductListItem[]
  page: number; page_size: number; total: number
}
export interface Offer {
  id: string; variant_sku: string; variant_attrs: Record<string,unknown>
  retail_price: number; sale_price: number | null; currency: string
  available: number
}
export interface MediaItem { url: string; kind: string; is_primary: boolean; alt: string }
export interface ProductDetail extends ProductListItem {
  model: string | null; subcategory: string | null; description: string | null
  status: string; updated_at: string
  barcode: string | null; mpn: string | null
  offers: Offer[]
  media: MediaItem[]
}

export const fetchProducts = (params: Record<string, string | number>) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)]))
  ).toString()
  return req<ProductListResult>('GET', `/products?${qs}`)
}
export const fetchProduct = (id: string) =>
  req<ProductDetail>('GET', `/products/${id}`)

// ── Product writes ───────────────────────────────────────────
export interface OfferInput {
  variant_sku: string
  variant_attrs?: Record<string, unknown>
  purchase_price: number
  retail_price: number
  sale_price?: number | null
  currency?: string
  stock_quantity?: number
  low_stock_threshold?: number
}
export interface ProductInput {
  sku: string
  slug?: string
  name: string
  brand?: string | null
  model?: string | null
  category?: string | null
  subcategory?: string | null
  description?: string | null
  specs?: Record<string, unknown>
  barcode?: string | null
  mpn?: string | null
  ean?: string | null
  initial_offer?: OfferInput | null
}
export interface ProductPatchInput extends Partial<ProductInput> {
  status?: 'RAW' | 'NORMALIZED' | 'CLASSIFIED' | 'VERIFIED' | 'ACTIVE' | 'NEEDS_FIX' | 'ARCHIVED'
}
export interface OfferPatchInput extends Partial<OfferInput> {
  is_active?: boolean
}

export const createProduct = (dto: ProductInput) =>
  req<ProductDetail>('POST',  `/products`, dto)
export const patchProduct  = (id: string, dto: ProductPatchInput) =>
  req<ProductDetail>('PATCH', `/products/${id}`, dto)
export const deleteProduct = (id: string, hard = false) =>
  req<void>('DELETE', `/products/${id}${hard ? '?hard=true' : ''}`)

export const addOffer    = (productId: string, dto: OfferInput) =>
  req<ProductDetail>('POST',   `/products/${productId}/offers`, dto)
export const patchOffer  = (productId: string, offerId: string, dto: OfferPatchInput) =>
  req<ProductDetail>('PATCH',  `/products/${productId}/offers/${offerId}`, dto)
export const deleteOffer = (productId: string, offerId: string) =>
  req<void>('DELETE', `/products/${productId}/offers/${offerId}`)

// ── Bulk import ───────────────────────────────────────────────
export interface ImportDiagnostic {
  delimiter: string
  headers: string[]
  mapped_fields: Record<string, string>     // canonical_field → matched_header
  unmapped_headers: string[]
  total_lines: number
  parsed_rows: number
  skipped_empty: number
  skipped_no_name: number
}
export interface ImportRowIssue {
  line_number: number
  field: string
  severity: 'error' | 'warning'
  message: string
}
export interface ImportSampleRow {
  line_number: number
  sku: string
  name: string
  brand: string | null
  category: string | null
  barcode: string | null
  purchase_price: number
  retail_price: number
  stock: number
  action: 'create' | 'update'
}
export interface ImportPreviewReport {
  parsed_rows: number
  valid_rows: number
  blocked_rows: number
  products_to_create: number
  products_to_update: number
  offers_to_create: number
  offers_to_update: number
  issues: ImportRowIssue[]
  sample_preview: ImportSampleRow[]
}
export interface ImportPreviewResponse {
  diagnostic: ImportDiagnostic
  report: ImportPreviewReport
}
export interface ImportCommitReport {
  products_created: number
  products_updated: number
  offers_created: number
  offers_updated: number
  blocked_rows: number
  issues: ImportRowIssue[]
}
export interface ImportCommitResponse {
  diagnostic: ImportDiagnostic
  report: ImportCommitReport
}

export const previewImport = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return reqMultipart<ImportPreviewResponse>('/products/import/preview', fd)
}
export const commitImport = (file: File, autoEnrich = true) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('auto_enrich', String(autoEnrich))
  return reqMultipart<ImportCommitResponse>('/products/import/commit', fd)
}

// ── URL import (paste a product link → scrape → add to store) ─────────
export interface UrlImportDraft {
  source_url: string
  name: string | null
  brand: string | null
  sku: string
  category: string | null
  description: string | null
  specs: Record<string, unknown>
  images: string[]
  price: number | null
  currency: string
  availability: 'in_stock' | 'out_of_stock' | 'unknown'
  method: string
  confidence: number
  notes: string[]
  fetch_engine: string
  http_status: number
}
export interface UrlImportCommitResult {
  product_id: string
  slug: string
  sku: string
  name: string
  status: string
  published: boolean
  offer_created: boolean
  images_added: number
}

export const previewUrlImport = (url: string) =>
  req<{ draft: UrlImportDraft }>('POST', '/products/import/url/preview', { url })

export const commitUrlImport = (
  draft: UrlImportDraft,
  opts: { publish: boolean; default_stock: number },
) =>
  req<UrlImportCommitResult>('POST', '/products/import/url/commit', {
    source_url: draft.source_url,
    name: draft.name,
    brand: draft.brand,
    sku: draft.sku,
    category: draft.category,
    description: draft.description,
    specs: draft.specs,
    images: draft.images,
    price: draft.price,
    currency: draft.currency,
    availability: draft.availability,
    publish: opts.publish,
    default_stock: opts.default_stock,
  })

// ── Enrichment ────────────────────────────────────────────────
export interface EnrichmentResult {
  product_id: string
  sku: string
  brand_before: string | null
  brand_after: string | null
  category_before: string | null
  category_after: string | null
  completeness_before: number
  completeness_after: number
  status_after: string
  auto_attrs_added: number
}
export interface BulkEnrichmentReport {
  total: number
  enriched: number
  skipped: number
  by_status: Record<string, number>
  avg_completeness_before: number
  avg_completeness_after: number
}
export interface EnrichmentStats {
  total: number
  average_completeness: number
  by_status: Record<string, { count: number; avg_completeness: number }>
}

export const enrichProduct = (id: string) =>
  req<EnrichmentResult>('POST', `/products/${id}/enrich`)
export const enrichAll = (statuses?: string[], limit = 5000) => {
  const params = new URLSearchParams()
  ;(statuses ?? []).forEach(s => params.append('only_status', s))
  params.set('limit', String(limit))
  return req<BulkEnrichmentReport>('POST', `/products/enrich-all?${params}`)
}
export const fetchEnrichmentStats = () =>
  req<EnrichmentStats>('GET', `/products/enrichment/stats`)

// ── Catalog quality / Issues (Phase 3) ────────────────────────
export type IssueCode =
  | 'missing_brand'
  | 'missing_category'
  | 'missing_description'
  | 'missing_image'
  | 'missing_price'
  | 'no_stock'
  | 'missing_barcode_or_mpn'
  | 'low_completeness'
  | 'low_specs'

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ProductIssue {
  code: IssueCode
  field: string
  severity: IssueSeverity
  message: string
  fix_hint: Record<string, unknown>
}
export interface ProductIssuesResponse {
  product_id: string
  completeness_score: number
  summary: { error: number; warning: number; info: number }
  issues: ProductIssue[]
}
export interface IssuesSummary {
  total: number
  by_issue: Record<IssueCode, number>
}
export interface IssueListItem {
  id: string
  sku: string
  name: string
  brand: string | null
  category: string | null
  completeness_score: number
  status: string
  min_price: number | null
  primary_image: string | null
}
export interface IssueListResponse {
  code: IssueCode
  items: IssueListItem[]
  page: number
  page_size: number
  total: number
}
export interface BrandCatalogItem {
  id: string
  label: string
  description: string
  products_in_db: number
}
export interface BrandCatalogResponse {
  total_known: number
  total_extras_in_db: number
  items: BrandCatalogItem[]
}

export const fetchProductIssues = (id: string) =>
  req<ProductIssuesResponse>('GET', `/products/${id}/issues`)
export const fetchIssuesSummary = () =>
  req<IssuesSummary>('GET', `/products/issues/summary`)
export const fetchIssuesList = (code: IssueCode, page = 1, pageSize = 50) =>
  req<IssueListResponse>('GET', `/products/issues/list?code=${code}&page=${page}&page_size=${pageSize}`)
export const fetchBrands = () =>
  req<BrandCatalogResponse>('GET', `/brands`)

// ── LLM settings + enrichment (Phase 4) ───────────────────────
export type LLMKind = 'ollama' | 'openai_compat' | 'anthropic'

export interface LLMConfig {
  kind: LLMKind
  endpoint: string
  model: string
  api_key: string         // masked on read
  api_key_set: boolean
  temperature: number
  max_tokens: number
  timeout_seconds: number
  json_mode: boolean
}
export interface LLMConfigInput {
  kind: LLMKind
  endpoint: string
  model: string
  api_key?: string | null   // empty string = keep, null = clear
  temperature: number
  max_tokens: number
  timeout_seconds: number
  json_mode: boolean
}
export interface LLMPing {
  kind: LLMKind
  endpoint: string
  model: string
  online: boolean
  models: string[]
  error: string | null
}
export interface LLMEnrichmentResult {
  product_id: string
  sku: string
  backend: LLMKind
  model: string
  fields_filled: string[]
  specs_added: number
  description_changed: boolean
  completeness_before: number
  completeness_after: number
  raw_payload: Record<string, unknown>
}
export interface LLMBulkReport {
  total_attempted: number
  enriched: number
  failed: number
  avg_completeness_before: number
  avg_completeness_after: number
  backend: LLMKind
  model: string
  failure_samples: string[]
}

export const fetchLLMConfig = () =>
  req<LLMConfig>('GET', '/settings/llm')
export const saveLLMConfig = (cfg: LLMConfigInput) =>
  req<LLMConfig>('PUT', '/settings/llm', cfg)
export const pingLLM = () =>
  req<LLMPing>('POST', '/settings/llm/ping')

export const enrichProductLLM = (id: string) =>
  req<LLMEnrichmentResult>('POST', `/products/${id}/enrich-llm`)
export const enrichLLMBulk = (statuses?: string[], limit = 50) => {
  const params = new URLSearchParams()
  ;(statuses ?? []).forEach(s => params.append('only_status', s))
  params.set('limit', String(limit))
  return req<LLMBulkReport>('POST', `/products/enrich-llm-bulk?${params}`)
}

// ── Orders ────────────────────────────────────────────────────
export interface OrderListItem {
  id: string; order_number: string; status: string; payment_status: string
  total: number; currency: string; customer_id: string; created_at: string
}
export interface OrderListResult {
  items: OrderListItem[]; page: number; page_size: number; total: number
}
export interface OrderItem {
  id: string; offer_id: string; product_id: string
  product_name: string; variant_sku: string
  unit_price: number; quantity: number; line_total: number
}
export interface OrderDetail extends OrderListItem {
  payment_method: string
  subtotal: number; shipping_cost: number; discount_amount: number; tax_amount: number
  items: OrderItem[]
}

export const fetchOrders = (params: Record<string, string | number>) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)]))
  ).toString()
  return req<OrderListResult>('GET', `/orders?${qs}`)
}
export const fetchOrder = (id: string) => req<OrderDetail>('GET', `/orders/${id}`)
export const confirmOrder = (id: string) => req<OrderDetail>('POST', `/orders/${id}/confirm`)
export const cancelOrder  = (id: string, reason?: string) =>
  req<OrderDetail>('POST', `/orders/${id}/cancel`, { reason })

// ── Stats (derived from list totals) ─────────────────────────
export async function fetchDashboardStats() {
  const [orders, pendingOrders, products] = await Promise.all([
    req<OrderListResult>('GET', '/orders?page_size=1'),
    req<OrderListResult>('GET', '/orders?page_size=1&status=RESERVED'),
    req<ProductListResult>('GET', '/products?page_size=1'),
  ])
  return {
    totalOrders:   orders.total,
    pendingOrders: pendingOrders.total,
    totalProducts: products.total,
  }
}


// ── Jobs Console (Phase 7) ────────────────────────────────────
export type JobType = 'scrape' | 'event' | 'sync'

export interface UnifiedJob {
  id: string
  type: JobType
  status: string
  label: string
  subtype: string | null
  claimed_by: string | null
  started_at: string | null
  completed_at: string | null
  error: string | null
  retry_count: number
  created_at: string
}

export interface JobsListResponse {
  items: UnifiedJob[]
  total: number
  page: number
  page_size: number
}

export interface JobsStats {
  by_type: {
    scrape: Record<string, number>
    event:  Record<string, number>
    sync:   Record<string, number>
  }
  totals: {
    active: number
    failed: number
    completed: number
    total: number
  }
}

export const fetchJobs = (params: {
  type?: JobType | ''
  status?: string
  q?: string
  page?: number
  page_size?: number
}) => {
  const qs = new URLSearchParams()
  if (params.type)       qs.set('type', params.type)
  if (params.status)     qs.set('status', params.status)
  if (params.q)          qs.set('q', params.q)
  if (params.page)       qs.set('page', String(params.page))
  if (params.page_size)  qs.set('page_size', String(params.page_size))
  return req<JobsListResponse>('GET', `/jobs?${qs.toString()}`)
}

export const fetchJobsStats = () =>
  req<JobsStats>('GET', '/jobs/stats')

export const fetchJobDetail = (type: JobType, id: string) =>
  req<Record<string, unknown>>('GET', `/jobs/${type}/${id}`)

export const retryJob = (type: JobType, id: string) =>
  req<{ ok: boolean; id: string; status: string }>('POST', `/jobs/${type}/${id}/retry`)

export const cancelJob = (type: JobType, id: string) =>
  req<{ ok: boolean; id: string; status: string }>('POST', `/jobs/${type}/${id}/cancel`)

// ── Catalog Graph (Phase 8 — Obsidian rebuild) ────────────────
export type GraphNodeType = 'brand' | 'category' | 'product'
export type GraphEdgeKind = 'brand-category' | 'product-brand' | 'product-category'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  count: number
  score: number | null
  // Product-only extras (undefined for brand/category nodes):
  sku?: string
  brand?: string | null
  category?: string | null
  status?: string
  primary_image?: string | null
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  avg_completeness: number
  kind: GraphEdgeKind
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    brand_count: number
    category_count: number
    product_count: number
    edge_count: number
    include_products: boolean
    product_limit: number
  }
}

export interface GraphQuery {
  include_products?: boolean
  product_limit?: number
  only_status?: string[]
}

export const fetchCatalogGraph = (q: GraphQuery = {}) => {
  const params = new URLSearchParams()
  if (q.include_products) params.set('include_products', 'true')
  if (q.product_limit)    params.set('product_limit', String(q.product_limit))
  ;(q.only_status ?? []).forEach(s => params.append('only_status', s))
  const qs = params.toString()
  return req<GraphResponse>('GET', `/products/graph${qs ? `?${qs}` : ''}`)
}

// ── Full Intel pipeline (Phase 4+5 fused) ────────────────────
export interface FullIntelResult {
  job_id: string
  status: 'PENDING' | 'CLAIMED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT'
  fields_filled?: string[]
  images_added?: number
  completeness_before?: number
  completeness_after?: number
  status_after?: string
  duration_ms?: number
  error?: string | null
  raw_payload?: Record<string, unknown> | null
}

export interface IntelBulkRequest {
  product_ids?: string[]
  only_status?: string[]
  missing_brand?: boolean
  missing_category?: boolean
  missing_image?: boolean
  limit?: number
}

export interface IntelBulkResponse {
  batch_id: string | null
  queued: number
  skipped_in_flight: number
  matched: number
}

export interface IntelBatchProgress {
  batch_id: string
  total: number
  by_status: Record<string, number>
  completed: number
  failed: number
  cancelled: number
  pending: number
  running: number
  percent_done: number
  avg_completeness_delta: number
  images_added: number
  is_terminal: boolean
}

export interface IntelJobDetail {
  id: string
  product_id: string
  batch_id: string | null
  status: string
  llm_kind: string | null
  llm_model: string | null
  fields_filled: string[]
  images_added: number
  completeness_before: number | null
  completeness_after: number | null
  status_after: string | null
  duration_ms: number | null
  claimed_by: string | null
  claimed_at: string | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  raw_payload: Record<string, unknown> | null
  scrape_summary: Record<string, unknown> | null
  retry_count: number
  created_at: string
}

export const enqueueIntel = (productId: string, wait = false) =>
  req<FullIntelResult>('POST', `/products/${productId}/intel?wait=${wait ? 'true' : 'false'}`)

export const enqueueIntelBulk = (body: IntelBulkRequest) =>
  req<IntelBulkResponse>('POST', '/products/intel-bulk', body)

export const fetchIntelJob = (id: string) =>
  req<IntelJobDetail>('GET', `/intel-jobs/${id}`)

export const fetchIntelBatch = (id: string) =>
  req<IntelBatchProgress>('GET', `/intel-batches/${id}`)

export const cancelIntelJob = (id: string) =>
  req<{ ok: boolean }>('POST', `/intel-jobs/${id}/cancel`)

// ── Image review queue (Phase 9) ─────────────────────────────
export type MediaStatus = 'PENDING' | 'UPLOADING' | 'STORED' | 'FAILED' | 'DELETED'
export type MediaSource = 'UPLOAD' | 'SCRAPED' | 'SUPPLIER' | 'GENERATED'

export interface ProductImage {
  id: string
  url: string
  status: MediaStatus
  source: MediaSource
  is_primary: boolean
  position: number
  alt_text: string | null
  width: number | null
  height: number | null
  bytes: number | null
  created_at: string
}

export interface ProductImagesResponse {
  product_id: string
  items: ProductImage[]
  counts: {
    pending: number
    stored:  number
    deleted: number
    failed:  number
    total:   number
  }
}

export interface PendingImageItem {
  id: string
  product_id: string
  url: string
  source: MediaSource
  alt_text: string | null
  created_at: string
  sku: string
  product_name: string
  brand: string | null
  category: string | null
}

export interface PendingImagesResponse {
  items: PendingImageItem[]
  page: number
  page_size: number
  total: number
}

export interface PendingImagesSummary {
  pending: number
  approved_24h: number
  rejected_24h: number
  top_products: { id: string; sku: string; name: string; pending: number }[]
}

export const fetchProductImages = (productId: string, status?: MediaStatus) => {
  const qs = status ? `?status=${status}` : ''
  return req<ProductImagesResponse>('GET', `/products/${productId}/images${qs}`)
}

export const approveImage = (productId: string, imageId: string, opts: { is_primary?: boolean; alt_text?: string | null } = {}) =>
  req<{ ok: boolean; id: string; status: string; is_primary: boolean }>('POST',
    `/products/${productId}/images/${imageId}/approve`,
    { is_primary: opts.is_primary ?? false, alt_text: opts.alt_text ?? null },
  )

export const rejectImage = (productId: string, imageId: string) =>
  req<{ ok: boolean; id: string; status: string }>('POST',
    `/products/${productId}/images/${imageId}/reject`,
  )

export const fetchPendingImages = (page = 1, pageSize = 40) =>
  req<PendingImagesResponse>('GET', `/images/pending?page=${page}&page_size=${pageSize}`)

export const fetchPendingImagesSummary = () =>
  req<PendingImagesSummary>('GET', '/images/pending/summary')

// ── Theme customization (Phase 9 Push 3 — admin + storefront) ─
// Token catalog is sourced from admin/src/lib/theme.ts. The keys here are
// open `Record<string,string>` because the registry can grow without
// requiring a type-level edit on every new token.

export type ThemeOverrides = Record<string, string>

export type ThemeScope = 'admin' | 'storefront'

export interface ThemeConfig {
  preset: string                  // see PRESETS in admin/src/lib/theme.ts
  overrides: ThemeOverrides       // user overrides (always applied on top of preset)
  mode?: 'light' | 'dark'         // overrides the preset's intrinsic mode
  updated_at?: string
}

// Diagnostic returned by the PUT endpoint listing every override key that
// failed server-side validation (and was therefore NOT persisted). The UI
// surfaces these so silent data loss is impossible.
export interface ThemeDropped {
  key:    string
  reason: 'unknown_token' | 'non_string' | 'too_long'
        | 'invalid_color' | 'invalid_font' | 'invalid_length'
        | 'invalid_duration' | 'invalid_number' | 'invalid_value'
  value:  string                  // truncated to 60 chars server-side
}

export interface ThemeSaveResult extends ThemeConfig {
  dropped?: ThemeDropped[]
}

export const fetchTheme = (scope: ThemeScope = 'admin') =>
  req<ThemeConfig>('GET', `/settings/theme?scope=${scope}`)

export const saveTheme = (cfg: ThemeConfig, scope: ThemeScope = 'admin') =>
  req<ThemeSaveResult>('PUT', `/settings/theme?scope=${scope}`, cfg)

// Public, no-auth endpoint — used by the storefront on bootstrap so the
// public site can render in the admin's chosen palette.
export const fetchPublicStorefrontTheme = () =>
  req<ThemeConfig>('GET', '/storefront/theme')
