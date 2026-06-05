/* =================================================================
   GLAIVE — application logic
   - shared header/footer injection
   - cart (localStorage) + drawer
   - homepage / shop / product rendering
   - filters, sort, search, reveal-on-scroll, toast
   ================================================================= */
(function () {
  const { ART, ICON, PRODUCTS, CATEGORIES } = window.GLAIVE;
  const money = (n) => '$' + n.toFixed(2);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const param = (k) => new URLSearchParams(location.search).get(k);

  /* ---------- Cart store ---------- */
  const CART_KEY = 'glaive.cart';
  const Cart = {
    read() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
    write(items) { localStorage.setItem(CART_KEY, JSON.stringify(items)); render(); },
    add(id, qty = 1) {
      const items = Cart.read();
      const line = items.find((i) => i.id === id);
      if (line) line.qty += qty; else items.push({ id, qty });
      Cart.write(items);
      toast(`Added to cart — ${byId(id).name}`);
      openDrawer();
    },
    setQty(id, qty) {
      let items = Cart.read();
      if (qty <= 0) items = items.filter((i) => i.id !== id);
      else items.find((i) => i.id === id).qty = qty;
      Cart.write(items);
    },
    remove(id) { Cart.write(Cart.read().filter((i) => i.id !== id)); },
    count() { return Cart.read().reduce((n, i) => n + i.qty, 0); },
    subtotal() { return Cart.read().reduce((s, i) => s + byId(i.id).price * i.qty, 0); },
  };

  /* ---------- Templates ---------- */
  function navMarkup() {
    const cols = CATEGORIES.map((c) =>
      `<a href="shop.html?cat=${encodeURIComponent(c.name)}">${c.name}</a>`).join('');
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
              <div class="mega-col"><h4>Collections</h4><a href="shop.html?sort=new">New Arrivals</a><a href="shop.html?tag=pro">Pro Series</a><a href="shop.html?sort=price-asc">Under $50</a></div>
              <div class="mega-feature">
                <div><span class="eyebrow">Flagship</span><h3>Arctis Nova Elite</h3><p class="muted">Hi-Res wireless, redefined.</p></div>
                <a class="btn btn--primary" href="product.html?id=arctis-nova-elite">Discover</a>
              </div>
            </div></div>
          </li>
          <li><a href="#software">Software</a></li>
          <li><a href="#discover">Discover</a></li>
          <li><a href="#support">Support</a></li>
        </ul>
        <div class="nav-actions">
          <button class="icon-btn" data-search aria-label="Search">${ICON.search}</button>
          <a class="icon-btn" href="#account" aria-label="Account">${ICON.user}</a>
          <button class="icon-btn" data-open-cart aria-label="Cart">${ICON.cart}<span class="cart-count" data-count="0">0</span></button>
          <button class="icon-btn hamburger" data-open-mobile aria-label="Menu">${ICON.menu}</button>
        </div>
      </div>
    </header>
    <nav class="mobile-drawer" id="mobileDrawer" aria-label="Mobile">
      <button class="icon-btn" data-close-mobile aria-label="Close" style="margin-left:auto">${ICON.close}</button>
      <a href="index.html">Home</a>${cols}
      <a href="#software">Software</a><a href="#support">Support</a>
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
          <div><h4>Software</h4><a href="#software">GLAIVE GG</a><a href="#software">Sonar Audio</a><a href="#software">Engine</a><a href="#software">Moments</a></div>
          <div><h4>Support</h4><a href="#support">Help Center</a><a href="#support">Warranty</a><a href="#support">Downloads</a><a href="#support">Register Product</a><a href="#support">Contact</a></div>
          <div><h4>Company</h4><a href="#">About</a><a href="#">Pro Athletes</a><a href="#">Careers</a><a href="#">Press</a><a href="#">Sustainability</a></div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} GLAIVE Gaming. A first-principles tribute build. Not affiliated with SteelSeries.</span>
          <span>Privacy · Terms · Cookies · Accessibility</span>
        </div>
      </div>
    </footer>`;
  }

  function drawerMarkup() {
    return `
    <div class="scrim" data-scrim></div>
    <aside class="drawer" id="cartDrawer" aria-label="Shopping cart" aria-hidden="true">
      <div class="drawer-head"><h3>Your Cart</h3><button class="icon-btn" data-close-cart aria-label="Close">${ICON.close}</button></div>
      <div class="drawer-body" id="cartBody"></div>
      <div class="drawer-foot" id="cartFoot"></div>
    </aside>
    <div class="toast" id="toast"></div>`;
  }

  function productCard(p) {
    return `
    <article class="card reveal">
      <a class="card-media" href="product.html?id=${p.id}" aria-label="${p.name}">
        ${p.badge ? `<span class="badge ${p.badge === 'Pro' ? 'badge--ghost' : ''}">${p.badge}</span>` : ''}
        <button class="wishlist icon-btn" aria-label="Add to wishlist">${ICON.heart}</button>
        ${ART[p.type]}
      </a>
      <div class="card-body">
        <span class="card-cat">${p.cat}</span>
        <a href="product.html?id=${p.id}"><h3 class="card-title">${p.name}</h3></a>
        <span class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating} (${p.reviews})</span>
        <div class="card-foot">
          <div class="price"><span class="now">${money(p.price)}</span></div>
          <button class="btn btn--primary" data-add="${p.id}">Add</button>
        </div>
      </div>
    </article>`;
  }

  /* ---------- Render: shared chrome ---------- */
  function mountChrome() {
    const nav = $('#nav'); if (nav) nav.innerHTML = navMarkup();
    const foot = $('#footer'); if (foot) foot.innerHTML = footerMarkup();
    document.body.insertAdjacentHTML('beforeend', drawerMarkup());
    wireChrome();
    renderCart();
  }

  function wireChrome() {
    // mega menu (hover on desktop, click for a11y)
    $$('.nav-item[data-mega]').forEach((item) => {
      const btn = $('button', item);
      const open = () => { closeMegas(); item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); };
      const close = () => { item.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
      item.addEventListener('mouseenter', open);
      item.addEventListener('mouseleave', close);
      btn.addEventListener('click', (e) => { e.preventDefault(); item.classList.contains('open') ? close() : open(); });
    });
    function closeMegas() { $$('.nav-item.open').forEach((i) => i.classList.remove('open')); }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMegas(); closeDrawer(); closeMobile(); } });

    on('[data-open-cart]', 'click', openDrawer);
    on('[data-close-cart]', 'click', closeDrawer);
    on('[data-scrim]', 'click', () => { closeDrawer(); closeMobile(); });
    on('[data-open-mobile]', 'click', openMobile);
    on('[data-close-mobile]', 'click', closeMobile);
    on('[data-search]', 'click', () => {
      const q = prompt('Search GLAIVE'); if (q) location.href = `shop.html?q=${encodeURIComponent(q)}`;
    });
    // delegated add-to-cart
    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) { Cart.add(add.dataset.add); }
    });
  }

  function on(sel, ev, fn) { $$(sel).forEach((el) => el.addEventListener(ev, fn)); }
  const scrim = () => $('[data-scrim]');
  function openDrawer() { $('#cartDrawer').classList.add('open'); $('#cartDrawer').setAttribute('aria-hidden', 'false'); scrim().classList.add('open'); }
  function closeDrawer() { const d = $('#cartDrawer'); if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); } if (!$('.mobile-drawer.open')) scrim()?.classList.remove('open'); }
  function openMobile() { $('#mobileDrawer').classList.add('open'); scrim().classList.add('open'); }
  function closeMobile() { $('#mobileDrawer')?.classList.remove('open'); if (!$('.drawer.open')) scrim()?.classList.remove('open'); }

  let toastT;
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }

  /* ---------- Render: cart ---------- */
  function renderCart() {
    $$('.cart-count').forEach((el) => { const n = Cart.count(); el.textContent = n; el.dataset.count = n; });
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
            <button data-dec="${p.id}" aria-label="Decrease">−</button>
            <span>${i.qty}</span>
            <button data-inc="${p.id}" aria-label="Increase">+</button>
          </div>
        </div>
        <div style="text-align:right"><div class="price"><span class="now" style="font-size:1rem">${money(p.price * i.qty)}</span></div><button class="rm" data-rm="${p.id}">Remove</button></div>
      </div>`; }).join('');
    const sub = Cart.subtotal();
    const ship = sub > 50 || sub === 0 ? 0 : 6.99;
    foot.innerHTML = `
      <div class="summary-row"><span>Subtotal</span><span>${money(sub)}</span></div>
      <div class="summary-row"><span>Shipping</span><span>${ship ? money(ship) : 'FREE'}</span></div>
      <div class="summary-row total"><span>Total</span><span>${money(sub + ship)}</span></div>
      <button class="btn btn--primary btn--block btn--lg" style="margin-top:1rem" data-checkout>Checkout</button>`;
    $$('[data-inc]').forEach((b) => b.onclick = () => Cart.setQty(b.dataset.inc, qtyOf(b.dataset.inc) + 1));
    $$('[data-dec]').forEach((b) => b.onclick = () => Cart.setQty(b.dataset.dec, qtyOf(b.dataset.dec) - 1));
    $$('[data-rm]').forEach((b) => b.onclick = () => Cart.remove(b.dataset.rm));
    $('[data-checkout]').onclick = () => toast('Demo checkout — integrate with the Ghir Laffaire /orders API');
    function qtyOf(id) { return Cart.read().find((i) => i.id === id)?.qty || 0; }
  }
  function render() { renderCart(); }

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    $$('.reveal').forEach((el) => io.observe(el));
  }

  /* ---------- Page: HOME ---------- */
  function renderHome() {
    // category rail
    const rail = $('#catRail');
    if (rail) rail.innerHTML = CATEGORIES.map((c) => `
      <a class="cat-card reveal" href="shop.html?cat=${encodeURIComponent(c.name)}">
        <div class="cat-art">${ART[c.type]}</div>
        <h3>${c.name}</h3><span>${c.tagline} →</span>
      </a>`).join('');
    // featured = badged products
    const feat = $('#featured');
    if (feat) feat.innerHTML = PRODUCTS.filter((p) => p.badge).slice(0, 8).map(productCard).join('');
    // bestsellers
    const best = $('#bestsellers');
    if (best) best.innerHTML = [...PRODUCTS].sort((a, b) => b.reviews - a.reviews).slice(0, 4).map(productCard).join('');
  }

  /* ---------- Page: SHOP ---------- */
  function renderShop() {
    const root = $('#shopRoot'); if (!root) return;
    const state = {
      cats: new Set(param('cat') ? [param('cat')] : []),
      q: param('q') || '',
      tag: param('tag') || '',
      sort: param('sort') || 'featured',
      max: Infinity,
    };
    const allCats = [...new Set(PRODUCTS.map((p) => p.cat))];
    $('#filterCats').innerHTML = allCats.map((c) => `
      <label class="check"><input type="checkbox" value="${c}" ${state.cats.has(c) ? 'checked' : ''}> ${c}</label>`).join('');
    $('#shopTitle').textContent = state.q ? `Results for “${state.q}”` : (state.cats.size === 1 ? [...state.cats][0] : 'All Gear');

    function apply() {
      let list = PRODUCTS.slice();
      if (state.cats.size) list = list.filter((p) => state.cats.has(p.cat));
      if (state.tag) list = list.filter((p) => p.tag.includes(state.tag) || (state.tag === 'pro' && p.badge === 'Pro'));
      if (state.q) { const q = state.q.toLowerCase(); list = list.filter((p) => (p.name + p.cat + p.blurb).toLowerCase().includes(q)); }
      if (state.max !== Infinity) list = list.filter((p) => p.price <= state.max);
      const sorters = {
        'featured': (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.reviews - a.reviews,
        'new': (a, b) => (b.badge === 'New' ? 1 : 0) - (a.badge === 'New' ? 1 : 0),
        'price-asc': (a, b) => a.price - b.price,
        'price-desc': (a, b) => b.price - a.price,
        'rating': (a, b) => b.rating - a.rating,
      };
      list.sort(sorters[state.sort] || sorters.featured);
      $('#grid').innerHTML = list.length ? list.map(productCard).join('')
        : `<p class="muted" style="grid-column:1/-1;padding:3rem 0">No products match your filters.</p>`;
      $('#count').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
      initReveal();
    }
    $('#filterCats').addEventListener('change', (e) => {
      const cb = e.target; cb.checked ? state.cats.add(cb.value) : state.cats.delete(cb.value); apply();
    });
    $$('#priceFilter input').forEach((r) => r.addEventListener('change', (e) => { state.max = Number(e.target.value) || Infinity; apply(); }));
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
    apply();
  }

  /* ---------- Page: PRODUCT ---------- */
  function renderProduct() {
    const root = $('#pdpRoot'); if (!root) return;
    const p = byId(param('id')) || PRODUCTS[0];
    document.title = `${p.name} — GLAIVE`;
    const colorSw = p.colors.map((c, i) => `<button class="swatch" style="background:${c}" aria-current="${i === 0}" aria-label="Color ${i + 1}"></button>`).join('');
    const specRows = Object.entries(p.specs).map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');
    root.innerHTML = `
      <div class="breadcrumbs"><a href="index.html">Home</a> / <a href="shop.html?cat=${p.cat}">${p.cat}</a> / ${p.name}</div>
      <div class="pdp">
        <div class="pdp-gallery">
          <div class="pdp-hero" id="pdpHero">${ART[p.type]}</div>
          <div class="pdp-thumbs">
            ${[1, 2, 3].map((n) => `<button aria-current="${n === 1}">${ART[p.type]}</button>`).join('')}
          </div>
        </div>
        <div class="pdp-info">
          <span class="eyebrow">${p.cat}${p.badge ? ' · ' + p.badge : ''}</span>
          <h1>${p.name}</h1>
          <span class="card-rating"><span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${p.rating} · ${p.reviews} reviews</span>
          <div class="pdp-price"><span class="now">${money(p.price)}</span><span class="muted">or ${money(p.price / 4)}/mo</span></div>
          <p class="pdp-desc">${p.blurb}</p>
          <div><h4 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--c-text-faint);margin-bottom:.5rem">Color</h4><div class="swatches">${colorSw}</div></div>
          <div class="buy-row">
            <button class="btn btn--primary btn--lg" data-add="${p.id}" style="flex:1">Add to Cart — ${money(p.price)}</button>
            <button class="btn btn--ghost btn--lg" aria-label="Wishlist">${ICON.heart}</button>
          </div>
          <div class="trust" style="border:none;grid-template-columns:1fr 1fr">
            <div class="t">${ICON.ship}<div><strong>Free shipping</strong><span>Orders over $50</span></div></div>
            <div class="t">${ICON.shield}<div><strong>2-year warranty</strong><span>Register for +1 year</span></div></div>
          </div>
          <h2 style="font-size:1.4rem;text-transform:uppercase;margin-top:2rem">Specifications</h2>
          <div class="spec-list">${specRows}</div>
        </div>
      </div>`;
    // thumb + swatch interactions
    $$('.pdp-thumbs button').forEach((b) => b.onclick = () => { $$('.pdp-thumbs button').forEach((x) => x.setAttribute('aria-current', 'false')); b.setAttribute('aria-current', 'true'); });
    $$('.swatch').forEach((b) => b.onclick = () => { $$('.swatch').forEach((x) => x.setAttribute('aria-current', 'false')); b.setAttribute('aria-current', 'true'); });
    // related
    const rel = $('#related');
    if (rel) rel.innerHTML = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id).slice(0, 4).map(productCard).join('') ||
      PRODUCTS.filter((x) => x.id !== p.id).slice(0, 4).map(productCard).join('');
  }

  /* ---------- Boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    mountChrome();
    renderHome();
    renderShop();
    renderProduct();
    initReveal();
  });
})();
