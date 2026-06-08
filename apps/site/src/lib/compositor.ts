/**
 * Compositor — places a design onto a print area and renders both the
 * customer preview (mockup + design) and the print-ready file (design
 * only, transparent, clipped to the print area). All maths are in
 * mockup viewBox units so the same transform drives the on-screen
 * preview and any export resolution.
 *
 * Source-agnostic: the mockup image passed in may be a rasterised SVG
 * garment or a real product photo — the compositor doesn't care.
 */
import type { Rect } from './mockups';

export interface Placement {
  nx: number;   // design centre as a fraction of the print area
  ny: number;
  scale: number; // design width as a fraction of the print-area width
  rot: number;   // rotation in degrees
}

export const DEFAULT_PLACEMENT: Placement = { nx: 0.5, ny: 0.5, scale: 0.85, rot: 0 };

/** A persistent (non-revoking) data URL for an SVG. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterise SVG markup into an <img>. */
export function svgToImage(svg: string, px: number): Promise<HTMLImageElement> {
  return loadImage(svgDataUrl(svg), px);
}

/** Load any URL into an <img>. */
export function loadImage(url: string, px?: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    if (px) { img.width = px; img.height = px; }
    img.src = url;
  });
}

/** Design box in viewBox units for a placement. */
export function designBox(printArea: Rect, design: { width: number; height: number }, pl: Placement) {
  const w = pl.scale * printArea.w;
  const h = w * (design.height / design.width);
  return { cx: printArea.x + pl.nx * printArea.w, cy: printArea.y + pl.ny * printArea.h, w, h };
}

/** Full preview: mockup image + placed design (clipped to print area). */
export async function renderPreview(
  mockupImg: CanvasImageSource,
  vb: number,
  printArea: Rect,
  design: HTMLCanvasElement | null,
  pl: Placement,
  out = 1000,
): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = out; c.height = out;
  const ctx = c.getContext('2d')!;
  const s = out / vb;
  ctx.drawImage(mockupImg, 0, 0, out, out);
  if (design) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(printArea.x * s, printArea.y * s, printArea.w * s, printArea.h * s);
    ctx.clip();
    drawDesign(ctx, design, printArea, pl, s);
    ctx.restore();
  }
  return c;
}

/** The print-ready file: design only, transparent, print-area-cropped. */
export async function renderPrintFile(
  printArea: Rect,
  design: HTMLCanvasElement,
  pl: Placement,
  longEdge = 2000,
): Promise<HTMLCanvasElement> {
  const aspect = printArea.h / printArea.w;
  const w = aspect <= 1 ? longEdge : Math.round(longEdge / aspect);
  const h = aspect <= 1 ? Math.round(longEdge * aspect) : longEdge;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const sx = w / printArea.w, sy = h / printArea.h;
  const box = designBox(printArea, design, pl);
  ctx.save();
  ctx.translate((box.cx - printArea.x) * sx, (box.cy - printArea.y) * sy);
  ctx.rotate((pl.rot * Math.PI) / 180);
  ctx.drawImage(design, (-box.w * sx) / 2, (-box.h * sy) / 2, box.w * sx, box.h * sy);
  ctx.restore();
  return c;
}

function drawDesign(ctx: CanvasRenderingContext2D, design: HTMLCanvasElement, printArea: Rect, pl: Placement, s: number) {
  const box = designBox(printArea, design, pl);
  ctx.save();
  ctx.translate(box.cx * s, box.cy * s);
  ctx.rotate((pl.rot * Math.PI) / 180);
  ctx.drawImage(design, (-box.w * s) / 2, (-box.h * s) / 2, box.w * s, box.h * s);
  ctx.restore();
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export échoué'))), type, 0.92);
  });
}

export function clampPlacement(pl: Placement): Placement {
  return {
    nx: Math.max(-0.15, Math.min(1.15, pl.nx)),
    ny: Math.max(-0.15, Math.min(1.15, pl.ny)),
    scale: Math.max(0.15, Math.min(1.6, pl.scale)),
    rot: pl.rot,
  };
}

export type { Rect };
