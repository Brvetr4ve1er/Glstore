/**
 * Order hand-off. No backend: orders reach the shop through WhatsApp or
 * Instagram.
 *
 *  - Phones: the Web Share API sends every preview + print file straight
 *    into the chosen app in one tap (navigator.share with files).
 *  - Computers / unsupported: the files download and WhatsApp Web (or the
 *    Instagram DM thread) opens, with a hint to attach them.
 *
 * Browsers only allow share sheets, pop-ups and clipboard writes during
 * a click. Building the images takes a moment, so the caller does the
 * click-time work first (copyText / prepareWindow), then awaits the
 * renders, then calls sendOrder(). If the browser still refuses the
 * share, sendOrder returns a `retry` to run from a second tap.
 */

export type Channel = 'whatsapp' | 'instagram';

export interface SideInfo {
  label: string;          // "Recto" | "Verso"
  designLabel: string;    // "Mon design" or a gallery name
  placementNote: string;  // "85% · centré"
}

export interface Customer {
  name: string;
  phone: string;
  mode: 'livraison' | 'retrait';
  wilaya: string;         // "16 · Alger" (livraison only)
  commune: string;        // free text, optional
}

export interface OrderDetails {
  brand: string;
  whatsappNumber: string;
  instagram: string;
  product: string;
  basePrice: number;
  colour: string;
  size: string | null;
  quantity: number;
  unitPrice: number;       // base + verso surcharge
  recto: SideInfo;
  verso: SideInfo | null;  // null = front only
  versoSurcharge: number;  // DA added for the verso design (0 if none)
  deliveryFee: number;
  pickupPlace: string;     // shown for "retrait"
  customer: Customer;
  note: string;            // free-text customer instructions
  total: number;
}

export interface NamedBlob { name: string; blob: Blob; }

export const fmtDA = (n: number) => n.toLocaleString('fr-FR').replace(/[\s ,]/g, ' ') + ' DA';

/** Light Algerian phone check: 05/06/07 mobiles and 02–04 landlines, with or without +213. */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00213')) d = d.slice(5);
  else if (d.startsWith('213')) d = d.slice(3);
  if (d.length === 9) d = '0' + d;
  return /^0[2-7]\d{8}$/.test(d) ? d.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : null;
}

export function orderText(o: OrderDetails): string {
  const L: string[] = [
    `Salut ${o.brand} 👋`,
    `Je voudrais commander ce produit personnalisé :`,
    ``,
    `• Produit : ${o.product} — ${fmtDA(o.basePrice)}`,
    `• Couleur : ${o.colour}`,
  ];
  if (o.size) L.push(`• Taille : ${o.size}`);
  L.push(`• Quantité : ${o.quantity}`);
  L.push(``);
  L.push(`🎨 Recto : ${o.recto.designLabel} · ${o.recto.placementNote}`);
  if (o.verso) {
    L.push(`🎨 Verso : ${o.verso.designLabel} · ${o.verso.placementNote} — +${fmtDA(o.versoSurcharge)}`);
  }
  if (o.note.trim()) {
    L.push(``);
    L.push(`📝 Note : ${o.note.trim()}`);
  }
  L.push(``);
  L.push(`👤 Prénom : ${o.customer.name.trim()}`);
  L.push(`📞 Téléphone : ${o.customer.phone}`);
  if (o.customer.mode === 'livraison') {
    const where = [o.customer.wilaya, o.customer.commune.trim()].filter(Boolean).join(' — ');
    L.push(`🚚 Livraison : ${where}`);
  } else {
    L.push(`🏪 Retrait en boutique : ${o.pickupPlace}`);
  }
  L.push(``);
  const sub = o.unitPrice * o.quantity;
  L.push(o.quantity > 1
    ? `Sous-total : ${fmtDA(sub)} (${o.quantity} × ${fmtDA(o.unitPrice)})`
    : `Sous-total : ${fmtDA(sub)}`);
  if (o.customer.mode === 'livraison') L.push(`Livraison : ${fmtDA(o.deliveryFee)} (à confirmer selon la wilaya)`);
  L.push(`Total : ${fmtDA(o.total)} — paiement à la livraison / au retrait`);
  L.push(``);
  L.push(`(Visuel(s) + fichier(s) d'impression joints.)`);
  return L.join('\n');
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
export function igLink(handle: string): string {
  return `https://ig.me/m/${encodeURIComponent(handle)}`;
}

/** Copy text to the clipboard. Call it directly inside the click handler. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

type ShareNav = Navigator & {
  canShare?: (d?: ShareData) => boolean;
  share?: (d?: ShareData) => Promise<void>;
};

/** Whether this browser can share image files (true on most phones). */
export function canShareFiles(): boolean {
  const nav = navigator as ShareNav;
  try {
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
    return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [probe] });
  } catch { return false; }
}

/**
 * On computers, open the chat tab during the click (pop-up blockers
 * allow that), then point it at the real link once the files are ready.
 */
export function prepareWindow(): Window | null {
  if (canShareFiles()) return null;
  const w = window.open('', '_blank');
  if (w) {
    try {
      w.opener = null;
      w.document.title = 'Ouverture…';
      w.document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">Ouverture de la conversation…</p>';
    } catch { /* cross-origin edge cases: ignore */ }
  }
  return w;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type OrderResult =
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'downloaded' }
  | { status: 'needs-tap'; retry: () => Promise<OrderResult> };

export async function sendOrder(
  channel: Channel,
  o: OrderDetails,
  files: NamedBlob[],
  win: Window | null = null,
): Promise<OrderResult> {
  const text = orderText(o);
  const fileObjs = files.map(f => new File([f.blob], f.name, { type: 'image/png' }));
  const nav = navigator as ShareNav;
  // Instagram ignores shared text, so only the images go through the
  // share sheet; the text is already on the clipboard.
  const shareData = (channel === 'whatsapp'
    ? { title: `${o.brand} — commande`, text, files: fileObjs }
    : { title: `${o.brand} — commande`, files: fileObjs }) as ShareData;

  if (!win && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare(shareData)) {
    const attempt = async (): Promise<OrderResult> => {
      try {
        await nav.share!(shareData);
        return { status: 'shared' };
      } catch (err) {
        const name = (err as Error)?.name;
        if (name === 'AbortError') return { status: 'cancelled' };
        if (name === 'NotAllowedError') return { status: 'needs-tap', retry: attempt };
        return fallback();
      }
    };
    return attempt();
  }
  return fallback();

  function fallback(): OrderResult {
    files.forEach(f => download(f.blob, f.name));
    const url = channel === 'whatsapp' ? waLink(o.whatsappNumber, text) : igLink(o.instagram);
    if (win && !win.closed) win.location.href = url;
    else window.open(url, '_blank', 'noopener');
    return { status: 'downloaded' };
  }
}
