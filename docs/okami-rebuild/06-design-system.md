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

A dark purple-black base with white type. The lime green pop is the
*only* accent. Drop pages may introduce a per-drop accent override
(see §F).

```css
/* tokens/colour.css */
:root {
  /* ── Surfaces ─────────────────────────── */
  --c-bg:           #1E1623;                  /* primary background */
  --c-bg-rgb:       30 22 35;
  --c-surface:      #241A2A;                  /* card / panel (one step up) */
  --c-dark:         rgb(20, 20, 19);          /* footer / overlays */
  --c-cream:        rgb(250, 249, 245);       /* rare light-section background */

  /* ── Type ─────────────────────────────── */
  --c-white:        #FFFFFF;
  --c-white-60:     rgba(255, 255, 255, 0.60);  /* secondary text */
  --c-white-10:     rgba(255, 255, 255, 0.10);  /* hover surfaces */
  --c-white-05:     rgba(255, 255, 255, 0.05);  /* card borders, dividers */
  --c-black:        #000000;                    /* white-button label, marquee text */

  /* ── Accents ──────────────────────────── */
  --c-lime:         #B6FF3D;                  /* sale / drop-live signal */
  --c-lime-glow:    rgba(182, 255, 61, 0.30);
  --c-violet:       #9B5CF6;                  /* "new drop" badges (added — see upgrade list) */
  --c-warn:         #F2A341;
  --c-error:        #E54B3C;
  --c-ok:           #4F8F4A;
  --c-info:         #3D7BCB;
}
```

Halftone background overlay (applied at the `<body>` level):

```css
body {
  background-color: var(--c-bg);
  background-image: radial-gradient(
    circle, rgba(255,255,255,0.04) 1px, transparent 1px
  );
  background-size: 20px 20px;
}
```

Contrast invariants (must hold automatically in CI):

- `--c-white` on `--c-bg`          : ≥ 7 : 1
- `--c-white-60` on `--c-bg`       : ≥ 4.5 : 1
- `--c-black` on `--c-white`       : ≥ 7 : 1  (marquee, primary CTA)
- `--c-lime` on `--c-bg`           : ≥ 4.5 : 1
- `--c-violet` on `--c-bg`         : ≥ 4.5 : 1

Per-drop accent override (set on `<html data-drop="…">`):

```css
:root[data-drop="toji"]    { --c-lime: #FF3D45; --c-violet: #FF8A8E; }
:root[data-drop="winter"]  { --c-lime: #6EC1E4; --c-violet: #C5E9F7; }
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
  --d-fast:  120ms;
  --d-base:  240ms;          /* matches Tailwind `transition-colors` defaults */
  --d-slow:  500ms;          /* card-shimmer */
  --d-card:  700ms;          /* category-card image zoom */
  --d-marquee: 30s;          /* ticker loop */

  --e-out:   cubic-bezier(0.19, 1, 0.22, 1);
  --e-in:    cubic-bezier(0.6, 0, 0.8, 0);
  --e-inout: cubic-bezier(0.65, 0, 0.35, 1);
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
- Category-card image `scale-110` at `--d-card` on hover (existing).
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

A drop overrides:

- `--c-lime`, `--c-violet`, optionally `--c-bg`.
- `--f-display` (rarely; e.g. a hand-drawn face for a special
  collaboration drop).

Set on `<html data-drop="…">` server-side from the drop record.
Components read from tokens; no per-drop overrides in components.

## G. Tailwind v4 config (re-implementation)

```js
// tailwind.config.ts (excerpt) — TailwindCSS v4
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    colors: {
      bg:        'var(--c-bg)',
      surface:   'var(--c-surface)',
      dark:      'var(--c-dark)',
      cream:     'var(--c-cream)',
      white:     'var(--c-white)',
      'white-60':'var(--c-white-60)',
      'white-10':'var(--c-white-10)',
      'white-05':'var(--c-white-05)',
      black:     'var(--c-black)',
      lime:      'var(--c-lime)',
      violet:    'var(--c-violet)',
      warn:      'var(--c-warn)',
      error:     'var(--c-error)',
      ok:        'var(--c-ok)',
    },
    fontFamily: {
      okami:      ['var(--f-display)'],
      streetwear: ['var(--f-action)'],
      inter:      ['var(--f-ui)'],
      arabic:     ['var(--f-arabic)'],
      mono:       ['var(--f-mono)'],
    },
    extend: {
      spacing: Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [String(i), `var(--s-${i})`]),
      ),
      borderRadius: { card: 'var(--r-1)', pill: 'var(--r-pill)' },
      backgroundImage: {
        halftone: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
      },
      backgroundSize: { halftone: '20px 20px' },
      keyframes: {
        logoPulse:       { '0%,100%': { opacity: '0.5', transform: 'scale(0.85)' }, '50%': { opacity: '1', transform: 'scale(1.10)' } },
        marquee:         { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'marquee-reverse': { from: { transform: 'translateX(-50%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        'logo-pulse':      'logoPulse 3s ease-in-out infinite',
        marquee:           'marquee 30s linear infinite',
        'marquee-reverse': 'marquee-reverse 30s linear infinite',
      },
      transitionTimingFunction: { 'out-x': 'var(--e-out)', 'in-x': 'var(--e-in)', 'inout-x': 'var(--e-inout)' },
    },
  },
} satisfies Config
```

## H. Token export pipeline

`tokens/` is the source of truth. A `scripts/build-tokens.ts` job emits:

- `tokens/build/tokens.css` (the CSS variables above)
- `tokens/build/tokens.ts` (TS literal-typed objects for Storybook /
  visual tests)
- `tokens/build/tailwind.preset.js` (consumed by `tailwind.config.ts`)
- `tokens/build/figma.json` (Style-Dictionary-compatible)

Designer pushes Figma → Style Dictionary → tokens repo → PR. No
hand-editing of generated files.
