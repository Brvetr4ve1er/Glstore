/**
 * Home — AMANATKOM.
 *
 * This page used to sell gaming gear ("JOUE POUR GAGNER", casques, claviers).
 * The storefront now serves the appliance brand, so the words changed and the
 * structure did not: badge → display headline → subtitle with concrete claims →
 * search → two CTAs → trust strip. That pattern passed the audit; only the copy
 * is new.
 *
 * Two things are load-bearing here:
 *
 * 1. THE CATEGORY GRID IS DERIVED, NOT FETCHED. All 567 products carry the one
 *    source category "Electromenager", so `GET /categories` can only ever
 *    return a single useless tile. The shopper-facing taxonomy lives in
 *    `@/lib/taxonomy` and is classified from the product NAME, client-side.
 *    `Autre` (~7%, ~40 sellable products) renders exactly like the other
 *    twelve — hiding it would drop those products out of the shop.
 *
 * 2. THE COUNTS ARE REAL. They are counted over the catalogue itself via
 *    `countByCategory`, not estimated and not sampled. The public products
 *    endpoint caps `page_size` at 120 (`api/routes/products.py:86`), so the
 *    sweep below pages through it and stops at a hard page budget. Tiles render
 *    immediately at their final size; the count line fills in when the sweep
 *    lands, so nothing moves under the cursor.
 *
 * Claims discipline: with a real business on the page, invented marketing is a
 * liability. Everything asserted here is either sourced from the codebase
 * (58 wilayas, paiement à la livraison) or counted from the live catalogue.
 * "Livraison 48h" and "Garantie 2 ans" were in the old gaming copy with nothing
 * behind them, and are gone.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, LayoutGrid, PackageCheck, Store, Truck, Wallet } from 'lucide-react'
import { fetchFeatured, fetchProducts, type ProductListItem } from '@/lib/api'
import { CategoryIcon, fmtNumber } from '@/lib/format'
import { CATEGORIES, countByCategory } from '@/lib/taxonomy'
import { ProductCard } from '@/components/ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { Button, EmptyState } from '@/components/ui'
import { SearchBox } from '@/components/SearchBox'
import { BrandLogo } from '@/components/BrandLogo'
import { SEO } from '@/components/SEO'

/** The public list endpoint's hard ceiling — `api/routes/products.py:86`. */
const SWEEP_PAGE_SIZE = 120
/**
 * Page budget for the count sweep. The real catalogue is 567 products (5 pages);
 * this leaves headroom without letting a much larger catalogue turn the home
 * page into a download. Past the budget the counts describe what was swept, so
 * the section says so rather than overstating.
 */
const SWEEP_MAX_PAGES = 8

interface CatalogSweep {
  items: ProductListItem[]
  /** Server-reported catalogue size — the truth even when the sweep stops early. */
  total: number
  /** True when the catalogue is bigger than the page budget. */
  truncated: boolean
}

/**
 * Page through the catalogue far enough to count categories exactly.
 * One react-query entry, cached for the session — the grid is the only caller.
 */
async function sweepCatalog(): Promise<CatalogSweep> {
  const first = await fetchProducts({ page: 1, page_size: SWEEP_PAGE_SIZE })
  const total = first.total ?? first.items.length
  const needed = Math.max(1, Math.ceil(total / SWEEP_PAGE_SIZE))
  const pages = Math.min(SWEEP_MAX_PAGES, needed)

  if (pages <= 1) return { items: first.items, total, truncated: needed > pages }

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchProducts({ page: i + 2, page_size: SWEEP_PAGE_SIZE }),
    ),
  )
  return {
    items: [first, ...rest].flatMap((r) => r.items),
    total,
    truncated: needed > pages,
  }
}

/** "1 produit" / "12 produits" — French singular is 0 and 1. */
function produits(n: number): string {
  return `${fmtNumber(n)} ${n > 1 ? 'produits' : 'produit'}`
}

export default function Home() {
  const featured = useQuery({
    queryKey: ['featured'],
    queryFn: () => fetchFeatured(12),
    staleTime: 60_000,
  })

  const catalog = useQuery({
    queryKey: ['catalog-sweep'],
    queryFn: sweepCatalog,
    staleTime: 5 * 60_000,
  })

  const counts = useMemo(
    () => (catalog.data ? countByCategory(catalog.data.items) : null),
    [catalog.data],
  )
  const total = catalog.data?.total ?? null

  const featuredItems = featured.data?.items ?? []

  return (
    <div className="page-enter">
      <SEO
        title="AMANATKOM — Électroménager en Algérie"
        description="Cuisson, froid, lavage, préparation culinaire et petit déjeuner. Prix en dinars, paiement à la livraison, dans les 58 wilayas."
      />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Ambient lights */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute top-10 left-1/4 w-[420px] h-[260px] bg-[var(--color-electric-blue)] opacity-[0.07] blur-[120px] rounded-full" />
          <div className="absolute bottom-10 right-1/4 w-[420px] h-[260px] bg-[var(--color-hot-pink)] opacity-[0.06] blur-[120px] rounded-full" />
        </div>

        <div className="max-w-[1400px] mx-auto px-6 pt-16 pb-12 md:pt-24 md:pb-16">
          <ScrollReveal variant="fade-up-sm" className="flex flex-col items-center text-center gap-6">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-sm text-xs font-black uppercase tracking-[0.18em] text-[var(--color-neon-yellow)]">
              <Store size={12} /> AMANATKOM · Électroménager en Algérie
            </div>

            {/*
              "ÉLECTROMÉNAGER" is 14 characters of uppercase display type and
              does not fit a 375px screen at text-5xl — it was clipped by the
              section's overflow-hidden. One step down at the base breakpoint
              fixes it; the desktop scale is unchanged.
            */}
            <h1 className="font-display text-4xl sm:text-5xl md:text-7xl font-black leading-[0.95] max-w-4xl tracking-tight uppercase">
              <span className="text-[var(--color-text-1)]">Tout l’</span>
              <span className="text-[var(--color-electric-blue)]">électroménager</span>{' '}
              <span className="punk-stripe text-[var(--color-text-1)]">de la maison.</span>
            </h1>

            <p className="text-base md:text-lg text-[var(--color-text-2)] max-w-2xl leading-relaxed">
              {total != null && (
                <>
                  <span className="num font-bold text-[var(--color-text-1)]">{fmtNumber(total)}</span>{' '}
                  références ·{' '}
                </>
              )}
              Cuisson, froid, lavage, préparation culinaire et petit déjeuner. Paiement{' '}
              <span className="text-[var(--color-text-1)] font-bold">à la livraison</span>, dans les{' '}
              <span className="text-[var(--color-text-1)] font-bold">58 wilayas</span>.
            </p>

            <div className="w-full max-w-2xl mt-2">
              <SearchBox variant="page" />
            </div>

            <div className="flex flex-wrap gap-3 justify-center mt-2">
              <Link to="/c/all">
                <Button variant="accent" size="lg">
                  Voir le catalogue <ArrowRight size={16} />
                </Button>
              </Link>
              {/*
                An anchor, not <Link><Button> — this scrolls within the page, and
                a <button> nested inside an <a> is invalid interactive content.
                Classes mirror the outline/lg Button so the pair reads as one row.
              */}
              <a
                href="#categories"
                className="inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 tracking-wide text-base px-6 py-3 border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5 focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]"
              >
                <LayoutGrid size={16} /> Parcourir par catégorie
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Trust strip — every line is sourced, none is invented ── */}
      <ScrollReveal variant="fade-up">
        <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-4 -mt-4 mb-12">
          {[
            { icon: Truck, title: 'Livraison 58 wilayas', desc: 'Toute l’Algérie est couverte' },
            { icon: Wallet, title: 'Paiement à la livraison', desc: 'Vous payez à la réception' },
            { icon: PackageCheck, title: 'Stock affiché', desc: 'La disponibilité est indiquée sur chaque fiche' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-sm flex items-center gap-3 px-5 py-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-neon-yellow)]/15 flex items-center justify-center shrink-0">
                <Icon size={18} className="text-[var(--color-neon-yellow)]" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-1)]">{title}</div>
                <div className="text-xs text-[var(--color-text-3)]">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </ScrollReveal>

      {/* ── Category grid ── */}
      <section id="categories" className="max-w-[1400px] mx-auto px-6 mb-16 scroll-mt-28">
        <ScrollReveal variant="fade-up-sm">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
                <span className="punk-stripe">Trouvez votre catégorie</span>
              </h2>
              <p className="text-sm text-[var(--color-text-3)] mt-2">
                {catalog.data
                  ? catalog.data.truncated
                    ? 'Les familles du catalogue — comptage sur les premiers produits'
                    : 'Les familles du catalogue, comptées sur le stock en ligne'
                  : 'Les familles du catalogue'}
              </p>
            </div>
            <Link
              to="/c/all"
              className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline whitespace-nowrap"
            >
              Tout voir →
            </Link>
          </div>
        </ScrollReveal>

        <motion.div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
        >
          {CATEGORIES.map((cat) => {
            // `null` = the sweep has not landed yet; `0` = a real, empty family.
            const n = counts?.get(cat.slug) ?? null
            return (
              <motion.div key={cat.slug} variants={STAGGER_ITEM}>
                <Link
                  to={`/c/${cat.slug}`}
                  className={[
                    'group relative flex flex-col items-center justify-center gap-2.5 aspect-square sm:aspect-[5/4] glass overflow-hidden px-3 text-center transition-colors hover:border-[var(--color-electric-blue)]/40',
                    n === 0 ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <span className="w-14 h-14 rounded-2xl bg-[var(--color-electric-blue)]/10 text-[var(--color-electric-blue)] flex items-center justify-center transition-transform group-hover:scale-110">
                    <CategoryIcon category={cat.slug} size={28} />
                  </span>
                  <span className="text-sm font-bold text-[var(--color-text-1)] leading-tight line-clamp-2">
                    {cat.label}
                  </span>
                  {/*
                    Fixed-height line: the count arrives late and must not shift
                    the tile. When the sweep FAILS the skeleton is dropped rather
                    than left shimmering forever — a permanent loading state on a
                    dead request is a lie. The tile still works without a count.
                  */}
                  <span className="h-4 flex items-center text-xs num text-[var(--color-text-3)]">
                    {n != null ? (
                      produits(n)
                    ) : catalog.isError ? null : (
                      <span aria-hidden className="inline-block w-12 h-2.5 rounded-full shimmer" />
                    )}
                  </span>
                </Link>
              </motion.div>
            )
          })}

          {/* The whole catalogue, as a tile — keeps the grid even and gives the
              shopper an exit when no family is the right one. */}
          <motion.div variants={STAGGER_ITEM}>
            <Link
              to="/c/all"
              className="group relative flex flex-col items-center justify-center gap-2.5 aspect-square sm:aspect-[5/4] glass overflow-hidden px-3 text-center transition-colors border-dashed hover:border-[var(--color-neon-yellow)]/50"
            >
              <span className="w-14 h-14 rounded-2xl bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] flex items-center justify-center transition-transform group-hover:scale-110">
                <LayoutGrid size={28} />
              </span>
              <span className="text-sm font-bold text-[var(--color-text-1)] leading-tight">
                Tout le catalogue
              </span>
              <span className="h-4 flex items-center text-xs num text-[var(--color-text-3)]">
                {total != null ? (
                  produits(total)
                ) : catalog.isError ? null : (
                  <span aria-hidden className="inline-block w-12 h-2.5 rounded-full shimmer" />
                )}
              </span>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Featured products ── */}
      <section className="max-w-[1400px] mx-auto px-6 mb-20">
        <ScrollReveal variant="fade-up-sm">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
                <span className="punk-stripe">Sélection</span>
              </h2>
              <p className="text-sm text-[var(--color-text-3)] mt-2">
                Un aperçu du catalogue · disponibilité indiquée sur chaque fiche
              </p>
            </div>
            <Link
              to="/c/all"
              className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline whitespace-nowrap"
            >
              Voir tout →
            </Link>
          </div>
        </ScrollReveal>

        {featured.isPending ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] shimmer rounded-2xl" />
            ))}
          </div>
        ) : featured.isError ? (
          <EmptyState
            title="Sélection indisponible pour le moment"
            desc="La sélection n’a pas pu être chargée. Le catalogue complet reste accessible."
            action={
              <Link to="/c/all">
                <Button variant="outline">Voir le catalogue</Button>
              </Link>
            }
          />
        ) : featuredItems.length === 0 ? (
          <EmptyState
            title="Aucun produit en sélection"
            desc="Parcourez le catalogue par catégorie en attendant."
            action={
              <Link to="/c/all">
                <Button variant="outline">Voir le catalogue</Button>
              </Link>
            }
          />
        ) : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            variants={STAGGER_CONTAINER}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
          >
            {featuredItems.map((p) => (
              <motion.div key={p.id} variants={STAGGER_ITEM}>
                <ProductCard product={p} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      {/* ── Brand callout ── */}
      <section className="max-w-[1400px] mx-auto px-6 mb-24">
        <ScrollReveal variant="zoom-in">
          <div className="glass-strong p-8 md:p-12 relative overflow-hidden">
            <div aria-hidden className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
            <div className="flex flex-col md:flex-row items-center gap-8 justify-between">
              <div className="flex items-center gap-5 max-w-xl">
                <div className="rocket-float shrink-0">
                  <BrandLogo size={64} showWordmark={false} />
                </div>
                <div>
                  <h3 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] leading-tight uppercase">
                    Commandez en ligne,{' '}
                    <span className="text-[var(--color-neon-yellow)]">payez à la livraison.</span>
                  </h3>
                  <p className="text-sm text-[var(--color-text-2)] mt-2 leading-relaxed">
                    Des références claires, des prix en dinars et un état de stock affiché produit
                    par produit. Vous commandez depuis chez vous et vous réglez à la réception, dans
                    les 58 wilayas.
                  </p>
                  <p className="text-xs text-[var(--color-text-3)] mt-3">
                    AMANATKOM est la marque de Bouakil Electro.
                  </p>
                </div>
              </div>
              <Link to="/c/all">
                <Button variant="accent" size="lg">
                  Découvrir <ArrowRight size={16} />
                </Button>
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </div>
  )
}
