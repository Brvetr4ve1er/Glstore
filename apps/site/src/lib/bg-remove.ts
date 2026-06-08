/**
 * Background removal — two strategies, both client-side, no backend.
 *
 *  1. removeBackgroundChroma()  — instant edge flood-fill chroma key.
 *     Pure canvas, zero network, works offline. Ideal for the common
 *     SHINOBI case: anime art on a solid/near-solid background. This
 *     is the default and is fully exercised by the test suite.
 *
 *  2. removeBackgroundAI()      — lazy-loads @imgly/background-removal
 *     from a CDN and runs an ONNX model (WebGPU/WASM) for complex,
 *     photographic backgrounds. Needs network for the first model
 *     download; throws a friendly error if unavailable.
 *
 * Both return an HTMLCanvasElement with a transparent background.
 */

const MAX_DIM = 1500; // cap working resolution for performance

export interface ChromaOptions {
  /** 0–100. Higher = removes a wider range of colours around the bg. */
  tolerance?: number;
  /** Optional explicit background colour [r,g,b]; else sampled from corners. */
  seed?: [number, number, number] | null;
}

/** Load a File/Blob/URL into a canvas, downscaled to MAX_DIM. */
export async function imageToCanvas(src: Blob | string): Promise<HTMLCanvasElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    let { width: w, height: h } = img;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

function colorDist(r: number, g: number, b: number, R: number, G: number, B: number): number {
  // Perceptual-ish weighting; range ~0..441
  const dr = r - R, dg = g - G, db = b - B;
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.7;
}

/**
 * Edge flood-fill chroma key. Only removes background pixels that are
 * connected to the image border, so a white highlight *inside* the
 * subject is preserved.
 */
export function removeBackgroundChroma(
  canvas: HTMLCanvasElement,
  opts: ChromaOptions = {},
): HTMLCanvasElement {
  const tolerance = opts.tolerance ?? 30;
  const tol = 12 + (tolerance / 100) * 150; // map 0–100 → distance threshold
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Background colour: explicit seed or average of the four corners.
  let R: number, G: number, B: number;
  if (opts.seed) {
    [R, G, B] = opts.seed;
  } else {
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
    R = G = B = 0;
    for (const c of corners) { R += d[c]; G += d[c + 1]; B += d[c + 2]; }
    R = Math.round(R / 4); G = Math.round(G / 4); B = Math.round(B / 4);
  }

  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  // Seed from every border pixel.
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + (w - 1)); }

  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (colorDist(d[i], d[i + 1], d[i + 2], R, G, B) > tol) continue; // foreground edge → stop
    d[i + 3] = 0; // transparent
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // Light edge feather: soften the boundary so it isn't jagged.
  feather(d, w, h, R, G, B, tol);

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** One-pass alpha feather on the cut boundary. */
function feather(d: Uint8ClampedArray, w: number, h: number, R: number, G: number, B: number, tol: number) {
  const out = new Uint8ClampedArray(d.length);
  out.set(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (d[p + 3] === 0) continue; // already transparent
      // count transparent 4-neighbours
      let t = 0;
      if (d[p - 4 + 3] === 0) t++;
      if (d[p + 4 + 3] === 0) t++;
      if (d[p - w * 4 + 3] === 0) t++;
      if (d[p + w * 4 + 3] === 0) t++;
      if (!t) continue;
      const dist = colorDist(d[p], d[p + 1], d[p + 2], R, G, B);
      if (dist < tol * 1.4) {
        // borderline & near the bg colour → partial alpha
        const a = Math.max(0, Math.min(1, (dist - tol) / (tol * 0.4)));
        out[p + 3] = Math.round(255 * a);
      }
    }
  }
  d.set(out);
}

/** Sample a pixel colour at normalized (nx,ny) — used by the eyedropper. */
export function sampleColor(canvas: HTMLCanvasElement, nx: number, ny: number): [number, number, number] {
  const ctx = canvas.getContext('2d')!;
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(nx * canvas.width)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(ny * canvas.height)));
  const p = ctx.getImageData(x, y, 1, 1).data;
  return [p[0], p[1], p[2]];
}

/**
 * AI background removal via @imgly/background-removal, lazy-loaded
 * from a CDN. Returns a transparent canvas, or throws with a friendly
 * message (e.g. when offline and the model can't be fetched).
 */
export async function removeBackgroundAI(src: Blob): Promise<HTMLCanvasElement> {
  let removeBackground: (b: Blob, cfg?: unknown) => Promise<Blob>;
  try {
    // esm.sh serves the package as an ES module with its deps bundled.
    const mod = await import(/* @vite-ignore */ 'https://esm.sh/@imgly/background-removal@1.5.8');
    removeBackground = (mod as any).removeBackground ?? (mod as any).default;
    if (typeof removeBackground !== 'function') throw new Error('module shape');
  } catch {
    throw new Error("Le module de découpe IA n'a pas pu être chargé (connexion ?). Utilise la découpe automatique.");
  }
  const outBlob = await removeBackground(src, { output: { format: 'image/png' } });
  return imageToCanvas(outBlob);
}
