/**
 * SHINOBI custom designer — client controller.
 *
 * Wires the DOM (rendered by custom.astro) to the mockup / bg-removal /
 * compositor / order modules. The interactive preview is DOM+CSS (an
 * <img> mockup + an absolutely-positioned design element) for buttery
 * drag/scale/rotate; export uses the canvas compositor so what you see
 * is what the shop prints.
 */
import { MOCKUPS, BASE_TO_MOCKUP, getMockup, type MockupKind, type Mockup } from '../lib/mockups';
import {
  imageToCanvas, removeBackgroundChroma, removeBackgroundAI, sampleColor,
} from '../lib/bg-remove';
import {
  DEFAULT_PLACEMENT, designBox, renderPreview, renderPrintFile, canvasToBlob,
  clampPlacement, svgDataUrl, type Placement,
} from '../lib/compositor';
import { sendOrder, type OrderDetails } from '../lib/order';

interface Base { id: string; name: string; price: number; doubleSideAllowed: boolean; extraDoubleSide: number; icon: string; order: number; }
interface Design { id: string; name: string; anime: string; image: string; isEmoji: boolean; }
interface Catalog { bases: Base[]; designs: Design[]; contact: { whatsappNumber: string; instagram: string }; brand: { name: string }; }

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const fmtDA = (n: number) => n.toLocaleString('fr-FR').replace(/,/g, ' ') + ' DA';
const NO_SIZE: MockupKind[] = ['mug', 'tote'];

export function initBuilder() {
  const cat: Catalog = JSON.parse($('#catalog').textContent || '{}');

  const state = {
    base: cat.bases[0],
    mockupKind: BASE_TO_MOCKUP[cat.bases[0].id] as MockupKind,
    garmentHex: '#161616',
    garmentName: 'Noir',
    designCanvas: null as HTMLCanvasElement | null, // current design (transparent)
    sourceCanvas: null as HTMLCanvasElement | null, // pre-removal upload (for re-runs)
    designLabel: '' as string,
    fromUpload: false,
    placement: { ...DEFAULT_PLACEMENT } as Placement,
    side: 'single' as 'single' | 'double',
    size: 'M' as string,
    tolerance: 30,
    eyedropper: false,
  };

  // ── DOM refs ──────────────────────────────────────────────
  const stage = $('#stage');
  const mockupImg = $<HTMLImageElement>('#mockup-img');
  const printBox = $('#print-box');
  const designEl = $<HTMLImageElement>('#design-el');
  const hint = $('#stage-hint');

  // ── Mockup + colour ───────────────────────────────────────
  function mockup(): Mockup { return getMockup(state.mockupKind); }

  function drawMockup() {
    const m = mockup();
    mockupImg.src = svgDataUrl(m.svg(state.garmentHex));
    layoutPrintBox();
  }

  function layoutPrintBox() {
    const m = mockup();
    const D = stage.clientWidth; // square stage
    const ds = D / m.vb;
    const pa = m.printArea;
    printBox.style.left = `${pa.x * ds}px`;
    printBox.style.top = `${pa.y * ds}px`;
    printBox.style.width = `${pa.w * ds}px`;
    printBox.style.height = `${pa.h * ds}px`;
    layoutDesign();
  }

  function layoutDesign() {
    if (!state.designCanvas) { designEl.style.display = 'none'; return; }
    const m = mockup();
    const D = stage.clientWidth;
    const ds = D / m.vb;
    const box = designBox(m, state.designCanvas, state.placement);
    designEl.style.display = 'block';
    designEl.style.width = `${box.w * ds}px`;
    designEl.style.height = `${box.h * ds}px`;
    designEl.style.left = `${box.cx * ds}px`;
    designEl.style.top = `${box.cy * ds}px`;
    designEl.style.transform = `translate(-50%, -50%) rotate(${state.placement.rot}deg)`;
  }

  // ── Colour swatches ───────────────────────────────────────
  function renderColors() {
    const wrap = $('#colors');
    wrap.innerHTML = '';
    for (const c of mockup().colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c.hex === state.garmentHex ? ' on' : '');
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.onclick = () => { state.garmentHex = c.hex; state.garmentName = c.name; renderColors(); drawMockup(); };
      wrap.appendChild(b);
    }
  }

  // ── Base / product ────────────────────────────────────────
  function selectBase(id: string) {
    const base = cat.bases.find(b => b.id === id);
    if (!base) return;
    state.base = base;
    state.mockupKind = BASE_TO_MOCKUP[id];
    // make sure the chosen garment colour exists for this mockup
    const colors = mockup().colors;
    if (!colors.find(c => c.hex === state.garmentHex)) {
      state.garmentHex = colors[0].hex; state.garmentName = colors[0].name;
    }
    $$('.opt-base').forEach(el => el.classList.toggle('on', el.getAttribute('data-base') === id));
    renderColors();
    drawMockup();
    updateConditionalSteps();
    updatePrice();
  }

  function updateConditionalSteps() {
    const sideStep = $('#step-side');
    const sizeStep = $('#step-size');
    sideStep.style.display = state.base.doubleSideAllowed ? '' : 'none';
    sizeStep.style.display = NO_SIZE.includes(state.mockupKind) ? 'none' : '';
  }

  // ── Designs: gallery + emoji ──────────────────────────────
  function emojiToCanvas(emoji: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.font = '380px "Noto Color Emoji","Apple Color Emoji",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 256, 286);
    return c;
  }

  async function setDesignFromGallery(d: Design) {
    let canvas: HTMLCanvasElement;
    if (d.isEmoji) {
      canvas = emojiToCanvas(d.image);
    } else {
      canvas = await imageToCanvas(d.image);
    }
    state.designCanvas = canvas;
    state.sourceCanvas = canvas;
    state.fromUpload = false;
    state.designLabel = `${d.name} (${d.anime})`;
    state.placement = { ...DEFAULT_PLACEMENT };
    commitDesign();
  }

  async function setDesignFromUpload(file: File) {
    showProcessing(true, 'Lecture de l\'image…');
    try {
      const src = await imageToCanvas(file);
      state.sourceCanvas = src;
      state.fromUpload = true;
      state.designLabel = 'Mon design';
      // auto chroma removal on a copy
      showProcessing(true, 'Découpe du fond…');
      state.designCanvas = runChroma();
      state.placement = { ...DEFAULT_PLACEMENT };
      commitDesign();
      $('#upload-tools').style.display = 'block';
    } catch (e) {
      alert((e as Error).message || 'Image illisible');
    } finally {
      showProcessing(false);
    }
  }

  function runChroma(seed: [number, number, number] | null = null): HTMLCanvasElement {
    const copy = document.createElement('canvas');
    copy.width = state.sourceCanvas!.width;
    copy.height = state.sourceCanvas!.height;
    copy.getContext('2d')!.drawImage(state.sourceCanvas!, 0, 0);
    return removeBackgroundChroma(copy, { tolerance: state.tolerance, seed });
  }

  function commitDesign() {
    if (!state.designCanvas) return;
    designEl.src = state.designCanvas.toDataURL('image/png');
    designEl.style.display = 'block';
    hint.style.display = 'none';
    layoutDesign();
    updateOrderEnabled();
    updatePrice();
  }

  // ── Background-removal tools (upload only) ─────────────────
  function wireUploadTools() {
    const tol = $<HTMLInputElement>('#tolerance');
    tol.oninput = () => {
      state.tolerance = Number(tol.value);
      if (state.sourceCanvas && state.fromUpload) { state.designCanvas = runChroma(); commitDesign(); }
    };
    $('#btn-keep').onclick = () => {
      // keep original (no removal)
      const copy = document.createElement('canvas');
      copy.width = state.sourceCanvas!.width; copy.height = state.sourceCanvas!.height;
      copy.getContext('2d')!.drawImage(state.sourceCanvas!, 0, 0);
      state.designCanvas = copy; commitDesign();
    };
    $('#btn-eyedrop').onclick = () => {
      state.eyedropper = !state.eyedropper;
      $('#btn-eyedrop').classList.toggle('on', state.eyedropper);
      stage.style.cursor = state.eyedropper ? 'crosshair' : '';
    };
    $('#btn-ai').onclick = async () => {
      if (!state.sourceCanvas) return;
      showProcessing(true, 'Découpe IA (téléchargement du modèle)…');
      try {
        const blob = await canvasToBlob(state.sourceCanvas);
        state.designCanvas = await removeBackgroundAI(blob);
        commitDesign();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        showProcessing(false);
      }
    };
  }

  // eyedropper click on the stage → sample source colour, re-run chroma
  function onStageEyedrop(e: PointerEvent) {
    if (!state.eyedropper || !state.sourceCanvas) return;
    e.preventDefault(); e.stopPropagation();
    const r = designEl.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const seed = sampleColor(state.sourceCanvas, nx, ny);
    state.designCanvas = runChroma(seed);
    commitDesign();
    state.eyedropper = false;
    $('#btn-eyedrop').classList.remove('on');
    stage.style.cursor = '';
  }

  // ── Drag / scale / rotate ─────────────────────────────────
  function wireInteraction() {
    let dragging = false, sx = 0, sy = 0, snx = 0, sny = 0;
    designEl.addEventListener('pointerdown', (e) => {
      if (state.eyedropper) return;
      dragging = true;
      designEl.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY;
      snx = state.placement.nx; sny = state.placement.ny;
    });
    designEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const m = mockup();
      const D = stage.clientWidth;
      const ds = D / m.vb;
      const dxVB = (e.clientX - sx) / ds;
      const dyVB = (e.clientY - sy) / ds;
      state.placement.nx = snx + dxVB / m.printArea.w;
      state.placement.ny = sny + dyVB / m.printArea.h;
      state.placement = clampPlacement(state.placement);
      layoutDesign();
    });
    const end = (e: PointerEvent) => { dragging = false; try { designEl.releasePointerCapture(e.pointerId); } catch {} };
    designEl.addEventListener('pointerup', end);
    designEl.addEventListener('pointercancel', end);
    stage.addEventListener('pointerdown', onStageEyedrop);

    const scale = $<HTMLInputElement>('#scale');
    scale.oninput = () => { state.placement.scale = Number(scale.value) / 100; layoutDesign(); };
    const rot = $<HTMLInputElement>('#rot');
    rot.oninput = () => { state.placement.rot = Number(rot.value); layoutDesign(); };

    $('#btn-center').onclick = () => {
      state.placement.nx = 0.5; state.placement.ny = 0.5;
      layoutDesign();
    };
    $('#btn-fit').onclick = () => {
      state.placement.scale = 0.95; state.placement.rot = 0;
      state.placement.nx = 0.5; state.placement.ny = 0.5;
      scale.value = '95'; rot.value = '0';
      layoutDesign();
    };
  }

  // ── Side / size ───────────────────────────────────────────
  function wireOptions() {
    $('#step-side').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-side]');
      if (!b) return;
      $$('[data-side]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.side = b.getAttribute('data-side') as 'single' | 'double';
      updatePrice();
    });
    $('#step-size').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]');
      if (!b) return;
      $$('[data-size]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.size = b.getAttribute('data-size')!;
    });
  }

  // ── Pricing ───────────────────────────────────────────────
  function price(): number {
    let t = state.base.price;
    if (state.side === 'double' && state.base.doubleSideAllowed) t += state.base.extraDoubleSide;
    return t;
  }
  function updatePrice() {
    $('#total').textContent = fmtDA(price());
    const parts = [
      state.base.name,
      state.designLabel || 'aucun design',
      state.base.doubleSideAllowed ? (state.side === 'double' ? 'recto + verso' : 'recto') : null,
      NO_SIZE.includes(state.mockupKind) ? null : state.size,
      state.garmentName,
    ].filter(Boolean);
    $('#brk').textContent = parts.join(' · ');
  }

  function updateOrderEnabled() {
    const ok = !!state.designCanvas;
    ($('#btn-order') as HTMLButtonElement).disabled = !ok;
    ($('#btn-download') as HTMLButtonElement).disabled = !ok;
  }

  // ── Processing overlay ────────────────────────────────────
  function showProcessing(on: boolean, label = '') {
    const ov = $('#processing');
    ov.style.display = on ? 'flex' : 'none';
    if (label) $('#processing-label').textContent = label;
  }

  // ── Order / share ─────────────────────────────────────────
  function placementNote(): string {
    const p = state.placement;
    const centered = Math.abs(p.nx - 0.5) < 0.06 && Math.abs(p.ny - 0.5) < 0.06;
    return `${Math.round(p.scale * 100)}% de la zone · ${centered ? 'centré' : 'placé main'}${p.rot ? ` · ${Math.round(p.rot)}°` : ''}`;
  }

  async function buildOrder(): Promise<{ details: OrderDetails; preview: Blob; printFile: Blob } | null> {
    if (!state.designCanvas) return null;
    const m = mockup();
    const previewCanvas = await renderPreview(m, state.garmentHex, state.designCanvas, state.placement, 1200);
    const printCanvas = await renderPrintFile(m, state.designCanvas, state.placement, 2200);
    const details: OrderDetails = {
      brand: cat.brand.name,
      whatsappNumber: cat.contact.whatsappNumber,
      product: state.base.name,
      basePrice: state.base.price,
      design: state.designLabel,
      colour: state.garmentName,
      size: NO_SIZE.includes(state.mockupKind) ? null : state.size,
      doubleSide: state.side === 'double' && state.base.doubleSideAllowed,
      total: price(),
      placementNote: placementNote(),
    };
    return {
      details,
      preview: await canvasToBlob(previewCanvas),
      printFile: await canvasToBlob(printCanvas),
    };
  }

  function wireOrder() {
    $('#btn-order').addEventListener('click', async () => {
      showProcessing(true, 'Préparation de la commande…');
      try {
        const o = await buildOrder();
        if (!o) return;
        const res = await sendOrder(o.details, { preview: o.preview, printFile: o.printFile });
        showToast(res === 'shared'
          ? 'Commande partagée 🎉'
          : 'Images téléchargées + WhatsApp ouvert — joins-les au message.');
      } catch (e) {
        alert((e as Error).message || 'Erreur');
      } finally {
        showProcessing(false);
      }
    });
    $('#btn-download').addEventListener('click', async () => {
      showProcessing(true, 'Génération du visuel…');
      try {
        const o = await buildOrder();
        if (!o) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(o.preview);
        a.download = 'shinobi-apercu.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        showToast('Visuel téléchargé.');
      } finally {
        showProcessing(false);
      }
    });
  }

  function showToast(msg: string) {
    const t = $('#toast');
    t.textContent = msg;
    t.style.display = 'block';
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.style.display = 'none'), 300); }, 3500);
  }

  // ── Tab: gallery vs upload ────────────────────────────────
  function wireSourceTabs() {
    $('#tab-gallery').onclick = () => switchSource('gallery');
    $('#tab-upload').onclick = () => switchSource('upload');
    $<HTMLInputElement>('#file').onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) setDesignFromUpload(f);
    };
    // drag & drop
    const dz = $('#dropzone');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) setDesignFromUpload(f);
    });
  }
  function switchSource(which: 'gallery' | 'upload') {
    $('#tab-gallery').classList.toggle('on', which === 'gallery');
    $('#tab-upload').classList.toggle('on', which === 'upload');
    $('#panel-gallery').style.display = which === 'gallery' ? '' : 'none';
    $('#panel-upload').style.display = which === 'upload' ? '' : 'none';
  }

  function wireGallery() {
    $('#gallery').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-design]');
      if (!b) return;
      const d = cat.designs.find(x => x.id === b.getAttribute('data-design'));
      if (!d) return;
      $$('[data-design]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      $('#upload-tools').style.display = 'none';
      setDesignFromGallery(d);
    });
  }

  function wireBases() {
    $('#bases').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-base]');
      if (b) selectBase(b.getAttribute('data-base')!);
    });
  }

  // helper for multi-select
  function $$(sel: string): HTMLElement[] { return Array.from(document.querySelectorAll<HTMLElement>(sel)); }

  // ── Boot ──────────────────────────────────────────────────
  renderColors();
  drawMockup();
  updateConditionalSteps();
  updatePrice();
  updateOrderEnabled();
  wireBases();
  wireColorsResize();
  wireSourceTabs();
  wireGallery();
  wireUploadTools();
  wireInteraction();
  wireOptions();
  wireOrder();
  window.addEventListener('resize', layoutPrintBox);

  function wireColorsResize() {
    // re-layout the print box once the mockup image has painted
    mockupImg.addEventListener('load', layoutPrintBox);
  }
}
