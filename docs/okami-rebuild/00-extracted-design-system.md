# 00 — Extracted Design System (as-is, source of truth)

> This is the **verbatim ground-truth extraction** of the live OKAMI
> Streetwear site, supplied by the project owner from a session with
> real DOM/network access. Everything in this file overrides any
> earlier `[INFERRED]` assumption in `02-audit-and-sitemap.md`.
>
> Tags used elsewhere should now read:
> - **[VERIFIED]** = present in this file
> - **[INFERRED]** = retained only when the as-is doc is silent
> - **[CONVENTION]** = generic web-store anatomy unrelated to OKAMI

The rebuild's job is to *evolve* this brand expression, not invent a
new one. Keep the colour, the fonts, the halftone, the marquee, the
hero composition. Improve the missing pieces (drops engine, search,
checkout, a11y, i18n) on top.

---

## 1. Brand DNA & visual identity

**Concept:** Dark anime streetwear. The aesthetic fuses Japanese
manga illustration with Western streetwear brutalism — halftone dot
textures, oversized typography, deep purple-black backgrounds, and
high-contrast white text. The overall mood is gritty, confident,
underground.

**Logo:** The OKAMI logotype is a custom hand-lettered/distressed
wordmark (white, uppercase, slightly mirrored/stylized). Positioned
centre-top, it scales up at larger breakpoints
(`md:scale-125 lg:scale-150`), giving it commanding presence.

## 2. Color system

| Token | Value | Usage |
|---|---|---|
| `--okami-bg` | `#1E1623` / `rgb(30, 22, 35)` | Primary background — body, overlays, footer, card backgrounds |
| `--okami-dark` | `rgb(20, 20, 19)` | Slightly darker variant for footer, dark overlays |
| `--okami-cream` | `rgb(250, 249, 245)` | Near-white cream, used for light sections |
| `--white` | `#FFFFFF` | Headings, nav links, body text, icons |
| `--black` | `#000000` | Buttons (white buttons with black text), marquee text |
| `--accent-green` | (lime/bright green) | Sale prices, "hot" price tags — the only accent pop colour |
| `--white-05` | `rgba(255,255,255,0.05)` | Card borders, subtle dividers |
| `--white-10` | `rgba(255,255,255,0.10)` | Hover states on icon buttons |
| `--white-60` | `rgba(255,255,255,0.60)` | Secondary text (labels, captions) |

Background gradients used extensively:

```css
/* Nav fade-in top gradient */
background: linear-gradient(180deg, #1E1623 0%, #1E162380 75%, transparent 100%);

/* Mobile nav bottom gradient */
background: linear-gradient(0deg, #1E1623 0%, #1E1623 50%, transparent 100%);

/* Hero image top overlay */
background: linear-gradient(to bottom, #1E1623, transparent, rgba(30,22,35,0.8));

/* Hero cinematic overlay */
background: linear-gradient(to top, rgba(0,0,0,0.4), transparent, rgba(0,0,0,0.2));

/* Category card image overlay */
background: gradient-to-t from-black/80 to-transparent;
```

**Background texture — halftone dots:**

```css
body {
  background-color: #1E1623;
  background-image: radial-gradient(
    circle,
    rgba(255,255,255,0.04) 1px,
    transparent 1px
  );
  background-size: 20px 20px;
}
```

## 3. Typography system

Three custom self-hosted fonts:

```css
@font-face { font-family: OKAMI;      src: url("/assets/font/OKAMI.otf"); }
@font-face { font-family: Streetwear; src: url("/assets/font/streetwear.ttf"); }
@font-face { font-family: Inter;      src: url("/assets/font/inter.ttf"); }
```

| Font | Class | Role |
|---|---|---|
| **OKAMI** | `font-okami` | Hero headings, section titles, category labels. Tall, condensed serif with editorial high-contrast strokes |
| **Streetwear** | `font-streetwear` | Navigation links, CTAs, marquee text, buttons. Distressed/grunge bold font |
| **Inter** | `font-inter` | UI micro-labels (e.g. "MENU", "CART"), tracking-widest captions |

### Type scale (observed)

```
10px  — Micro labels ("MENU", "CART") font-inter, tracking-widest, uppercase
14px  — Product card "Select Options" buttons
16px  — Body / default
24px  — Section sub-labels (e.g. "CATEGORIES: ALL")
30px  — Navigation links (sm/md)
36px  — Mobile sub-headings
40px  — Medium headings
72px  — Hero H1 (desktop mid)
96px  — Hero H1 (desktop full — "LATEST DROP")
```

Responsive type pattern (Tailwind):

```css
/* Nav links */
text-sm md:text-base lg:text-2xl xl:text-3xl

/* Hero heading */
text-5xl md:text-7xl                       /* font-okami */

/* Categories heading */
text-3xl md:text-5xl lg:text-7xl           /* uppercase tracking-widest */

/* Category card labels */
text-3xl md:text-5xl lg:text-7xl           /* font-okami, uppercase, tracking-wider */
```

Almost everything is `uppercase`, with `tracking-wider` /
`tracking-widest`. Hero is `leading-none`.

## 4. Spacing & layout

Built on **TailwindCSS v4** with custom extensions.

```css
/* Standard content wrapper — used site-wide */
.container { width: 90%; display: flex; justify-content: center; }

/* With responsive padding */
w-[90%] px-6 md:px-8 lg:px-12
```

Grids:

```css
/* Category grid */
w-[90%] grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8

/* Product grid (shop page) */
grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6

/* Footer nav */
flex justify-around items-center
```

Z-index layers:

```
z-10  page content, sections
z-20  marquee / ticker
z-30  image overlays (hero gradient)
z-40  header background gradient (pointer-events-none)
z-50  header / nav (interactive) AND mobile bottom nav
```

Spacing constants:

- Section padding: `py-20 md:py-24`
- Card inner padding: `p-4 md:p-6 lg:p-8`
- Mobile bottom nav height: `h-20` (80 px)
- Marquee ticker padding: `py-3 md:py-4 lg:py-6`
- Marquee item horizontal margin: `mx-16` (64 px)

## 5. Component library (as-is)

### 5.1 Desktop floating top bar

```html
<!-- Transparent gradient fade (not interactive) -->
<div class="fixed top-0 left-0 right-0 h-[calc(3%+5rem)] z-40
            bg-[linear-gradient(180deg,#1E1623_0%,#1E162380_75%,transparent_100%)]
            pointer-events-none" />

<!-- Interactive nav positioned at 3% from top -->
<header class="fixed top-[3%] left-0 right-0 z-50">
  <div class="w-full flex justify-center">
    <div class="w-[90%] px-6 md:px-8 lg:px-12 py-4">
      <div class="w-full flex items-center justify-between px-[17px]">
        <!-- Left: Hamburger + Language -->
        <!-- Center: Logo (absolute centered, scales up on larger screens) -->
        <div class="absolute left-1/2 -top-2 -translate-x-1/2 md:scale-125 lg:scale-150 origin-top" />
        <!-- Right: Search + Cart -->
      </div>
    </div>
  </div>
</header>
```

### 5.2 Mobile bottom navigation

```html
<div class="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-40
            bg-[linear-gradient(0deg,#1E1623_0%,#1E1623_50%,transparent_100%)]
            backdrop-blur-xl h-20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]
            border-t border-white/5">
  <button class="flex flex-col items-center gap-1 p-2 hover:bg-white/5
                 rounded-xl transition-colors min-w-[64px] group">
    <!-- Icon -->
    <span class="text-[10px] uppercase font-inter tracking-widest text-white/60">MENU</span>
  </button>
  <a class="flex flex-col items-center gap-1 p-2 hover:bg-white/5
            rounded-xl transition-colors relative min-w-[64px] group">
    <!-- Cart icon -->
    <span class="text-[10px] uppercase font-inter tracking-widest text-white/60">CART</span>
  </a>
</div>
```

### 5.3 Hero

```html
<div class="relative w-full aspect-[4/5.5] md:aspect-auto md:h-screen">
  <div class="relative w-full h-full overflow-hidden flex items-center
              justify-center perspective-[1000px]">

    <!-- Background product image (parallax) -->
    <div class="absolute inset-0 w-full h-full will-change-transform">
      <picture class="block w-full h-full">
        <img class="w-full h-full object-cover opacity-100 transition-opacity duration-500" />
      </picture>
    </div>

    <!-- Cinematic overlays -->
    <div class="absolute inset-0 z-30 pointer-events-none
                bg-gradient-to-t from-black/40 via-transparent to-black/20" />
    <div class="absolute inset-0 bg-gradient-to-b
                from-[#1E1623] via-transparent to-okami-bg/80" />

    <!-- Text content bottom-left + CTA button bottom-right -->
    <div class="absolute bottom-[15px] left-0 right-0 z-20">
      <div class="w-[90%] px-6 md:px-8 lg:px-12 pb-20 md:pb-24">
        <div class="w-full flex items-center justify-between p-[28px]">

          <h2 class="text-white font-okami text-5xl md:text-7xl
                     leading-none mix-blend-overlay">
            LATEST<br>DROP
          </h2>

          <a class="bg-white text-black font-streetwear font-bold
                    hover:bg-white/90 transition-all active:scale-95
                    whitespace-nowrap rounded-full
                    text-[1.5em] md:text-[2em] lg:text-[2.5em]
                    flex items-center justify-center">
            ORDER NOW
          </a>

        </div>
      </div>
    </div>
  </div>
</div>
```

### 5.4 Marquee / ticker

```html
<div class="relative z-20 bg-white py-3 md:py-4 lg:py-6 overflow-hidden w-full">
  <div class="whitespace-nowrap flex w-fit animate-marquee-reverse">
    <div class="flex shrink-0">
      <span class="text-black font-streetwear font-bold
                   text-lg md:text-2xl lg:text-3xl mx-16 uppercase">
        WEAR ANIME MERCH WITH CONFIDENCE •
      </span>
      <!-- × 10 repetitions -->
    </div>
    <div class="flex shrink-0"><!-- duplicate set --></div>
  </div>
</div>
```

```css
@keyframes marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes marquee-reverse {
  0%   { transform: translateX(-50%); }
  100% { transform: translateX(0); }
}
```

### 5.5 Category card grid

```html
<div class="w-[90%] grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">

  <!-- Large card: col-span-2, landscape -->
  <a class="group relative col-span-2 aspect-[3/2]
            overflow-hidden rounded-sm cursor-pointer
            border border-white/5 block">

    <div class="relative overflow-hidden w-full h-full flex items-center justify-center">
      <div class="absolute inset-0 bg-[#1E1623] z-10 transition-transform
                  duration-700 group-hover:scale-110" />
      <!-- Image -->
      <div class="absolute inset-0 bg-black/30 group-hover:bg-black/10
                  transition-colors duration-300" />
      <div class="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent
                  to-transparent opacity-0 group-hover:opacity-100
                  transition-opacity duration-500" />
    </div>

    <div class="absolute bottom-0 left-0 right-0 p-4 md:p-6 lg:p-8
                bg-gradient-to-t from-black/80 to-transparent text-center">
      <h4 class="text-white font-okami text-3xl md:text-5xl lg:text-7xl
                 leading-none tracking-wider uppercase">
        OUTFIT
      </h4>
    </div>
  </a>

  <!-- Small card: portrait -->
  <a class="group relative aspect-[3/5] overflow-hidden rounded-sm
            cursor-pointer border border-white/5 block">
    <!-- Same inner structure -->
    <h4 class="text-white font-okami text-2xl md:text-3xl lg:text-4xl
               leading-none tracking-wider uppercase">
      HOODIES
    </h4>
  </a>

</div>
```

### 5.6 CTA buttons

```css
/* Primary — white pill */
.btn-primary {
  background: white;
  color: black;
  font-family: Streetwear;
  font-weight: bold;
  border-radius: 9999px;
  transition: all;
}
.btn-primary:hover  { background: rgba(255,255,255,0.9); }
.btn-primary:active { transform: scale(0.95); }

/* Secondary — outlined/transparent */
.btn-secondary {
  background: transparent;
  color: white;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px;
  font-family: Streetwear;
  text-transform: uppercase;
  letter-spacing: widest;
}

/* "Place Order" / "Select Options" — white pill, small */
background: white;
color: black;
border-radius: 12px;
font-size: 14px;
font-family: Streetwear;
padding: 8px 20px;
```

### 5.7 Footer

```html
<footer class="left-0 right-0 w-full bg-okami-dark py-6 z-10">
  <nav class="w-full flex justify-around items-center">
    <a class="text-white text-sm md:text-base lg:text-2xl xl:text-3xl
              font-streetwear font-medium hover:text-white/70 transition-colors">
      Home
    </a>
    <!-- Products | About Us | Contact Us -->
  </nav>
</footer>
```

## 6. Animations & micro-interactions

| Animation | Keyframe / value | Usage |
|---|---|---|
| `logoPulse` | `scale(0.85) opacity:0.5` ↔ `scale(1.1) opacity:1` | Logo breathing |
| `marquee` | `translateX(0)` → `translateX(-50%)` | Scrolling text forward |
| `marquee-reverse` | `translateX(-50%)` → `translateX(0)` | Scrolling text reverse |
| Card hover | `scale-110` on image (700 ms) | Category card zoom |
| Card shimmer | `opacity 0 → 1` on `white/10` gradient | Hover sheen |
| Dark overlay fade | `bg-black/30 → bg-black/10` (300 ms) | Card brighten on hover |
| Button press | `active:scale-95` | Tactile click |
| `transition-colors` | default Tailwind 150 ms | Nav hover |

Logo keyframes:

```css
@keyframes logoPulse {
  0%   { opacity: 0.5; transform: scale(0.85); }
  50%  { opacity: 1;   transform: scale(1.1);  }
  100% { opacity: 0.5; transform: scale(0.85); }
}
```

## 7. Background texture (recap)

Halftone dot overlay across the entire `#1E1623` surface, evoking
manga dot-screen printing:

```css
body {
  background-color: #1E1623;
  background-image: radial-gradient(
    circle, rgba(255,255,255,0.04) 1px, transparent 1px
  );
  background-size: 20px 20px;
}
```

## 8. Owner's noted upgrade list

Carried forward into [05-rebuild-strategy.md](./05-rebuild-strategy.md)
and the design-system token notes in
[06-design-system.md](./06-design-system.md).

**Performance & UX**
- `will-change: transform` only when in viewport.
- Replace spinner placeholders with shimmer/skeleton loaders.
- Blur-up placeholder images on lazy-load.

**Design upgrades**
- Glowing neon border variant for the primary CTA:
  `box-shadow: 0 0 20px rgba(255,255,255,0.3)`.
- Add a grain/noise SVG overlay at ~3 % opacity for a more analog
  feel.
- Introduce a third accent (muted gold or electric purple
  `#9B5CF6`) for "New Drop" badges, complementing the lime green.
- Glass-morphism quick-view panels:
  `backdrop-filter: blur(20px) saturate(150%)`.

**Typography**
- Variable-font optical sizing (tighten `letter-spacing` as size grows).
- `font-feature-settings: "ss01"` for ligatures on the display face.

**Interactivity**
- Real parallax depth on the hero (`translate3d` driven by scroll;
  `perspective-[1000px]` is present but unused).
- Desktop brand-colour cursor follower dot.

## 9. Tech stack — verified

| Layer | Technology |
|---|---|
| Framework | **React** (SPA, mounts on `#root`) |
| Styling | **TailwindCSS v4** (utility-first) |
| Custom fonts | 3 self-hosted (`/assets/font/OKAMI.otf`, `streetwear.ttf`, `inter.ttf`) |
| Routing | Client-side SPA (`/shop`, `/about`, `/contact`, `/cart`) |
| Commerce | Custom headless (products via API, `US` / `DA` currency switcher) |
| Animations | Pure CSS keyframes + Tailwind animation utilities |
| Layout | Flexbox + Grid, 90 % container width |
| Breakpoints | Tailwind defaults (`md:768`, `lg:1024`, `xl:1280`) |
| Images | `<picture>` with `object-cover`, lazy-loaded |

> **Important correction:** an earlier `[INFERRED]` audit assumed
> Shopify based on sister-brand domains. The owner's extraction shows
> the live site is a **React SPA on TailwindCSS v4 with a custom
> headless commerce backend**, not Shopify. The rebuild strategy is
> reconciled in [13-platform-reconciliation.md](./13-platform-reconciliation.md).
