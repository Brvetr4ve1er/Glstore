/**
 * Floema-style home: a paper hero with floating product cutouts that
 * drift gently in place, a row of collection "catalogues", an editorial
 * featured-product grid, a forest-tone sustainability band, and a
 * recent-addings marquee just before the footer.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowDown } from 'lucide-react'
import { fetchFeatured, fetchProducts } from '@/lib/api'
import { ProductCard } from '@/components/ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { SEO } from '@/components/SEO'
import { COLLECTIONS, MOCK_LIST } from '@/lib/mock-products'

/** Eight hand-positioned drifting product cutouts for the hero.
 *  Positions in % of the hero box; pick from MOCK_LIST so visuals match
 *  the catalogue. */
const FLOAT_POSITIONS = [
  { top: '6%',  left: '6%',  w: '180px', drift: 'fl-drift-a', delay: '0s' },
  { top: '12%', left: '74%', w: '210px', drift: 'fl-drift-b', delay: '0.6s' },
  { top: '40%', left: '2%',  w: '160px', drift: 'fl-drift-c', delay: '1.2s' },
  { top: '60%', left: '20%', w: '190px', drift: 'fl-drift-a', delay: '0.4s' },
  { top: '70%', left: '78%', w: '220px', drift: 'fl-drift-b', delay: '1.6s' },
  { top: '36%', left: '82%', w: '170px', drift: 'fl-drift-c', delay: '0.8s' },
  { top: '5%',  left: '40%', w: '150px', drift: 'fl-drift-a', delay: '1.4s' },
  { top: '68%', left: '46%', w: '170px', drift: 'fl-drift-c', delay: '0.2s' },
]

export default function Home() {
  const featured = useQuery({ queryKey: ['featured'], queryFn: () => fetchFeatured(12), staleTime: 60_000 })
  const recent = useQuery({
    queryKey: ['recent', 'desc'],
    queryFn: () => fetchProducts({ page: 1, page_size: 12, sort: 'name_asc' }),
    staleTime: 60_000,
  })

  const floats = useMemo(
    () => FLOAT_POSITIONS.map((pos, i) => ({ pos, product: MOCK_LIST[i % MOCK_LIST.length] })),
    [],
  )

  return (
    <div className="page-enter">
      <SEO
        title="Ghir Laffaire — Tools for a calmer day"
        description="A craft-first storefront for laptops, audio, gaming, smart home and accessories. Built to last, designed to endure."
      />

      {/* ── Hero ── */}
      <section className="fl-band-paper relative overflow-hidden">
        <div className="relative max-w-[1600px] mx-auto px-6 md:px-10 pt-12 pb-24 md:pt-20 md:pb-40 min-h-[88vh]">
          {/* Floating product cutouts (decorative on md+) */}
          <div aria-hidden className="absolute inset-0 hidden md:block pointer-events-none">
            {floats.map(({ pos, product }, i) => (
              <div
                key={i}
                className={`absolute ${pos.drift}`}
                style={{ top: pos.top, left: pos.left, width: pos.w, animationDelay: pos.delay }}
              >
                <img
                  src={product.primary_image ?? ''}
                  alt=""
                  className="w-full h-auto object-cover rounded-sm"
                  loading="lazy"
                />
              </div>
            ))}
          </div>

          {/* Centred title */}
          <ScrollReveal variant="fade-up-sm" className="relative z-10 max-w-3xl mx-auto text-center flex flex-col items-center gap-8 pt-10 md:pt-20">
            <div className="text-[11px] uppercase tracking-[0.28em] font-semibold text-[var(--color-text-2)]">
              Est. 2007 · Made for life
            </div>

            <h1 className="font-display text-[clamp(48px,8vw,128px)] leading-[0.96] tracking-[-0.04em] text-[var(--color-jet-black)]">
              Tools for a <em className="not-italic">calmer</em> day.
            </h1>

            <p className="text-[16px] md:text-[18px] text-[var(--color-text-2)] max-w-xl leading-relaxed">
              Laptops, audio, gaming, smart home and accessories — chosen the way you'd choose a hand tool. Honest stock, fast delivery, and a return policy that doesn't read like a trap.
            </p>

            <div className="flex flex-wrap gap-3 justify-center mt-2">
              <Link to="/c/all" className="fl-cta">
                <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
                See all products
              </Link>
              <Link to="/c/laptops" className="fl-cta" data-variant="ghost">
                <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
                Shop laptops
              </Link>
            </div>
          </ScrollReveal>

          {/* Scroll-to-explore */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[var(--color-text-3)] fl-bob">
            <span className="text-[10px] uppercase tracking-[0.24em] font-semibold">Scroll to explore</span>
            <ArrowDown size={14} strokeWidth={1.6} />
          </div>
        </div>
      </section>

      {/* ── Collections ── */}
      <section className="fl-band-paper-alt">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-20 md:py-28">
          <ScrollReveal variant="fade-up-sm" className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] font-semibold text-[var(--color-text-3)] mb-3">
                Catalogues
              </div>
              <h2 className="font-display text-[clamp(36px,5vw,72px)] leading-[1.02] tracking-[-0.04em] max-w-3xl">
                Five collections, <em className="not-italic">one</em> shelf.
              </h2>
            </div>
            <Link to="/c/all" className="fl-cta" data-variant="ghost">
              <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
              See all
            </Link>
          </ScrollReveal>

          <motion.div
            variants={STAGGER_CONTAINER}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
          >
            {COLLECTIONS.map(col => {
              const sample = MOCK_LIST.find(
                p => (p.category ?? '').toLowerCase().includes(col.slug.split('-')[0])
                  || (col.slug === 'smart-home' && (p.category ?? '').toLowerCase().includes('smart')),
              )
              return (
                <motion.div key={col.slug} variants={STAGGER_ITEM}>
                  <Link
                    to={`/c/${col.slug}`}
                    className="group flex flex-col gap-4 fl-card p-5"
                    style={{ background: `color-mix(in srgb, var(${col.cssVar}) 22%, var(--color-surface-1))` }}
                  >
                    <div className="aspect-[3/4] overflow-hidden bg-white/40">
                      {sample?.primary_image && (
                        <img
                          src={sample.primary_image}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      )}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.22em] font-semibold opacity-70">
                          Catalogue
                        </div>
                        <div className="font-display text-[22px] leading-tight tracking-[-0.02em]">
                          {col.label}
                        </div>
                      </div>
                      <span className="fl-pill" data-tone={col.tone}>{col.slug}</span>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* ── Featured ── */}
      <section className="fl-band-paper">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-20 md:py-28">
          <ScrollReveal variant="fade-up-sm" className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] font-semibold text-[var(--color-text-3)] mb-3">
                Sélection
              </div>
              <h2 className="font-display text-[clamp(36px,5vw,72px)] leading-[1.02] tracking-[-0.04em] max-w-3xl">
                The most-loved <em className="not-italic">of the season.</em>
              </h2>
            </div>
            <Link to="/c/all" className="fl-cta" data-variant="ghost">
              <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
              See more
            </Link>
          </ScrollReveal>

          {featured.isPending ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] shimmer" />
              ))}
            </div>
          ) : (
            <motion.div
              variants={STAGGER_CONTAINER}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.05 }}
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            >
              {(featured.data?.items ?? []).slice(0, 8).map(p => (
                <motion.div key={p.id} variants={STAGGER_ITEM}>
                  <ProductCard product={p} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Sustainability / quote band ── */}
      <section className="fl-band-forest">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-24 md:py-36 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
          <div className="md:col-span-3">
            <div className="text-[11px] uppercase tracking-[0.28em] font-semibold opacity-80">
              Sustainability
            </div>
          </div>
          <div className="md:col-span-9">
            <p className="font-display text-[clamp(32px,4.4vw,64px)] leading-[1.05] tracking-[-0.04em]">
              We do not subscribe to <em className="not-italic">disposable</em> electronics. Every device we sell is rated for repair, ships in recyclable fibre, and arrives without a bag of plastic theatre.
            </p>
            <div className="mt-12 flex flex-wrap gap-3">
              <Link to="/sustainability" className="fl-cta">
                <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
                Our approach
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent addings marquee ── */}
      <section className="fl-band-paper">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-20">
          <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
            <h2 className="font-display text-[clamp(28px,3.6vw,56px)] leading-[1.05] tracking-[-0.04em]">
              Recent additions
            </h2>
            <Link to="/c/all" className="text-[12px] uppercase tracking-[0.22em] font-semibold link-underline text-[var(--color-jet-black)]">
              View all →
            </Link>
          </div>

          <div className="overflow-hidden -mx-6 md:-mx-10">
            <div className="fl-marquee flex gap-4 px-6 md:px-10 w-max">
              {[...(recent.data?.items ?? []), ...(recent.data?.items ?? [])].map((p, i) => (
                <div key={`${p.id}-${i}`} className="w-[260px] shrink-0">
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
