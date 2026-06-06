# 06 — Design System

> Tokens first, components next. No design decision lives outside this
> file or its generated artefacts.
>
> **This file inherits the verified OKAMI brand expression** from
> [00-extracted-design-system.md](./00-extracted-design-system.md):
> the deep `#1E1623` background with a halftone overlay, the three
> self-hosted fonts (OKAMI / Streetwear / Inter), the white pill
> CTA, the white marquee, the logo-pulse animation. The rebuild
> *evolves* these — it does not replace them.

## A. Design principles

1. **Dark, gritty, confident.** OKAMI's brand is anime streetwear
   brutalism; the system stays loyal to that mood.
2. **Type carries voice.** OKAMI for display, Streetwear for action,
   Inter for UI micro-copy — the trio already extracted from the live
   site.
3. **Halftone is the texture.** A subtle radial-dot overlay reads as
   manga-print and never as decoration.
4. **One scale, one rhythm.** 4 px base, Tailwind v4 spacing tokens,
   everything is a multiple.
5. **Motion explains, never decorates.** Marquee, logo-pulse, hover
   shimmer — purposeful, reduced-motion respected.

## B. Tokens

### B.1 Colour

Tokens **mirror the verified v2 ground truth** in
[00 §2](./00-extracted-design-system.md#2-colour-system). Names are
unprefixed (matching the bundle) — no `--c-` namespace.

```css
/* tokens/colour.css — v2 source-verified */
:root {
  /* ── Surfaces ─────────────────────────── */
  --bg-base:   #1E1623;     /* body default — deep purple-black */
  --bg-deep:   #0A050D;     /* deepest void — full-bleed heroes */
  --bg-dark:   #0D0B14;     /* modals */
  --bg-mid:    #1a1520;     /* raised — nav / panels */
  --bg-card:   #251f2b;     /* card surface */
  --bg-hover:  #2a2533;     /* hover state */
  --bg-near:   #0a0a0a;     /* footer alt / near-black */

  /* ── Ink scale (white-on-dark) ────────── */
  --white: #FFFFFF;
  --w90: rgba(255,255,255,0.90);
  --w80: rgba(255,255,255,0.80);
  --w70: rgba(255,255,255,0.70);
  --w60: rgba(255,255,255,0.60);
  --w50: rgba(255,255,255,0.50);
  --w30: rgba(255,255,255,0.30);
  --w20: rgba(255,255,255,0.20);
  --w10: rgba(255,255,255,0.10);
  --w05: rgba(255,255,255,0.05);

  /* ── Semantic palette (CORRECTED — full set, not "green only") ── */
  --green:  #00C758;     /* in stock / success */
  --red:    #FB2C36;     /* sold out / danger */
  --orange: #FE6E00;     /* limited drop alert */
  --amber:  #F59E0B;     /* gold / promo highlight */
  --yellow: #EDB200;     /* "new" badge */
  --purple: #AC4BFF;     /* brand accent / aurora */
  --blue:   #3080FF;     /* info */

  /* ── Glow shadows (real elevation, no box-shadow) ── */
  --glow-w-sm:  0 0 15px rgba(255,255,255,0.10);
  --glow-w-md:  0 0 20px rgba(255,255,255,0.20);
  --glow-w-lg:  0 0 30px rgba(255,255,255,0.30);
  --glow-w-xl:  0 0 50px rgba(255,255,255,0.30);
  --glow-green: 0 0 15px rgba(34,197,94,0.20);
  --glow-red:   0 0 30px rgba(255,0,0,0.40);
}
```

Wallpaper background (CORRECTED — **external SVG with
`background-attachment: fixed`**, not a CSS gradient):

```css
body {
  background-color: var(--bg-base);
  background-image: url("/assets/icons/wallpaper.svg");
  background-position: top;
  background-size: cover;
  background-attachment: fixed;          /* the parallax pin */
  font-family: OKAMI, -apple-system, sans-serif;
  color: #fff;
}
body::after {                            /* mix-blend-overlay grain */
  content: '';
  position: fixed; inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
  opacity: 0.35;
  background: url("data:image/svg+xml;…fractalNoise…");
}
```

Contrast invariants (must hold automatically in CI):

| Pair | Target |
|---|---|
| `--white` on `--bg-base`        | ≥ 7 : 1 |
| `--w60` on `--bg-base`          | ≥ 4.5 : 1 (secondary text) |
| `#000` on `--white`             | ≥ 7 : 1 (marquee, primary CTA) |
| `--green`, `--red`, `--orange`, `--amber`, `--yellow`, `--purple`, `--blue` on `--bg-base` | ≥ 4.5 : 1 |
| Any badge text on its tinted background | ≥ 3 : 1 (badge UI exception) |

Per-drop accent override — drops can re-paint the *accent* colours
(`--purple`, `--orange`), never the base surface:

```css
:root[data-drop="toji"]    { --purple: #FF3D45; --orange: #FF8A8E; }
:root[data-drop="winter"]  { --purple: #6EC1E4; --orange: #C5E9F7; }
```

### B.2 Typography

The verified trio carries forward verbatim. Each font has a strict role
and is not used outside it.

```css
@font-face { font-family: "OKAMI";      src: url("/fonts/OKAMI.otf")      format("opentype"); font-display: swap; }
@font-face { font-family: "Streetwear"; src: url("/fonts/streetwear.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Inter";      src: url("/fonts/inter.ttf")      format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Arabic"; src: local("IBM Plex Arabic"); font-display: swap; } /* v1.1 (AR) */

:root {
  --f-display: "OKAMI", "Bricolage Grotesque", serif;            /* hero, section titles, category labels */
  --f-action:  "Streetwear", "Inter", system-ui, sans-serif;     /* nav, CTA, marquee */
  --f-ui:      "Inter", system-ui, sans-serif;                   /* micro-labels, captions */
  --f-arabic:  "IBM Plex Arabic", "Inter", system-ui, sans-serif;
  --f-mono:    "JetBrains Mono", ui-monospace, monospace;
}
```

**Role discipline.** OKAMI never appears below 24 px. Streetwear is
always uppercase. Inter carries `tracking-widest` whenever used as a
micro-label.

Scale — derived from the verified `text-5xl → text-7xl` and
`text-3xl md:text-5xl lg:text-7xl` cascades on the live site:

| Token | Mobile → Desktop | Font | Line-height | Use |
|---|---|---|---|---|
| `--t-hero`     | `clamp(48px, 6vw + 1rem, 96px)`  | OKAMI       | 0.95 | Hero "LATEST DROP" |
| `--t-display`  | `clamp(36px, 4vw + 1rem, 72px)`  | OKAMI       | 1.00 | Category cards, section titles |
| `--t-h1`       | `clamp(28px, 2vw + 1rem, 40px)`  | OKAMI       | 1.05 | Page title |
| `--t-nav`      | `clamp(14px, 1vw + 0.5rem, 30px)`| Streetwear  | 1.10 | Nav links, marquee text |
| `--t-cta`      | `clamp(14px, 1vw + 0.5rem, 40px)`| Streetwear  | 1.00 | Hero ORDER NOW pill |
| `--t-h2`       | `clamp(22px, 1.2vw + 0.5rem, 32px)` | OKAMI    | 1.15 | Sub-section |
| `--t-h3`       | `18 → 22px` | OKAMI / Streetwear | 1.25 | Sub-section |
| `--t-body`     | `15 → 16px` | Inter | 1.55 | Body |
| `--t-body-sm`  | `13 → 14px` | Inter | 1.50 | Helper text |
| `--t-micro`    | `10px`      | Inter | 1.30 | "MENU", "CART", footer status |
| `--t-mono`     | `12px`      | JetBrains Mono | 1.40 | SKUs, codes |

Letter-spacing on display tokens: `0.05em` (`tracking-wider`) and
`0.10em` (`tracking-widest`) to honour the live treatment.

Letter-spacing tokens:

| Token | Value | Use |
|---|---|---|
| `--ls-display`  | `0.05em`  | Hero / category labels (`tracking-wider`) |
| `--ls-widest`   | `0.10em`  | Section labels, "CATEGORIES: ALL" (`tracking-widest`) |
| `--ls-body`     | `0`       | Inter body |
| `--ls-cta`      | `0.06em`  | Streetwear uppercase CTAs and nav |

### B.3 Spacing — 4 px system

```css
:root {
  --s-0:  0;
  --s-1:  4px;
  --s-2:  8px;
  --s-3:  12px;
  --s-4:  16px;
  --s-5:  20px;
  --s-6:  24px;
  --s-7:  32px;
  --s-8:  40px;
  --s-9:  48px;
  --s-10: 64px;
  --s-11: 80px;
  --s-12: 96px;
  --s-13: 128px;
}
```

Section rhythm: `--s-12` between major sections on desktop,
`--s-10` on tablet, `--s-9` on mobile.

### B.4 Radius

The verified site is mixed: pills for CTAs, sharp/`rounded-sm` for
cards, `rounded-xl` for icon-button surfaces in the mobile bottom nav.

```css
:root {
  --r-0: 0;
  --r-1: 2px;       /* category cards: `rounded-sm` */
  --r-2: 4px;       /* secondary buttons */
  --r-3: 12px;      /* small white pill buttons (Place Order / Select Options) */
  --r-4: 16px;      /* mobile bottom-nav buttons (`rounded-xl`) */
  --r-pill: 9999px; /* primary CTAs */
}
```

Brand default: **hard-edge cards** (`--r-1`); pills for the primary
CTA. Streetwear feel preserved.

### B.5 Shadows / elevation

Used sparingly. Lifts come from contrast, not blur.

```css
:root {
  --e-1: 0 1px 2px rgba(20,17,15,0.06);                /* card resting */
  --e-2: 0 4px 12px rgba(20,17,15,0.10);               /* hover */
  --e-3: 0 16px 32px -8px rgba(20,17,15,0.16);         /* drawer, modal */
}
```

### B.6 Motion

```css
:root {
  --d-fast:    120ms;
  --d-base:    240ms;          /* matches Tailwind `transition-colors` defaults */
  --d-slow:    500ms;          /* card-shimmer */
  --d-card:    700ms;          /* category-card image zoom */
  --d-marquee: 18s;            /* ticker loop (verified) */

  /* Two verified custom bezier curves */
  --ease-expo:   cubic-bezier(0.16, 1, 0.3, 1);     /* primary — product hover, nav reveal, page xs */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* delight — size select, cart badge, add-to-cart */
  --ease-out:    cubic-bezier(0, 0, 0.2, 1);        /* generic */
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Verified keyframes carried forward:

```css
@keyframes logoPulse {
  0%   { opacity: 0.5; transform: scale(0.85); }
  50%  { opacity: 1;   transform: scale(1.10); }
  100% { opacity: 0.5; transform: scale(0.85); }
}
@keyframes marquee         { from { transform: translateX(0); }   to { transform: translateX(-50%); } }
@keyframes marquee-reverse { from { transform: translateX(-50%); } to { transform: translateX(0); } }
```

Allowed motions:

- `logoPulse` on the wordmark (existing).
- `marquee` / `marquee-reverse` on the ticker (existing).
- Category-card image `scale-110` at `--d-card` with `--ease-expo` on
  hover (existing).
- Card shimmer (`opacity 0 → 1` on `bg-white/10` gradient) on hover.
- Hero parallax: 4–8 % vertical `translate3d` driven by scroll.
- Cart-drawer slide and modal fade — added by the rebuild.
- Countdown ticks as opacity micro-pulse, never bounce.

### B.7 Z-index scale

```
0   page background
10  page content
20  sticky nav
30  drawer overlay
40  drawer surface
50  modal overlay
60  modal surface
70  toast container
80  full-screen takeover (drop landing)
```

### B.8 Breakpoints

```
xs   <  410
sm   ≥  410
md   ≥  768
lg   ≥ 1024
xl   ≥ 1280
2xl  ≥ 1536
```

Container: fluid up to `1440 px`, then center with `--s-7` gutters.

## C. Grid system

24-column grid, gutter `--s-6`, outer margin `--s-7` desktop / `--s-4`
mobile. Most content uses 12/24 + 12/24 splits, 18/24 + 6/24, or
full-bleed for hero + lookbook chapters.

## D. Iconography

- 24 px line-icons, 1.5 px stroke, rounded caps.
- One pack (Phosphor / Lucide) — never mix.
- Brand mark used only at navigation and in OG / favicon.

## E. Imagery rules

- Aspect ratios in product/PLP: `4 : 5` portrait card.
- Aspect ratios in lookbook: free, but never reflow on load.
- All images served via `next/image` with `srcset`; original capped at
  2400 px on the long edge.
- Format priority: AVIF → WebP → JPEG.
- Alt text required (a11y CI fails the build otherwise).

## F. Theming for drops

A drop overrides the *accent* tokens, never the surfaces:

- `--purple`, `--orange` (the two accents components actually consume).
- `--f-display` (rarely; e.g. a hand-drawn face for a special
  collaboration drop).

Set on `<html data-drop="…">` server-side from the drop record.
Components read from tokens; no per-drop overrides in components.

## G. Tailwind v4 config (re-implementation, v2-aligned)

Token names match the unprefixed v2 spec; Tailwind utilities resolve
to the live `:root` CSS variables.

```js
// tailwind.config.ts — TailwindCSS v4
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    colors: {
      /* surfaces */
      'bg-base':  'var(--bg-base)',
      'bg-deep':  'var(--bg-deep)',
      'bg-dark':  'var(--bg-dark)',
      'bg-mid':   'var(--bg-mid)',
      'bg-card':  'var(--bg-card)',
      'bg-hover': 'var(--bg-hover)',
      'bg-near':  'var(--bg-near)',
      /* ink */
      white: 'var(--white)',
      w90: 'var(--w90)', w80: 'var(--w80)', w70: 'var(--w70)', w60: 'var(--w60)',
      w50: 'var(--w50)', w30: 'var(--w30)', w20: 'var(--w20)', w10: 'var(--w10)', w05: 'var(--w05)',
      black: '#000000',
      /* semantic */
      green:  'var(--green)',
      red:    'var(--red)',
      orange: 'var(--orange)',
      amber:  'var(--amber)',
      yellow: 'var(--yellow)',
      purple: 'var(--purple)',
      blue:   'var(--blue)',
    },
    fontFamily: {
      okami:      ['OKAMI', 'system-ui', 'sans-serif'],         /* default */
      streetwear: ['Streetwear', 'Bebas Neue', 'sans-serif'],   /* CTA / marquee */
      inter:      ['Inter', 'system-ui', 'sans-serif'],         /* body / admin */
      arabic:     ['"IBM Plex Arabic"', 'Inter', 'sans-serif'],
      mono:       ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
    },
    letterSpacing: {
      tight: '-0.025em',
      '1': '0.1em', '2': '0.2em', '3': '0.3em', '4': '0.4em', '5': '0.5em',
    },
    extend: {
      borderRadius: {
        sm: '6px', md: '9px', lg: '16px', xl: '24px', '2xl': '32px', pill: '999px',
      },
      boxShadow: {
        'glow-w-sm':  'var(--glow-w-sm)',
        'glow-w-md':  'var(--glow-w-md)',
        'glow-w-lg':  'var(--glow-w-lg)',
        'glow-w-xl':  'var(--glow-w-xl)',
        'glow-green': 'var(--glow-green)',
        'glow-red':   'var(--glow-red)',
      },
      transitionTimingFunction: {
        expo:   'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        logoPulse: {
          '0%,100%': { opacity: '0.5', transform: 'scale(0.85)' },
          '50%':     { opacity: '1',   transform: 'scale(1.10)' },
        },
        marquee:         { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'marquee-reverse': { from: { transform: 'translateX(-50%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        'logo-pulse':      'logoPulse 1.5s ease-in-out infinite',
        marquee:           'marquee 18s linear infinite',
        'marquee-reverse': 'marquee-reverse 18s linear infinite',
      },
    },
  },
} satisfies Config
```

Notes:

- **No CSS-gradient halftone preset** — the background is the external
  `wallpaper.svg`, set on `<body>` not via a Tailwind utility.
- **No box-shadow elevation tokens** — only `glow-*` tokens; elevation
  is communicated by changing the surface colour (`bg-mid` → `bg-card`).
- **Easings are named `expo` and `spring`** (matching the bundle), not
  `out-x` / `in-x` / `inout-x`.

## H. Token export pipeline

`tokens/` is the source of truth. A `scripts/build-tokens.ts` job emits:

- `tokens/build/tokens.css` (the CSS variables above)
- `tokens/build/tokens.ts` (TS literal-typed objects for Storybook /
  visual tests)
- `tokens/build/tailwind.preset.js` (consumed by `tailwind.config.ts`)
- `tokens/build/figma.json` (Style-Dictionary-compatible)

Designer pushes Figma → Style Dictionary → tokens repo → PR. No
hand-editing of generated files.
