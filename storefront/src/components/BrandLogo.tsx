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
        <svg viewBox="0 0 64 64" width={size} height={size} aria-label="Ghir Laffaire" role="img">
          <g stroke="#FFD400" strokeWidth="2.4" strokeLinecap="round">
            <line x1="2"  y1="22" x2="14" y2="22" opacity="0.85" />
            <line x1="0"  y1="34" x2="10" y2="34" opacity="0.55" />
            <line x1="3"  y1="46" x2="12" y2="46" opacity="0.75" />
          </g>
          <path d="M16 18 L52 18 L46 44 L22 44 Z"
            fill="#1E466B" stroke="#0D0D0D" strokeWidth="2" strokeLinejoin="round" />
          <line x1="16" y1="18" x2="12" y2="10" stroke="#0D0D0D" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="26" cy="52" r="3.4" fill="#0D0D0D" />
          <circle cx="44" cy="52" r="3.4" fill="#0D0D0D" />
          <rect x="26" y="14" width="20" height="20" rx="2.5"
            fill="#FFD400" stroke="#0D0D0D" strokeWidth="2" />
          <text x="36" y="29" textAnchor="middle"
            fontFamily="Bricolage Grotesque, Inter, sans-serif"
            fontWeight="900" fontSize="14" fill="#0D0D0D">?</text>
          <path d="M28 12 L31 6 L34 11 L37 5 L40 11 L43 6 L46 12 Z"
            fill="#FF2E7A" stroke="#0D0D0D" strokeWidth="1.5" strokeLinejoin="round"
            className="crown-bounce origin-center" />
          <g fill="#3DA9FC">
            <path d="M54 10 L55 13 L58 14 L55 15 L54 18 L53 15 L50 14 L53 13 Z" className="sparkle-pulse" />
            <path d="M58 38 L59 40 L61 41 L59 42 L58 44 L57 42 L55 41 L57 40 Z"
              className="sparkle-pulse" style={{ animationDelay: '0.6s' }} />
          </g>
        </svg>
      </motion.div>

      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="headline-italic text-[16px] text-[var(--color-text-1)]">
            <span className="text-[var(--color-electric-blue)]">GHiR</span>{' '}
            <span>LAFFAiRE</span>
          </span>
          {showTagline && (
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--color-neon-yellow)] mt-1 font-bold">
              Fast · Reliable · Yours
            </span>
          )}
        </div>
      )}
    </div>
  )
}
