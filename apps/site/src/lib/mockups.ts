/**
 * Product mockup templates.
 *
 * Each mockup is a recolourable flat-vector garment with a FRONT and a
 * BACK view, plus a "print area" rectangle (in viewBox units) marking
 * where a customer design can be placed — like Printify / Redbubble.
 *
 * Photographic mockups: a mockup may optionally carry a `raster` map
 * (one image per colour, per side) — see the `raster` field + the note
 * at the bottom. When present the builder uses the photo instead of the
 * SVG. Until the shop supplies real product photos, the clean vector
 * mockups are the default and look good out of the box.
 */

export type MockupKind = 'tshirt' | 'hoodie' | 'mug' | 'tote';
export type Side = 'recto' | 'verso';

export interface GarmentColor { name: string; hex: string; }
export interface Rect { x: number; y: number; w: number; h: number; }

/** Optional photographic override (owner-supplied product photos). */
export interface RasterMockup {
  /** image URL per colour name, per side */
  images: Record<string, { recto: string; verso?: string }>;
  printAreaRecto: Rect;
  printAreaVerso?: Rect;
}

export interface Mockup {
  kind: MockupKind;
  vb: number;                 // square viewBox side
  printArea: Rect;            // print area for the vector mockup (both sides)
  colors: GarmentColor[];
  twoSided: boolean;          // can it have a back design?
  front: (garmentHex: string) => string;
  back: (garmentHex: string) => string;
  raster?: RasterMockup;      // optional real-photo override
}

/* Owner-editable base id (content/bases/*.json) → mockup. */
export const BASE_TO_MOCKUP: Record<string, MockupKind> = {
  tshirt: 'tshirt',
  sweat: 'hoodie',
  pull: 'hoodie',
  tote: 'tote',
  mug: 'mug',
};

const GARMENT_COLORS: GarmentColor[] = [
  { name: 'Noir', hex: '#161616' },
  { name: 'Blanc', hex: '#FAFAF7' },
  { name: 'Gris', hex: '#9AA0A6' },
  { name: 'Rouge', hex: '#CC0000' },
];
const MUG_COLORS: GarmentColor[] = [
  { name: 'Blanc', hex: '#FAFAF7' },
  { name: 'Noir', hex: '#161616' },
];

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amount)));
  g = Math.max(0, Math.min(255, Math.round(g + amount)));
  b = Math.max(0, Math.min(255, Math.round(b + amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}
const SHADOW = `<ellipse cx="500" cy="905" rx="250" ry="24" fill="rgba(0,0,0,0.10)"/>`;

/** Per-garment realism kit: stroke colour, fold shade, deep shade, highlight. */
function tones(g: string) {
  const light = isLight(g);
  return {
    fold:      shade(g, light ? -22 : 28),     // shadow folds
    deep:      shade(g, light ? -45 : 50),     // deep shadow / collar rib
    highlight: light ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.06)',
    seam:      light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.10)',
    stitch:    light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.30)',
  };
}

/** Shared SVG defs: vignette + side-light gradient for body shaping. */
function defs(g: string): string {
  const t = tones(g);
  return `<defs>
    <linearGradient id="bodyLight" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.fold}" stop-opacity="0.55"/>
      <stop offset="0.18" stop-color="${g}" stop-opacity="0"/>
      <stop offset="0.82" stop-color="${g}" stop-opacity="0"/>
      <stop offset="1" stop-color="${t.fold}" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="centerHi" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0" stop-color="${t.highlight}" stop-opacity="${isLight(g) ? 0.0 : 1}"/>
      <stop offset="1" stop-color="${t.highlight}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hemShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.fold}" stop-opacity="0"/>
      <stop offset="1" stop-color="${t.deep}" stop-opacity="0.45"/>
    </linearGradient>
  </defs>`;
}
function open(g: string, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${defs(g)}${SHADOW}${extra}`;
}

// ── T-SHIRT ─────────────────────────────────────────────────────────
// Oversize-tee silhouette: relaxed shoulder, dropped sleeve, wide hem.
const TSHIRT_BODY = `M300,215 L360,205
  C420,250 580,250 640,205 L700,215
  L860,300 L770,460 L700,425
  L705,860 L295,860 L300,425 L230,460 L140,300 Z`;
const TSHIRT_BACK_BODY = `M300,215 L360,200
  C470,232 530,232 640,200 L700,215
  L860,300 L770,460 L700,425
  L705,860 L295,860 L300,425 L230,460 L140,300 Z`;

function tshirtFront(g: string): string {
  const t = tones(g);
  return open(g) + `
    <!-- body -->
    <path d="${TSHIRT_BODY}" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <!-- side-light gradient + centre highlight + hem shade -->
    <path d="${TSHIRT_BODY}" fill="url(#bodyLight)"/>
    <path d="${TSHIRT_BODY}" fill="url(#centerHi)" opacity="0.7"/>
    <path d="${TSHIRT_BODY}" fill="url(#hemShade)"/>
    <!-- collar V ribbing -->
    <path d="M362,206 C420,250 580,250 638,206 C600,260 400,260 362,206 Z" fill="${t.deep}" opacity="0.85"/>
    <path d="M380,222 C430,256 570,256 620,222" stroke="${t.highlight}" stroke-width="1.5" fill="none" opacity="0.6"/>
    <!-- sleeve seams -->
    <path d="M230,460 C260,430 290,400 312,392" stroke="${t.seam}" stroke-width="2" fill="none"/>
    <path d="M770,460 C740,430 710,400 688,392" stroke="${t.seam}" stroke-width="2" fill="none"/>
    <!-- sleeve cuff shade -->
    <path d="M300,425 L230,460 L260,478 L312,448 Z" fill="${t.deep}" opacity="0.40"/>
    <path d="M700,425 L770,460 L740,478 L688,448 Z" fill="${t.deep}" opacity="0.40"/>
    <!-- top-stitches around collar + cuffs + hem -->
    <path d="M370,219 C425,255 575,255 630,219" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" fill="none" opacity="0.7"/>
    <path d="M270,453 L308,433" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>
    <path d="M730,453 L692,433" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>
    <path d="M306,838 L700,838" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
    <!-- subtle vertical fold down the middle -->
    <path d="M500,260 L500,840" stroke="${t.fold}" stroke-width="1.5" opacity="0.18"/>
  </svg>`;
}
function tshirtBack(g: string): string {
  const t = tones(g);
  return open(g) + `
    <path d="${TSHIRT_BACK_BODY}" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="${TSHIRT_BACK_BODY}" fill="url(#bodyLight)"/>
    <path d="${TSHIRT_BACK_BODY}" fill="url(#centerHi)" opacity="0.7"/>
    <path d="${TSHIRT_BACK_BODY}" fill="url(#hemShade)"/>
    <!-- back collar rib (solid, no V dip) -->
    <path d="M378,205 C470,238 530,238 622,205 C540,228 460,228 378,205 Z" fill="${t.deep}" opacity="0.85"/>
    <path d="M390,218 C470,246 530,246 610,218" stroke="${t.highlight}" stroke-width="1.5" fill="none" opacity="0.55"/>
    <!-- yoke seam -->
    <path d="M310,260 C400,290 600,290 690,260" stroke="${t.seam}" stroke-width="2" fill="none" opacity="0.7"/>
    <path d="M310,260 C400,290 600,290 690,260" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" fill="none" opacity="0.6"/>
    <!-- sleeve detail -->
    <path d="M230,460 C260,430 290,400 312,392" stroke="${t.seam}" stroke-width="2" fill="none"/>
    <path d="M770,460 C740,430 710,400 688,392" stroke="${t.seam}" stroke-width="2" fill="none"/>
    <path d="M300,425 L230,460 L260,478 L312,448 Z" fill="${t.deep}" opacity="0.40"/>
    <path d="M700,425 L770,460 L740,478 L688,448 Z" fill="${t.deep}" opacity="0.40"/>
    <path d="M306,838 L700,838" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
    <path d="M500,290 L500,840" stroke="${t.fold}" stroke-width="1.5" opacity="0.18"/>
  </svg>`;
}

// ── HOODIE ──────────────────────────────────────────────────────────
const HOODIE_BODY = `M300,250 L355,235
  C400,300 600,300 645,235 L700,250
  L870,330 L775,500 L700,455
  L705,865 L295,865 L300,455 L225,500 L130,330 Z`;
const HOODIE_BACK_BODY = `M300,250 L355,250
  C400,300 600,300 645,250 L700,250
  L870,330 L775,500 L700,455
  L705,865 L295,865 L300,455 L225,500 L130,330 Z`;

function hoodieFront(g: string): string {
  const t = tones(g);
  return open(g) + `
    <!-- hood back layer (slightly darker) -->
    <path d="M345,238 C380,108 620,108 655,238 C600,212 400,212 345,238 Z" fill="${t.deep}" opacity="0.95"/>
    <!-- hood front -->
    <path d="M345,238 C380,138 620,138 655,238 C610,300 390,300 345,238 Z" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="M345,238 C380,138 620,138 655,238 C610,300 390,300 345,238 Z" fill="url(#bodyLight)"/>
    <!-- body -->
    <path d="${HOODIE_BODY}" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="${HOODIE_BODY}" fill="url(#bodyLight)"/>
    <path d="${HOODIE_BODY}" fill="url(#centerHi)" opacity="0.8"/>
    <path d="${HOODIE_BODY}" fill="url(#hemShade)"/>
    <!-- kangaroo pocket -->
    <path d="M360,640 L640,640 L612,790 L388,790 Z" fill="${t.fold}" opacity="0.55"/>
    <path d="M360,640 L640,640 L612,790 L388,790 Z" fill="none" stroke="${t.seam}" stroke-width="3"/>
    <path d="M360,640 L640,640" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/>
    <!-- pocket opening shadows (hands enter here) -->
    <path d="M412,672 C420,680 420,720 412,728" stroke="${t.deep}" stroke-width="3" fill="none" opacity="0.55"/>
    <path d="M588,672 C580,680 580,720 588,728" stroke="${t.deep}" stroke-width="3" fill="none" opacity="0.55"/>
    <!-- drawstrings -->
    <rect x="455" y="270" width="10" height="160" rx="5" fill="${t.deep}"/>
    <rect x="535" y="270" width="10" height="160" rx="5" fill="${t.deep}"/>
    <circle cx="460" cy="438" r="10" fill="${t.deep}"/>
    <circle cx="540" cy="438" r="10" fill="${t.deep}"/>
    <!-- cuffs (ribbed) -->
    <rect x="225" y="498" width="92" height="22" rx="8" fill="${t.deep}" opacity="0.65" transform="rotate(24 270 509)"/>
    <rect x="683" y="498" width="92" height="22" rx="8" fill="${t.deep}" opacity="0.65" transform="rotate(-24 730 509)"/>
    <!-- hem rib -->
    <rect x="298" y="838" width="408" height="28" fill="${t.deep}" opacity="0.55"/>
    <path d="M305,855 L700,855" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
  </svg>`;
}
function hoodieBack(g: string): string {
  const t = tones(g);
  return open(g) + `
    <!-- hood seen from behind -->
    <path d="M335,255 C370,108 630,108 665,255 C610,302 390,302 335,255 Z" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="M335,255 C370,108 630,108 665,255 C610,302 390,302 335,255 Z" fill="url(#bodyLight)"/>
    <!-- hood centre fold -->
    <path d="M500,130 L500,295" stroke="${t.deep}" stroke-width="2" opacity="0.45"/>
    <!-- body -->
    <path d="${HOODIE_BACK_BODY}" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="${HOODIE_BACK_BODY}" fill="url(#bodyLight)"/>
    <path d="${HOODIE_BACK_BODY}" fill="url(#centerHi)" opacity="0.8"/>
    <path d="${HOODIE_BACK_BODY}" fill="url(#hemShade)"/>
    <!-- centre back seam -->
    <path d="M500,310 L500,840" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"/>
    <!-- cuffs + hem -->
    <rect x="225" y="498" width="92" height="22" rx="8" fill="${t.deep}" opacity="0.65" transform="rotate(24 270 509)"/>
    <rect x="683" y="498" width="92" height="22" rx="8" fill="${t.deep}" opacity="0.65" transform="rotate(-24 730 509)"/>
    <rect x="298" y="838" width="408" height="28" fill="${t.deep}" opacity="0.55"/>
  </svg>`;
}

// ── MUG ─────────────────────────────────────────────────────────────
function mugSvg(g: string): string {
  const t = tones(g);
  const rim = shade(g, isLight(g) ? -34 : 42);
  return open(g) + `
    <!-- handle -->
    <path d="M690,360 C840,360 840,640 690,640 L690,580 C752,580 752,420 690,420 Z" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="M690,360 C840,360 840,640 690,640 L690,580 C752,580 752,420 690,420 Z" fill="url(#bodyLight)"/>
    <!-- body -->
    <path d="M250,330 L690,330 L690,690 C690,720 660,742 470,742 C280,742 250,720 250,690 Z" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="M250,330 L690,330 L690,690 C690,720 660,742 470,742 C280,742 250,720 250,690 Z" fill="url(#bodyLight)"/>
    <path d="M250,330 L690,330 L690,690 C690,720 660,742 470,742 C280,742 250,720 250,690 Z" fill="url(#centerHi)" opacity="0.85"/>
    <!-- top rim ellipse -->
    <ellipse cx="470" cy="330" rx="220" ry="42" fill="${rim}"/>
    <ellipse cx="470" cy="324" rx="220" ry="42" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <ellipse cx="470" cy="324" rx="186" ry="32" fill="${t.fold}" opacity="0.55"/>
    <ellipse cx="470" cy="320" rx="160" ry="22" fill="${t.deep}" opacity="0.30"/>
    <!-- left specular highlight -->
    <path d="M278,348 C268,470 268,600 296,720" stroke="rgba(255,255,255,0.28)" stroke-width="16" fill="none" stroke-linecap="round"/>
    <path d="M286,360 C278,470 278,600 302,710" stroke="rgba(255,255,255,0.12)" stroke-width="6" fill="none" stroke-linecap="round"/>
    <!-- right shadow -->
    <path d="M652,348 C664,470 664,600 638,720" stroke="${t.deep}" stroke-width="20" fill="none" opacity="0.45" stroke-linecap="round"/>
    <!-- bottom contact shadow on body -->
    <path d="M270,720 C320,738 620,738 670,720" stroke="${t.deep}" stroke-width="6" fill="none" opacity="0.45"/>
  </svg>`;
}

// ── TOTE ────────────────────────────────────────────────────────────
function toteSvg(g: string): string {
  const t = tones(g);
  return open(g) + `
    <!-- handles (with shading) -->
    <path d="M380,300 C380,150 470,150 470,300" fill="none" stroke="${t.deep}" stroke-width="24" stroke-linecap="round"/>
    <path d="M380,290 C380,160 470,160 470,290" fill="none" stroke="${t.fold}" stroke-width="16" stroke-linecap="round"/>
    <path d="M530,300 C530,150 620,150 620,300" fill="none" stroke="${t.deep}" stroke-width="24" stroke-linecap="round"/>
    <path d="M530,290 C530,160 620,160 620,290" fill="none" stroke="${t.fold}" stroke-width="16" stroke-linecap="round"/>
    <!-- bag body -->
    <path d="M270,300 L730,300 L710,860 L290,860 Z" fill="${g}" stroke="${t.seam}" stroke-width="3"/>
    <path d="M270,300 L730,300 L710,860 L290,860 Z" fill="url(#bodyLight)"/>
    <path d="M270,300 L730,300 L710,860 L290,860 Z" fill="url(#centerHi)" opacity="0.7"/>
    <path d="M270,300 L730,300 L710,860 L290,860 Z" fill="url(#hemShade)"/>
    <!-- top hem -->
    <rect x="270" y="300" width="460" height="28" fill="${t.deep}" opacity="0.55"/>
    <path d="M278,322 L722,322" stroke="${t.stitch}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>
    <!-- handle attachment stitches -->
    <circle cx="425" cy="304" r="4" fill="${t.deep}"/>
    <circle cx="425" cy="318" r="4" fill="${t.deep}"/>
    <circle cx="575" cy="304" r="4" fill="${t.deep}"/>
    <circle cx="575" cy="318" r="4" fill="${t.deep}"/>
    <!-- canvas weave hint -->
    <path d="M330,360 L330,820 M430,350 L430,830 M530,350 L530,830 M630,360 L630,820"
      stroke="${t.seam}" stroke-width="1.2" opacity="0.35"/>
    <path d="M300,440 L700,440 M295,560 L705,560 M292,680 L708,680"
      stroke="${t.seam}" stroke-width="1.2" opacity="0.35"/>
    <!-- bottom contact shadow band -->
    <rect x="290" y="848" width="420" height="14" fill="${t.deep}" opacity="0.35"/>
  </svg>`;
}

export const MOCKUPS: Record<MockupKind, Mockup> = {
  tshirt: {
    kind: 'tshirt', vb: 1000, twoSided: true,
    printArea: { x: 350, y: 300, w: 300, h: 360 },
    colors: GARMENT_COLORS, front: tshirtFront, back: tshirtBack,
  },
  hoodie: {
    kind: 'hoodie', vb: 1000, twoSided: true,
    printArea: { x: 365, y: 330, w: 270, h: 290 },
    colors: GARMENT_COLORS, front: hoodieFront, back: hoodieBack,
  },
  mug: {
    kind: 'mug', vb: 1000, twoSided: false,
    printArea: { x: 300, y: 380, w: 300, h: 300 },
    colors: MUG_COLORS, front: mugSvg, back: mugSvg,
  },
  tote: {
    kind: 'tote', vb: 1000, twoSided: false,
    printArea: { x: 340, y: 400, w: 320, h: 360 },
    colors: GARMENT_COLORS, front: toteSvg, back: toteSvg,
  },
};

export function getMockup(kind: MockupKind): Mockup { return MOCKUPS[kind]; }

/* ───────────────────────────────────────────────────────────────────
 * ADDING REAL PHOTOGRAPHIC MOCKUPS
 * -------------------------------------------------------------------
 * 1. Drop product photos in apps/site/public/images/mockups/, one per
 *    colour and side, e.g. tshirt-noir-front.jpg / tshirt-noir-back.jpg.
 * 2. Add a `raster` block to the mockup, with the print-area rectangle
 *    measured in the PHOTO's pixel coordinates (origin top-left), e.g.:
 *
 *      MOCKUPS.tshirt.raster = {
 *        images: {
 *          Noir:  { recto: '/images/mockups/tshirt-noir-front.jpg',
 *                   verso: '/images/mockups/tshirt-noir-back.jpg' },
 *          Blanc: { recto: '/images/mockups/tshirt-blanc-front.jpg' },
 *        },
 *        printAreaRecto: { x: 360, y: 300, w: 300, h: 360 },
 *      };
 *
 * 3. The designer automatically renders the photo (for the selected
 *    colour) instead of the vector mockup, and overlays the design on
 *    the photo's print area. No other code changes needed.
 * ─────────────────────────────────────────────────────────────────── */
