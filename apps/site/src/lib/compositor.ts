/**
 * Compositor — places a design canvas onto a mockup's print area and
 * renders both the customer-facing preview (garment + design) and the
 * print-ready file (design only, transparent, clipped to the print
 * area). All maths are in mockup viewBox units so the same transform
 * drives the on-screen preview and any export resolution.
 */
import type { Mockup, Rect } from './mockups';

/** Design placement, normalized to the print area. */
export interface Placement {
  /** design centre as a fraction of the print area (0.5,0.5 = centred) */
  nx: number;
  ny: number;
  /** design width as a fraction of the print-area width */
  scale: number;
  /** rotation in degrees */
  rot: number;
}

export const DEFAULT_PLACEMENT: Placement = { nx: 0.5, ny: 0.5, scale: 0.85, rot: 0 };

/** A persistent (non-revoking) data URL for an SVG — safe to assign to
 *  a long-lived <img src>. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterise an SVG markup string into an <img> at a target pixel size. */
export function svgToImage(svg: string, px: number): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG illisible')); };
    img.width = px; img.height = px;
    img.src = url;
  });
}

/** Compute the design's box in viewBox units for a given placement. */
export function designBox(mockup: Mockup, design: { width: number; height: number }, pl: Placement) {
  const pa = mockup.printArea;
  const w = pl.scale * pa.w;
  const aspect = design.height / design.width;
  const h = w * aspect;
  const cx = pa.x + pl.nx * pa.w;
  const cy = pa.y + pl.ny * pa.h;
  return { cx, cy, w, h };
}

/**
 * Render the full mockup preview (garment + placed design) to a canvas.
 * `out` is the output side length in px.
 */
export async function renderPreview(
  mockup: Mockup,
  garmentHex: string,
  design: HTMLCanvasElement | null,
  pl: Placement,
  out = 1000,
): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = out; c.height = out;
  const ctx = c.getContext('2d')!;
  const s = out / mockup.vb; // viewBox → px

  // garment
  const garmentImg = await svgToImage(mockup.svg(garmentHex), out);
  ctx.drawImage(garmentImg, 0, 0, out, out);

  // design, clipped to the print area so it reads as printed-on-fabric
  if (design) {
    const pa = mockup.printArea;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pa.x * s, pa.y * s, pa.w * s, pa.h * s);
    ctx.clip();
    drawDesign(ctx, design, mockup, pl, s);
    ctx.restore();
  }
  return c;
}

/**
 * Render ONLY the design as it sits within the print area — the file
 * the shop actually prints. Transparent everywhere else. Output canvas
 * matches the print-area aspect ratio.
 */
export async function renderPrintFile(
  mockup: Mockup,
  design: HTMLCanvasElement,
  pl: Placement,
  longEdge = 2000,
): Promise<HTMLCanvasElement> {
  const pa = mockup.printArea;
  const aspect = pa.h / pa.w;
  const w = aspect <= 1 ? longEdge : Math.round(longEdge / aspect);
  const h = aspect <= 1 ? Math.round(longEdge * aspect) : longEdge;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const sx = w / pa.w, sy = h / pa.h;

  // translate so the print area's origin is (0,0)
  const box = designBox(mockup, { width: design.width, height: design.height }, pl);
  ctx.save();
  ctx.translate((box.cx - pa.x) * sx, (box.cy - pa.y) * sy);
  ctx.rotate((pl.rot * Math.PI) / 180);
  const dw = box.w * sx, dh = box.h * sy;
  ctx.drawImage(design, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return c;
}

function drawDesign(
  ctx: CanvasRenderingContext2D,
  design: HTMLCanvasElement,
  mockup: Mockup,
  pl: Placement,
  s: number,
) {
  const box = designBox(mockup, { width: design.width, height: design.height }, pl);
  ctx.save();
  ctx.translate(box.cx * s, box.cy * s);
  ctx.rotate((pl.rot * Math.PI) / 180);
  const dw = box.w * s, dh = box.h * s;
  ctx.drawImage(design, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export échoué'))), type, 0.92);
  });
}

/** Clamp a placement so the design stays mostly within the print area. */
export function clampPlacement(pl: Placement): Placement {
  return {
    nx: Math.max(-0.15, Math.min(1.15, pl.nx)),
    ny: Math.max(-0.15, Math.min(1.15, pl.ny)),
    scale: Math.max(0.15, Math.min(1.6, pl.scale)),
    rot: pl.rot,
  };
}

export type { Rect };
