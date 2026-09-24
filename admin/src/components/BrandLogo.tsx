import { motion } from 'framer-motion'

/**
 * AMANTCOM brand mark — the same shield as storefront/src/components/BrandLogo.tsx:
 * a shield, a chevron reading as an A, and the dot it keeps safe.
 *
 * It replaces the Ghir Laffaire mark (cart, mystery box, crown) that the admin
 * console still showed after the storefront was rebranded. Colours are
 * `var(--color-*)` tokens so the mark follows the admin theme.
 */
interface BrandLogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
  /** A small "Console" label beneath the wordmark. */
  showTagline?: boolean
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
        <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="AMANTCOM">
          <path
            d="M32 4 L55 13 V32 C55 45 45 55 32 60 C19 55 9 45 9 32 V13 Z"
            fill="var(--color-surface-2)"
            stroke="var(--color-brand)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M22 40 L32 19 L42 40"
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M26.5 33 H37.5" stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="46.5" r="3.2" fill="var(--color-accent)" />
        </svg>
      </motion.div>

      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="headline-italic text-[15px] tracking-tight text-[var(--color-text-1)]">
            <span className="text-[var(--color-brand)]">A</span>MANTCOM
          </span>
          {showTagline && (
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-text-2)] mt-1 font-bold">
              Console
            </span>
          )}
        </div>
      )}
    </div>
  )
}
