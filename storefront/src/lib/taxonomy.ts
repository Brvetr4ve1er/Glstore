/**
 * Appliance taxonomy — derived, because the catalogue has none.
 *
 * All 567 products in the real database carry the single category
 * "Electromenager". There is no usable taxonomy in the source data, and there
 * are no descriptions and no specs either — only a name, a price, a stock
 * state and (72% of the time) a brand.
 *
 * So the category is classified from the product NAME, client-side. That is a
 * deliberate choice over two alternatives:
 *
 *   · Teaching `api/services/enrichment` these categories so `products.category`
 *     becomes authoritative. Correct long-term, and the right follow-up — but it
 *     is a backend change, and this storefront work is additive by constraint.
 *   · Hardcoding a category list in the UI. Rejected: it would drift from the
 *     data the moment a new product type arrives.
 *
 * Coverage was MEASURED against the real 567-row catalogue: 92.4% classified.
 * The residual lands in `autre`, which is a first-class category here — hiding
 * it would drop ~40 sellable products out of the shop.
 *
 * Order matters: the first matching category wins. More specific groups are
 * listed before more general ones (`MACHINE A VAISSELLE` must be caught by
 * Lavage before `MACHINE A ...` reaches anything else).
 *
 * THREE TRAPS, confirmed in the live data — none of these is a category:
 *   · brands:  MULTISMART (175), GEANT (71), CONTIGLOBAL (43), MIDEA (30)
 *   · colours: INOX (81), NOIR (47), BLANC (47), GRIS (40), ROUGE (13)
 *   · specs:   "13 ELEMENT", "6L", "40P", "14K"
 *
 * The keyword lists deliberately include MISSPELLINGS that are really in the
 * supplier's data — BOULOIRE, CAFITIER, REFRIGIRATEUR, CENTRE FIGEUSE,
 * MACHINE A GOFFRE. Dropping them silently loses real products.
 */

export interface Category {
  /** URL segment: /c/:slug */
  slug: string
  /** Shopper-facing French label */
  label: string
  /** Uppercase, accent-folded substrings. First match wins. */
  keywords: string[]
}

/**
 * Fold to the form the keyword lists are written in: uppercase, no accents.
 * "Réfrigérateur" and "REFRIGERATEUR" must match the same rule.
 */
export function foldName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
}

export const CATEGORIES: Category[] = [
  {
    slug: 'eau-chauffage',
    label: 'Eau & Chauffage',
    keywords: ['FONTAIN', 'BAIN DHUILE', 'BAIN D HUILE', 'CHAUFF BAIN', 'CHAUFFE BAIN',
      'CHAUFFE EAU', 'CHAUFFE-EAU', 'CHAUFFE MULTISMART', 'CHAUFFAGE', 'RADIATEUR', 'CONVECTEUR'],
  },
  {
    slug: 'froid',
    label: 'Froid',
    keywords: ['REFRIGERATEUR', 'REFRIGIRATEUR', 'REFRIGRATEUR', 'CONGELATEUR', 'FRIGO', 'VITRINE'],
  },
  {
    slug: 'climatisation',
    label: 'Climatisation & Air',
    keywords: ['CLIMATISEUR', 'ARTCOOL', 'AIR COOLER', 'VENTILATEUR', 'SPLIT',
      'RAFRAICHISSEUR', 'PURIFICATEUR'],
  },
  {
    slug: 'lavage',
    label: 'Lavage',
    keywords: ['MACHINE A LAVER', 'MACHINE A VAISSELLE', 'LAVE LINGE', 'LAVE-LINGE',
      'LAVE VAISSELLE', 'SECHE LINGE', 'LAVEUSE', 'ESSOREUSE'],
  },
  {
    slug: 'hottes-encastrable',
    label: 'Hottes & Encastrable',
    keywords: ['HOTTE', 'ENCASTRABLE'],
  },
  {
    slug: 'friture-grill',
    label: 'Friture & Grill',
    keywords: ['FRITEUSE', 'PANINEUSE', 'GRILL', 'BARBECUE', 'CREPIERE', 'GAUFRIER',
      'AIR FRYER', 'SANDWICH', 'MACHINE A CREPE', 'MACHINE A GOFFRE', 'MACHINE A GAUFRE',
      'MACHINE A PIZZA', 'MACHINE A PETIT DEJEUNER'],
  },
  {
    slug: 'petit-dejeuner',
    label: 'Petit déjeuner',
    keywords: ['CAFETIER', 'CAFITIER', 'CAFETIERE', 'MACHINE A CAFE', 'PRESSE A CAFE',
      'MOULINETTE', 'MOULIN A CAFE', 'BOUILLOIRE', 'BOULOIRE', 'GRILLE PAIN', 'TOASTER',
      'EXPRESSO', 'COFFEE GRINDER', 'THEIERE'],
  },
  {
    slug: 'cuisson',
    label: 'Cuisson',
    keywords: ['MICRO ONDE', 'MICRO-ONDE', 'MICROONDE', 'FOUR', 'CUISINIERE', 'PLAQUE',
      'CUIS', 'RECHAUD', 'COCOTTE', 'AUTOCUISEUR', 'MARMITE', 'BAKER'],
  },
  {
    slug: 'preparation',
    label: 'Préparation culinaire',
    keywords: ['PETRIN', 'BATTEUR', 'HACHOIR', 'BLENDER', 'ROBOT', 'MIXEUR', 'MIXER',
      'JUICER', 'PRESSE AGRUME', 'CENTRIFUG', 'CENTRE FIGEUSE', 'EXTRACTEUR',
      'TRANCHEUSE', 'RAPE', 'MACHINE A PATTE'],
  },
  {
    slug: 'entretien',
    label: 'Entretien & Repassage',
    keywords: ['FER A REPASSER', 'FER ', 'CENTRALE VAPEUR', 'ASPIRATEUR', 'NETTOYEUR',
      'BALAI', 'VAPEUR', 'MACHINE A COUDRE'],
  },
  {
    slug: 'soin-beaute',
    label: 'Soin & Beauté',
    keywords: ['SECHE CHEVEUX', 'SECHE-CHEVEUX', 'SECHOIR', 'TONDEUSE', 'RASOIR',
      'LISSEUR', 'BROSSE'],
  },
  {
    slug: 'tv-image',
    label: 'TV & Image',
    keywords: ['TV ', 'TELEVISEUR', 'SMART TV', 'QLED', 'ANDROID TV'],
  },
  {
    // Not a fallback bin to hide — ~7% of the catalogue lands here and every
    // one of those products is sellable. It renders like any other category.
    slug: 'autre',
    label: 'Autre',
    keywords: [],
  },
]

export const AUTRE_SLUG = 'autre'

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]))

export function categoryBySlug(slug: string | null | undefined): Category | undefined {
  return slug ? BY_SLUG.get(slug) : undefined
}

export function categoryLabel(slug: string | null | undefined): string {
  return categoryBySlug(slug)?.label ?? 'Autre'
}

/**
 * Classify a product name into a category slug. Always returns something —
 * unmatched names land in `autre` rather than disappearing.
 */
export function classifyProductName(name: string | null | undefined): string {
  const n = foldName(name)
  if (!n.trim()) return AUTRE_SLUG
  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) continue
    for (const kw of cat.keywords) {
      if (n.includes(kw)) return cat.slug
    }
  }
  return AUTRE_SLUG
}

/** Count products per category — used by the home grid and the filters. */
export function countByCategory(
  items: ReadonlyArray<{ name: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cat of CATEGORIES) counts.set(cat.slug, 0)
  for (const p of items) {
    const slug = classifyProductName(p.name)
    counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  return counts
}
