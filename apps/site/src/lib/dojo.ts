/**
 * Le Dojo — SHINOBI's loyalty game.
 *
 * Customers earn chakra by using the site (first design, try-on, verso,
 * daily invocation, orders…), climb five ninja ranks, unlock secret
 * designs and earn small in-shop perks.
 *
 * Everything runs in the browser: progress lives in localStorage on the
 * customer's device (no account, no server, no tracking). Perks are
 * printed in the WhatsApp order and confirmed by the shop, so a faked
 * score can at worst reveal a secret design early.
 */

export type Rarity = 'commun' | 'rare' | 'legendaire';

export interface Rank { id: number; name: string; kanji: string; min: number; motto: string; }
export const RANKS: Rank[] = [
  { id: 0, name: 'Minarai', kanji: '見習', min: 0,   motto: "L'apprenti qui pousse la porte du dojo." },
  { id: 1, name: 'Genin',   kanji: '下忍', min: 50,  motto: 'Tes premiers sceaux sont tracés.' },
  { id: 2, name: 'Chūnin',  kanji: '中忍', min: 150, motto: 'Le clan commence à connaître ton nom.' },
  { id: 3, name: 'Jōnin',   kanji: '上忍', min: 300, motto: 'Tu portes les couleurs du clan.' },
  { id: 4, name: 'Shinobi', kanji: '忍者', min: 500, motto: 'Légende de Bab Ezzouar.' },
];

export interface Mission {
  id: string; icon: string; title: string; desc: string;
  chakra: number; href: string; goal?: number;
}
export const MISSIONS: Mission[] = [
  { id: 'dojo',             icon: '⛩️', title: 'Entre dans le dojo',        desc: 'Ouvre le designer.',                          chakra: 10,  href: '/custom/' },
  { id: 'premier-sceau',    icon: '🎴', title: 'Premier sceau',             desc: 'Choisis un design de la galerie.',            chakra: 20,  href: '/custom/' },
  { id: 'eclaireur',        icon: '🧭', title: 'Éclaireur',                 desc: 'Essaie 5 designs différents.',                chakra: 30,  href: '/galerie/', goal: 5 },
  { id: 'art-perso',        icon: '🖌️', title: 'Ton propre art',            desc: 'Importe ton image dans le designer.',         chakra: 40,  href: '/custom/' },
  { id: 'double-lame',      icon: '⚔️', title: 'Double lame',               desc: 'Ajoute un design au verso.',                  chakra: 30,  href: '/custom/' },
  { id: 'miroir',           icon: '🪞', title: 'Technique du miroir',       desc: 'Essaie un design sur ta photo.',              chakra: 40,  href: '/custom/' },
  { id: 'mesure',           icon: '📏', title: 'Juste mesure',              desc: 'Trouve ta taille avec le guide.',             chakra: 20,  href: '/custom/' },
  { id: 'invocation',       icon: '🌀', title: 'Première invocation',       desc: "Fais l'invocation du jour.",                  chakra: 20,  href: '/dojo/#invocation' },
  { id: 'parchemin',        icon: '📜', title: 'Lis le parchemin',          desc: 'Consulte la page Infos & livraison.',         chakra: 10,  href: '/infos/' },
  { id: 'allie',            icon: '🤝', title: 'Recrute un allié',          desc: 'Partage le site avec un ami.',                chakra: 30,  href: '/dojo/#allie' },
  { id: 'premiere-mission', icon: '🏯', title: 'Première mission accomplie', desc: 'Passe ta première commande.',                chakra: 100, href: '/custom/' },
];
export const ROLL_CHAKRA = 15;          // every daily invocation
export const REPEAT_ORDER_CHAKRA = 50;  // every order after the first
const RARITY_WEIGHT: Record<Rarity, number> = { commun: 70, rare: 25, legendaire: 5 };
export const RARITY_LABEL: Record<Rarity, string> = { commun: 'Commun', rare: 'Rare', legendaire: 'Légendaire' };

interface State {
  v: 1;
  chakra: number;
  done: Record<string, number>;          // mission id → completion time
  seen: string[];                        // design ids tried (Éclaireur)
  roll: { day: string; id: string } | null;
  orders: number;
}
const KEY = 'shinobi.dojo';
const fresh = (): State => ({ v: 1, chakra: 0, done: {}, seen: [], roll: null, orders: 0 });
let memory: State | null = null; // used when storage is blocked (private mode)

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1) return { ...fresh(), ...s };
    }
  } catch { /* fall through */ }
  return memory ?? fresh();
}
function save(s: State) {
  memory = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* keep in memory */ }
}
const sync = () => window.dispatchEvent(new CustomEvent('dojo:sync'));

/** The owner can switch the game off in /admin/ (html[data-dojo="off"]). */
export const enabled = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.dojo !== 'off';

export function rankOf(chakra: number): Rank {
  let r = RANKS[0];
  for (const x of RANKS) if (chakra >= x.min) r = x;
  return r;
}
export function progress(s: State = load()) {
  const rank = rankOf(s.chakra);
  const next = RANKS[rank.id + 1] ?? null;
  const pct = next ? (s.chakra - rank.min) / (next.min - rank.min) : 1;
  return { chakra: s.chakra, rank, next, pct: Math.max(0, Math.min(1, pct)), toNext: next ? next.min - s.chakra : 0 };
}
export const isUnlocked = (unlockRank = 0) => !enabled() || rankOf(load().chakra).id >= unlockRank;
export const isDone = (id: string) => !!load().done[id];
export const seenCount = () => load().seen.length;

export interface DojoEvent { gained: number; reason: string; mission?: Mission; before: Rank; after: Rank; }

function apply(mutate: (s: State) => { gained: number; reason: string; mission?: Mission } | null): DojoEvent | null {
  if (!enabled()) return null;
  const s = load();
  const before = rankOf(s.chakra);
  const r = mutate(s);
  if (!r) return null;
  s.chakra += r.gained;
  save(s);
  const detail: DojoEvent = { ...r, before, after: rankOf(s.chakra) };
  window.dispatchEvent(new CustomEvent<DojoEvent>('dojo', { detail }));
  return detail;
}

/** Complete a one-off mission (no-op if already done). */
export function complete(id: string): DojoEvent | null {
  return apply(s => {
    if (s.done[id]) return null;
    const m = MISSIONS.find(x => x.id === id);
    if (!m) return null;
    s.done[id] = Date.now();
    return { gained: m.chakra, reason: m.title, mission: m };
  });
}

/** Note that a design was tried; completes Éclaireur at 5. */
export function see(designId: string) {
  if (!enabled()) return;
  const s = load();
  if (!s.seen.includes(designId)) { s.seen.push(designId); save(s); sync(); }
  const goal = MISSIONS.find(m => m.id === 'eclaireur')!.goal!;
  if (s.seen.length >= goal) complete('eclaireur');
}

/** Called once an order was actually sent (or its files handed over). */
export function recordOrder(): DojoEvent | null {
  return apply(s => {
    s.orders += 1;
    const first = MISSIONS.find(m => m.id === 'premiere-mission')!;
    if (!s.done[first.id]) { s.done[first.id] = Date.now(); return { gained: first.chakra, reason: first.title, mission: first }; }
    return { gained: REPEAT_ORDER_CHAKRA, reason: 'Nouvelle mission accomplie' };
  });
}

// ── Daily invocation ─────────────────────────────────────────────
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function rolledToday(): string | null {
  const s = load();
  return s.roll && s.roll.day === today() ? s.roll.id : null;
}
export function msUntilNextRoll(now = new Date()) {
  const t = new Date(now); t.setHours(24, 0, 0, 0);
  return t.getTime() - now.getTime();
}
/** Weighted random pick among the designs this customer can see. */
export function roll(pool: { id: string; rarity: Rarity }[], rnd = Math.random): string | null {
  if (!enabled() || !pool.length || rolledToday()) return null;
  const total = pool.reduce((n, d) => n + RARITY_WEIGHT[d.rarity], 0);
  let x = rnd() * total, id = pool[pool.length - 1].id;
  for (const d of pool) { x -= RARITY_WEIGHT[d.rarity]; if (x < 0) { id = d.id; break; } }
  apply(s => { s.roll = { day: today(), id }; return { gained: ROLL_CHAKRA, reason: 'Invocation du jour' }; });
  complete('invocation');
  return id;
}

export function reset() { save(fresh()); sync(); }

// ── Owner config (rewards per rank, secret designs) ─────────────
export interface DojoConfig {
  rewards: { rank: number; text: string }[];
  secrets: { id: string; name: string; rank: number }[];
}
export function readConfig(): DojoConfig {
  try {
    const c = JSON.parse(document.getElementById('dojo-config')?.textContent || '{}');
    return {
      rewards: (c.rewards ?? []).map((r: { rank: unknown; text: string }) => ({ rank: Number(r.rank), text: r.text })),
      secrets: c.secrets ?? [],
    };
  } catch { return { rewards: [], secrets: [] }; }
}
export const rewardsUpTo = (cfg: DojoConfig, rankId: number) => cfg.rewards.filter(r => r.rank <= rankId && r.text);

/** What goes into the order message. */
export function loyaltySummary(): { rank: string; chakra: number; rewards: string[] } | null {
  if (!enabled()) return null;
  const p = progress();
  if (!p.chakra) return null;
  return {
    rank: `${p.rank.name} ${p.rank.kanji}`,
    chakra: p.chakra,
    rewards: rewardsUpTo(readConfig(), p.rank.id).map(r => r.text),
  };
}
