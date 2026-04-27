import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, Sparkles, Truck, ShieldCheck, Zap } from 'lucide-react'
import { fetchCategories, fetchFeatured } from '@/lib/api'
import { categoryIcon } from '@/lib/format'
import { ProductCard } from '@/components/ProductCard'
import { ScrollReveal, STAGGER_CONTAINER, STAGGER_ITEM } from '@/components/ScrollReveal'
import { Button } from '@/components/ui'
import { SearchBox } from '@/components/SearchBox'
import { BrandLogo } from '@/components/BrandLogo'
import { SEO } from '@/components/SEO'

export default function Home() {
  const featured = useQuery({ queryKey: ['featured'], queryFn: () => fetchFeatured(12), staleTime: 60_000 })
  const cats = useQuery({ queryKey: ['categories'], queryFn: fetchCategories, staleTime: 5 * 60_000 })

  return (
    <div className="page-enter">
      <SEO
        title="Ghir Laffaire — Fast. Reliable. Yours."
        description="Électroménager et électronique en Algérie. Livraison 48h dans les 58 wilayas. Paiement à la livraison."
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
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-sm text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-neon-yellow)]">
              <Sparkles size={11} /> Inspiré par Shibuya · construit pour l'Algérie
            </div>

            <h1 className="font-display text-5xl md:text-7xl font-black leading-[0.95] max-w-4xl tracking-tight">
              <span className="text-[var(--color-electric-blue)]">Fast.</span>{' '}
              <span className="text-[var(--color-text-1)]">Reliable.</span>{' '}
              <span className="punk-stripe text-[var(--color-text-1)]">Yours.</span>
            </h1>

            <p className="text-base md:text-lg text-[var(--color-text-2)] max-w-2xl leading-relaxed">
              Électroménager et électronique. Livraison <span className="text-[var(--color-text-1)] font-bold">48h</span> à travers les 58 wilayas. Paiement <span className="text-[var(--color-text-1)] font-bold">à la livraison</span>.
            </p>

            <div className="w-full max-w-2xl mt-2">
              <SearchBox variant="page" />
            </div>

            <div className="flex flex-wrap gap-3 justify-center mt-2">
              <Link to="/c/all">
                <Button variant="accent" size="lg">
                  Explorer le catalogue <ArrowRight size={16} />
                </Button>
              </Link>
              <Link to="/c/TV">
                <Button variant="outline" size="lg">
                  📺 TV à partir de 30 000 DZD
                </Button>
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <ScrollReveal variant="fade-up">
        <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-4 -mt-4 mb-12">
          {[
            { icon: Truck, title: 'Livraison 48h', desc: '58 wilayas couvertes' },
            { icon: ShieldCheck, title: 'COD partout', desc: 'Payez à la livraison' },
            { icon: Zap, title: 'Stock vérifié', desc: 'Disponibilité en temps réel' },
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

      {/* ── Categories grid ── */}
      <section className="max-w-[1400px] mx-auto px-6 mb-16">
        <ScrollReveal variant="fade-up-sm">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-[var(--color-text-1)]">
                <span className="punk-stripe">Catégories</span>
              </h2>
              <p className="text-sm text-[var(--color-text-3)] mt-2">Naviguez par univers</p>
            </div>
            <Link to="/c/all" className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline whitespace-nowrap">
              Tout voir →
            </Link>
          </div>
        </ScrollReveal>

        <motion.div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
        >
          {(cats.data?.items ?? []).slice(0, 12).map(c => (
            <motion.div key={c.name} variants={STAGGER_ITEM}>
              <Link
                to={`/c/${encodeURIComponent(c.name)}`}
                className="group relative flex flex-col items-center justify-center gap-2 aspect-square glass overflow-hidden hover:border-[var(--color-electric-blue)]/40 transition-colors"
              >
                <span className="text-3xl group-hover:scale-110 transition-transform" aria-hidden>
                  {categoryIcon(c.name)}
                </span>
                <span className="text-xs font-bold text-[var(--color-text-1)] text-center px-2 line-clamp-2">{c.name}</span>
                <span className="text-[10px] num text-[var(--color-text-3)]">{c.count}</span>
              </Link>
            </motion.div>
          ))}
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
              <p className="text-sm text-[var(--color-text-3)] mt-2">Mieux notés · vérifiés · en stock</p>
            </div>
            <Link to="/c/all" className="text-xs font-bold text-[var(--color-electric-blue)] hover:underline whitespace-nowrap">
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
        ) : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            variants={STAGGER_CONTAINER}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
          >
            {(featured.data?.items ?? []).map(p => (
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
                <div className="rocket-float shrink-0"><BrandLogo size={64} showWordmark={false} /></div>
                <div>
                  <h3 className="font-display text-2xl md:text-3xl font-black text-[var(--color-text-1)] leading-tight">
                    Punk mode <span className="text-[var(--color-neon-yellow)]">on.</span>
                  </h3>
                  <p className="text-sm text-[var(--color-text-2)] mt-2 leading-relaxed">
                    Move fast. Stay reliable. Une plateforme construite pour l'Algérie, des prix clairs, du stock honnête, des fiches vérifiées.
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
