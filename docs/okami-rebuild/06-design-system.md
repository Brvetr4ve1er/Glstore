# 06 — Design System

> Tokens first, components next. No design decision lives outside this
> file or its generated artefacts.

## A. Design principles

1. **Atmosphere over ornament.** Photography does the work; UI gets out
   of the way.
2. **Quiet ink, loud accents.** A small palette so the photography and
   the drop colour can lead.
3. **One scale, one rhythm.** 4 px base; everything is a multiple.
4. **No motion for its own sake.** Movement only when it explains
   state or guides attention.
5. **Type carries voice.** A single, opinionated display face; system
   sans for everything else.

## B. Tokens

### B.1 Colour

A neutral ink-on-paper base with a citron / signal accent. Drop pages
override the accent per drop (see §F).

```css
/* tokens/colour.css */
:root {
  /* ── Surfaces ─────────────────────────── */
  --c-paper:        #F6F4EF;   /* primary background, off-white */
  --c-paper-2:      #ECE9E1;   /* alt surfaces, panels */
  --c-paper-3:      #DAD5C9;   /* dividers, hairlines */

  /* ── Ink ─────────────────────────────── */
  --c-ink:          #14110F;   /* primary text */
  --c-ink-2:        rgba(20, 17, 15, 0.72);
  --c-ink-3:        rgba(20, 17, 15, 0.50);
  --c-ink-4:        rgba(20, 17, 15, 0.18);
  --c-ink-5:        rgba(20, 17, 15, 0.08);
  --c-white:        #FFFFFF;

  /* ── Brand / accents ──────────────────── */
  --c-okami:        #E8FF52;   /* signal citron — "drop live" */
  --c-okami-soft:   rgba(232, 255, 82, 0.30);
  --c-warn:         #F2A341;   /* low stock badge */
  --c-error:        #E54B3C;   /* sold out / invalid */
  --c-ok:           #4F8F4A;   /* in stock / success */
  --c-info:         #3D7BCB;   /* informational */

  /* ── Inverse (dark hero/drop pages) ───── */
  --c-night:        #0C0A09;
  --c-night-2:      #1A1814;
}
```

Contrast invariants (must hold automatically in CI):

- `--c-ink` on `--c-paper`         : ≥ 4.5 : 1
- `--c-ink-2` on `--c-paper`       : ≥ 4.5 : 1
- `--c-okami` on `--c-night`       : ≥ 4.5 : 1
- `--c-paper` on `--c-night`       : ≥ 7 : 1
- `--c-error` on `--c-paper`       : ≥ 4.5 : 1

Per-drop accent (set on `<html data-drop="X">`):

```css
:root[data-drop="toji"]    { --c-okami: #B41A24; --c-night: #0F0606; }
:root[data-drop="winter"]  { --c-okami: #6EC1E4; --c-night: #0A1014; }
```

### B.2 Typography

Two families:

- **Display:** a strong neo-grotesque or condensed display face — e.g.
  *Migra* (commercial) or **Bricolage Grotesque** (free, variable).
  The display face is the only place the brand "shouts".
- **Body:** *Inter Tight* — free, variable, predictable rendering, good
  Arabic counterpart pairing with **IBM Plex Arabic** (free) for AR.

```css
:root {
  --f-display: "Bricolage Grotesque", "Inter Tight", system-ui, sans-serif;
  --f-body:    "Inter Tight", system-ui, sans-serif;
  --f-arabic:  "IBM Plex Arabic", "Inter Tight", system-ui, sans-serif;
  --f-mono:    "JetBrains Mono", ui-monospace, monospace;
}
```

Scale — `clamp()` driven, 1.250 minor-third on mobile, 1.333 perfect-fourth on desktop:

| Token | Mobile → Desktop | Weight | Line-height | Use |
|---|---|---|---|---|
| `--t-hero`     | `clamp(44px, 6vw + 1rem, 96px)` | 600 | 0.95 | Hero |
| `--t-display`  | `clamp(36px, 4vw + 1rem, 72px)` | 600 | 1.00 | Drop / section |
| `--t-h1`       | `clamp(28px, 2vw + 1rem, 44px)` | 600 | 1.05 | Page title |
| `--t-h2`       | `clamp(22px, 1.2vw + 0.5rem, 32px)` | 600 | 1.15 | Section title |
| `--t-h3`       | `18 → 22px` | 600 | 1.25 | Sub-section |
| `--t-h4`       | `16 → 18px` | 600 | 1.30 | Card title |
| `--t-body-lg`  | `16 → 18px` | 400 | 1.55 | Lead paragraph |
| `--t-body`     | `15 → 16px` | 400 | 1.55 | Body |
| `--t-body-sm`  | `13 → 14px` | 400 | 1.50 | Helper text |
| `--t-mono`     | `12px`      | 500 | 1.4  | Codes, SKUs |
| `--t-caption`  | `11px`      | 600 | 1.3  | Eyebrow / overline |

Letter-spacing: tighter for display, neutral for body.

| Token | Value |
|---|---|
| `--ls-display` | `-0.03em` |
| `--ls-body`    | `-0.005em` |
| `--ls-cta`     | `0.06em` (uppercase labels) |

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

```css
:root {
  --r-0: 0;
  --r-1: 4px;
  --r-2: 8px;
  --r-3: 12px;     /* cards */
  --r-4: 18px;     /* drawer / modal */
  --r-pill: 9999px;
}
```

Brand default: **hard-edge cards** (`--r-0` / `--r-1`); pills for
chips and CTAs. Streetwear feel.

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
  --d-base:  240ms;
  --d-slow:  520ms;

  --e-out:   cubic-bezier(0.19, 1, 0.22, 1);     /* page reveals */
  --e-in:    cubic-bezier(0.6, 0, 0.8, 0);
  --e-inout: cubic-bezier(0.65, 0, 0.35, 1);
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Allowed motions:

- Fade + 8 px translate-up on enter (lists, hero copy).
- Cross-fade for image swaps in PDP.
- Slide for drawer (cart, mobile menu).
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

- `--c-okami`, `--c-night`, `--c-paper`
- `--f-display` (optionally; e.g. a hand-drawn face for a special
  drop)

Set on `<html data-drop="…">` server-side from the drop record.
Components read from tokens; no per-drop overrides in components.

## G. Tailwind config (re-implementation)

```js
// tailwind.config.ts (excerpt)
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    screens: { xs: '410px', sm: '744px', md: '1024px', lg: '1280px', xl: '1440px', '2xl': '1700px' },
    colors: {
      paper: 'var(--c-paper)',
      'paper-2': 'var(--c-paper-2)',
      'paper-3': 'var(--c-paper-3)',
      ink: 'var(--c-ink)',
      'ink-2': 'var(--c-ink-2)',
      'ink-3': 'var(--c-ink-3)',
      okami: 'var(--c-okami)',
      night: 'var(--c-night)',
      warn: 'var(--c-warn)',
      error: 'var(--c-error)',
      ok: 'var(--c-ok)',
      white: 'var(--c-white)',
    },
    fontFamily: {
      display: ['var(--f-display)'],
      sans: ['var(--f-body)'],
      arabic: ['var(--f-arabic)'],
      mono: ['var(--f-mono)'],
    },
    extend: {
      spacing: Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [String(i), `var(--s-${i})`]),
      ),
      borderRadius: { card: 'var(--r-1)', drawer: 'var(--r-4)', pill: 'var(--r-pill)' },
      boxShadow: { '1': 'var(--e-1)', '2': 'var(--e-2)', '3': 'var(--e-3)' },
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
