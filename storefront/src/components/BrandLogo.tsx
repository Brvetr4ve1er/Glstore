import { motion } from 'framer-motion'

/**
 * AMANTCOM brand mark.
 *
 * The mark is built around safekeeping rather than appliances: a shield,
 * and inside it a chevron reading as an A, sheltering a single dot — the
 * thing entrusted. (An earlier version of this comment glossed the name
 * against an Arabic word meaning "your trusts" — that gloss matched the
 * brand's PREVIOUS spelling letter-for-letter, but does not verifiably
 * correspond to "AMANTCOM", so it is not repeated here rather than risk
 * asserting an etymology that no longer holds.)
 *
 * It replaces a GLAIVE gaming mark (an angular glaive-blade hexagon with an
 * upward blade and an RGB spark) that shipped in the navbar, the mobile drawer
 * and the footer of an appliance shop.
 *
 * Everything is a `var(--color-*)` token, deliberately: `lib/theme.ts` swaps
 * those at runtime per store, so the mark re-themes with the rest of the
 * storefront instead of pinning one brand's palette into the SVG. That is the
 * mistake `.no-img-placeholder` still makes with two hardcoded retired-brand
 * literals.
 */

interface BrandLogoProps {
  size?: number
  showWordmark?: boolean
  showTagline?: boolean
  className?: string
}

export function BrandLogo({
  size = 36,
  showWordmark = true,
  showTagline = false,
  className,
}: BrandLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <motion.div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        whileHover={{ rotate: -4, scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      >
        <svg
          viewBox="0 0 64 64"
          width={size}
          height={size}
          role="img"
          aria-label="AMANTCOM"
        >
          {/* Shield — safekeeping. Soft shoulders, not a weapon silhouette. */}
          <path
            d="M32 4 L55 13 V32 C55 45 45 55 32 60 C19 55 9 45 9 32 V13 Z"
            fill="var(--color-surface-2)"
            stroke="var(--color-brand)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {/* Chevron reading as an A, and as a roof over what it holds. */}
          <path
            d="M22 40 L32 19 L42 40"
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* The A's crossbar. */}
          <path
            d="M26.5 33 H37.5"
            stroke="var(--color-brand)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* The thing entrusted, kept under the roof. */}
          <circle cx="32" cy="46.5" r="3.2" fill="var(--color-accent)" />
        </svg>
      </motion.div>

      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="headline-italic text-[17px] tracking-tight text-[var(--color-text-1)]">
            <span className="text-[var(--color-brand)]">A</span>MANATKOM
          </span>
          {showTagline && (
            // Sector, not a claim. No "#1", no years in business, no warranty
            // promise -- the owner supplies those, approved, or they stay out.
            <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--color-text-2)] mt-1 font-bold">
              Électroménager
            </span>
          )}
        </div>
      )}
    </div>
  )
}
