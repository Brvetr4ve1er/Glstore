/**
 * FilterSidebar — rebuilt on the real catalogue, not on assumptions.
 *
 * Every number in this file was measured against the 567-product supplier
 * database (`storefront/src/dev/catalog.fixture.json` mirrors it for dev):
 *
 *   · prices   min 1 000 · p25 8 950 · median 20 000 · p75 37 000 · max 250 000
 *   · brands   16 real ones (MULTISMART 175, GEANT 71, CONTIGLOBAL 43, MIDEA 30 …)
 *              **and 160 products with no brand at all** — the second-largest
 *              bucket in the shop, so "Sans marque" is a real, reachable option,
 *              not an oversight.
 *   · stock    38 products (6.7%) are out of stock — a visible state, not an
 *              edge case.
 *   · category the CSV has none. All 567 rows say "Electromenager", so the
 *              taxonomy is derived from the product NAME client-side by
 *              `@/lib/taxonomy`. This file imports it; it never re-derives it.
 *
 * ── Where the counts come from ──────────────────────────────────────────
 * A server facet endpoint cannot count a client-derived taxonomy, and
 * `/brands/public` cannot count the products whose brand is NULL. So the
 * sidebar pulls the catalogue once (paged at the API's 120-row cap, capped at
 * FACET_MAX rows, cached 10 min, shared by the desktop + drawer instances) and
 * counts it with `countByCategory()`. Above the cap it degrades honestly: the
 * controls still render, the numbers simply do not. No invented counts.
 *
 * ── The container seam — READ THIS BEFORE WIRING ────────────────────────
 * Three of these facets cannot be expressed as server query params:
 *
 *   · `category` — the taxonomy is client-side; `GET /products?category=` only
 *     knows the literal string "Electromenager".
 *   · `stock: 'faible' | 'normal' | 'rupture'` — the supplier's `Statut Stock`
 *     column is parsed (`api/services/csv_parser.py:329`) but never persisted,
 *     so the only stock signal the storefront receives is `available`.
 *   · `brand: SANS_MARQUE` — no query param can ask for "brand IS NULL".
 *
 * They therefore live in `FilterState` and are applied by the CONTAINER over
 * the page it already fetched. `filterProducts()` below is exported for exactly
 * that, so wiring is one line in `Catalog.tsx`:
 *
 *     const items = filterProducts(data?.items ?? [], filters)
 *
 * `brand` (real brands), `priceMin`, `priceMax` and `inStockOnly` keep working
 * as server params exactly as before — nothing about today's behaviour is
 * removed. `filterProducts` is idempotent over an already-server-filtered page,
 * so applying it is safe whether or not the server narrowed first.
 */
import { useId, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, X as XIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchBrandsPublic, fetchPriceBounds, fetchProducts, type ProductListItem } from '@/lib/api'
import { fmtMoney, fmtNumber } from '@/lib/format'
import { categoryIconComponent } from '@/lib/icons'
import { CATEGORIES, classifyProductName, countByCategory, foldName } from '@/lib/taxonomy'
import { Button } from './ui'

/**
 * Sentinel for "this product has no brand" — 160 of 567 products, the second-
 * largest bucket in the shop.
 *
 * It is deliberately a READABLE French string rather than something like
 * `__none__`. `Catalog.tsx:78` and `:103` print `filters.brand` straight into
 * the page ("marque X", chip "Marque: X"), so until the container learns about
 * this value the worst case is a chip that reads "Marque: Sans marque" — which
 * is exactly what the shopper asked for — instead of a leaked `__none__`.
 *
 * It cannot collide with a real brand: every brand reaching the UI is folded to
 * uppercase, by SQL in `/brands/public` (`UPPER(brand)`) and by `foldName()`
 * here, and this value is mixed case. `matchesFilters` also tests it before it
 * ever compares brand names.
 */
export const SANS_MARQUE = 'Sans marque'

/** Derived stock level. `''` means "any". */
export type StockLevel = '' | 'normal' | 'faible' | 'rupture'

/**
 * Boundary between "faible" and "normal", in units.
 *
 * Matches the two places a shopper already sees the warning — `lib/tags.ts:42`
 * and `ProductDetail.tsx:507` both use `available <= 3` for "Plus que N !" — so
 * the filter agrees with the badges on the cards next to it.
 */
export const LOW_STOCK_MAX = 3

export interface FilterState {
  /** A real brand name, `SANS_MARQUE`, or `''` for all. */
  brand: string
  priceMin: number | null
  priceMax: number | null
  inStockOnly: boolean
  /** Taxonomy slug from `@/lib/taxonomy` (`''` = all). Optional: added after
   *  the original shape shipped, so older literals still type-check. */
  category?: string
  /** Derived stock level (`''` = all). Optional for the same reason. */
  stock?: StockLevel
}

export const EMPTY_FILTERS: FilterState = {
  brand: '',
  priceMin: null,
  priceMax: null,
  inStockOnly: false,
  category: '',
  stock: '',
}

/**
 * Price bands anchored on the catalogue's real quartiles — min 1 000, p25
 * 8 950, median 20 000, p75 37 000, max 250 000 DZD — rounded to numbers a
 * shopper can read. Measured over the 567 real products they split the shop
 * **142 / 142 / 142 / 100 / 41**, which is why they are these numbers and not
 * an invented "<20K / 20-50K / 50-100K / >100K" (which would have put 325 of
 * 567 products in one band and 42 in another).
 *
 * The intervals are DISJOINT and INCLUSIVE at both ends — hence `8 999` and
 * `20 001`, not a second band starting on `20 000`. Two reasons, both real:
 *   · the counts below must add up to the catalogue, and touching bands
 *     double-counted 7 products (1 sits at exactly 20 000, 5 at 37 000);
 *   · `price_min` / `price_max` go to the server as `min_price >= :pmin AND
 *     min_price <= :pmax` (api/routes/products.py:121-124), which is inclusive.
 *     Half-open bands here would disagree with the server on the boundary.
 * Every label states its interval exactly. No product is in two bands, and
 * none falls between them — all prices in this catalogue are whole dinars.
 */
export interface PriceBand {
  id: string
  min: number | null
  max: number | null
}

export const PRICE_BANDS: ReadonlyArray<PriceBand> = [
  { id: 'lt9',   min: null,   max: 8_999 },
  { id: '9-20',  min: 9_000,  max: 20_000 },
  { id: '20-37', min: 20_001, max: 37_000 },
  { id: '37-75', min: 37_001, max: 75_000 },
  { id: 'gt75',  min: 75_001, max: null },
]

/**
 * Label a band through the app's own money helpers rather than hard-coding a
 * currency token — `fmtMoney` prints the dinar as **DA**, so a literal "DZD"
 * in here would have been the one string in the sidebar that disagreed with
 * every price on the page.
 *
 * Each label states its interval exactly: the open band stores `max: 8 999`
 * and reads "Moins de 9 000 DA", the closed ones name both inclusive ends, and
 * the currency appears once so the row fits on one line.
 */
export function priceBandLabel(band: PriceBand): string {
  if (band.min == null) return `Moins de ${fmtMoney((band.max ?? 0) + 1)}`
  if (band.max == null) return `Plus de ${fmtMoney(band.min - 1)}`
  return `De ${fmtNumber(band.min)} à ${fmtMoney(band.max)}`
}

/** The subset of a product this file needs — `ProductListItem` satisfies it. */
export interface FilterableProduct {
  name: string | null
  brand: string | null
  min_price: number | null
  available: number
}

/** Bucket a quantity into the three stock states the filter offers. */
export function stockLevelOf(available: number | null | undefined): Exclude<StockLevel, ''> {
  const n = available ?? 0
  if (n <= 0) return 'rupture'
  if (n <= LOW_STOCK_MAX) return 'faible'
  return 'normal'
}

/** True when a product satisfies every active facet. */
export function matchesFilters(p: FilterableProduct, s: FilterState): boolean {
  if (s.category && classifyProductName(p.name) !== s.category) return false

  if (s.brand === SANS_MARQUE) {
    if ((p.brand ?? '').trim()) return false
  } else if (s.brand && foldName(p.brand) !== foldName(s.brand)) {
    return false
  }

  if (s.priceMin != null || s.priceMax != null) {
    if (p.min_price == null) return false
    if (s.priceMin != null && p.min_price < s.priceMin) return false
    if (s.priceMax != null && p.min_price > s.priceMax) return false
  }

  if (s.inStockOnly && (p.available ?? 0) <= 0) return false
  if (s.stock && stockLevelOf(p.available) !== s.stock) return false

  return true
}

/** Apply `state` to a list the container already has. See the seam note above. */
export function filterProducts<T extends FilterableProduct>(
  items: ReadonlyArray<T>,
  state: FilterState,
): T[] {
  return items.filter(p => matchesFilters(p, state))
}

/**
 * The half of `FilterState` the API understands, ready to spread into
 * `fetchProducts()`.
 *
 * It deliberately DROPS `category`, `stock` and `brand: SANS_MARQUE`: the
 * server has no column for any of them, and passing `brand=__sans_marque__`
 * would return an empty grid instead of the 160 products the shopper asked
 * for. Pair it with `filterProducts()`, which applies exactly the facets this
 * function drops:
 *
 *     const params = { ...catalogQueryParams(filters), sort, page, page_size }
 *     const items  = filterProducts(data?.items ?? [], filters)
 *
 * `inStockOnly` is still forwarded when the shopper picked a level that implies
 * being in stock, so the server keeps narrowing before the client refines.
 */
export function catalogQueryParams(s: FilterState): Record<string, string | number | undefined> {
  return {
    ...(s.brand && s.brand !== SANS_MARQUE ? { brand: s.brand } : {}),
    ...(s.inStockOnly ? { in_stock: 'true' } : {}),
    ...(s.priceMin != null ? { price_min: s.priceMin } : {}),
    ...(s.priceMax != null ? { price_max: s.priceMax } : {}),
  }
}

/** How many facets are narrowing the catalogue right now. */
export function activeFilterCount(s: FilterState): number {
  return (
    (s.category ? 1 : 0) +
    (s.brand ? 1 : 0) +
    (s.priceMin != null || s.priceMax != null ? 1 : 0) +
    (s.stock || s.inStockOnly ? 1 : 0)
  )
}

// ── Facet source ──────────────────────────────────────────────────────────
// `GET /products` caps page_size at 120 (api/routes/products.py:86) and every
// sort clause carries an `id` tiebreaker, so paging is deterministic and the
// union below has no duplicates or holes.

const FACET_PAGE = 120
/** Above this the sidebar stops counting rather than firing a dozen requests. */
const FACET_MAX = 1_200

interface FacetCatalogue {
  items: ProductListItem[]
  total: number
  /** False when the catalogue is larger than FACET_MAX — counts are hidden. */
  complete: boolean
}

async function fetchFacetCatalogue(): Promise<FacetCatalogue> {
  const first = await fetchProducts({ page: 1, page_size: FACET_PAGE, sort: 'name_asc' })
  const total = first.total ?? first.items.length
  if (total > FACET_MAX) return { items: [], total, complete: false }

  const pages = Math.ceil(total / FACET_PAGE)
  if (pages <= 1) return { items: first.items, total, complete: true }

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchProducts({ page: i + 2, page_size: FACET_PAGE, sort: 'name_asc' }),
    ),
  )
  return {
    items: [...first.items, ...rest.flatMap(r => r.items)],
    total,
    complete: true,
  }
}

interface Props {
  state: FilterState
  onChange: (s: FilterState) => void
  onClose?: () => void
  /** Set when rendered as a mobile drawer */
  drawer?: boolean
}

export function FilterSidebar({ state, onChange, onClose, drawer }: Props) {
  const uid = useId()
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: fetchBrandsPublic, staleTime: 5 * 60_000 })
  const { data: bounds } = useQuery({ queryKey: ['price-bounds'], queryFn: fetchPriceBounds, staleTime: 5 * 60_000 })
  const { data: facets } = useQuery({
    queryKey: ['filter-facets'],
    queryFn: fetchFacetCatalogue,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  })

  const min = bounds?.min ?? 0
  const max = bounds?.max ?? 1_000_000

  const counted = facets?.complete ? facets.items : null

  // ── Category counts — the whole point of the derived taxonomy ──────────
  const categoryCounts = useMemo(
    () => (counted ? countByCategory(counted) : null),
    [counted],
  )
  const categories = useMemo(() => {
    if (!categoryCounts) return CATEGORIES
    // A category with nothing in it leads only to an empty grid. `autre` is not
    // special-cased away here — it carries ~7% of the catalogue and renders
    // like any other category whenever it has products.
    return CATEGORIES.filter(c => (categoryCounts.get(c.slug) ?? 0) > 0)
  }, [categoryCounts])

  // ── Brands — including the 160 products that have none ─────────────────
  const brandFacets = useMemo(() => {
    if (counted) {
      const byBrand = new Map<string, number>()
      let none = 0
      for (const p of counted) {
        const b = (p.brand ?? '').trim()
        if (!b) { none += 1; continue }
        const key = foldName(b)
        byBrand.set(key, (byBrand.get(key) ?? 0) + 1)
      }
      const list = [...byBrand.entries()]
        .map(([name, count]) => ({ name, count: count as number | null }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name))
      return { list, none: none as number | null }
    }
    // Fallback: the server facet is complete for real brands but structurally
    // blind to NULL ones, so "Sans marque" stays offered without a count.
    const list = (brands?.items ?? [])
      .map(b => ({ name: b.name, count: b.count as number | null }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name))
    return { list, none: null as number | null }
  }, [counted, brands])

  // Counted through `matchesFilters` itself, so the number beside a band is by
  // construction the number of products selecting that band returns.
  const priceCounts = useMemo(() => {
    if (!counted) return null
    const m = new Map<string, number>()
    for (const band of PRICE_BANDS) {
      const probe: FilterState = { ...EMPTY_FILTERS, priceMin: band.min, priceMax: band.max }
      m.set(band.id, counted.reduce((n, p) => n + (matchesFilters(p, probe) ? 1 : 0), 0))
    }
    return m
  }, [counted])

  const stockCounts = useMemo(() => {
    if (!counted) return null
    let normal = 0, faible = 0, rupture = 0
    for (const p of counted) {
      const lvl = stockLevelOf(p.available)
      if (lvl === 'normal') normal += 1
      else if (lvl === 'faible') faible += 1
      else rupture += 1
    }
    return { all: counted.length, inStock: normal + faible, normal, faible, rupture }
  }, [counted])

  const activeBand = PRICE_BANDS.find(
    b => (b.min ?? null) === (state.priceMin ?? null) && (b.max ?? null) === (state.priceMax ?? null),
  )?.id ?? ''

  const stockValue: 'all' | 'in-stock' | Exclude<StockLevel, ''> =
    state.stock ? state.stock : state.inStockOnly ? 'in-stock' : 'all'

  const active = activeFilterCount(state)

  return (
    <aside className={drawer ? '' : 'hidden lg:block'}>
      {/* The drawer panel gets its own opaque surface: its parent in Catalog is
          `glass-strong`, and four sections of filters scroll far enough that
          the page behind was reading straight through the controls. The desktop
          panel keeps the glass look but gains a height cap — with Catégorie,
          Marque, Prix and Disponibilité open it is taller than the viewport,
          and a `sticky` panel with no cap puts its last section out of reach. */}
      <div
        className={
          drawer
            ? 'h-full overflow-y-auto p-5 bg-[var(--color-surface-1)]'
            : 'glass p-5 sticky top-32 max-h-[calc(100dvh-10rem)] overflow-y-auto'
        }
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)] flex items-center gap-2">
            Filtres
            {active > 0 && (
              <span className="num inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] text-xs font-black">
                {active}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              disabled={active === 0}
              className="text-xs uppercase tracking-widest font-bold text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] disabled:opacity-40 disabled:hover:text-[var(--color-text-3)]"
            >
              Réinitialiser
            </button>
            {drawer && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="p-1.5 rounded-md hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)]"
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
        </div>

        {/* ── Catégorie ─────────────────────────────────────────────────── */}
        <Section title="Catégorie" defaultOpen>
          <fieldset className="min-w-0 flex flex-col gap-0.5">
            <legend className="sr-only">Catégorie de produit</legend>
            <RadioRow
              id={`${uid}-cat-all`}
              name={`${uid}-cat`}
              checked={!state.category}
              onSelect={() => onChange({ ...state, category: '' })}
              label="Toutes les catégories"
              count={counted ? counted.length : null}
            />
            {categories.map(cat => {
              const Icon = categoryIconComponent(cat.slug)
              return (
                <RadioRow
                  key={cat.slug}
                  id={`${uid}-cat-${cat.slug}`}
                  name={`${uid}-cat`}
                  checked={state.category === cat.slug}
                  onSelect={() => onChange({ ...state, category: cat.slug })}
                  label={cat.label}
                  count={categoryCounts?.get(cat.slug) ?? null}
                  icon={<Icon size={16} aria-hidden="true" className="shrink-0" />}
                />
              )
            })}
          </fieldset>
        </Section>

        {/* ── Marque ────────────────────────────────────────────────────── */}
        <Section title="Marque" defaultOpen>
          <fieldset className="min-w-0 flex flex-col gap-0.5 max-h-72 overflow-y-auto pr-1">
            <legend className="sr-only">Marque</legend>
            <RadioRow
              id={`${uid}-brand-all`}
              name={`${uid}-brand`}
              checked={state.brand === ''}
              onSelect={() => onChange({ ...state, brand: '' })}
              label="Toutes les marques"
              count={counted ? counted.length : null}
            />
            <RadioRow
              id={`${uid}-brand-none`}
              name={`${uid}-brand`}
              checked={state.brand === SANS_MARQUE}
              onSelect={() => onChange({ ...state, brand: SANS_MARQUE })}
              label={SANS_MARQUE}
              count={brandFacets.none}
            />
            {/* Index-keyed ids: a brand name is free-form supplier text and
                could collide once slugified, and a collided id silently breaks
                the label association this section exists to get right. */}
            {brandFacets.list.slice(0, 40).map((b, i) => (
              <RadioRow
                key={b.name}
                id={`${uid}-brand-${i}`}
                name={`${uid}-brand`}
                checked={state.brand === b.name}
                onSelect={() => onChange({ ...state, brand: b.name })}
                label={b.name}
                count={b.count}
              />
            ))}
          </fieldset>
        </Section>

        {/* ── Prix ──────────────────────────────────────────────────────── */}
        <Section title="Prix" defaultOpen>
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <PriceInput
                id={`${uid}-price-min`}
                label="Min"
                value={state.priceMin ?? ''}
                onChange={v => onChange({ ...state, priceMin: v })}
                placeholder={String(Math.floor(min))}
              />
              <PriceInput
                id={`${uid}-price-max`}
                label="Max"
                value={state.priceMax ?? ''}
                onChange={v => onChange({ ...state, priceMax: v })}
                placeholder={String(Math.ceil(max))}
              />
            </div>
            <div className="text-xs text-[var(--color-text-3)] flex items-center justify-between gap-2">
              <span>De {fmtMoney(min)}</span>
              <span>à {fmtMoney(max)}</span>
            </div>

            <fieldset className="min-w-0 flex flex-col gap-0.5">
              <legend className="sr-only">Tranche de prix</legend>
              <RadioRow
                id={`${uid}-band-all`}
                name={`${uid}-band`}
                checked={state.priceMin == null && state.priceMax == null}
                onSelect={() => onChange({ ...state, priceMin: null, priceMax: null })}
                label="Tous les prix"
                count={counted ? counted.length : null}
              />
              {PRICE_BANDS.map(band => (
                <RadioRow
                  key={band.id}
                  id={`${uid}-band-${band.id}`}
                  name={`${uid}-band`}
                  checked={activeBand === band.id}
                  onSelect={() => onChange({ ...state, priceMin: band.min, priceMax: band.max })}
                  label={priceBandLabel(band)}
                  count={priceCounts?.get(band.id) ?? null}
                />
              ))}
            </fieldset>
          </div>
        </Section>

        {/* ── Disponibilité ─────────────────────────────────────────────── */}
        <Section title="Disponibilité" defaultOpen>
          <fieldset className="min-w-0 flex flex-col gap-0.5">
            <legend className="sr-only">Disponibilité</legend>
            <RadioRow
              id={`${uid}-stock-all`}
              name={`${uid}-stock`}
              checked={stockValue === 'all'}
              onSelect={() => onChange({ ...state, inStockOnly: false, stock: '' })}
              label="Tous les produits"
              count={stockCounts?.all ?? null}
            />
            <RadioRow
              id={`${uid}-stock-any`}
              name={`${uid}-stock`}
              checked={stockValue === 'in-stock'}
              onSelect={() => onChange({ ...state, inStockOnly: true, stock: '' })}
              label="En stock uniquement"
              count={stockCounts?.inStock ?? null}
            />
            <RadioRow
              id={`${uid}-stock-normal`}
              name={`${uid}-stock`}
              checked={stockValue === 'normal'}
              onSelect={() => onChange({ ...state, inStockOnly: true, stock: 'normal' })}
              label="Stock normal"
              count={stockCounts?.normal ?? null}
            />
            <RadioRow
              id={`${uid}-stock-faible`}
              name={`${uid}-stock`}
              checked={stockValue === 'faible'}
              onSelect={() => onChange({ ...state, inStockOnly: true, stock: 'faible' })}
              label="Stock faible"
              count={stockCounts?.faible ?? null}
            />
            <RadioRow
              id={`${uid}-stock-rupture`}
              name={`${uid}-stock`}
              checked={stockValue === 'rupture'}
              onSelect={() => onChange({ ...state, inStockOnly: false, stock: 'rupture' })}
              label="En rupture"
              count={stockCounts?.rupture ?? null}
            />
          </fieldset>
          <p className="text-xs text-[var(--color-text-3)] mt-2.5 leading-relaxed">
            Calculé sur les quantités réellement disponibles — stock faible à
            partir de {LOW_STOCK_MAX} pièces ou moins.
          </p>
        </Section>

        {drawer && (
          <Button variant="accent" className="w-full mt-2" onClick={onClose}>
            Voir les résultats
          </Button>
        )}
      </div>
    </aside>
  )
}


/**
 * One filter option: a real radio, a real `<label htmlFor>`, and the live count
 * when the facet catalogue could be read. The `htmlFor`/`id` pairing is not
 * decoration — it is the fix for audit Critical #1.
 */
function RadioRow({
  id, name, checked, onSelect, label, count, icon,
}: {
  id: string
  name: string
  checked: boolean
  onSelect: () => void
  label: string
  count?: number | null
  icon?: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
        checked ? 'bg-[var(--color-electric-blue)]/12' : 'hover:bg-[var(--color-surface-3)]'
      }`}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onSelect}
        className="w-4 h-4 shrink-0 accent-[var(--color-electric-blue)] cursor-pointer"
      />
      <label
        htmlFor={id}
        className={`flex-1 min-w-0 flex items-center gap-2 text-sm leading-snug cursor-pointer ${
          checked
            ? 'font-bold text-[var(--color-electric-blue)]'
            : 'text-[var(--color-text-2)]'
        }`}
      >
        {icon}
        {/* Wraps rather than truncates: "Entretien & Repassage" and long
            supplier brand names are the filter's only label, so an ellipsis
            would hide the one thing the row exists to say. */}
        <span className="min-w-0 break-words">{label}</span>
      </label>
      {count != null && (
        <span className="num text-xs text-[var(--color-text-3)] shrink-0 tabular-nums">
          {fmtNumber(count)}
        </span>
      )}
    </div>
  )
}


function Section({
  title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-[var(--color-surface-4)]/60 first:border-t-0 py-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-1)]">{title}</span>
        <ChevronDown size={14} className={`text-[var(--color-text-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


function PriceInput({
  id, label, value, onChange, placeholder,
}: {
  id: string
  label: string
  value: number | ''
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <label htmlFor={id} className="text-xs font-bold text-[var(--color-text-3)] uppercase tracking-wider">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={0}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value
          onChange(v === '' ? null : Number(v))
        }}
        className="h-9 w-full px-2.5 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] outline-none num"
      />
    </div>
  )
}
