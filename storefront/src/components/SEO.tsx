/**
 * Per-route SEO + Open Graph / Twitter Card metadata.
 *
 * Uses React 19's native metadata hoisting — `<title>` and `<meta>` rendered
 * inside any component are automatically lifted into <head> by React.
 *
 * Usage:
 *   <SEO title="…" description="…" image="https://…" />
 *
 * If `image` is omitted, og:image is omitted (cleaner than a placeholder).
 */
interface SEOProps {
  title: string
  description?: string
  image?: string | null
  /** Canonical URL — falls back to current location */
  url?: string
  /** Override the og:type. Default 'website'. Product pages should pass 'product'. */
  type?: 'website' | 'product' | 'article'
  noIndex?: boolean
}

const DEFAULT_DESC = 'Matériel gaming pro en Algérie — casques, claviers, souris, manettes. Livraison rapide. Paiement à la livraison.'
const SITE_NAME = 'GLAIVE'

export function SEO({
  title, description, image, url, type = 'website', noIndex,
}: SEOProps) {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`
  const desc = (description || DEFAULT_DESC).slice(0, 160)
  const canonical = url || (typeof window !== 'undefined' ? window.location.href : undefined)

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {noIndex && <meta name="robots" content="noindex,nofollow" />}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="fr_DZ" />
      {canonical && <meta property="og:url" content={canonical} />}
      {image && <meta property="og:image" content={image} />}
      {image && <meta property="og:image:alt" content={title} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      {image && <meta name="twitter:image" content={image} />}
    </>
  )
}
