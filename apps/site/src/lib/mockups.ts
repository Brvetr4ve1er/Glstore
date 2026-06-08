/**
 * Product mockup templates.
 *
 * Each mockup is a recolourable flat-vector garment rendered as an SVG
 * string, plus a "print area" rectangle (in viewBox units) that marks
 * where a customer design can be placed — exactly like the print-area
 * box in Printify / Redbubble.
 *
 * The SVG is a pure function of the garment colour so the same code
 * path drives both the interactive preview and the exported PNG.
 */

export type MockupKind = 'tshirt' | 'hoodie' | 'mug' | 'tote';

export interface GarmentColor {
  name: string;
  hex: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mockup {
  kind: MockupKind;
  vb: number; // square viewBox side (all mockups are vb × vb)
  printArea: Rect;
  colors: GarmentColor[];
  svg: (garmentHex: string) => string;
}

/* Maps an owner-editable base id (content/bases/*.json) → a mockup. */
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

/* A garment looks better with a hint of shading. We derive a slightly
 * darker tone for folds from the chosen colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amount)));
  g = Math.max(0, Math.min(255, Math.round(g + amount)));
  b = Math.max(0, Math.min(255, Math.round(b + amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* Is the garment light? Used to flip seam/stroke contrast. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// ── T-SHIRT ────────────────────────────────────────────────────────
function tshirtSvg(g: string): string {
  const fold = shade(g, isLight(g) ? -18 : 22);
  const seam = isLight(g) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
    <path d="M300,215 L360,205 C420,250 580,250 640,205 L700,215 L860,300 L770,455 L700,420 L705,860 L295,860 L300,420 L230,455 L140,300 L300,215 Z"
      fill="${g}" stroke="${seam}" stroke-width="3"/>
    <path d="M360,205 C420,250 580,250 640,205 C600,250 400,250 360,205 Z" fill="${fold}" opacity="0.6"/>
    <path d="M300,420 L230,455 L255,470 L312,445 Z" fill="${fold}" opacity="0.5"/>
    <path d="M700,420 L770,455 L745,470 L688,445 Z" fill="${fold}" opacity="0.5"/>
    <path d="M310,840 L705,840 L705,860 L295,860 Z" fill="${fold}" opacity="0.35"/>
    <path d="M430,250 C440,420 440,650 430,840" stroke="${seam}" stroke-width="2" fill="none" opacity="0.5"/>
    <path d="M575,250 C565,420 565,650 575,840" stroke="${seam}" stroke-width="2" fill="none" opacity="0.5"/>
  </svg>`;
}

// ── HOODIE ─────────────────────────────────────────────────────────
function hoodieSvg(g: string): string {
  const fold = shade(g, isLight(g) ? -22 : 26);
  const seam = isLight(g) ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
    <!-- hood behind -->
    <path d="M345,235 C380,120 620,120 655,235 C600,210 400,210 345,235 Z" fill="${fold}" opacity="0.9"/>
    <path d="M345,235 C380,140 620,140 655,235 C610,300 390,300 345,235 Z" fill="${g}" stroke="${seam}" stroke-width="3"/>
    <!-- body -->
    <path d="M300,250 L355,235 C400,300 600,300 645,235 L700,250 L870,330 L775,500 L700,455 L705,865 L295,865 L300,455 L225,500 L130,330 L300,250 Z"
      fill="${g}" stroke="${seam}" stroke-width="3"/>
    <!-- kangaroo pocket -->
    <path d="M360,640 L640,640 L610,790 L390,790 Z" fill="${fold}" opacity="0.55"/>
    <path d="M360,640 L640,640 L610,790 L390,790 Z" fill="none" stroke="${seam}" stroke-width="3"/>
    <!-- drawstrings -->
    <rect x="455" y="270" width="10" height="150" rx="5" fill="${fold}"/>
    <rect x="535" y="270" width="10" height="150" rx="5" fill="${fold}"/>
    <circle cx="460" cy="425" r="9" fill="${fold}"/>
    <circle cx="540" cy="425" r="9" fill="${fold}"/>
    <!-- sleeve folds -->
    <path d="M300,455 L225,500 L250,515 L312,485 Z" fill="${fold}" opacity="0.5"/>
    <path d="M700,455 L775,500 L750,515 L688,485 Z" fill="${fold}" opacity="0.5"/>
    <!-- cuffs + hem ribbing -->
    <rect x="225" y="498" width="90" height="22" rx="6" fill="${fold}" opacity="0.6" transform="rotate(25 270 509)"/>
    <rect x="685" y="498" width="90" height="22" rx="6" fill="${fold}" opacity="0.6" transform="rotate(-25 730 509)"/>
    <rect x="300" y="838" width="405" height="27" fill="${fold}" opacity="0.45"/>
  </svg>`;
}

// ── MUG ────────────────────────────────────────────────────────────
function mugSvg(g: string): string {
  const fold = shade(g, isLight(g) ? -16 : 24);
  const seam = isLight(g) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
  const rim = shade(g, isLight(g) ? -28 : 36);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
    <!-- handle -->
    <path d="M690,360 C820,360 820,640 690,640 L690,580 C740,580 740,420 690,420 Z"
      fill="${g}" stroke="${seam}" stroke-width="3"/>
    <!-- body -->
    <path d="M250,330 L690,330 L690,690 C690,720 660,740 470,740 C280,740 250,720 250,690 Z"
      fill="${g}" stroke="${seam}" stroke-width="3"/>
    <!-- top rim ellipse -->
    <ellipse cx="470" cy="330" rx="220" ry="42" fill="${rim}"/>
    <ellipse cx="470" cy="324" rx="220" ry="42" fill="${g}" stroke="${seam}" stroke-width="3"/>
    <ellipse cx="470" cy="324" rx="186" ry="32" fill="${fold}" opacity="0.55"/>
    <!-- side sheen -->
    <path d="M285,345 C275,470 275,600 300,720" stroke="rgba(255,255,255,0.18)" stroke-width="14" fill="none" stroke-linecap="round"/>
    <path d="M650,345 C662,470 662,600 640,720" stroke="${fold}" stroke-width="18" fill="none" opacity="0.5" stroke-linecap="round"/>
  </svg>`;
}

// ── TOTE ───────────────────────────────────────────────────────────
function toteSvg(g: string): string {
  const fold = shade(g, isLight(g) ? -16 : 22);
  const seam = isLight(g) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
    <!-- handles -->
    <path d="M380,300 C380,150 470,150 470,300" fill="none" stroke="${fold}" stroke-width="22" stroke-linecap="round"/>
    <path d="M530,300 C530,150 620,150 620,300" fill="none" stroke="${fold}" stroke-width="22" stroke-linecap="round"/>
    <!-- bag body -->
    <path d="M270,300 L730,300 L710,840 L290,840 Z" fill="${g}" stroke="${seam}" stroke-width="3"/>
    <!-- top seam -->
    <rect x="270" y="300" width="460" height="26" fill="${fold}" opacity="0.5"/>
    <!-- canvas weave hint -->
    <path d="M330,360 L330,820 M430,350 L430,830 M530,350 L530,830 M630,360 L630,820"
      stroke="${seam}" stroke-width="1.5" opacity="0.4"/>
    <path d="M300,440 L700,440 M295,560 L705,560 M292,680 L708,680"
      stroke="${seam}" stroke-width="1.5" opacity="0.4"/>
  </svg>`;
}

export const MOCKUPS: Record<MockupKind, Mockup> = {
  tshirt: {
    kind: 'tshirt', vb: 1000,
    printArea: { x: 350, y: 300, w: 300, h: 360 },
    colors: GARMENT_COLORS,
    svg: tshirtSvg,
  },
  hoodie: {
    kind: 'hoodie', vb: 1000,
    printArea: { x: 365, y: 330, w: 270, h: 290 },
    colors: GARMENT_COLORS,
    svg: hoodieSvg,
  },
  mug: {
    kind: 'mug', vb: 1000,
    printArea: { x: 300, y: 380, w: 300, h: 300 },
    colors: MUG_COLORS,
    svg: mugSvg,
  },
  tote: {
    kind: 'tote', vb: 1000,
    printArea: { x: 340, y: 400, w: 320, h: 360 },
    colors: GARMENT_COLORS,
    svg: toteSvg,
  },
};

export function getMockup(kind: MockupKind): Mockup {
  return MOCKUPS[kind];
}
