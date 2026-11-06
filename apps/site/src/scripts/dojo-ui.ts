/**
 * Site-wide Dojo layer: header rank chip, "+chakra" toasts, level-up
 * screen, secret-design locks and page-visit missions.
 */
import {
  enabled, progress, complete, rankOf, readConfig, RANKS, load,
  type DojoEvent, type Rank,
} from '../lib/dojo';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderChips() {
  const p = progress();
  document.querySelectorAll<HTMLElement>('[data-dojo-chip]').forEach(chip => {
    chip.style.setProperty('--p', String(p.pct));
    chip.querySelector('.dc-kanji')!.textContent = p.rank.kanji;
    chip.querySelector('.dc-name')!.textContent = p.rank.name;
    chip.querySelector('.dc-pts')!.textContent = `${p.chakra} chakra`;
    chip.setAttribute('aria-label', `Le Dojo — rang ${p.rank.name}, ${p.chakra} chakra`
      + (p.next ? `, encore ${p.toNext} pour ${p.next.name}` : ''));
  });
}

function renderLocks() {
  const r = rankOf(load().chakra).id;
  const on = enabled();
  document.querySelectorAll<HTMLElement>('[data-unlock-rank]').forEach(el => {
    const need = Number(el.dataset.unlockRank || 0);
    const locked = on && need > r;
    el.classList.toggle('is-locked', locked);
    el.classList.toggle('is-secret', need > 0);
    if (locked) el.setAttribute('aria-label', `Design secret — débloqué au rang ${RANKS[need].name}`);
    else el.removeAttribute('aria-label');
    const label = el.querySelector<HTMLElement>('[data-lock-label]');
    if (label) label.textContent = label.dataset.lockLabel === 'short'
      ? (locked ? '🔒' : '✦')
      : (locked ? `🔒 ${RANKS[need].name} ${RANKS[need].kanji}` : '✦ Secret');
  });
}

// ── Toasts ───────────────────────────────────────────────────────
const queue: string[] = [];
let busy = false;
function toast(html: string) {
  queue.push(html);
  if (!busy) nextToast();
}
function nextToast() {
  const el = document.getElementById('dojo-toast');
  const html = queue.shift();
  if (!el || html === undefined) { busy = false; return; }
  busy = true;
  el.innerHTML = html;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; nextToast(); }, 250);
  }, 2600);
}

// ── Level-up ─────────────────────────────────────────────────────
function levelUp(from: Rank, to: Rank) {
  const box = document.getElementById('dojo-levelup');
  if (!box) return;
  const cfg = readConfig();
  const crossed = (id: number) => id > from.id && id <= to.id;
  const gifts = [
    ...cfg.rewards.filter(r => crossed(r.rank) && r.text).map(r => `🎁 ${r.text}`),
    ...cfg.secrets.filter(s => crossed(s.rank)).map(s => `🔓 Design secret débloqué : ${s.name}`),
  ];
  box.querySelector('.lu-kanji')!.textContent = to.kanji;
  box.querySelector('.lu-name')!.textContent = to.name;
  box.querySelector('.lu-motto')!.textContent = to.motto;
  const list = box.querySelector('.lu-gifts')!;
  list.innerHTML = '';
  for (const g of gifts) { const li = document.createElement('li'); li.textContent = g; list.appendChild(li); }
  (list as HTMLElement).hidden = !gifts.length;
  box.hidden = false;
  box.classList.remove('play'); void box.offsetWidth; box.classList.add('play');
  if (!reduceMotion()) burst(box.querySelector('.lu-stamp') as HTMLElement);
  (box.querySelector('.lu-ok') as HTMLElement).focus();
}
function closeLevelUp() {
  const box = document.getElementById('dojo-levelup');
  if (box) box.hidden = true;
}
/** A few shuriken flying out of the stamp. */
function burst(origin: HTMLElement) {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    s.className = 'dojo-shard';
    s.textContent = i % 3 ? '✦' : '✶';
    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const d = 110 + Math.random() * 90;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
    origin.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

function onDojo(e: Event) {
  const d = (e as CustomEvent<DojoEvent>).detail;
  renderChips(); renderLocks();
  if (!d || !d.gained) return;
  const p = progress();
  toast(`<b>+${d.gained}</b> <span class="dt-k">気</span> chakra · ${d.reason}`
    + (p.next ? `<small>encore ${p.toNext} pour ${p.next.name}</small>` : ''));
  if (d.after.id > d.before.id) levelUp(d.before, d.after);
}

export function initDojoUI() {
  renderChips(); renderLocks();
  if (!enabled()) return;

  window.addEventListener('dojo', onDojo);
  window.addEventListener('dojo:sync', () => { renderChips(); renderLocks(); });
  window.addEventListener('storage', (e) => { if (e.key === 'shinobi.dojo') { renderChips(); renderLocks(); } });

  // Locked secret designs in the galleries: send the customer to the dojo instead.
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.is-locked[data-unlock-rank]');
    if (!a) return;
    e.preventDefault();
    location.href = '/dojo/#rangs';
  });

  const box = document.getElementById('dojo-levelup');
  box?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-lu-close]')) closeLevelUp();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && !box.hidden) closeLevelUp(); });

  // Page-visit missions.
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/custom') complete('dojo');
  if (path === '/infos') complete('parchemin');
}
