# 00 — Extracted Design System (as-is, source of truth · v2 FINAL)

> Verbatim ground-truth extraction supplied by the project owner,
> source-verified against the compiled bundle
> `/assets/index-BOKG-Pk-.css` and a live-DOM pass. **This file
> overrides every earlier `[INFERRED]` assumption** elsewhere in this
> folder.
>
> Tag legend:
> - **[VERIFIED]** — confirmed in this file (bundle / DOM).
> - **[INFERRED]** — retained only where the as-is is silent.
> - **[CONVENTION]** — standard web-store anatomy unrelated to OKAMI.

The rebuild's job is to *evolve* this brand expression, not invent a
new one. Keep the colour system, the fonts, the halftone wallpaper,
the marquee, the greyscale → colour signature, the 3D card flip,
the aurora orbs, the two bezier curves. Improve the missing pieces
(drops engine, search, checkout, a11y, i18n) on top.

---

## 1. Aesthetic direction

**Dark anime streetwear brutalism.** Japanese manga print culture
(halftone texture, monochrome restraint) crossed with Western
streetwear loudness (oversized condensed type, brutal letter-spacing,
white-on-void contrast). Mood: gritty, confident, underground,
scarcity-driven. The product art carries all the colour; the chrome
stays near-monochrome so a grid of tees reads like a gallery wall.
Drop-culture scarcity ("when it's gone, it's gone") is a design
constraint, not just copy — sold-out states are first-class visuals.

## 2. Colour system

One deep purple-black base, a near-monochrome white-ink scale, and a
**full semantic palette** reserved for status. Purple `#AC4BFF`
doubles as the brand accent and the aurora-orb colour.

### 2.1 Surfaces (verified hex from bundle)

| Token | Value | Role |
|---|---|---|
| `--bg-base`  | `#1E1623` | Body default — deep purple-black |
| `--bg-deep`  | `#0A050D` | Deepest void — full-bleed heroes |
| `--bg-dark`  | `#0D0B14` | Dark — modals |
| `--bg-mid`   | `#1a1520` | Raised — nav / panels |
| `--bg-card`  | `#251f2b` | Card surface |
| `--bg-hover` | `#2a2533` | Hover state |
| `--bg-near`  | `#0a0a0a` | Near-black (footer alt) |

### 2.2 Ink scale

| Token | Value |
|---|---|
| `--white` | `#FFFFFF` |
| `--w90`   | `rgba(255,255,255,0.90)` |
| `--w80`   | `rgba(255,255,255,0.80)` |
| `--w70`   | `rgba(255,255,255,0.70)` |
| `--w60`   | `rgba(255,255,255,0.60)` — secondary text |
| `--w50`   | `rgba(255,255,255,0.50)` |
| `--w30`   | `rgba(255,255,255,0.30)` |
| `--w20`   | `rgba(255,255,255,0.20)` — borders, dividers |
| `--w10`   | `rgba(255,255,255,0.10)` — hover surfaces |
| `--w05`   | `rgba(255,255,255,0.05)` — card borders |

### 2.3 Semantic palette (CORRECTED — full set, not "green only")

| Token | Value | Role |
|---|---|---|
| `--green`  | `#00C758` | In stock / success |
| `--red`    | `#FB2C36` | Sold out / danger |
| `--orange` | `#FE6E00` | Limited drop alert |
| `--amber`  | `#F59E0B` | Gold / promo highlight |
| `--yellow` | `#EDB200` | "New" badge |
| `--purple` | `#AC4BFF` | Brand accent / aurora |
| `--blue`   | `#3080FF` | Info |

### 2.4 Glow shadows (already in the live site — do not "add")

| Token | Value | Use |
|---|---|---|
| `--glow-w-sm` | `0 0 15px rgba(255,255,255,0.10)` | Idle |
| `--glow-w-md` | `0 0 20px rgba(255,255,255,0.20)` | Hover |
| `--glow-w-lg` | `0 0 30px rgba(255,255,255,0.30)` | CTA hover |
| `--glow-w-xl` | `0 0 50px rgba(255,255,255,0.30)` | Hero CTA |
| `--glow-green` | `0 0 15px rgba(34,197,94,0.20)` | In-stock badge |
| `--glow-red`   | `0 0 30px rgba(255,0,0,0.40)` | Sold-out CTA |

There are no elevation box-shadows in the system; glows do the work,
both decorative and semantic.

## 3. Fonts (three self-hosted)

```css
@font-face { font-family: OKAMI;      src: url("/assets/font/OKAMI.otf")      format("opentype"); font-display: swap; }
@font-face { font-family: Streetwear; src: url("/assets/font/streetwear.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: Inter;      src: url("/assets/font/inter.ttf")      format("truetype"); font-display: swap; }
```

| Font | Role |
|---|---|
| **OKAMI.otf** | **Default body font** — renders everything unless overridden. Headings, category labels, hero. |
| **Streetwear.ttf** | Nav links, CTAs, marquee. Forced via `.force-font-streetwear`. |
| **Inter.ttf** | Body copy, micro-labels, and the entire **admin** UI (`admin.` subdomain) — `.font-inter`. |

> Correction vs the earlier extension export: OKAMI is the body default
> *globally*, not only on display elements.

## 4. Type scale

Everything uppercase. Letter-spacing runs from tight
(`--ls-tight: -0.025em`) to brutal (`--ls-5: 0.5em`). Display stacks
use `line-height: 0.85`. Hero can reach `text-[45vw]` — a viewport
word that bleeds off-canvas. Responsive nav pattern:
`text-sm md:text-base lg:text-2xl xl:text-3xl`.

| Token | Family | Use |
|---|---|---|
| `text-[45vw]` · `ls 0.4em` · `lh 0.85` | OKAMI | VW hero word |
| `text-7xl` · `ls 0.3em` | OKAMI | Hero "LATEST DROP" |
| `text-5xl` · `ls 0.3em` | OKAMI | H2 "Categories" |
| `text-2xl` · `ls 0.2em` | OKAMI | H3 "Hoodies" |
| `text-[40px]` · `ls 0.2em` | Streetwear | Display CTA |
| `text-base` | Inter | Body copy |
| `text-[11px]` · `ls 0.3em` | Inter | Micro-label (MENU, CART) |

Letter-spacing scale: `--ls-tight: -0.025em`, `--ls-1: 0.1em`,
`--ls-2: 0.2em`, `--ls-3: 0.3em`, `--ls-4: 0.4em`, `--ls-5: 0.5em`.

## 5. Layout, surfaces, z-index

Container: `w-[90%]` centred · padding `px-6 md:px-8 lg:px-12` ·
section `py-20 md:py-24`. Product grid
`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`, gap `4 → 6`. Category
grid `cols-2 md:cols-4` with the lead card spanning `col-span-2`.

### 5.1 Surfaces & elevation (colour, not shadow)

A surface tier raises by **changing background colour**, never by
drop-shadow:

```
bg-deep   → bg-base → bg-mid → bg-card → glass (bg-base/80 + blur20)
```

### 5.2 Z-index scale (CORRECTED — extends to 9999)

| Layer | Use |
|---|---|
| `z-10`   | content |
| `z-20`   | marquee · hero text |
| `z-30`   | image overlays |
| `z-40`   | nav gradient (no-pointer) |
| `z-50`   | nav · bottom bar |
| `z-60`   | dropdowns |
| `z-100` / `z-110` | cart drawer |
| `z-200`  | overlays |
| `z-9999` | toasts · top modal |

## 6. Background & texture (CORRECTED)

The body background is an **external SVG asset** with fixed
attachment — *not* a CSS dot-gradient:

```css
body {
  background-color: #1E1623;
  background-image:    url("/assets/icons/wallpaper.svg");
  background-position: top;
  background-size:     cover;
  background-attachment: fixed;   /* ← the parallax pin */
  font-family: OKAMI, -apple-system, sans-serif;
  color: #fff;
}

/* mix-blend-overlay grain noise */
body::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
  opacity: 0.35;
  background: url("data:image/svg+xml;…fractalNoise…");
}
```

Signature gradient fades used to dissolve nav/footer into the base
colour:

```css
.fade-top    { background: linear-gradient(180deg, #1E1623 0%, #1E162380 75%, transparent 100%); }
.fade-bottom { background: linear-gradient(0deg,   #1E1623 0%, #1E1623   50%, transparent 100%); }
```

## 7. Aurora orbs

Three blurred coloured discs sit behind heroes and section breaks:

```css
.aurora .orb { position: absolute; border-radius: 50%; filter: blur(120px); mix-blend-mode: overlay; }
.o1 { width: 240px; height: 240px; background: rgba(172,75,255,0.35); }   /* purple */
.o2 { width: 170px; height: 170px; background: rgba(0,199,88,0.22); }     /* green */
.o3 { width: 150px; height: 150px; background: rgba(254,110,0,0.20); }    /* orange */
```

## 8. Signature interactions (the patterns that define the feel)

### 8.1 Greyscale → colour on product hover

The brand's defining interaction. Product art is desaturated by
default and snaps to full colour on hover:

```css
.product-img         { filter: grayscale(0.95) brightness(1.10);
                        transition: filter 0.4s ease, transform 0.5s var(--ease-expo); }
.product:hover .img  { filter: grayscale(0);        transform: scale(1.10); }
.product.sold .img   { filter: grayscale(1) brightness(0.5); /* permanent */ }
```

### 8.2 3D card flip

```css
.flip               { perspective: 1000px; }
.flip-inner         { transform-style: preserve-3d; transition: transform 0.7s var(--ease-expo); }
.flip:hover .inner  { transform: rotateY(180deg); }
.flip-face          { backface-visibility: hidden; }
```

## 9. Motion system

### 9.1 Two custom bezier curves (verified)

| Token | Value | Use |
|---|---|---|
| `--ease-expo`   | `cubic-bezier(0.16, 1, 0.3, 1)`     | **Primary** — product hover, nav reveal, page transitions |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | **Delight** — size select, cart badge, add-to-cart |
| `--ease-out`    | `cubic-bezier(0, 0, 0.2, 1)`        | Generic CSS default |

### 9.2 Logo pulse — infinite

```css
@keyframes logoPulse {
  0%   { opacity: 0.5; transform: scale(0.85); }
  50%  { opacity: 1;   transform: scale(1.10); }
  100% { opacity: 0.5; transform: scale(0.85); }
}
.logo-pulse { animation: logoPulse 1.5s ease-in-out infinite; }
```

### 9.3 Other observed motions

| Motion | Value |
|---|---|
| Card image zoom            | `scale-110` · 700 ms `--ease-expo` |
| Category card shine sweep  | `bg-white/10` opacity 0→1 · 500 ms |
| Card image brighten        | overlay `black/30 → black/10` · 300 ms |
| Button press               | `active:scale-95` |
| Marquee                    | `translateX 0 → -50%` · linear infinite |
| Page transition            | `translate-y 200px → 0` + opacity fade |

## 10. Components (verified scaffolds)

### 10.1 Floating top nav (glass · centred logo)

```html
<header class="fixed top-[3%] left-0 right-0 z-50">
  <div class="w-[90%] mx-auto flex items-center justify-between
              px-6 md:px-8 lg:px-12 py-4 bg-bg-base/80 backdrop-blur-xl
              border border-white/10 rounded-pill">
    <!-- Left: hamburger + EN/AR -->
    <!-- Center: logo (md:scale-125 lg:scale-150) -->
    <!-- Right: search + cart with count badge -->
  </div>
</header>
```

### 10.2 Marquee ticker

```html
<div class="bg-white py-3 md:py-4 lg:py-6 overflow-hidden">
  <div class="whitespace-nowrap flex w-fit animate-marquee">
    <span class="font-streetwear text-black text-lg md:text-2xl lg:text-3xl
                 mx-16 uppercase">WEAR ANIME MERCH WITH CONFIDENCE •</span>
    <!-- ×10 inside one set, two sets total for seamless loop -->
  </div>
</div>
```

### 10.3 Hero

```html
<div class="relative aspect-[4/5.5] md:aspect-auto md:h-screen overflow-hidden
            flex items-end perspective-[1000px]">
  <div class="absolute inset-0 will-change-transform">         <!-- bg image (parallax) -->
    <picture><img class="w-full h-full object-cover" /></picture>
  </div>
  <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>
  <div class="absolute inset-0 bg-gradient-to-b from-bg-base via-transparent to-bg-base/80"></div>

  <div class="relative z-20 w-[90%] mx-auto pb-20 md:pb-24 flex items-end justify-between p-[28px]">
    <h2 class="font-okami text-5xl md:text-7xl leading-none mix-blend-overlay">LATEST<br>DROP</h2>
    <a class="font-streetwear font-bold bg-white text-black rounded-full
              text-[1.5em] md:text-[2em] lg:text-[2.5em]
              hover:bg-white/90 active:scale-95">ORDER NOW</a>
  </div>
</div>
```

### 10.4 Category card grid

```html
<div class="w-[90%] mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">

  <!-- Lead card: col-span-2 landscape -->
  <a class="group relative col-span-2 aspect-[3/2] overflow-hidden
            rounded-sm border border-white/5 block">
    <div class="absolute inset-0 transition-transform duration-700 group-hover:scale-110"><!-- image --></div>
    <div class="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors duration-300"></div>
    <div class="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-transparent
                opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
    <div class="absolute bottom-0 inset-x-0 p-4 md:p-6 lg:p-8 bg-gradient-to-t from-black/80 to-transparent text-center">
      <h4 class="font-okami text-3xl md:text-5xl lg:text-7xl uppercase tracking-wider">OUTFIT</h4>
    </div>
  </a>

  <!-- Small card: portrait aspect-[3/5] -->
</div>
```

### 10.5 Product card (greyscale signature + sold-out)

```html
<div class="pcard">
  <div class="aw aspect-[3/4] rounded-lg overflow-hidden border border-white/10
              hover:border-white/30 hover:shadow-[var(--glow-w-sm)] relative">
    <div class="art filter grayscale-[.95] brightness-110
                transition-[filter,transform] duration-500
                group-hover:filter-none group-hover:scale-110"><!-- product img --></div>
    <div class="absolute inset-0 bg-gradient-to-t from-bg-base from-8% via-transparent"></div>
    <span class="badge bd-drop absolute top-2.5 left-2.5">Limited</span>
  </div>
  <h3 class="font-okami text-base mt-2.5 uppercase tracking-wide">Wolf Spirit Hoodie</h3>
  <p  class="font-inter text-[11px] text-white/50 mt-1">Hoodies · Drop #04</p>
  <p  class="font-okami text-lg mt-1.5 tracking-wider">4 200 DA</p>
</div>
```

### 10.6 Size selector (spring ease)

```html
<div class="sizes flex flex-wrap gap-2.5">
  <button class="sz x">XS</button> <!-- struck-through, disabled -->
  <button class="sz">S</button>
  <button class="sz on">M</button>  <!-- selected: scale-[1.06] white bg -->
  <button class="sz">L</button>
  <button class="sz">XL</button>
</div>
```

```css
.sz    { width: 46px; height: 46px; border-radius: 9px; border: 1px solid var(--w20);
         font-family: OKAMI; transition: all 0.2s var(--ease-spring); }
.sz.on { background: #fff; color: #000; transform: scale(1.06); }
.sz.x  { color: var(--w20); text-decoration: line-through; cursor: not-allowed; }
```

### 10.7 Mobile bottom nav (glass · pinned)

```html
<div class="fixed bottom-0 inset-x-0 z-50 flex items-center justify-center gap-40
            bg-[linear-gradient(0deg,#1E1623_0%,#1E1623_50%,transparent_100%)]
            backdrop-blur-xl h-20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]
            border-t border-white/5">
  <button class="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 min-w-[64px]">
    <span>☰</span><span class="font-inter text-[10px] uppercase tracking-widest text-white/60">MENU</span>
  </button>
  <!-- HOME / CART -->
</div>
```

### 10.8 Buttons + badges

```css
.btn-white   { background: #fff; color: #000; border-radius: 999px;
               font-family: Streetwear; padding: 14px 28px;
               transition: all 0.3s var(--ease-expo); }
.btn-white:hover  { box-shadow: var(--glow-w-lg); transform: scale(1.02); }
.btn-white:active { transform: scale(0.95); }

.btn-outline { background: transparent; color: #fff; border: 1px solid var(--w20); border-radius: 6px;
               font-family: Streetwear; letter-spacing: 0.3em; }
.btn-ghost   { background: var(--w05); color: var(--w70); border: 1px solid var(--w10); }
.btn-red     { background: var(--red); color: #fff; box-shadow: 0 0 20px rgba(251,44,54,0.30); }
```

| Badge | Visual |
|---|---|
| **Limited Drop** | `bg-orange/15 border-orange/30 text-orange` |
| **New**          | `bg-purple/20 border-purple/40 text-purple` |
| **In Stock**     | `bg-green/10 border-green/30 text-green` + `glow-green` |
| **Sold Out**     | `bg-red/10 border-red/30 text-red` |
| **Last Pieces**  | `bg-amber/20 border-amber/30 text-amber` |
| **Generic**      | `bg-white/8 border-white/20 text-white` |

## 11. Tech stack — verified

| Layer | Technology |
|---|---|
| Framework | **React SPA**, **Vite** build (mounts `#root`; dynamic-import chunk-reload resilience) |
| Styling | **TailwindCSS v4**, utility-first; **oklch** colour space in compiled output |
| Fonts | 3 self-hosted: `OKAMI.otf` / `streetwear.ttf` / `inter.ttf` |
| Routing | Client-side SPA (`/shop`, `/about`, `/contact`, `/cart`) + **`admin.` subdomain** (Inter-forced UI) |
| Commerce | Custom headless; **currency switch US / DA** |
| Tracking | **Meta Pixel + TikTok Pixel** (both fire on load) |
| PWA | manifest per-domain; service worker **actively unregistered** on the storefront |
| Breakpoints | Tailwind defaults: `md 768` · `lg 1024` · `xl 1280` |

> The Shopify inference from the first pass is wrong. The live stack
> is a custom React SPA on Vite with a custom headless commerce
> backend. Strategy implications are in
> [13-platform-reconciliation.md](./13-platform-reconciliation.md).

## 12. Upgrade path (de-duplicated)

The earlier upgrade list recommended several things the live site
**already ships**. Corrected below.

### Worth doing

- **Skeleton + blur-up loaders** — current site has spinners, no
  shimmer skeletons or LQIP placeholders.
- **Lazy `will-change`** — apply only when the hero enters the
  viewport, not globally.
- **Real hero scroll-parallax** — `perspective-1000` is declared but
  underused; drive `translate3d` on scroll.
- **Restock / drop-countdown timer** — leans into the scarcity model
  the brand already sells on.
- **Palette consistency pass** — the semantic colours exist but are
  applied inconsistently; lock each colour to one meaning.

### Skip / corrected (already in the system)

- ~~Add glowing CTA border~~ → already ships
  `shadow-[0_0_30px/50px_rgba(255,255,255,.3)]`.
- ~~Add a third accent (purple)~~ → `#AC4BFF` already in the system.
- ~~Add glass-morphism blur~~ → `backdrop-blur-xl/2xl` already used.
- ~~Variable-font optical sizing + `ss01`~~ → these are static custom
  display fonts; verify the font even has an `ss01` table before
  targeting it.

## 13. Drop-in token reference

```css
/* OKAMI v2 — source-verified tokens */
@font-face { font-family: OKAMI;      src: url(/assets/font/OKAMI.otf)      format("opentype"); font-display: swap; }
@font-face { font-family: Streetwear; src: url(/assets/font/streetwear.ttf) format("truetype"); font-display: swap; }
@font-face { font-family: Inter;      src: url(/assets/font/inter.ttf)     format("truetype"); font-display: swap; }

body {
  background-color: #1E1623;
  background-image:    url(/assets/icons/wallpaper.svg);   /* ✦ external asset, NOT a CSS gradient */
  background-position: top;
  background-size:     cover;
  background-attachment: fixed;                            /* ✦ pinned parallax */
  font-family: OKAMI, -apple-system, sans-serif;
  color: #fff;
}

:root {
  /* Surfaces */
  --bg-base:#1E1623; --bg-deep:#0A050D; --bg-dark:#0D0B14;
  --bg-mid:#1a1520;  --bg-card:#251f2b; --bg-hover:#2a2533;

  /* Semantic */
  --green:#00C758; --red:#FB2C36; --orange:#FE6E00;
  --amber:#F59E0B; --yellow:#EDB200; --purple:#AC4BFF; --blue:#3080FF;

  /* Easings */
  --ease-expo:   cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ✦ THE signature — greyscale → color */
.product-img             { filter: grayscale(.95) brightness(1.1);
                           transition: filter 0.4s ease, transform 0.5s var(--ease-expo); }
.product:hover .img      { filter: grayscale(0); transform: scale(1.1); }
.product.sold .img       { filter: grayscale(1) brightness(.5); }

/* ✦ 3D flip */
.flip                    { perspective: 1000px; }
.flip-inner              { transform-style: preserve-3d; transition: transform 0.7s var(--ease-expo); }
.flip:hover .flip-inner  { transform: rotateY(180deg); }
.flip-face               { backface-visibility: hidden; }

/* logo pulse */
@keyframes logoPulse { 0%{opacity:.5;transform:scale(.85)} 50%{opacity:1;transform:scale(1.1)} 100%{opacity:.5;transform:scale(.85)} }

/* gradient fades + scrollbar */
.fade-top    { background: linear-gradient(180deg, #1E1623 0%, #1E162380 75%, transparent 100%); }
.fade-bottom { background: linear-gradient(0deg,   #1E1623 0%, #1E1623   50%, transparent 100%); }
::-webkit-scrollbar       { width: 6px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
```
