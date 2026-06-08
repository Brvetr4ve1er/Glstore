/**
 * Order hand-off. No backend — the order goes to the shop through the
 * channels they already use.
 *
 *  - Mobile (the primary audience): the Web Share API shares the
 *    composited mockup + print file + order text straight into
 *    WhatsApp/Instagram in one tap (navigator.share with files).
 *  - Desktop / unsupported: download the images, then open WhatsApp
 *    Web pre-filled, with a one-line instruction to attach them.
 */

export interface OrderDetails {
  brand: string;
  whatsappNumber: string;
  product: string;       // "T-shirt oversize"
  basePrice: number;
  design: string;        // "Mon design" or a gallery name
  colour: string;
  size: string | null;
  doubleSide: boolean;
  total: number;
  placementNote: string; // e.g. "centré, ~85% de la zone"
}

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/,/g, ' ') + ' DA';

export function orderText(o: OrderDetails): string {
  const lines = [
    `Salut ${o.brand} 👋`,
    `Je voudrais commander ce design personnalisé :`,
    ``,
    `• Produit : ${o.product} — ${fmt(o.basePrice)}`,
    `• Design  : ${o.design}`,
    `• Couleur : ${o.colour}`,
  ];
  if (o.size) lines.push(`• Taille  : ${o.size}`);
  if (o.doubleSide) lines.push(`• Côtés   : Recto + Verso (+500 DA)`);
  lines.push(`• Placement : ${o.placementNote}`);
  lines.push(``);
  lines.push(`Total : ${fmt(o.total)}`);
  lines.push(``);
  lines.push(`(Mon visuel + le fichier d'impression sont joints / téléchargés.)`);
  lines.push(`Mon prénom :`);
  lines.push(`Ma wilaya  :`);
  lines.push(`Téléphone  :`);
  return lines.join('\n');
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface ShareFiles {
  preview: Blob;   // mockup + design (what it looks like)
  printFile: Blob; // design only, transparent (what the shop prints)
}

export type OrderResult = 'shared' | 'downloaded';

/**
 * Try the native share sheet with files (mobile). Returns 'shared' if
 * the OS share dialog handled it, otherwise falls back to downloading
 * the files + opening WhatsApp and returns 'downloaded'.
 */
export async function sendOrder(o: OrderDetails, files: ShareFiles): Promise<OrderResult> {
  const text = orderText(o);
  const previewFile = new File([files.preview], 'shinobi-apercu.png', { type: 'image/png' });
  const printFile = new File([files.printFile], 'shinobi-impression.png', { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  const shareData: ShareData = {
    title: `${o.brand} — commande`,
    text,
    files: [previewFile, printFile],
  } as ShareData;

  if (nav.canShare && nav.canShare(shareData) && nav.share) {
    try {
      await nav.share(shareData);
      return 'shared';
    } catch (err) {
      // user cancelled, or share failed → fall through to download
      if ((err as Error)?.name === 'AbortError') return 'shared';
    }
  }

  // Fallback: download both, open WhatsApp Web pre-filled.
  download(files.preview, 'shinobi-apercu.png');
  download(files.printFile, 'shinobi-impression.png');
  window.open(waLink(o.whatsappNumber, text), '_blank', 'noopener');
  return 'downloaded';
}
