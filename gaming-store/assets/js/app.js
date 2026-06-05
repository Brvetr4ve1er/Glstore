/* =================================================================
   GLAIVE — application logic
   - shared header/footer/drawer/modal injection
   - cart + wishlist (localStorage)
   - sale-aware pricing, quick-view modal, recently-viewed
   - homepage / shop / product / checkout rendering
   - filters, sort, search, reveal-on-scroll, toast, a11y
   ================================================================= */
(function () {
  const { ART, ICON, PRODUCTS, CATEGORIES, WILAYAS, REVIEWS } = window.GLAIVE;
  const money = (n) => '$' + n.toFixed(2);
  const eff = (p) => (p.sale != null ? p.sale : p.price);              // effective price
  const savePct = (p) => (p.sale != null ? Math.round((1 - p.sale / p.price) * 100) : 0);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const param = (k) => new URLSearchParams(location.search).get(k);

  /* ---------- localStorage stores ---------- */
  function makeListStore(key, onChange) {
    return {
      read() { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } },
      write(v) { localStorage.setItem(key, JSON.stringify(v)); onChange(); },
    };
  }

  const Cart = (() => {
    const s = makeListStore('glaive.cart', () => renderCart());
    return {
      ...s,
      add(id, qty = 1) {
        const items = s.read();
        const line = items.find((i) => i.id === id);
        if (line) line.qty += qty; else items.push({ id, qty });
        s.write(items);
        toast(`Added — ${byId(id).name}`);
        openDrawer();
      },
      setQty(id, qty) {
        let items = s.read();
        if (qty <= 0) items = items.filter((i) => i.id !== id);
        else { const l = items.find((i) => i.id === id); if (l) l.qty = qty; }
        s.write(items);
      },
      remove(id) { s.write(s.read().filter((i) => i.id !== id)); },
      count() { return s.read().reduce((n, i) => n + i.qty, 0); },
      subtotal() { return s.read().reduce((t, i) => t + eff(byId(i.id)) * i.qty, 0); },
      clear() { s.write([]); },
    };
  })();

  const Wish = (() => {
    const s = makeListStore('glaive.wish', () => renderWishCount());
    return {
      ...s,
      has(id) { return s.read().includes(id); },
      toggle(id) {
        const w = s.read();
        const i = w.indexOf(id);
        if (i >= 0) { w.splice(i, 1); toast('Removed from saved'); }
        else { w.push(id); toast(`Saved — ${byId(id).name}`); }
        s.write(w);
      },
      count() { return s.read().length; },
    };
  })();

  const Compare = (() => {
    const s = makeListStore('glaive.compare', () => { renderCompareTray(); if (document.getElementById('compareRoot')) renderCompare(); });
    return {
      ...s,
      has(id) { return s.read().includes(id); },
      toggle(id) {
        const c = s.read();
        const i = c.indexOf(id);
        if (i >= 0) { c.splice(i, 1); }
        else { if (c.length >= 4) { toast('Compare up to 4 items'); return; } c.push(id); }
        s.write(c);
        refreshCompareUI(id);
      },
      remove(id) { s.write(s.read().filter((x) => x !== id)); refreshCompareUI(id); },
      clear() { s.write([]); document.querySelectorAll('[data-compare]').forEach((b) => setCompareBtn(b, false)); },
      count() { return s.read().length; },
    };
  })();

  const Recent = {
    key: 'glaive.recent',
    read() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
    push(id) {
      let r = this.read().filter((x) => x !== id);
      r.unshift(id);
      localStorage.setItem(this.key, JSON.stringify(r.slice(0, 8)));
    },
  };

  /* ---------- price markup ---------- */
  function priceHTML(p) {
    if (p.sale != null) {
      return `<div class="price"><span class="now">${money(p.sale)}</span><span class="was">${money(p.price)}</span><span class="save">-${savePct(p)}%</span></div>`;
    }
    return `<div class="price"><span class="now">${money(p.price)}</span></div>`;
  }

  /* ---------- templates ---------- */
  function navMarkup() {
    const cols = CATEGORIES.map((c) => `<a href="shop.html?cat=${encodeURIComponent(c.name)}">${c.name}</a>`).join('');
    return `
    <div class="topbar">Free 2-day shipping over $50 · 25 years of For Glory · Members get early drops</div>
    <header class="header">
      <div class="container nav">
        <a class="brand" href="index.html"><span class="mark">▲</span>GLAIVE</a>
        <ul class="nav-links">
          <li class="nav-item" data-mega="shop">
            <button aria-haspopup="true" aria-expanded="false">Shop ${ICON.chevron}</button>
            <div class="megamenu"><div class="container">
              <div class="mega-col"><h4>Audio</h4><a href="shop.html?cat=Headsets">Gaming Headsets</a><a href="shop.html?cat=Accessories">GameDAC</a><a href="shop.html?cat=Headsets">Wireless</a></div>
              <div class="mega-col"><h4>Desk</h4><a href="shop.html?cat=Keyboards">Keyboards</a><a href="shop.html?cat=Mice">Mice</a><a href="shop.html?cat=Mousepads">Mousepads</a></div>
              <div class="mega-col"><h4>Console</h4><a href="shop.html?cat=Controllers">Controllers</a><a href="shop.html?cat=Headsets">PlayStation</a><a href="shop.html?cat=Headsets">Xbox</a></div>
              <div class="mega-col"><h4>Collections</h4><a href="shop.html?sort=new">New Arrivals</a><a href="shop.html?tag=pro">Pro Series</a><a href="shop.html?sort=price-asc">Under $50</a><a href="quiz.html">Find your gear →</a></div>
              <div class="mega-feature">
                <div><span class="eyebrow">Flagship</span><h3>Arctis Nova Elite</h3><p class="muted">Hi-Res wireless, redefined.</p></div>
                <a class="btn btn--primary" href="product.html?id=arctis-nova-elite">Discover</a>
              </div>
            </div></div>
          </li>
          <li><a href="software.html">Software</a></li>
          <li><a href="quiz.html">Find Your Gear</a></li>
          <li><a href="index.html#support">Support</a></li>
        </ul>
        <div class="nav-actions">
          <button class="icon-btn" data-search aria-label="Search">${ICON.search}</button>
          <a class="icon-btn" href="shop.html?wish=1" aria-label="Saved items">${ICON.heart}<span class="cart-count" data-wishcount data-count="0">0</span></a>
          <a class="icon-btn" href="#account" aria-label="Account">${ICON.user}</a>
          <button class="icon-btn" data-open-cart aria-label="Cart">${ICON.cart}<span class="cart-count" data-cartcount data-count="0">0</span></button>
          <button class="icon-btn hamburger" data-open-mobile aria-label="Menu">${ICON.menu}</button>
        </div>
      </div>
    </header>
    <nav class="mobile-drawer" id="mobileDrawer" aria-label="Mobile">
      <button class="icon-btn" data-close-mobile aria-label="Close" style="margin-left:auto">${ICON.close}</button>
      <a href="index.html">Home</a>${cols}
      <a href="shop.html?wish=1">Saved Items</a>
      <a href="quiz.html">Find Your Gear</a>
      <a href="software.html">Software</a><a href="index.html#support">Support</a>
    </nav>`;
  }

  function footerMarkup() {
    return `
    <footer class="footer" id="support">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="index.html"><span class="mark">▲</span>GLAIVE</a>
            <p>Pro-grade gaming gear engineered with and for the world’s best players. For Glory.</p>
            <div class="socials">
              <a href="#" aria-label="X">${ICON.twitter}</a>
              <a href="#" aria-label="YouTube">${ICON.youtube}</a>
              <a href="#" aria-label="Instagram">${ICON.instagram}</a>
              <a href="#" aria-label="Twitch">${ICON.twitch}</a>
            </div>
          </div>
          <div><h4>Shop</h4><a href="shop.html?cat=Headsets">Headsets</a><a href="shop.html?cat=Keyboards">Keyboards</a><a href="shop.html?cat=Mice">Mice</a><a href="shop.html?cat=Mousepads">Mousepads</a><a href="shop.html?cat=Controllers">Controllers</a></div>
          <div><h4>Software</h4><a href="software.html">GLAIVE GG</a><a href="software.html">Sonar Audio</a><a href="software.html">Engine</a><a href="software.html">Moments</a></div>
          <div><h4>Support</h4><a href="index.html#support">Help Center</a><a href="index.html#support">Warranty</a><a href="index.html#support">Downloads</a><a href="index.html#support">Register Product</a><a href="index.html#support">Contact</a></div>
          <div><h4>Company</h4><a href="#">About</a><a href="#">Pro Athletes</a><a href="#">Careers</a><a href="#">Press</a><a href="#">Sustainability</a></div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} GLAIVE Gaming. A first-principles tribute build. Not affiliated with SteelSeries.</span>
          <span>Privacy · Terms · Cookies · Accessibility</span>
        </div>
      </div>
    </footer>`;
  }

  function overlaysMarkup() {
    return `
    <div class="scrim" data-scrim></div>
    <aside class="drawer" id="cartDrawer" aria-label="Shopping cart" aria-hidden="true">
      <div class="drawer-head"><h3>Your Cart</h3><button class="icon-btn" data-close-cart aria-label="Close">${ICON.close}</button></div>
      <div class="drawer-body" id="cartBody"></div>
      <div class="drawer-foot" id="cartFoot"></div>
    </aside>
    <div class="modal" id="quickModal" role="dialog" aria-modal="true" aria-hidden="true"><div class="modal-card" id="quickCard"></div></div>
    <div class="search-overlay" id="searchOverlay" role="dialog" aria-modal="true" aria-label="Search" aria-hidden="true">
      <div class="search-panel">
        <div class="search-input-wrap">
          ${ICON.search}
          <input id="searchInput" type="search" placeholder="Search headsets, mice, keyboards…" autocomplete="off" aria-label="Search products" aria-controls="searchResults" />
          <kbd>ESC</kbd>
        </div>
        <div class="search-results" id="searchResults" role="listbox"></div>
      </div>
    </div>
    <div class="compare-tray" id="compareTray" aria-live="polite"></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  }

  function productCard(p) {
    const saved = Wish.has(p.id);
    return `
    <article class="card reveal" data-id="${p.id}">
      <div class="card-media">
        <a class="media-link" href="product.html?id=${p.id}" aria-label="${p.name}">${ART[p.type]}</a>
        ${p.badge ? `<span class="badge ${p.badge === 'Pro' ? 'badge--ghost' : ''}">${p.badge}</span>` : ''}
        ${p.sale != null ? `<span class="badge badge--sale">Save ${savePct(p)}%</span>` : ''}
        <button class="wishlist icon-btn ${saved ? 'active' : ''}" data-wish="${p.id}" aria-pressed="${saved}" aria-label="Save ${p.name}">${saved ? ICON.heartFill : ICON.heart}</button>
        <button class="btn btn--ghost quickview" data-quick="${p.id}">${ICON.eye} Quick view</button>
      </div>
      <div class="card-body">
        <span class="card-cat">${p.cat}</span>
        <a href="product.html?id=${p.id}"><h3 class="card-title">${p.name}</h3></a>
        <span class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating} (${p.reviews})</span>
        <button class="compare-toggle ${Compare.has(p.id) ? 'active' : ''}" data-compare="${p.id}" aria-pressed="${Compare.has(p.id)}">${Compare.has(p.id) ? '✓ Comparing' : '⇄ Compare'}</button>
        <div class="card-foot">
          ${priceHTML(p)}
          <button class="btn btn--primary" data-add="${p.id}">Add</button>
        </div>
      </div>
    </article>`;
  }

  /* ---------- mount shared chrome ---------- */
  function mountChrome() {
    const nav = $('#nav'); if (nav) nav.innerHTML = navMarkup();
    const foot = $('#footer'); if (foot) foot.innerHTML = footerMarkup();
    document.body.insertAdjacentHTML('beforeend', overlaysMarkup());
    wireChrome();
    renderCart();
    renderWishCount();
    renderCompareTray();
  }

  function wireChrome() {
    $$('.nav-item[data-mega]').forEach((item) => {
      const btn = $('button', item);
      const open = () => { closeMegas(); item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); };
      const close = () => { item.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
      item.addEventListener('mouseenter', open);
      item.addEventListener('mouseleave', close);
      btn.addEventListener('click', (e) => { e.preventDefault(); item.classList.contains('open') ? close() : open(); });
    });
    function closeMegas() { $$('.nav-item.open').forEach((i) => i.classList.remove('open')); }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeMegas(); closeDrawer(); closeMobile(); closeModal(); closeSearch(); }
      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    });
    on('[data-open-cart]', 'click', openDrawer);
    on('[data-close-cart]', 'click', closeDrawer);
    on('[data-scrim]', 'click', () => { closeDrawer(); closeMobile(); closeModal(); });
    on('[data-open-mobile]', 'click', openMobile);
    on('[data-close-mobile]', 'click', closeMobile);
    on('[data-search]', 'click', openSearch);
    wireSearch();

    // delegated actions
    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) { closeModal(); Cart.add(add.dataset.add); return; }
      const wish = e.target.closest('[data-wish]');
      if (wish) { e.preventDefault(); Wish.toggle(wish.dataset.wish); refreshWishUI(wish.dataset.wish); return; }
      const quick = e.target.closest('[data-quick]');
      if (quick) { e.preventDefault(); openQuick(quick.dataset.quick); return; }
      const cmp = e.target.closest('[data-compare]');
      if (cmp) { e.preventDefault(); Compare.toggle(cmp.dataset.compare); return; }
    });
  }

  function on(sel, ev, fn) { $$(sel).forEach((el) => el.addEventListener(ev, fn)); }

  /* ---------- overlay management ---------- */
  const scrim = () => $('[data-scrim]');
  const anyOpen = () => $('.drawer.open, .mobile-drawer.open, .modal.open');
  function syncScrim() { anyOpen() ? scrim()?.classList.add('open') : scrim()?.classList.remove('open'); }
  function openDrawer() { $('#cartDrawer').classList.add('open'); $('#cartDrawer').setAttribute('aria-hidden', 'false'); syncScrim(); }
  function closeDrawer() { const d = $('#cartDrawer'); if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); } syncScrim(); }
  function openMobile() { $('#mobileDrawer').classList.add('open'); syncScrim(); }
  function closeMobile() { $('#mobileDrawer')?.classList.remove('open'); syncScrim(); }
  function closeModal() { const m = $('#quickModal'); if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); } syncScrim(); }

  /* ---------- search overlay ---------- */
  let searchIdx = -1, searchHits = [];
  function openSearch() { const o = $('#searchOverlay'); o.classList.add('open'); o.setAttribute('aria-hidden', 'false'); setTimeout(() => $('#searchInput').focus(), 50); }
  function closeSearch() { const o = $('#searchOverlay'); if (o) { o.classList.remove('open'); o.setAttribute('aria-hidden', 'true'); } }
  function wireSearch() {
    const input = $('#searchInput'), out = $('#searchResults');
    if (!input) return;
    const run = () => {
      const q = input.value.trim().toLowerCase();
      searchIdx = -1;
      if (!q) { out.innerHTML = ''; searchHits = []; return; }
      searchHits = PRODUCTS.filter((p) => (p.name + ' ' + p.cat + ' ' + p.blurb + ' ' + p.tag.join(' ')).toLowerCase().includes(q)).slice(0, 6);
      out.innerHTML = searchHits.length
        ? searchHits.map((p, i) => `
          <a class="search-hit" role="option" data-i="${i}" href="product.html?id=${p.id}">
            <div class="thumb">${ART[p.type]}</div>
            <div class="info"><strong>${p.name}</strong><span>${p.cat}</span></div>
            <div class="price"><span class="now">${money(eff(p))}</span></div>
          </a>`).join('')
          + `<div class="search-empty"><a href="shop.html?q=${encodeURIComponent(input.value)}">See all results for “${input.value}” →</a></div>`
        : `<div class="search-empty">No matches for “${input.value}”. Try “headset”, “wireless” or “apex”.</div>`;
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); searchIdx = Math.min(searchIdx + 1, searchHits.length - 1); markHit(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); searchIdx = Math.max(searchIdx - 1, 0); markHit(); }
      else if (e.key === 'Enter') {
        if (searchIdx >= 0 && searchHits[searchIdx]) location.href = `product.html?id=${searchHits[searchIdx].id}`;
        else if (input.value.trim()) location.href = `shop.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    });
    function markHit() { $$('.search-hit', out).forEach((el, i) => el.classList.toggle('active', i === searchIdx)); }
  }

  function openQuick(id) {
    const p = byId(id); if (!p) return;
    $('#quickCard').innerHTML = `
      <div class="modal-media">${ART[p.type]}</div>
      <div class="modal-body">
        <button class="icon-btn modal-close" data-close-modal aria-label="Close">${ICON.close}</button>
        <span class="eyebrow">${p.cat}${p.badge ? ' · ' + p.badge : ''}</span>
        <h3>${p.name}</h3>
        <span class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating} · ${p.reviews} reviews</span>
        ${priceHTML(p)}
        <p class="muted" style="font-size:.9rem">${p.blurb}</p>
        <div style="display:flex;gap:.75rem;margin-top:auto">
          <button class="btn btn--primary btn--block" data-add="${p.id}">Add to Cart</button>
          <a class="btn btn--ghost" href="product.html?id=${p.id}">Details</a>
        </div>
      </div>`;
    $('[data-close-modal]', $('#quickCard')).addEventListener('click', closeModal);
    const m = $('#quickModal'); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); syncScrim();
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }

  /* ---------- wishlist UI sync ---------- */
  function renderWishCount() { $$('[data-wishcount]').forEach((el) => { const n = Wish.count(); el.textContent = n; el.dataset.count = n; }); }
  function refreshWishUI(id) {
    const saved = Wish.has(id);
    $$(`[data-wish="${id}"]`).forEach((b) => { b.classList.toggle('active', saved); b.setAttribute('aria-pressed', saved); b.innerHTML = saved ? ICON.heartFill : ICON.heart; });
  }

  /* ---------- compare UI sync ---------- */
  function setCompareBtn(b, on) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); b.textContent = on ? '✓ Comparing' : '⇄ Compare'; }
  function refreshCompareUI(id) { $$(`[data-compare="${id}"]`).forEach((b) => setCompareBtn(b, Compare.has(id))); }
  function renderCompareTray() {
    const tray = $('#compareTray'); if (!tray) return;
    const ids = Compare.read();
    if (!ids.length) { tray.classList.remove('show'); tray.innerHTML = ''; return; }
    const slots = [0, 1, 2, 3].map((i) => {
      const id = ids[i];
      if (!id) return `<div class="slot empty-slot"></div>`;
      const p = byId(id);
      return `<div class="slot" title="${p.name}">${ART[p.type]}<button data-uncompare="${id}" aria-label="Remove ${p.name}">×</button></div>`;
    }).join('');
    tray.innerHTML = `
      <span class="ct-label">Compare</span>
      <div class="slots">${slots}</div>
      <a class="btn btn--primary" href="compare.html" ${ids.length < 2 ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>Compare (${ids.length})</a>
      <button class="clear" data-clear-compare>Clear</button>`;
    tray.classList.add('show');
    $$('[data-uncompare]', tray).forEach((b) => b.onclick = () => Compare.remove(b.dataset.uncompare));
    $('[data-clear-compare]', tray).onclick = () => Compare.clear();
  }

  /* ---------- cart drawer ---------- */
  function renderCart() {
    $$('[data-cartcount]').forEach((el) => { const n = Cart.count(); el.textContent = n; el.dataset.count = n; });
    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!body) return;
    const items = Cart.read();
    if (!items.length) {
      body.innerHTML = `<div class="cart-empty"><p>Your cart is empty.</p><a class="btn btn--ghost" href="shop.html" style="margin-top:1rem">Browse gear</a></div>`;
      foot.innerHTML = ''; return;
    }
    body.innerHTML = items.map((i) => { const p = byId(i.id); return `
      <div class="cart-line">
        <div class="thumb">${ART[p.type]}</div>
        <div class="meta">
          <strong>${p.name}</strong><span>${p.cat}</span>
          <div class="qty">
            <button data-dec="${p.id}" aria-label="Decrease quantity">−</button>
            <span aria-label="Quantity">${i.qty}</span>
            <button data-inc="${p.id}" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div style="text-align:right"><div class="price"><span class="now" style="font-size:1rem">${money(eff(p) * i.qty)}</span></div><button class="rm" data-rm="${p.id}">Remove</button></div>
      </div>`; }).join('');
    const sub = Cart.subtotal();
    const ship = sub > 50 || sub === 0 ? 0 : 6.99;
    foot.innerHTML = `
      <div class="summary-row"><span>Subtotal</span><span>${money(sub)}</span></div>
      <div class="summary-row"><span>Shipping</span><span>${ship ? money(ship) : 'FREE'}</span></div>
      <div class="summary-row total"><span>Total</span><span>${money(sub + ship)}</span></div>
      <a class="btn btn--primary btn--block btn--lg" style="margin-top:1rem" href="checkout.html">Checkout</a>`;
    const qtyOf = (id) => Cart.read().find((i) => i.id === id)?.qty || 0;
    $$('[data-inc]').forEach((b) => b.onclick = () => Cart.setQty(b.dataset.inc, qtyOf(b.dataset.inc) + 1));
    $$('[data-dec]').forEach((b) => b.onclick = () => Cart.setQty(b.dataset.dec, qtyOf(b.dataset.dec) - 1));
    $$('[data-rm]').forEach((b) => b.onclick = () => Cart.remove(b.dataset.rm));
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    $$('.reveal:not(.in)').forEach((el) => io.observe(el));
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    const rail = $('#catRail');
    if (rail) rail.innerHTML = CATEGORIES.map((c) => `
      <a class="cat-card reveal" href="shop.html?cat=${encodeURIComponent(c.name)}">
        <div class="cat-art">${ART[c.type]}</div>
        <h3>${c.name}</h3><span>${c.tagline} →</span>
      </a>`).join('');
    const feat = $('#featured');
    if (feat) feat.innerHTML = PRODUCTS.filter((p) => p.badge).slice(0, 8).map(productCard).join('');
    const best = $('#bestsellers');
    if (best) best.innerHTML = [...PRODUCTS].sort((a, b) => b.reviews - a.reviews).slice(0, 4).map(productCard).join('');
    renderRecent('#recentRail', '#recentSection');
  }

  function renderRecent(railSel, sectionSel) {
    const rail = $(railSel); if (!rail) return;
    const ids = Recent.read().filter((id, i) => id !== param('id') && i < 4);
    const items = ids.map(byId).filter(Boolean);
    if (!items.length) { const sec = $(sectionSel); if (sec) sec.style.display = 'none'; return; }
    rail.innerHTML = items.map(productCard).join('');
  }

  /* ---------- SHOP ---------- */
  function renderShop() {
    const root = $('#shopRoot'); if (!root) return;
    const state = {
      cats: new Set(param('cat') ? [param('cat')] : []),
      q: param('q') || '', tag: param('tag') || '', wish: param('wish') === '1',
      sort: param('sort') || 'featured', max: Infinity,
    };
    const allCats = [...new Set(PRODUCTS.map((p) => p.cat))];
    $('#filterCats').innerHTML = allCats.map((c) => `<label class="check"><input type="checkbox" value="${c}" ${state.cats.has(c) ? 'checked' : ''}> ${c}</label>`).join('');
    $('#shopTitle').textContent = state.wish ? 'Saved Items' : state.q ? `Results for “${state.q}”` : (state.cats.size === 1 ? [...state.cats][0] : 'All Gear');

    function apply() {
      let list = PRODUCTS.slice();
      if (state.wish) list = list.filter((p) => Wish.has(p.id));
      if (state.cats.size) list = list.filter((p) => state.cats.has(p.cat));
      if (state.tag) list = list.filter((p) => p.tag.includes(state.tag) || (state.tag === 'pro' && p.badge === 'Pro'));
      if (state.q) { const q = state.q.toLowerCase(); list = list.filter((p) => (p.name + p.cat + p.blurb).toLowerCase().includes(q)); }
      if (state.max !== Infinity) list = list.filter((p) => eff(p) <= state.max);
      const sorters = {
        featured: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.reviews - a.reviews,
        new: (a, b) => (b.badge === 'New' ? 1 : 0) - (a.badge === 'New' ? 1 : 0),
        'price-asc': (a, b) => eff(a) - eff(b),
        'price-desc': (a, b) => eff(b) - eff(a),
        rating: (a, b) => b.rating - a.rating,
      };
      list.sort(sorters[state.sort] || sorters.featured);
      $('#grid').innerHTML = list.length ? list.map(productCard).join('')
        : `<p class="muted" style="grid-column:1/-1;padding:3rem 0">${state.wish ? 'No saved items yet — tap the ♥ on any product.' : 'No products match your filters.'}</p>`;
      $('#count').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
      initReveal();
    }
    $('#filterCats').addEventListener('change', (e) => { const cb = e.target; cb.checked ? state.cats.add(cb.value) : state.cats.delete(cb.value); apply(); });
    $$('#priceFilter input').forEach((r) => r.addEventListener('change', (e) => { state.max = Number(e.target.value) || Infinity; apply(); }));
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
    apply();
  }

  /* ---------- PRODUCT ---------- */
  function renderProduct() {
    const root = $('#pdpRoot'); if (!root) return;
    const p = byId(param('id')) || PRODUCTS[0];
    document.title = `${p.name} — GLAIVE`;
    Recent.push(p.id);
    const saved = Wish.has(p.id);
    const colorSw = p.colors.map((c, i) => `<button class="swatch" style="background:${c}" aria-current="${i === 0}" aria-label="Color ${i + 1}"></button>`).join('');
    const specRows = Object.entries(p.specs).map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');
    root.innerHTML = `
      <div class="breadcrumbs"><a href="index.html">Home</a> / <a href="shop.html?cat=${p.cat}">${p.cat}</a> / ${p.name}</div>
      <div class="pdp">
        <div class="pdp-gallery">
          <div class="pdp-hero" id="pdpHero">${ART[p.type]}</div>
          <div class="pdp-thumbs">${[1, 2, 3].map((n) => `<button aria-current="${n === 1}">${ART[p.type]}</button>`).join('')}</div>
        </div>
        <div class="pdp-info">
          <span class="eyebrow">${p.cat}${p.badge ? ' · ' + p.badge : ''}</span>
          <h1>${p.name}</h1>
          <span class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating} · ${p.reviews} reviews</span>
          <div class="pdp-price"><span class="now">${money(eff(p))}</span>${p.sale != null ? `<span class="was">${money(p.price)}</span><span class="save">Save ${savePct(p)}%</span>` : ''}<span class="muted">or ${money(eff(p) / 4)}/mo</span></div>
          <p class="pdp-desc">${p.blurb}</p>
          <div><h4 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--c-text-faint);margin-bottom:.5rem">Color</h4><div class="swatches">${colorSw}</div></div>
          <div class="buy-row">
            <button class="btn btn--primary btn--lg" data-add="${p.id}" style="flex:1">Add to Cart — ${money(eff(p))}</button>
            <button class="btn btn--ghost btn--lg wishlist-btn ${saved ? 'active' : ''}" data-wish="${p.id}" aria-pressed="${saved}" aria-label="Save">${saved ? ICON.heartFill : ICON.heart}</button>
          </div>
          <div class="trust" style="border:none;grid-template-columns:1fr 1fr">
            <div class="t">${ICON.ship}<div><strong>Free shipping</strong><span>Orders over $50</span></div></div>
            <div class="t">${ICON.shield}<div><strong>2-year warranty</strong><span>Register for +1 year</span></div></div>
          </div>
          <h2 style="font-size:1.4rem;text-transform:uppercase;margin-top:2rem">Specifications</h2>
          <div class="spec-list">${specRows}</div>
        </div>
      </div>
      ${buildReviews(p)}`;
    $$('.pdp-thumbs button').forEach((b) => b.onclick = () => { $$('.pdp-thumbs button').forEach((x) => x.setAttribute('aria-current', 'false')); b.setAttribute('aria-current', 'true'); });
    $$('.swatch').forEach((b) => b.onclick = () => { $$('.swatch').forEach((x) => x.setAttribute('aria-current', 'false')); b.setAttribute('aria-current', 'true'); });
    const rel = $('#related');
    if (rel) {
      const related = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id);
      rel.innerHTML = (related.length ? related : PRODUCTS.filter((x) => x.id !== p.id)).slice(0, 4).map(productCard).join('');
    }
    // sticky mobile buy bar
    document.body.classList.add('has-buybar');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="buybar">
        <div><div class="bb-price">${money(eff(p))}</div></div>
        <button class="btn btn--primary" data-add="${p.id}">Add to Cart</button>
      </div>`);
    initReveal();
  }

  /* ---------- reviews block ---------- */
  function buildReviews(p) {
    // deterministic distribution skewed by the product's average rating
    const total = p.reviews;
    const r = p.rating;
    const dist = {
      5: Math.round(total * (r >= 4.8 ? 0.82 : r >= 4.6 ? 0.7 : 0.6)),
      4: Math.round(total * 0.2),
      3: Math.round(total * 0.06),
      2: Math.round(total * 0.02),
      1: Math.round(total * 0.015),
    };
    const max = Math.max(...Object.values(dist), 1);
    const bars = [5, 4, 3, 2, 1].map((s) => `
      <div class="review-bar"><span>${s} ★</span><div class="track"><div class="fill" style="width:${(dist[s] / max) * 100}%"></div></div><span>${dist[s]}</span></div>`).join('');
    // pick 4 snippets seeded by product id length so each PDP differs but is stable
    const seed = p.id.length;
    const picks = [0, 1, 2, 3].map((i) => REVIEWS[(seed + i) % REVIEWS.length]);
    const cards = picks.map((rv) => `
      <article class="review">
        <div class="review-head"><strong>${rv.n}</strong><span class="verified">${ICON.check} Verified buyer</span></div>
        <span class="stars">${'★'.repeat(rv.r)}${'☆'.repeat(5 - rv.r)}</span>
        <h4>${rv.t}</h4>
        <p>${rv.b}</p>
      </article>`).join('');
    return `
      <section class="reviews">
        <h2>Reviews</h2>
        <div class="review-summary">
          <div class="review-score">
            <div class="big">${p.rating.toFixed(1)}</div>
            <div class="stars">${'★'.repeat(Math.round(p.rating))}</div>
            <span>${total.toLocaleString()} reviews</span>
          </div>
          <div class="review-bars">${bars}</div>
        </div>
        <div class="review-list">${cards}</div>
      </section>`;
  }

  /* ---------- CHECKOUT ---------- */
  function renderCheckout() {
    const root = $('#checkoutRoot'); if (!root) return;
    const items = Cart.read();
    if (!items.length) {
      root.innerHTML = `<div class="cart-empty" style="padding:5rem 0"><h2 style="font-family:var(--font-display);text-transform:uppercase">Your cart is empty</h2><p class="muted" style="margin:1rem 0">Add some gear before checking out.</p><a class="btn btn--primary" href="shop.html">Shop now</a></div>`;
      return;
    }
    const sub = Cart.subtotal();
    const ship = sub > 50 ? 0 : 6.99;
    const total = sub + ship;
    const lines = items.map((i) => { const p = byId(i.id); return `
      <div class="osum-line">
        <div class="thumb">${ART[p.type]}</div>
        <div><strong style="font-weight:700">${p.name}</strong><div class="muted" style="font-size:.75rem">Qty ${i.qty}</div></div>
        <span>${money(eff(p) * i.qty)}</span>
      </div>`; }).join('');
    const wilOpts = WILAYAS.map((w) => `<option value="${w}">${w}</option>`).join('');
    root.innerHTML = `
      <div class="breadcrumbs"><a href="index.html">Home</a> / <a href="shop.html">Shop</a> / Checkout</div>
      <h1 style="font-family:var(--font-display);text-transform:uppercase;font-size:var(--fs-600);margin:0 0 2rem">Checkout</h1>
      <form class="checkout" id="checkoutForm" novalidate>
        <div>
          <section style="margin-bottom:2.5rem">
            <h2>Contact</h2>
            <div class="field"><label for="cname">Full name</label><input class="input" id="cname" name="name" required placeholder="Lara Croft"></div>
            <div class="field-row">
              <div class="field"><label for="cphone">Phone</label><input class="input" id="cphone" name="phone" required placeholder="05 55 55 55 55"></div>
              <div class="field"><label for="cemail">Email (optional)</label><input class="input" id="cemail" name="email" type="email" placeholder="you@email.com"></div>
            </div>
          </section>
          <section style="margin-bottom:2.5rem">
            <h2>Shipping</h2>
            <div class="field-row">
              <div class="field"><label for="cwilaya">Wilaya</label><select class="select" id="cwilaya" name="wilaya" required>${wilOpts}</select></div>
              <div class="field"><label for="ccommune">Commune</label><input class="input" id="ccommune" name="commune" required placeholder="Commune"></div>
            </div>
            <div class="field"><label for="cstreet">Street address</label><input class="input" id="cstreet" name="street" required placeholder="123 Main St"></div>
            <div class="field"><label for="cnotes">Delivery notes (optional)</label><input class="input" id="cnotes" name="notes" placeholder="Landmark, instructions…"></div>
          </section>
          <section>
            <h2>Payment</h2>
            <div class="pay-opts">
              <label class="pay-opt"><input type="radio" name="pay" value="COD" checked> <span><strong>Cash on Delivery</strong><br><span class="muted" style="font-size:.8rem">Pay when your gear arrives</span></span></label>
              <label class="pay-opt"><input type="radio" name="pay" value="CARD"> <span><strong>Card</strong><br><span class="muted" style="font-size:.8rem">Visa · Mastercard · CIB</span></span></label>
            </div>
          </section>
        </div>
        <aside class="order-summary">
          <h2 style="font-size:var(--fs-400)">Order summary</h2>
          ${lines}
          <div class="summary-row" style="margin-top:1rem"><span>Subtotal</span><span>${money(sub)}</span></div>
          <div class="summary-row"><span>Shipping</span><span>${ship ? money(ship) : 'FREE'}</span></div>
          <div class="summary-row total"><span>Total</span><span>${money(total)}</span></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" style="margin-top:1rem">Place order — ${money(total)}</button>
          <div class="secure-note">${ICON.lock} Secure demo checkout</div>
        </aside>
      </form>`;
    $('#checkoutForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const ordNo = 'GLV-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      Cart.clear();
      root.innerHTML = `
        <div class="confirm">
          <div class="ok">${ICON.check}</div>
          <h1>Order confirmed</h1>
          <p class="muted">Thanks, ${form.name.value.split(' ')[0] || 'gamer'} — your gear is on the way.</p>
          <p style="margin:1rem 0">Order number<br><span class="ordno">${ordNo}</span></p>
          <p class="muted" style="font-size:.85rem;max-width:42ch;margin:1rem auto">In the real platform this posts to <code>POST /api/v1/orders/create</code> with the cart offers, shipping wilaya and payment method, then reserves stock.</p>
          <a class="btn btn--primary" href="shop.html" style="margin-top:1rem">Continue shopping</a>
        </div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- COMPARE PAGE ---------- */
  function renderCompare() {
    const root = $('#compareRoot'); if (!root) return;
    const items = Compare.read().map(byId).filter(Boolean);
    if (items.length < 2) {
      root.innerHTML = `
        <div class="breadcrumbs"><a href="index.html">Home</a> / Compare</div>
        <div class="compare-empty">
          <h1 style="font-family:var(--font-display);text-transform:uppercase;font-size:var(--fs-600)">Compare gear</h1>
          <p class="muted" style="margin:1rem auto;max-width:44ch">Pick at least two products to compare side by side. Tap “⇄ Compare” on any product card to add it.</p>
          <a class="btn btn--primary" href="shop.html">Browse the catalog</a>
        </div>`;
      return;
    }
    // union of all spec keys, preserving first-seen order
    const keys = [];
    items.forEach((p) => Object.keys(p.specs).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    const head = items.map((p) => `
      <th class="compare-col">
        <a href="product.html?id=${p.id}"><div class="compare-media">${ART[p.type]}</div></a>
        <span class="card-cat">${p.cat}</span>
        <a href="product.html?id=${p.id}"><h3>${p.name}</h3></a>
        <div class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating}</div>
        <div style="margin-top:8px">${priceHTML(p)}</div>
        <button class="btn btn--primary" data-add="${p.id}" style="margin-top:10px;width:100%">Add to Cart</button>
        <button class="compare-remove" data-uncompare="${p.id}">Remove</button>
      </th>`).join('');
    const specRows = keys.map((k) => `
      <tr><td class="rowlabel">${k}</td>${items.map((p) => `<td>${p.specs[k] || '—'}</td>`).join('')}</tr>`).join('');
    root.innerHTML = `
      <div class="breadcrumbs"><a href="index.html">Home</a> / Compare</div>
      <div class="section-head"><h1 style="font-family:var(--font-display);text-transform:uppercase;font-size:var(--fs-600)">Compare (${items.length})</h1><button class="btn btn--ghost" data-clear-compare2>Clear all</button></div>
      <div class="compare-scroll">
        <table class="compare-table">
          <thead><tr><td class="rowlabel"></td>${head}</tr></thead>
          <tbody>
            <tr><td class="rowlabel">Price</td>${items.map((p) => `<td><strong>${money(eff(p))}</strong></td>`).join('')}</tr>
            <tr><td class="rowlabel">Best for</td>${items.map((p) => `<td>${p.tag.join(', ')}</td>`).join('')}</tr>
            ${specRows}
          </tbody>
        </table>
      </div>`;
    $$('[data-uncompare]', root).forEach((b) => b.onclick = () => { Compare.remove(b.dataset.uncompare); renderCompare(); });
    $('[data-clear-compare2]', root).onclick = () => { Compare.clear(); renderCompare(); };
  }

  /* ---------- GEAR FINDER QUIZ ---------- */
  function renderQuiz() {
    const root = $('#quizRoot'); if (!root) return;
    const steps = [
      { key: 'cat', q: 'What are you shopping for?', sub: 'Step 1 of 3 · Category',
        opts: [
          { label: 'Headset', desc: 'Immersive audio + comms', val: 'Headsets' },
          { label: 'Keyboard', desc: 'Speed and precision', val: 'Keyboards' },
          { label: 'Mouse', desc: 'Aim and control', val: 'Mice' },
          { label: 'Show me everything', desc: 'No preference', val: '' },
        ] },
      { key: 'conn', q: 'Wired or wireless?', sub: 'Step 2 of 3 · Connectivity',
        opts: [
          { label: 'Wireless', desc: 'Freedom, no cable', val: 'wireless' },
          { label: 'Wired', desc: 'Lowest latency, no charging', val: 'wired' },
          { label: "Doesn't matter", desc: 'Surprise me', val: '' },
        ] },
      { key: 'priority', q: "What's your priority?", sub: 'Step 3 of 3 · Priority',
        opts: [
          { label: 'Best value', desc: 'Most performance per dinar', val: 'price-asc' },
          { label: 'Top performance', desc: 'Highest rated, no compromise', val: 'rating' },
          { label: 'Latest tech', desc: 'Newest releases', val: 'new' },
          { label: 'Pro-grade', desc: 'What the pros use', val: 'pro' },
        ] },
    ];
    const answers = {};
    let step = 0;

    function paint() {
      if (step >= steps.length) return showResults();
      const s = steps[step];
      root.innerHTML = `
        <div class="quiz">
          <div class="quiz-progress">${steps.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
          <div class="quiz-step">
            <span class="eyebrow">${s.sub}</span>
            <h2>${s.q}</h2>
            <div class="quiz-opts">
              ${s.opts.map((o, i) => `<button class="quiz-opt" data-opt="${i}">${o.label}<small>${o.desc}</small></button>`).join('')}
            </div>
            ${step > 0 ? `<button class="quiz-back">← Back</button>` : ''}
          </div>
        </div>`;
      $$('.quiz-opt', root).forEach((b) => b.onclick = () => { answers[s.key] = s.opts[b.dataset.opt].val; step++; paint(); });
      const back = $('.quiz-back', root); if (back) back.onclick = () => { step--; paint(); };
    }

    function showResults() {
      let list = PRODUCTS.slice();
      if (answers.cat) list = list.filter((p) => p.cat === answers.cat);
      if (answers.conn) list = list.filter((p) => p.tag.includes(answers.conn));
      const pr = answers.priority;
      if (pr === 'pro') list = list.filter((p) => p.badge === 'Pro' || p.tag.includes('pro'));
      const sorters = { 'price-asc': (a, b) => eff(a) - eff(b), rating: (a, b) => b.rating - a.rating, new: (a, b) => (b.badge === 'New' ? 1 : 0) - (a.badge === 'New' ? 1 : 0) };
      list.sort(sorters[pr] || ((a, b) => b.rating - a.rating));
      if (!list.length) list = [...PRODUCTS].sort((a, b) => b.rating - a.rating);
      const top = list.slice(0, 3);
      const qs = new URLSearchParams();
      if (answers.cat) qs.set('cat', answers.cat);
      if (answers.conn) qs.set('tag', answers.conn);
      if (pr && pr !== 'pro') qs.set('sort', pr); else if (pr === 'pro') qs.set('tag', 'pro');
      root.innerHTML = `
        <div class="quiz">
          <div class="quiz-progress">${steps.map(() => `<span class="on"></span>`).join('')}</div>
          <span class="eyebrow">Your matches</span>
          <h2 style="font-family:var(--font-display);text-transform:uppercase;font-size:var(--fs-600);margin-bottom:.5rem">Here's your loadout</h2>
          <p class="muted" style="margin-bottom:2rem">Based on your answers, these are the top picks for you.</p>
          <div class="product-grid cols-3" id="quizResults"></div>
          <div style="display:flex;gap:.75rem;margin-top:2rem;flex-wrap:wrap">
            <a class="btn btn--primary" href="shop.html?${qs.toString()}">See all matches →</a>
            <button class="btn btn--ghost" data-restart>Start over</button>
          </div>
        </div>`;
      $('#quizResults').innerHTML = top.map(productCard).join('');
      $('[data-restart]', root).onclick = () => { step = 0; for (const k in answers) delete answers[k]; paint(); };
      initReveal();
    }
    paint();
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    mountChrome();
    renderHome();
    renderShop();
    renderProduct();
    renderCheckout();
    renderCompare();
    renderQuiz();
    initReveal();
  });
})();
