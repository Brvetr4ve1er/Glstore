/**
 * Order hand-off. No backend — orders reach the shop through WhatsApp.
 *  - Mobile: Web Share API shares every preview + print file straight
 *    into WhatsApp in one tap (navigator.share with files).
 *  - Desktop / unsupported: download the files + open WhatsApp Web
 *    pre-filled, with a one-line instruction to attach them.
 */

export interface SideInfo {
  label: string;          // "Recto" | "Verso"
  designLabel: string;    // "Mon design" or a gallery name
  placementNote: string;  // "85% de la zone · centré"
}

export interface OrderDetails {
  brand: string;
  whatsappNumber: string;
  product: string;
  basePrice: number;
  colour: string;
  size: string | null;
  total: number;
  recto: SideInfo;
  verso: SideInfo | null;   // null = front only
  versoSurcharge: number;   // DA added for the verso design (0 if none)
  note: string;             // free-text customer instructions
}

export interface NamedBlob { name: string; blob: Blob; }

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/,/g, ' ') + ' DA';

export function orderText(o: OrderDetails): string {
  const L: string[] = [
    `Salut ${o.brand} 👋`,
    `Je voudrais commander ce produit personnalisé :`,
    ``,
    `• Produit : ${o.product} — ${fmt(o.basePrice)}`,
    `• Couleur : ${o.colour}`,
  ];
  if (o.size) L.push(`• Taille  : ${o.size}`);
  L.push(``);
  L.push(`🎨 Recto : ${o.recto.designLabel} (${o.recto.placementNote})`);
  if (o.verso) {
    L.push(`🎨 Verso : ${o.verso.designLabel} (${o.verso.placementNote}) — +${fmt(o.versoSurcharge)}`);
  }
  if (o.note.trim()) {
    L.push(``);
    L.push(`📝 Note : ${o.note.trim()}`);
  }
  L.push(``);
  L.push(`Total : ${fmt(o.total)}`);
  L.push(``);
  L.push(`(Visuel(s) + fichier(s) d'impression joints / téléchargés.)`);
  L.push(`Mon prénom :`);
  L.push(`Ma wilaya  :`);
  L.push(`Téléphone  :`);
  return L.join('\n');
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type OrderResult = 'shared' | 'downloaded';

export async function sendOrder(o: OrderDetails, files: NamedBlob[]): Promise<OrderResult> {
  const text = orderText(o);
  const fileObjs = files.map(f => new File([f.blob], f.name, { type: 'image/png' }));

  const nav = navigator as Navigator & {
    canShare?: (d?: ShareData) => boolean;
    share?: (d?: ShareData) => Promise<void>;
  };
  const shareData = { title: `${o.brand} — commande`, text, files: fileObjs } as ShareData;

  if (nav.canShare && nav.canShare(shareData) && nav.share) {
    try {
      await nav.share(shareData);
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'shared';
    }
  }

  files.forEach(f => download(f.blob, f.name));
  window.open(waLink(o.whatsappNumber, text), '_blank', 'noopener');
  return 'downloaded';
}
