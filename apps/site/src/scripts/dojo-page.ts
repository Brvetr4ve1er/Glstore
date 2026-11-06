/** /dojo/ page: rank card, ladder, missions, daily invocation, share mission. */
import {
  enabled, progress, load, MISSIONS, RARITY_LABEL, complete, roll, rolledToday,
  msUntilNextRoll, isUnlocked, reset, type Rarity,
} from '../lib/dojo';
import { copyText } from '../lib/order';

interface PoolItem { id: string; name: string; anime: string; image: string | null; emoji: string | null; rarity: Rarity; unlockRank: number; }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function thumb(d: PoolItem): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return d.image
    ? `<img src="${esc(d.image)}" alt="" style="width:70%;height:70%;object-fit:contain">`
    : `<span>${esc(d.emoji || '🥷')}</span>`;
}

function renderStatus() {
  const p = progress();
  const s = load();
  const set = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };
  set('rc-kanji', p.rank.kanji);
  set('rc-name', p.rank.name);
  set('rc-chakra', String(p.chakra));
  set('rc-next', p.next ? `Encore ${p.toNext} chakra pour ${p.next.name} ${p.next.kanji}` : 'Rang maximal atteint — respect, Shinobi. 🙇');
  const fill = $('rc-fill'); if (fill) fill.style.width = `${Math.round(p.pct * 100)}%`;
  $('rc-bar')?.setAttribute('aria-valuenow', String(Math.round(p.pct * 100)));

  document.querySelectorAll<HTMLElement>('.rung').forEach(r => {
    const id = Number(r.dataset.rank);
    r.classList.toggle('reached', id <= p.rank.id);
    r.classList.toggle('current', id === p.rank.id);
  });

  let done = 0;
  document.querySelectorAll<HTMLElement>('[data-mission]').forEach(li => {
    const id = li.dataset.mission!;
    const ok = !!s.done[id];
    if (ok) done++;
    li.classList.toggle('done', ok);
    const prog = li.querySelector('.m-prog');
    if (prog && li.dataset.goal) prog.textContent = ok ? '' : `${Math.min(s.seen.length, Number(li.dataset.goal))}/${li.dataset.goal}`;
  });
  const mc = $('m-count'); if (mc) mc.textContent = `Missions · ${done}/${MISSIONS.length}`;
}

function wireInvocation(pool: PoolItem[]) {
  const btn = $<HTMLButtonElement>('inv-btn'), go = $<HTMLAnchorElement>('inv-go'), wait = $('inv-wait');
  const card = $('inv-card'), th = $('inv-thumb'), rar = $('inv-rarity'), nm = $('inv-name');
  if (!btn || !go || !wait || !card || !th || !rar || !nm) return;

  const show = (d: PoolItem) => {
    card.dataset.rarity = d.rarity;
    th.innerHTML = thumb(d);
    rar.textContent = RARITY_LABEL[d.rarity];
    nm.textContent = d.name;
    go.href = `/custom/?design=${encodeURIComponent(d.id)}`;
    go.hidden = false; btn.hidden = true;
  };
  let timer = 0;
  const tick = () => {
    const ms = msUntilNextRoll();
    const h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60;
    wait.textContent = `Prochaine invocation dans ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    wait.hidden = false;
    if (ms < 1000) location.reload();
  };
  const startWait = () => { tick(); clearInterval(timer); timer = window.setInterval(tick, 1000); };

  const already = rolledToday();
  const prev = already && pool.find(d => d.id === already);
  if (prev) { show(prev); startWait(); }

  btn.addEventListener('click', async () => {
    const available = pool.filter(d => isUnlocked(d.unlockRank));
    btn.disabled = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      card.classList.add('spinning');
      rar.textContent = 'Invocation…'; nm.textContent = '…';
      let delay = 50;
      for (let i = 0; i < 16; i++) {
        th.innerHTML = thumb(available[i % available.length]);
        await new Promise(r => setTimeout(r, delay));
        delay *= 1.14;
      }
      card.classList.remove('spinning');
    }
    const id = roll(available);
    const d = available.find(x => x.id === id);
    btn.disabled = false;
    if (!d) return;
    show(d);
    card.classList.remove('reveal'); void card.offsetWidth; card.classList.add('reveal');
    startWait();
  });
}

function wireShare() {
  const b = $<HTMLButtonElement>('allie');
  if (!b) return;
  b.addEventListener('click', async () => {
    const url = location.origin + '/';
    const data = { title: 'SHINOBI', text: "Crée ton t-shirt anime perso chez SHINOBI 🥷", url };
    try {
      if (typeof navigator.share === 'function') { await navigator.share(data); complete('allie'); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    if (await copyText(url)) { b.textContent = 'Lien copié ✓'; complete('allie'); }
  });
}

export function initDojoPage() {
  if (!enabled() || !$('rank-card')) return;
  const pool: PoolItem[] = JSON.parse($('dojo-pool')?.textContent || '[]');
  renderStatus();
  wireInvocation(pool);
  wireShare();
  window.addEventListener('dojo', renderStatus);
  window.addEventListener('dojo:sync', renderStatus);
  window.addEventListener('storage', renderStatus);
  $('dojo-reset')?.addEventListener('click', () => {
    if (confirm('Effacer ta progression au dojo sur cet appareil ?')) { reset(); location.reload(); }
  });
}
