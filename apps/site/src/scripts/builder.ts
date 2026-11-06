/**
 * SHINOBI custom designer — client controller (v2).
 *
 * Adds: independent FRONT (recto) + BACK (verso) designs in one order,
 * a customer note, and photographic-mockup support. The interactive
 * preview is DOM+CSS for smooth drag/scale/rotate; export uses the
 * canvas compositor so what you see is what the shop prints.
 */
import { getMockup, BASE_TO_MOCKUP, type MockupKind, type Mockup, type Rect, type Side } from '../lib/mockups';
import { imageToCanvas, removeBackgroundChroma, removeBackgroundAI, sampleColor } from '../lib/bg-remove';
import {
  DEFAULT_PLACEMENT, designBox, renderPreview, renderPrintFile, canvasToBlob,
  clampPlacement, svgDataUrl, loadImage, type Placement,
} from '../lib/compositor';
import {
  sendOrder, copyText, prepareWindow, orderText, normalisePhone, fmtDA,
  type OrderDetails, type SideInfo, type NamedBlob, type Channel, type Customer, type OrderResult,
} from '../lib/order';
import { SIZE_GUIDES } from '../lib/size-guide';
import { complete, see, recordOrder, isUnlocked, loyaltySummary, RANKS } from '../lib/dojo';

interface Base { id: string; name: string; price: number; doubleSideAllowed: boolean; extraDoubleSide: number; icon: string; order: number; }
interface Design { id: string; name: string; anime: string; image?: string; emoji?: string; unlockRank: number; rarity: string; }
interface Catalog {
  bases: Base[]; designs: Design[];
  contact: { whatsappNumber: string; instagram: string };
  brand: { name: string };
  delivery: { fee: number; pickupFee: number; pickupPlace: string };
}

interface SideState {
  design: HTMLCanvasElement | null;
  source: HTMLCanvasElement | null; // pre-removal upload
  label: string;
  fromUpload: boolean;
  galleryId: string | null;
  placement: Placement;
  tolerance: number;
}
const freshSide = (): SideState => ({
  design: null, source: null, label: '', fromUpload: false, galleryId: null,
  placement: { ...DEFAULT_PLACEMENT }, tolerance: 30,
});

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s));
const NO_SIZE: MockupKind[] = ['mug', 'tote'];
const MAX_QTY = 20;
const CUSTOMER_KEY = 'shinobi.customer';

/** Remembered on this device only, so a returning customer doesn't retype. */
function loadCustomer(): Customer {
  const empty: Customer = { name: '', phone: '', mode: 'livraison', wilaya: '', commune: '' };
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch { return empty; }
}
function saveCustomer(c: Customer) {
  try { localStorage.setItem(CUSTOMER_KEY, JSON.stringify(c)); } catch { /* private mode: ignore */ }
}

export function initBuilder() {
  const cat: Catalog = JSON.parse($('#catalog').textContent || '{}');

  const state = {
    base: cat.bases[0],
    mockupKind: BASE_TO_MOCKUP[cat.bases[0].id] as MockupKind,
    garmentHex: '#161616',
    garmentName: 'Noir',
    size: 'M' as string,
    note: '' as string,
    qty: 1,
    customer: loadCustomer(),
    activeSide: 'recto' as Side,
    sides: { recto: freshSide(), verso: freshSide() } as Record<Side, SideState>,
    eyedropper: false,
    curVb: 1000,
    curPrintArea: { x: 0, y: 0, w: 0, h: 0 } as Rect,
    // Try-on mode: when stageMode is 'photo' the stage shows the
    // customer's photo; placement coords still live in the same viewBox.
    stageMode: 'mockup' as 'mockup' | 'photo',
    customerPhoto: null as { url: string; vb: number; pa: Rect } | null,
  };
  const cur = () => state.sides[state.activeSide];
  const mk = (): Mockup => getMockup(state.mockupKind);

  // ── DOM refs ──────────────────────────────────────────────
  const stage = $('#stage');
  const mockupImg = $<HTMLImageElement>('#mockup-img');
  const printBox = $('#print-box');
  const designEl = $<HTMLImageElement>('#design-el');
  const hint = $('#stage-hint');

  // ── Mockup image (SVG or photo) ───────────────────────────
  function svgForSide(side: Side): string {
    const m = mk();
    return side === 'verso' ? m.back(state.garmentHex) : m.front(state.garmentHex);
  }
  function rasterFor(side: Side): { url: string; pa: Rect } | null {
    const m = mk();
    if (!m.raster) return null;
    const set = m.raster.images[state.garmentName];
    if (!set) return null;
    const url = side === 'verso' && set.verso ? set.verso : set.recto;
    const pa = side === 'verso' && m.raster.printAreaVerso ? m.raster.printAreaVerso : m.raster.printAreaRecto;
    return { url, pa };
  }
  function drawMockup() {
    if (state.stageMode === 'photo') {
      if (state.customerPhoto) {
        mockupImg.src = state.customerPhoto.url;
        state.curPrintArea = state.customerPhoto.pa;
        state.curVb = state.customerPhoto.vb;
        $('#photo-prompt').style.display = 'none';
        $('#print-box-label').textContent = 'zone du design';
      } else {
        mockupImg.removeAttribute('src');
        $('#photo-prompt').style.display = 'flex';
        return;
      }
    } else {
      $('#photo-prompt').style.display = 'none';
      $('#print-box-label').textContent = "zone d'impression";
      const m = mk();
      const r = rasterFor(state.activeSide);
      if (r) { mockupImg.src = r.url; state.curPrintArea = r.pa; state.curVb = 1000; }
      else { mockupImg.src = svgDataUrl(svgForSide(state.activeSide)); state.curPrintArea = m.printArea; state.curVb = m.vb; }
    }
    layoutPrintBox();
  }
  async function mockupImageForExport(side: Side): Promise<{ img: HTMLImageElement; vb: number; pa: Rect }> {
    const m = mk();
    const r = rasterFor(side);
    if (r) return { img: await loadImage(r.url, 1000), vb: 1000, pa: r.pa };
    return { img: await loadImage(svgDataUrl(svgForSide(side)), m.vb), vb: m.vb, pa: m.printArea };
  }

  // ── Layout (display) ──────────────────────────────────────
  function layoutPrintBox() {
    const D = stage.clientWidth;
    const ds = D / state.curVb;
    const pa = state.curPrintArea;
    printBox.style.left = `${pa.x * ds}px`;
    printBox.style.top = `${pa.y * ds}px`;
    printBox.style.width = `${pa.w * ds}px`;
    printBox.style.height = `${pa.h * ds}px`;
    layoutDesign();
  }
  function layoutDesign() {
    const s = cur();
    if (!s.design) { designEl.style.display = 'none'; hint.style.display = 'flex'; return; }
    const D = stage.clientWidth;
    const ds = D / state.curVb;
    const box = designBox(state.curPrintArea, s.design, s.placement);
    designEl.style.display = 'block';
    hint.style.display = 'none';
    designEl.style.width = `${box.w * ds}px`;
    designEl.style.height = `${box.h * ds}px`;
    designEl.style.left = `${box.cx * ds}px`;
    designEl.style.top = `${box.cy * ds}px`;
    designEl.style.transform = `translate(-50%, -50%) rotate(${s.placement.rot}deg)`;
  }

  // ── Colours ───────────────────────────────────────────────
  function renderColors() {
    const wrap = $('#colors'); wrap.innerHTML = '';
    for (const c of mk().colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c.hex === state.garmentHex ? ' on' : '');
      b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name);
      b.onclick = () => { state.garmentHex = c.hex; state.garmentName = c.name; renderColors(); drawMockup(); };
      wrap.appendChild(b);
    }
  }

  // ── Side switcher (recto / verso) ─────────────────────────
  function renderSideSwitch() {
    const wrap = $('#side-switch');
    wrap.style.display = mk().twoSided ? 'flex' : 'none';
    if (!mk().twoSided) return;
    wrap.querySelectorAll<HTMLElement>('[data-edit-side]').forEach(b => {
      const side = b.getAttribute('data-edit-side') as Side;
      const on = side === state.activeSide;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      const dot = b.querySelector('.dot') as HTMLElement | null;
      if (dot) dot.style.display = state.sides[side].design ? 'inline-block' : 'none';
    });
    $('#btn-clear-verso').style.display = state.sides.verso.design ? 'inline-flex' : 'none';
  }
  function switchSide(side: Side) {
    if (side === 'verso' && !mk().twoSided) return;
    state.activeSide = side;
    state.eyedropper = false; $('#btn-eyedrop')?.classList.remove('on'); stage.style.cursor = '';
    drawMockup();
    reflectSideInPanels();
    renderSideSwitch();
  }

  // reflect the active side's design choice in the panels + sliders
  function reflectSideInPanels() {
    const s = cur();
    // gallery highlight
    $$('[data-design]').forEach(x => x.classList.toggle('on', x.getAttribute('data-design') === s.galleryId));
    // upload tools visibility
    $('#upload-tools').style.display = s.fromUpload ? 'block' : 'none';
    // sliders
    ($('#scale') as HTMLInputElement).value = String(Math.round(s.placement.scale * 100));
    ($('#rot') as HTMLInputElement).value = String(Math.round(s.placement.rot));
    ($('#tolerance') as HTMLInputElement).value = String(s.tolerance);
    commitDesignDisplay();
  }

  // ── Base / product ────────────────────────────────────────
  function selectBase(id: string) {
    const base = cat.bases.find(b => b.id === id); if (!base) return;
    state.base = base; state.mockupKind = BASE_TO_MOCKUP[id];
    if (!mk().colors.find(c => c.hex === state.garmentHex)) {
      state.garmentHex = mk().colors[0].hex; state.garmentName = mk().colors[0].name;
    }
    if (!mk().twoSided) { state.activeSide = 'recto'; state.sides.verso = freshSide(); }
    $$('.opt-base').forEach(el => el.classList.toggle('on', el.getAttribute('data-base') === id));
    renderColors();
    renderSideSwitch();
    drawMockup();
    reflectSideInPanels();
    updateConditionalSteps();
    updatePrice();
  }
  function updateConditionalSteps() {
    $('#step-size').style.display = NO_SIZE.includes(state.mockupKind) ? 'none' : '';
  }

  // ── Designs ───────────────────────────────────────────────
  function emojiToCanvas(emoji: string): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d')!;
    x.font = '380px "Noto Color Emoji","Apple Color Emoji",serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(emoji, 256, 286);
    return c;
  }
  /** Secret designs stay locked until the customer reaches the rank. */
  function lockedMessage(d: Design): boolean {
    if (isUnlocked(d.unlockRank)) return false;
    const r = RANKS[d.unlockRank];
    showToast(`🔒 Design secret — atteins le rang ${r.name} ${r.kanji} au Dojo pour le débloquer.`);
    const el = document.querySelector<HTMLElement>(`[data-design="${d.id}"]`);
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    return true;
  }
  async function setFromGallery(d: Design): Promise<boolean> {
    if (lockedMessage(d)) return false;
    let canvas: HTMLCanvasElement;
    if (d.image) {
      showProcessing(true, 'Chargement du design…');
      try { canvas = await imageToCanvas(d.image); }
      catch { showToast("Ce design n'a pas pu être chargé."); return false; }
      finally { showProcessing(false); }
    } else {
      canvas = emojiToCanvas(d.emoji || '🥷');
    }
    const s = cur();
    s.design = canvas; s.source = canvas; s.fromUpload = false;
    s.galleryId = d.id; s.label = `${d.name} (${d.anime})`;
    s.placement = { ...DEFAULT_PLACEMENT };
    $('#upload-tools').style.display = 'none';
    $$('[data-design]').forEach(x => x.classList.toggle('on', x.getAttribute('data-design') === d.id));
    commitDesignDisplay(); afterDesignChange();
    see(d.id); complete('premier-sceau');
    return true;
  }
  async function setFromUpload(file: File) {
    showProcessing(true, "Lecture de l'image…");
    try {
      const src = await imageToCanvas(file);
      const s = cur();
      s.source = src; s.fromUpload = true; s.galleryId = null; s.label = 'Mon design';
      showProcessing(true, 'Découpe du fond…');
      s.design = runChroma(s);
      s.placement = { ...DEFAULT_PLACEMENT };
      ($('#scale') as HTMLInputElement).value = '85'; ($('#rot') as HTMLInputElement).value = '0';
      $('#upload-tools').style.display = 'block';
      commitDesignDisplay(); afterDesignChange();
      complete('art-perso');
    } catch (e) { alert((e as Error).message || 'Image illisible'); }
    finally { showProcessing(false); }
  }
  function runChroma(s: SideState, seed: [number, number, number] | null = null): HTMLCanvasElement {
    const copy = document.createElement('canvas');
    copy.width = s.source!.width; copy.height = s.source!.height;
    copy.getContext('2d')!.drawImage(s.source!, 0, 0);
    return removeBackgroundChroma(copy, { tolerance: s.tolerance, seed });
  }
  function commitDesignDisplay() {
    const s = cur();
    if (!s.design) { designEl.style.display = 'none'; designEl.removeAttribute('src'); hint.style.display = 'flex'; return; }
    designEl.src = s.design.toDataURL('image/png');
    layoutDesign();
  }
  function afterDesignChange() {
    renderSideSwitch(); updateOrderEnabled(); updatePrice();
    if (mk().twoSided && state.sides.verso.design) complete('double-lame');
  }

  // ── Background-removal tools (active side, upload only) ────
  function wireUploadTools() {
    let tolRaf = 0;
    ($('#tolerance') as HTMLInputElement).oninput = (e) => {
      const s = cur(); s.tolerance = Number((e.target as HTMLInputElement).value);
      if (!s.source || !s.fromUpload) return;
      if (tolRaf) cancelAnimationFrame(tolRaf);
      tolRaf = requestAnimationFrame(() => { s.design = runChroma(s); commitDesignDisplay(); tolRaf = 0; });
    };
    $('#btn-keep').onclick = () => {
      const s = cur(); if (!s.source) return;
      const copy = document.createElement('canvas');
      copy.width = s.source.width; copy.height = s.source.height;
      copy.getContext('2d')!.drawImage(s.source, 0, 0);
      s.design = copy; commitDesignDisplay();
    };
    $('#btn-eyedrop').onclick = () => {
      state.eyedropper = !state.eyedropper;
      $('#btn-eyedrop').classList.toggle('on', state.eyedropper);
      stage.style.cursor = state.eyedropper ? 'crosshair' : '';
    };
    $('#btn-ai').onclick = async () => {
      const s = cur(); if (!s.source) return;
      showProcessing(true, 'Découpe IA (téléchargement du modèle)…');
      try {
        const blob = await canvasToBlob(s.source);
        s.design = await removeBackgroundAI(blob); commitDesignDisplay();
      } catch (e) { alert((e as Error).message); }
      finally { showProcessing(false); }
    };
  }
  function onStageEyedrop(e: PointerEvent) {
    const s = cur();
    if (!state.eyedropper || !s.source) return;
    e.preventDefault(); e.stopPropagation();
    const r = designEl.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    s.design = runChroma(s, sampleColor(s.source, nx, ny)); commitDesignDisplay();
    state.eyedropper = false; $('#btn-eyedrop').classList.remove('on'); stage.style.cursor = '';
  }

  // ── Drag / scale / rotate ─────────────────────────────────
  function wireInteraction() {
    let dragging = false, sx = 0, sy = 0, snx = 0, sny = 0;
    designEl.addEventListener('pointerdown', (e) => {
      if (state.eyedropper) return;
      dragging = true; designEl.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY; snx = cur().placement.nx; sny = cur().placement.ny;
    });
    designEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const ds = stage.clientWidth / state.curVb;
      const p = cur().placement;
      p.nx = snx + ((e.clientX - sx) / ds) / state.curPrintArea.w;
      p.ny = sny + ((e.clientY - sy) / ds) / state.curPrintArea.h;
      cur().placement = clampPlacement(p);
      layoutDesign();
    });
    const end = (e: PointerEvent) => { dragging = false; try { designEl.releasePointerCapture(e.pointerId); } catch {} };
    designEl.addEventListener('pointerup', end);
    designEl.addEventListener('pointercancel', end);
    stage.addEventListener('pointerdown', onStageEyedrop);

    ($('#scale') as HTMLInputElement).oninput = (e) => { cur().placement.scale = Number((e.target as HTMLInputElement).value) / 100; layoutDesign(); };
    ($('#rot') as HTMLInputElement).oninput = (e) => { cur().placement.rot = Number((e.target as HTMLInputElement).value); layoutDesign(); };
    $('#btn-center').onclick = () => { const p = cur().placement; p.nx = 0.5; p.ny = 0.5; layoutDesign(); };
    $('#btn-fit').onclick = () => {
      const p = cur().placement; p.nx = 0.5; p.ny = 0.5; p.scale = 0.95; p.rot = 0;
      ($('#scale') as HTMLInputElement).value = '95'; ($('#rot') as HTMLInputElement).value = '0'; layoutDesign();
    };
  }

  // ── Side switcher + clear verso ───────────────────────────
  function wireSides() {
    $('#side-switch').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-edit-side]');
      if (b) switchSide(b.getAttribute('data-edit-side') as Side);
    });
    $('#btn-clear-verso').onclick = () => {
      state.sides.verso = freshSide();
      if (state.activeSide === 'verso') reflectSideInPanels();
      renderSideSwitch(); updatePrice(); commitDesignDisplay();
    };
  }

  // ── Size + note ───────────────────────────────────────────
  function wireOptions() {
    $('#step-size').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]');
      if (!b) return;
      $$('[data-size]').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); state.size = b.getAttribute('data-size')!;
      updatePrice();
    });
    ($('#note') as HTMLTextAreaElement).oninput = (e) => { state.note = (e.target as HTMLTextAreaElement).value; };
  }

  // ── Customer details ──────────────────────────────────────
  let showErrors = false; // stays quiet until the first order attempt
  const nameIn = $<HTMLInputElement>('#c-name');
  const phoneIn = $<HTMLInputElement>('#c-phone');
  const wilayaIn = $<HTMLSelectElement>('#c-wilaya');
  const communeIn = $<HTMLInputElement>('#c-commune');

  function setFieldError(el: HTMLElement, msg: string) {
    const err = document.getElementById(`${el.id}-err`);
    if (msg) { el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', `${el.id}-err`); }
    else { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
    if (err) err.textContent = msg;
  }
  /** Returns the first invalid field (and marks every invalid one), or null. */
  function validateCustomer(): HTMLElement | null {
    const c = state.customer;
    const bad: HTMLElement[] = [];
    const nameMsg = c.name.trim().length < 2 ? 'Indique ton prénom.' : '';
    setFieldError(nameIn, nameMsg); if (nameMsg) bad.push(nameIn);
    const phoneMsg = !c.phone.trim() ? 'Indique ton numéro.'
      : !normalisePhone(c.phone) ? 'Numéro invalide (ex. 05 55 12 34 56).' : '';
    setFieldError(phoneIn, phoneMsg); if (phoneMsg) bad.push(phoneIn);
    const wilayaMsg = c.mode === 'livraison' && !c.wilaya ? 'Choisis ta wilaya.' : '';
    setFieldError(wilayaIn, wilayaMsg); if (wilayaMsg) bad.push(wilayaIn);
    return bad[0] ?? null;
  }
  function reflectMode() {
    const livraison = state.customer.mode === 'livraison';
    $('#delivery-fields').style.display = livraison ? '' : 'none';
    if (!livraison) setFieldError(wilayaIn, '');
    document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach(r => { r.checked = r.value === state.customer.mode; });
  }
  function wireCustomer() {
    const c = state.customer;
    nameIn.value = c.name; phoneIn.value = c.phone; wilayaIn.value = c.wilaya; communeIn.value = c.commune;
    const onEdit = () => {
      c.name = nameIn.value; c.phone = phoneIn.value; c.wilaya = wilayaIn.value; c.commune = communeIn.value;
      saveCustomer(c);
      // once errors have been shown, re-check live so they clear as soon as they're fixed
      if (showErrors) validateCustomer();
    };
    [nameIn, phoneIn, communeIn].forEach(el => el.addEventListener('input', onEdit));
    wilayaIn.addEventListener('change', onEdit);
    phoneIn.addEventListener('blur', () => {
      const n = normalisePhone(phoneIn.value);
      if (n) { phoneIn.value = n; onEdit(); }
    });
    document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach(r =>
      r.addEventListener('change', () => {
        c.mode = r.value as Customer['mode']; saveCustomer(c); reflectMode(); updatePrice();
      }));
    $('#qty-minus').addEventListener('click', () => setQty(state.qty - 1));
    $('#qty-plus').addEventListener('click', () => setQty(state.qty + 1));
    reflectMode(); setQty(1);
  }
  function setQty(n: number) {
    state.qty = Math.max(1, Math.min(MAX_QTY, n));
    $('#qty').textContent = String(state.qty);
    ($('#qty-minus') as HTMLButtonElement).disabled = state.qty <= 1;
    ($('#qty-plus') as HTMLButtonElement).disabled = state.qty >= MAX_QTY;
    updatePrice();
  }

  // ── Pricing ───────────────────────────────────────────────
  function versoSurcharge(): number {
    return mk().twoSided && state.sides.verso.design ? state.base.extraDoubleSide : 0;
  }
  function unitPrice(): number { return state.base.price + versoSurcharge(); }
  function deliveryFee(): number {
    return state.customer.mode === 'livraison' ? cat.delivery.fee : cat.delivery.pickupFee;
  }
  function total(): number { return unitPrice() * state.qty + deliveryFee(); }
  function updatePrice() {
    $('#total').textContent = fmtDA(total());
    $('#mb-total').textContent = fmtDA(total());
    const sub = unitPrice() * state.qty;
    $('#l-sub-label').textContent = state.qty > 1 ? `Sous-total (${state.qty} × ${fmtDA(unitPrice())})` : 'Sous-total';
    $('#l-sub').textContent = fmtDA(sub);
    const livraison = state.customer.mode === 'livraison';
    $('#l-del-row').style.display = livraison ? '' : 'none';
    $('#l-del').textContent = fmtDA(cat.delivery.fee);
    const sides = [
      state.sides.recto.design ? 'recto' : null,
      state.sides.verso.design ? 'verso' : null,
    ].filter(Boolean).join(' + ') || 'aucun design';
    const parts = [
      state.base.name, sides,
      NO_SIZE.includes(state.mockupKind) ? null : state.size,
      state.garmentName,
    ].filter(Boolean);
    $('#brk').textContent = parts.join(' · ');
  }
  function updateOrderEnabled() {
    const ok = !!state.sides.recto.design;
    ['#btn-order', '#btn-order-ig', '#btn-download'].forEach(id => (($(id) as HTMLButtonElement).disabled = !ok));
    $('#order-hint').textContent = ok ? '' : 'Choisis ou importe un design pour pouvoir commander.';
  }

  // ── Processing + toast ────────────────────────────────────
  function showProcessing(on: boolean, label = '') {
    $('#processing').style.display = on ? 'flex' : 'none';
    if (label) $('#processing-label').textContent = label;
  }
  let toastHideT: number | undefined, toastDoneT: number | undefined;
  function showToast(msg: string) {
    const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    // force reflow so the 'show' transition replays on rapid successive toasts
    void t.offsetWidth;
    t.classList.add('show');
    if (toastHideT) clearTimeout(toastHideT);
    if (toastDoneT) clearTimeout(toastDoneT);
    toastHideT = window.setTimeout(() => {
      t.classList.remove('show');
      toastDoneT = window.setTimeout(() => (t.style.display = 'none'), 300);
    }, 4000);
  }

  // ── Order ─────────────────────────────────────────────────
  function placementNote(s: SideState): string {
    const p = s.placement;
    const centered = Math.abs(p.nx - 0.5) < 0.06 && Math.abs(p.ny - 0.5) < 0.06;
    return `${Math.round(p.scale * 100)}% · ${centered ? 'centré' : 'placé main'}${p.rot ? ` · ${Math.round(p.rot)}°` : ''}`;
  }
  async function buildSideFiles(side: Side): Promise<NamedBlob[]> {
    const s = state.sides[side];
    if (!s.design) return [];
    const { img, vb, pa } = await mockupImageForExport(side);
    const preview = await renderPreview(img, vb, pa, s.design, s.placement, 1200);
    const print = await renderPrintFile(pa, s.design, s.placement, 2200);
    return [
      { name: `shinobi-${side}-apercu.png`, blob: await canvasToBlob(preview) },
      { name: `shinobi-${side}-impression.png`, blob: await canvasToBlob(print) },
    ];
  }
  function sideInfo(side: Side, label: string): SideInfo {
    return { label, designLabel: state.sides[side].label, placementNote: placementNote(state.sides[side]) };
  }
  async function buildPhotoPreviewFile(): Promise<NamedBlob | null> {
    if (state.stageMode !== 'photo' || !state.customerPhoto) return null;
    const s = state.sides.recto;
    if (!s.design) return null;
    const img = await loadImage(state.customerPhoto.url, state.customerPhoto.vb);
    const c = await renderPreview(img, state.customerPhoto.vb, state.customerPhoto.pa, s.design, s.placement, 1200);
    return { name: 'shinobi-essai-photo.png', blob: await canvasToBlob(c) };
  }
  async function buildFiles(): Promise<NamedBlob[]> {
    const files = [...await buildSideFiles('recto'), ...await buildSideFiles('verso')];
    const tryon = await buildPhotoPreviewFile();
    if (tryon) files.push(tryon);
    return files;
  }
  /** Synchronous, so it can run inside the click (clipboard needs that). */
  function buildDetails(): OrderDetails {
    const c = state.customer;
    return {
      brand: cat.brand.name, whatsappNumber: cat.contact.whatsappNumber, instagram: cat.contact.instagram,
      product: state.base.name, basePrice: state.base.price,
      colour: state.garmentName,
      size: NO_SIZE.includes(state.mockupKind) ? null : state.size,
      quantity: state.qty,
      unitPrice: unitPrice(),
      recto: sideInfo('recto', 'Recto'),
      verso: state.sides.verso.design ? sideInfo('verso', 'Verso') : null,
      versoSurcharge: versoSurcharge(),
      deliveryFee: deliveryFee(),
      pickupPlace: cat.delivery.pickupPlace,
      customer: { ...c, phone: normalisePhone(c.phone) ?? c.phone.trim() },
      note: state.note,
      loyalty: loyaltySummary(),
      total: total(),
    };
  }

  const appName = (ch: Channel) => (ch === 'whatsapp' ? 'WhatsApp' : 'Instagram');
  function reportResult(ch: Channel, res: OrderResult) {
    if (res.status === 'shared' || res.status === 'downloaded') recordOrder();
    if (res.status === 'shared') showToast('Commande envoyée 🎉 On te répond vite !');
    else if (res.status === 'cancelled') showToast('Envoi annulé — tu peux réessayer.');
    else if (res.status === 'downloaded') showToast(ch === 'whatsapp'
      ? 'Visuels téléchargés + WhatsApp ouvert — joins-les au message.'
      : 'Message copié ✅ Visuels téléchargés — colle le message dans Instagram et joins-les.');
    else openShareReady(ch, res.retry);
  }

  const shareReady = $('#share-ready');
  let pendingRetry: (() => Promise<OrderResult>) | null = null;
  let pendingChannel: Channel = 'whatsapp';
  function openShareReady(ch: Channel, retry: () => Promise<OrderResult>) {
    pendingRetry = retry; pendingChannel = ch;
    const btn = $('#sr-send');
    btn.textContent = `Envoyer sur ${appName(ch)}`;
    btn.className = `btn ${ch === 'whatsapp' ? 'btn-wa' : 'btn-ig'} sr-send`;
    shareReady.style.display = 'flex';
    btn.focus();
  }
  function closeShareReady() { shareReady.style.display = 'none'; pendingRetry = null; }

  async function placeOrder(ch: Channel) {
    if (!state.sides.recto.design) return;
    showErrors = true;
    const bad = validateCustomer();
    if (bad) {
      $('#order-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      bad.focus({ preventScroll: true });
      showToast('Complète tes infos pour envoyer la commande.');
      return;
    }
    // click-time work: copy the text (Instagram can't pre-fill it) and,
    // on computers, open the chat tab before pop-up blockers kick in
    const details = buildDetails();
    if (ch === 'instagram') await copyText(orderText(details));
    const win = prepareWindow();
    showProcessing(true, 'Préparation de la commande…');
    try {
      const files = await buildFiles();
      reportResult(ch, await sendOrder(ch, details, files, win));
    } catch (e) {
      win?.close();
      showToast((e as Error).message || "Erreur pendant la préparation — réessaie.");
    } finally { showProcessing(false); }
  }

  function wireOrder() {
    $('#btn-order').addEventListener('click', () => placeOrder('whatsapp'));
    $('#btn-order-ig').addEventListener('click', () => placeOrder('instagram'));
    $('#sr-send').addEventListener('click', async () => {
      const retry = pendingRetry, ch = pendingChannel;
      closeShareReady();
      if (retry) reportResult(ch, await retry());
    });
    shareReady.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('data-close')) closeShareReady();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && shareReady.style.display === 'flex') closeShareReady();
    });
    $('#btn-download').addEventListener('click', async () => {
      if (!state.sides.recto.design) return;
      showProcessing(true, 'Génération des visuels…');
      try {
        const files = await buildFiles();
        for (const f of files.filter(f => !f.name.includes('impression'))) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(f.blob); a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
        showToast('Visuel(s) téléchargé(s).');
      } catch (e) {
        showToast((e as Error).message || 'Erreur pendant la génération.');
      } finally { showProcessing(false); }
    });
  }

  // ── Phone order bar ───────────────────────────────────────
  function wireMobileBar() {
    const bar = $('#mobile-bar');
    const card = $('#order-card');
    $('#mb-go').addEventListener('click', () => {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstEmpty = [nameIn, phoneIn].find(el => !el.value.trim());
      if (firstEmpty) setTimeout(() => firstEmpty.focus({ preventScroll: true }), 400);
    });
    if (!('IntersectionObserver' in window)) return;
    // hide the bar while the order card itself is on screen
    new IntersectionObserver(([entry]) => { bar.hidden = entry.isIntersecting; }, { threshold: 0.05 })
      .observe(card);
  }

  // ── Tabs (gallery / upload) ───────────────────────────────
  function wireSourceTabs() {
    $('#tab-gallery').onclick = () => switchSource('gallery');
    $('#tab-upload').onclick = () => switchSource('upload');
    ($('#file') as HTMLInputElement).onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (f) setFromUpload(f);
    };
    const dz = $('#dropzone');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) setFromUpload(f);
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
      const d = cat.designs.find(x => x.id === b.getAttribute('data-design')); if (!d) return;
      setFromGallery(d);
    });
  }
  function wireBases() {
    $('#bases').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-base]');
      if (b) selectBase(b.getAttribute('data-base')!);
    });
  }

  // ── Deep-link: /custom/?design=<id> ──────────────────────
  function applyDeepLinkDesign() {
    try {
      const id = new URLSearchParams(location.search).get('design');
      if (!id) return;
      const d = cat.designs.find(x => x.id === id);
      if (!d) return;
      setFromGallery(d); // highlights it, or explains the lock

    } catch { /* SSR or non-browser env */ }
  }

  // ── Try-on mode (photo) ───────────────────────────────────
  function setStageMode(mode: 'mockup' | 'photo') {
    state.stageMode = mode;
    const m = $('#mode-mockup'), p = $('#mode-photo');
    m.classList.toggle('on', mode === 'mockup'); m.setAttribute('aria-selected', mode === 'mockup' ? 'true' : 'false');
    p.classList.toggle('on', mode === 'photo'); p.setAttribute('aria-selected', mode === 'photo' ? 'true' : 'false');
    // disable side switcher / colour swatches in photo mode — they don't
    // affect the photo preview anyway
    $('#side-switch').style.opacity = mode === 'photo' ? '0.4' : '1';
    $('#side-switch').style.pointerEvents = mode === 'photo' ? 'none' : '';
    $('#colors').style.opacity = mode === 'photo' ? '0.4' : '1';
    $('#colors').style.pointerEvents = mode === 'photo' ? 'none' : '';
    drawMockup();
  }
  async function loadCustomerPhoto(file: File) {
    showProcessing(true, 'Lecture de la photo…');
    try {
      const src = await imageToCanvas(file);
      // Letterbox onto a 1000×1000 canvas with a soft washi background
      // so the stage maths (square viewBox) keep working unchanged.
      const VB = 1000;
      const sq = document.createElement('canvas');
      sq.width = VB; sq.height = VB;
      const ctx = sq.getContext('2d')!;
      ctx.fillStyle = '#F2F0EA'; ctx.fillRect(0, 0, VB, VB);
      const sc = Math.min(VB / src.width, VB / src.height);
      const dw = src.width * sc, dh = src.height * sc;
      const dx = (VB - dw) / 2, dy = (VB - dh) / 2;
      ctx.drawImage(src, dx, dy, dw, dh);
      // print area = centred 55% × 55% of the photo's drawn rect
      const pa: Rect = { x: dx + dw * 0.225, y: dy + dh * 0.20, w: dw * 0.55, h: dh * 0.55 };
      state.customerPhoto = { url: sq.toDataURL('image/jpeg', 0.92), vb: VB, pa };
      complete('miroir');
      cur().placement = { ...DEFAULT_PLACEMENT };
      ($('#scale') as HTMLInputElement).value = '85'; ($('#rot') as HTMLInputElement).value = '0';
      drawMockup();
      commitDesignDisplay();
    } catch (e) { alert((e as Error).message); }
    finally { showProcessing(false); }
  }
  function wireStageMode() {
    $('#mode-mockup').addEventListener('click', () => setStageMode('mockup'));
    $('#mode-photo').addEventListener('click', () => setStageMode('photo'));
    ($('#photo-file') as HTMLInputElement).addEventListener('change', (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) loadCustomerPhoto(f);
    });
  }

  // ── Size guide modal ──────────────────────────────────────
  function wireSizeGuide() {
    const modal = $('#size-guide');
    const btn = $('#btn-size-guide');
    const tableBody = modal.querySelector<HTMLTableSectionElement>('#sg-table tbody')!;
    const familyEl = $('#sg-family');
    const noteEl = $('#sg-note');
    const recOut = $('#sg-rec-out');
    const hIn = $<HTMLInputElement>('#sg-height');
    const wIn = $<HTMLInputElement>('#sg-weight');

    function familyFor(kind: MockupKind): 'tshirt' | 'hoodie' | null {
      if (kind === 'tshirt') return 'tshirt';
      if (kind === 'hoodie') return 'hoodie';
      return null; // mug/tote have no size
    }

    function paint(highlight: string | null) {
      const fam = familyFor(state.mockupKind);
      if (!fam) return;
      const g = SIZE_GUIDES[fam];
      familyEl.textContent = g.label;
      noteEl.textContent = g.fitNote;
      tableBody.innerHTML = '';
      for (const r of g.rows) {
        const tr = document.createElement('tr');
        if (highlight === r.size) tr.classList.add('match');
        tr.innerHTML = `<td>${r.size}</td><td>${r.chest}</td><td>${r.length}</td><td>${r.shoulder}</td><td>${r.sleeve}</td>`;
        tableBody.appendChild(tr);
      }
    }

    const applyBtn = $<HTMLButtonElement>('#sg-apply');
    let recommendedSize: string | null = null;

    function recompute() {
      const fam = familyFor(state.mockupKind);
      if (!fam) return;
      const h = parseInt(hIn.value, 10);
      const w = parseInt(wIn.value, 10);
      if (!h || !w) {
        recOut.textContent = 'Entre ta taille et ton poids — on te recommande une taille.';
        paint(null);
        applyBtn.style.display = 'none';
        recommendedSize = null;
        return;
      }
      const size = SIZE_GUIDES[fam].recommend(h, w);
      recOut.innerHTML = `Pour <b>${h} cm</b> · <b>${w} kg</b> → on recommande la taille <b>${size}</b>.`;
      paint(size);
      recommendedSize = size;
      complete('mesure');
      applyBtn.textContent = `Choisir la taille ${size} →`;
      applyBtn.style.display = '';
    }

    applyBtn.addEventListener('click', () => {
      if (!recommendedSize) return;
      const sizeBtn = document.querySelector<HTMLElement>(`[data-size="${recommendedSize}"]`);
      if (sizeBtn) {
        $$('[data-size]').forEach(x => x.classList.remove('on'));
        sizeBtn.classList.add('on');
        state.size = recommendedSize;
        updatePrice();
      }
      close();
      showToast(`Taille ${recommendedSize} sélectionnée 👍`);
    });

    function open() {
      const fam = familyFor(state.mockupKind);
      if (!fam) return;
      paint(null);
      modal.style.display = 'flex';
      // pre-fill current selected size as a baseline highlight
      paint(state.size);
      setTimeout(() => hIn.focus(), 50);
    }
    function close() { modal.style.display = 'none'; }

    btn.addEventListener('click', open);
    modal.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('data-close')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') close();
    });
    hIn.addEventListener('input', recompute);
    wIn.addEventListener('input', recompute);
  }

  // ── Boot ──────────────────────────────────────────────────
  renderColors(); renderSideSwitch(); drawMockup();
  updateConditionalSteps(); updatePrice(); updateOrderEnabled();
  wireBases(); wireSides(); wireSourceTabs(); wireGallery();
  wireUploadTools(); wireInteraction(); wireOptions(); wireOrder(); wireSizeGuide();
  wireStageMode(); wireCustomer(); wireMobileBar();
  applyDeepLinkDesign();
  mockupImg.addEventListener('load', layoutPrintBox);
  window.addEventListener('resize', layoutPrintBox);
}
