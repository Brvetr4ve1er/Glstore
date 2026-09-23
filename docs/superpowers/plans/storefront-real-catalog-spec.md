# Shared spec — storefront rebuild on the real catalogue

**Every implementer in this fleet reads this file first.** It is the single
source of truth for the data, the taxonomy and the constraints. Do not design
against assumptions; the numbers below were measured, not estimated.

## The brand — CONFIRMED

**The customer-facing brand is AMANATKOM. Put AMANATKOM on the page.**

Two names, two jobs — do not mix them up:

| Name | What it is | Where it appears |
|---|---|---|
| **AMANATKOM** | the **brand** customers see | hero, logo, nav, footer, page titles, SEO, emails |
| **Bouakil Electro** | the **operating company** | legal/company fine print only — never as the shop's name |

This is the ordinary company-vs-brand split: Bouakil Electro is the real
business that owns and runs the shop; AMANATKOM (أماناتكم — "your trusts") is
what it trades under. A shopper should see AMANATKOM everywhere and encounter
"Bouakil Electro" only where a legal entity is genuinely required.

AMANATKOM is also the platform name, which is fine and not a conflict: the
platform hosts brands, and today it hosts one — its own. GLAIVE remains a
second brand the architecture supports; it is simply not what this storefront
serves.

What this means for copy, concretely:

- The shop is named **AMANATKOM** — hero, footer, page titles, SEO, logo alt.
- It sells **home appliances** in Algeria: DZD, 58 wilayas, cash on delivery.
- The GLAIVE gaming identity appears nowhere here. "JOUE POUR GAGNER",
  `/c/Headsets`, `/c/Keyboards` are all wrong for this storefront.
- **Do not invent claims.** No "25 years", no "#1 in Algeria", no warranty
  terms, no delivery promises beyond the ones already in the codebase
  (58 wilayas, paiement à la livraison). With a real brand on the page,
  invented marketing claims stop being a design smell and become a liability.
  If you want a claim and cannot source it from existing code, leave it out.
- **Do not translate or transliterate the brand.** It is written AMANATKOM in
  Latin script throughout. Do not render it in Arabic script, and do not
  "correct" the spelling.

**GLAIVE stays exactly as built.** Nothing in `db/seed_gaming.sql`,
`db/seed_glaive_starter.sql` or the GLAIVE theme is touched. This is the
multi-brand architecture doing its job: `stores.theme` is per store and the
storefront already boots its palette from `GET /storefront/theme`.

## The data — measured, not assumed

Source: `bouakil electro product database - Produits.csv`, 567 products.
Verified through the platform's own parser (`api/services/csv_parser.parse`):
**567/567 rows parse, all 11 significant headers bind to `COLUMN_MAP`.**

### Field fill rates — what the UI must survive without

| Field | Fill | Consequence for the UI |
|---|---|---|
| `Nom`, `SKU`, `Code Barre`, `Prix de Vente` | **100%** | always safe to render |
| `Prix de Gros` | 99.3% | |
| `Statut Stock` | 95.1% | |
| `Marque` | **71.8%** | **160 products have NO brand** |
| `CUMP` / `Dernier Prix d'Achat` | 27% | internal only, never public |
| **`Description Détaillée`** | **0%** | no product has a description |
| **`Spécifications Techniques`** | **0%** | no product has specs |
| **`Liens Média`** | **0%** | **no product has an image** |
| `Prix d'Achat`, `Méta-données`, `UoM` | 0% | |

**Three of those zeros define this entire job.** A product card, a detail page
and a search result must look deliberate with nothing but a name, a price, a
stock state and — 72% of the time — a brand.

### Prices (DZD)

`min 1 000 · p25 8 950 · median 20 000 · p75 37 000 · max 250 000`

Price filter bands must be built on this distribution. Do not invent bands.

### Stock

`Normal 500 · Rupture 38 · Faible 1 · (empty) 28`

`Rupture` is 6.7% of the catalogue — out-of-stock is a real, visible state with
real volume, not an edge case.

### Brands (16 distinct)

`MULTISMART 175 · GEANT 71 · CONTIGLOBAL 43 · MIDEA 30 · SCHALLENGE 24 ·
SONIFER 22 · ARCODYM 16 · ELECTROGAS 12 · TEFAL 3 · WESTCROWN 3 · MOULINEX 2 ·
CRRAFT 2 · KRUPS 2 · BERGMANN 1` — **and 160 with none.**

The brand filter needs a real "Sans marque" entry. It is the second-largest
bucket in the catalogue.

### The source data contains misspellings

Real, in the live file: `BOULOIRE` (bouilloire), `CAFITIER` (cafetière),
`REFRIGIRATEUR` / `REFRIGRATEUR`, `MUTLISMART`, `CENTRE FIGEUSE`
(centrifugeuse), `MACHINE A GOFFRE` (gaufre).

Search must tolerate this. Exact-match search over this catalogue will fail
shoppers. Accent-folding and forgiving matching are requirements, not polish.

## The taxonomy — derived, because the CSV has none

**All 567 products carry the single category "Electromenager".** There is no
taxonomy in the source data. The one below was derived from product names by
keyword classification and measured at **92.4% coverage**.

| Category | Count | % |
|---|---:|---:|
| Cuisson | 136 | 24.0% |
| Préparation culinaire | 136 | 24.0% |
| Friture & Grill | 49 | 8.6% |
| Petit déjeuner | 42+ | 7.4% |
| Froid | 34+ | 6.0% |
| Lavage | 33 | 5.8% |
| Hottes & Encastrable | 32 | 5.6% |
| Climatisation & Air | 24 | 4.2% |
| Entretien & Repassage | 21 | 3.7% |
| Eau & Chauffage | 17 | 3.0% |
| Soin & Beauté | ~8 | 1.4% |
| TV & Image | ~5 | 0.9% |
| **Autre** | ~40 | ~7% |

**"Autre" is a real bucket and must render like a first-class category.**
Hiding it loses 40 sellable products.

Traps confirmed in the data — do not let these become categories:
- `MULTISMART`, `GEANT`, `CONTIGLOBAL`, `MIDEA` are **brands**.
- `INOX`, `NOIR`, `BLANC`, `GRIS`, `ROUGE` are **colours**.
- `13 ELEMENT`, `6L`, `40P`, `14K` are **specs**.

## Icons and illustrations — the core of this job

With 0% images, the icon system *is* the visual layer for 567 products.

**Current state:** `storefront/src/lib/format.ts:44-47` — `categoryIcon()`
returns an **emoji string**, defaulting to `'🎮'`. Emoji as UI iconography is
audit signal #22, and a gaming emoji on a refrigerator is worse than none.

**Target:** `categoryIcon()` returns a **React component**, one SVG per category
above. Its only caller today is `ProductCard.tsx` (already imports it), so this
is additive.

Non-negotiable for coherence — audit signals #21 and #23 are "icons from
multiple families" and "inconsistent stroke widths":

- **One family.** `lucide-react` is already a dependency and covers most
  appliance types. Gaps get hand-drawn SVGs on Lucide's grammar: **24×24
  viewBox, 2px stroke, round caps and joins, `currentColor`, no fill.**
- **No emoji. No raster. No generated photographs.**
- The empty-image **illustration** is one shared component: the category icon at
  display scale on a tonal surface, reusing the existing
  `.no-img-placeholder` (`storefront/src/index.css:304`), themed per brand.

## Global constraints — binding on every implementer

- **Additive only.** Components gain props and sections; nothing is rewritten.
  **Grep for callers before changing any signature.**
- **French + DZD.** Prices via the existing `fmtMoney`. No English strings.
- **Do not touch:** `gaming-store/` (static prototype), `db/seed_gaming.sql`,
  `db/seed_glaive_starter.sql`, the GLAIVE theme tokens, anything under `api/`
  unless your task says so.
- **No-touch list from the audit** — these already pass, leave them: the hero
  copy pattern, `alt` coverage (5/5), the error/empty/loading states, the
  2-inline-styles discipline.
- **Accessibility:** any form you touch ships `htmlFor`/`id` pairs. `htmlFor`
  currently appears **zero** times across 6 inputs — audit Critical #1. Do not
  add a seventh.
- **`text-[10px]` is banned** in new code (55 existing instances are a separate
  cleanup task). Use the type scale.
- `python -m pytest tests/` must not drop below **421 passed**.
- Storefront must build: `npm --prefix storefront run build` (`tsc -b && vite
  build`) — a TypeScript error is a failed deploy.
- Stay on branch `gaming-store`. No force git ops. **Stage explicit paths,
  never `git add -A`.**
- **Read before writing.** Briefs name files and line numbers for a reason —
  two briefs in this project were wrong because they paraphrased code instead
  of opening it.

## Files you will be pointed at

| Path | Why |
|---|---|
| `storefront/src/lib/format.ts:44-47` | `categoryIcon()` — the emoji to replace |
| `storefront/src/lib/tags.ts` | `deriveTags()` — reads `specs`, which is 0% filled here |
| `storefront/src/components/ProductCard.tsx:9-13` | props interface, additive |
| `storefront/src/components/FilterSidebar.tsx` | brand / price / stock filters |
| `storefront/src/components/Navbar.tsx:13-17` | hard-coded `/c/Headsets` etc. |
| `storefront/src/components/Footer.tsx:9-13` | same hard-coded links |
| `storefront/src/pages/Home.tsx` | hero + section rhythm |
| `storefront/src/pages/ProductDetail.tsx` | must survive 0 description, 0 specs |
| `storefront/src/index.css:304` | `.no-img-placeholder` |

## Out of scope for this fleet

Financing, customer accounts, OTP, applications, documents, signatures, POS
partners — all planned in `amanatkom-financing.md` and deliberately parked.
Nothing in this fleet touches them. No database import happens here; the
operator runs imports.
