import { motion } from 'framer-motion'

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
        whileHover={{ rotate: -6, scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      >
        <svg viewBox="0 0 64 64" width={size} height={size} aria-label="GLAIVE" role="img">
          {/* angular glaive-blade hexagon */}
          <path d="M32 3 L57 17 L57 47 L32 61 L7 47 L7 17 Z"
            fill="var(--color-surface-2)" stroke="var(--color-electric-blue)" strokeWidth="2.5" strokeLinejoin="round" />
          {/* upward blade */}
          <path d="M32 14 L43 41 L32 34 L21 41 Z"
            fill="var(--color-electric-blue)" stroke="var(--color-jet-black)" strokeWidth="1.5" strokeLinejoin="round" />
          {/* power core */}
          <circle cx="32" cy="44" r="3.6" fill="var(--color-neon-yellow)" />
          {/* RGB spark */}
          <path d="M48 12 L49 15 L52 16 L49 17 L48 20 L47 17 L44 16 L47 15 Z"
            fill="var(--color-hot-pink)" className="sparkle-pulse origin-center" />
        </svg>
      </motion.div>

      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="headline-italic text-[17px] tracking-tight text-[var(--color-text-1)]">
            GL<span className="text-[var(--color-electric-blue)]">A</span>IVE
          </span>
          {showTagline && (
            <span className="text-[9px] tracking-[0.24em] uppercase text-[var(--color-neon-yellow)] mt-1 font-bold">
              For Glory
            </span>
          )}
        </div>
      )}
    </div>
  )
}
