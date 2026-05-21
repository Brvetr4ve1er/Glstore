/**
 * Brand wordmark — Floema-style: a calm, condensed editorial wordmark
 * with a registered-trademark mark. Kept as an SVG so it sits as a
 * single inline element on any background.
 */

interface BrandLogoProps {
  size?: number
  showWordmark?: boolean
  showTagline?: boolean
  className?: string
  /** When the logo sits on a dark band, set to true to invert ink. */
  inverted?: boolean
}

export function BrandLogo({
  size = 36,
  showWordmark = true,
  showTagline = false,
  className,
  inverted = false,
}: BrandLogoProps) {
  const ink = inverted ? '#F2EFEA' : '#241F21'
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      {/* Full wordmark "Ghir Laffaire®" as a single SVG */}
      <svg
        viewBox="0 0 220 36"
        height={size}
        aria-label="Ghir Laffaire"
        role="img"
        style={{ display: 'block' }}
      >
        <text
          x="0"
          y="26"
          fill={ink}
          fontFamily="Instrument Serif, Space Grotesk, serif"
          fontSize="26"
          fontWeight="400"
          letterSpacing="-0.5"
        >
          Ghir Laffaire
        </text>
        <circle cx="195" cy="11" r="7" fill="none" stroke={ink} strokeWidth="1.4" />
        <text
          x="195"
          y="14"
          textAnchor="middle"
          fill={ink}
          fontFamily="Instrument Serif, serif"
          fontSize="9"
          fontWeight="400"
        >
          R
        </text>
      </svg>

      {showWordmark === false ? null : null}

      {showTagline && (
        <span
          className="text-[10px] uppercase tracking-[0.22em] font-semibold ml-2"
          style={{ color: ink, opacity: 0.6 }}
        >
          Made for life
        </span>
      )}
    </div>
  )
}
