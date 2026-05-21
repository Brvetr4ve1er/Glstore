/**
 * Floema-style footer:
 *   1) Citron "Made to last…" lower-tagline band
 *   2) Dark band with link columns, newsletter, and legal row
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Instagram, Linkedin, Facebook } from 'lucide-react'
import { BrandLogo } from './BrandLogo'

const COLS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: 'Shop',
    links: [
      { to: '/c/all',         label: 'All Products' },
      { to: '/c/laptops',     label: 'Laptops' },
      { to: '/c/audio',       label: 'Audio' },
      { to: '/c/gaming',      label: 'Gaming' },
      { to: '/c/smart-home',  label: 'Smart Home' },
      { to: '/c/accessories', label: 'Accessories' },
    ],
  },
  {
    title: 'Service',
    links: [
      { to: '/order/track',    label: 'Track an order' },
      { to: '/help/shipping',  label: 'Shipping' },
      { to: '/help/warranty',  label: 'Warranty' },
      { to: '/help/returns',   label: 'Returns' },
      { to: '/help/contact',   label: 'Contact' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about',          label: 'About' },
      { to: '/sustainability', label: 'Sustainability' },
      { to: '/journal',        label: 'Journal' },
      { to: '/careers',        label: 'Careers' },
      { to: '/legal/privacy',  label: 'Privacy' },
    ],
  },
]

export function Footer() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return (
    <footer className="mt-24">
      {/* ── Lower tagline band (citron) ───────────────────────── */}
      <section className="fl-band-citron">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-20 md:py-28 flex flex-col items-center text-center gap-8">
          <p className="font-display text-[clamp(40px,5vw,80px)] leading-[1] tracking-[-0.04em] text-[var(--color-jet-black)] max-w-4xl">
            Made to last, <em className="not-italic underline decoration-2 underline-offset-[10px]">designed</em> to endure.
          </p>
          <Link to="/about" className="fl-cta" data-variant="ghost">
            <span className="icon-circle">
              <ArrowRight size={14} strokeWidth={2.2} />
            </span>
            Read our story
          </Link>
        </div>
      </section>

      {/* ── Main dark footer ─────────────────────────────────── */}
      <section className="fl-band-dark">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-16 md:py-20">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            {/* Wordmark + newsletter */}
            <div className="md:col-span-5 flex flex-col gap-6">
              <BrandLogo size={36} inverted showTagline />
              <p className="text-sm text-[var(--color-soft-white)]/70 max-w-md leading-relaxed">
                A calm, craft-first tech storefront. Tools, instruments and devices built to be repaired, not replaced.
              </p>

              <form
                onSubmit={e => { e.preventDefault(); if (email.trim()) setSubmitted(true) }}
                className="flex gap-2 max-w-md mt-2"
              >
                <div className="flex-1 flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-5">
                  <input
                    type="email"
                    required
                    placeholder="Your email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-[var(--color-soft-white)] placeholder:text-white/40 py-3 focus:outline-none"
                  />
                </div>
                <button type="submit" className="fl-cta">
                  <span className="icon-circle"><ArrowRight size={14} strokeWidth={2.2} /></span>
                  {submitted ? 'Subscribed' : 'Subscribe'}
                </button>
              </form>
              <div className="flex items-center gap-3 text-[var(--color-soft-white)]/70 mt-3">
                <a href="#" aria-label="Instagram" className="w-9 h-9 rounded-full grid place-items-center border border-white/20 hover:bg-white/10"><Instagram size={15} strokeWidth={1.6} /></a>
                <a href="#" aria-label="LinkedIn" className="w-9 h-9 rounded-full grid place-items-center border border-white/20 hover:bg-white/10"><Linkedin size={15} strokeWidth={1.6} /></a>
                <a href="#" aria-label="Facebook" className="w-9 h-9 rounded-full grid place-items-center border border-white/20 hover:bg-white/10"><Facebook size={15} strokeWidth={1.6} /></a>
              </div>
            </div>

            {/* Link columns */}
            <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
              {COLS.map(col => (
                <div key={col.title}>
                  <h3 className="text-[10px] uppercase tracking-[0.22em] font-semibold text-[var(--color-soft-white)]/50 mb-4">
                    {col.title}
                  </h3>
                  <ul className="flex flex-col gap-3 text-[14px] text-[var(--color-soft-white)]/85">
                    {col.links.map(l => (
                      <li key={l.to}>
                        <Link to={l.to} className="hover:text-[var(--color-citron)] transition-colors">
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 mt-14 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-soft-white)]/45">
            <span>© {new Date().getFullYear()} Ghir Laffaire — Made for life</span>
            <span>Floema-inspired storefront · Built with care</span>
          </div>
        </div>
      </section>
    </footer>
  )
}
