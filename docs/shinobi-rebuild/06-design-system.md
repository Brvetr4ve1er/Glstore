# 06 — Design System

> Tokens first, components next. No design decision lives outside
> this file or its generated artefacts. Source of truth for the
> brand expression is
> [00-source-data.md](./00-source-data.md): torii-red dominant,
> sumi-black ink, seigaiha wave pattern, chibi-ninja mascot,
> kanji **忍者** accents, FR-primary voice.

## A. Design principles

1. **Red is the verb.** Every interactive surface — buy, custom,
   add — reads in torii red. The colour does the work; the type
   gets out of the way.
2. **Seigaiha is the texture.** A single Japanese wave pattern
   anchors the brand. We use it like Floema uses paper or OKAMI
   uses halftone — calm, repeated, recognisable.
3. **The mascot is the wordmark's friend.** The chibi-ninja badge
   sits next to the wordmark in nav and in OG art — never as a
   decorative animation.
4. **Honour the bilingual reader.** FR is the body voice; EN reads
   in the same line-height. Numbers + DA stay aligned.
5. **One scale, one rhythm.** 4 px base; everything is a multiple.

## B. Tokens

### B.1 Colour

```css
/* tokens/colour.css */
:root {
  /* ── Brand reds ────────────────────────── */
  --torii:        #CC0000;   /* primary action red — owner-confirmed */
  --torii-bright: #E00000;   /* hover / drop-live / signal */
  --torii-deep:   #A30000;   /* pressed / sold-out fallback */
  --torii-glow:   rgba(204, 0, 0, 0.30);

  /* ── Ink ───────────────────────────────── */
  --sumi:         #0E0E0E;   /* primary ink — near-black, warmer than #000 */
  --sumi-2:       rgba(14, 14, 14, 0.72);
  --sumi-3:       rgba(14, 14, 14, 0.50);
  --sumi-4:       rgba(14, 14, 14, 0.18);
  --sumi-5:       rgba(14, 14, 14, 0.08);
  --black:        #000000;   /* hard black — marquee text, brand-mark on white */

  /* ── Paper / surfaces (light) ─────────── */
  --washi:        #FAFAF7;   /* off-white, warm paper */
  --washi-2:      #F2F0EA;   /* alt surface */
  --washi-3:      #E6E3DA;   /* dividers, soft borders */

  /* ── Night / dark surfaces ────────────── */
  --indigo:       #0F1A2A;   /* dark navy — the seigaiha base */
  --indigo-2:     #16243A;   /* raised dark surface */
  --indigo-3:     #1F2F47;   /* card on dark */

  /* ── Inks on dark ─────────────────────── */
  --white:        #FFFFFF;
  --w90: rgba(255,255,255,0.90);
  --w80: rgba(255,255,255,0.80);
  --w70: rgba(255,255,255,0.70);
  --w60: rgba(255,255,255,0.60);
  --w50: rgba(255,255,255,0.50);
  --w30: rgba(255,255,255,0.30);
  --w20: rgba(255,255,255,0.20);
  --w10: rgba(255,255,255,0.10);
  --w05: rgba(255,255,255,0.05);

  /* ── Accents ──────────────────────────── */
  --gold:         #D7A33A;   /* limited / drop / "rare" badge */
  --cherry:       #FFB5C5;   /* sakura accent, used sparingly in editorial */
  --jade:         #2E8B57;   /* in-stock signal (distinct from torii) */

  /* ── Status ───────────────────────────── */
  --ok:           #2E8B57;
  --warn:         #C68A00;
  --err:          #C0273B;
  --info:         #2F6FB4;
}
```

Contrast invariants (CI-enforced):

| Pair | Target |
|---|---|
| `--sumi` on `--washi`              | ≥ 7 : 1 |
| `--sumi-2` on `--washi`            | ≥ 4.5 : 1 (secondary text) |
| `--torii` on `--washi`             | ≥ 4.5 : 1 (the "buy" action) |
| `--white` on `--torii`             | ≥ 4.5 : 1 (CTA label) |
| `--white` on `--indigo`            | ≥ 7 : 1 (dark-mode body) |
| `--gold` on `--indigo`             | ≥ 4.5 : 1 (drop badge) |
| `--white` on `--sumi`              | ≥ 7 : 1 |

### B.2 Seigaiha background

The brand's signature texture. A repeating SVG pattern of overlapping
arcs:

```css
:root {
  --seigaiha-light: url("/assets/seigaiha.svg#light");   /* ink-on-paper */
  --seigaiha-dark:  url("/assets/seigaiha.svg#dark");    /* white-on-indigo */
  --seigaiha-red:   url("/assets/seigaiha.svg#red");     /* white-on-torii */
}

body {
  background: var(--washi);
}
body.theme-dark {
  background-color: var(--indigo);
  background-image: var(--seigaiha-dark);
  background-size: 96px 48px;
  background-repeat: repeat;
}
.band-seigaiha-red {
  background-color: var(--torii);
  background-image: var(--seigaiha-red);
  background-size: 96px 48px;
  color: var(--white);
}
```

The pattern asset lives at `/preview/assets/seigaiha.svg` (see
[preview/index.html](./preview/index.html)). Faint, never loud — 4
to 8 % opacity in the pattern fill.

### B.3 Typography

Three families, in role discipline.

```css
:root {
  --f-display: "Bebas Neue", "Anton", "Impact", system-ui, sans-serif;  /* hero, section titles */
  --f-body:    "Inter Tight", "Inter", system-ui, sans-serif;            /* body, UI, admin */
  --f-kanji:   "Noto Sans JP", "Yu Gothic", "Hiragino Sans", system-ui, sans-serif; /* 忍者 accents only */
  --f-mono:    "JetBrains Mono", ui-monospace, monospace;
}
```

When the real custom OKAMI / Streetwear-style faces become available,
they drop in via `@font-face`. The display proxy (Bebas Neue / Anton)
keeps the heavy condensed feel the brand uses today on Instagram.

Type scale (clamp-driven):

| Token | Mobile → Desktop | Family | Use |
|---|---|---|---|
| `--t-hero`     | `clamp(44px, 6vw + 1rem, 96px)`   | display | Hero |
| `--t-display`  | `clamp(32px, 4vw + 1rem, 64px)`   | display | Section titles |
| `--t-h1`       | `clamp(26px, 2vw + 1rem, 40px)`   | display | Page title |
| `--t-h2`       | `clamp(22px, 1.2vw + 0.5rem, 32px)` | display | Sub-section |
| `--t-h3`       | `18 → 22px`                       | display | Card title |
| `--t-body-lg`  | `16 → 18px`                       | body    | Lead paragraph |
| `--t-body`     | `15 → 16px`                       | body    | Body |
| `--t-body-sm`  | `13 → 14px`                       | body    | Helper text |
| `--t-label`    | `11 → 12px`                       | body    | Micro-labels (FR + EN) |
| `--t-kanji`    | `0.85em of host`                  | kanji   | "忍者" accents inline |
| `--t-num`      | `14 → 16px`                       | mono    | Prices, DA, SKUs |

Letter-spacing:

| Token | Value | Use |
|---|---|---|
| `--ls-display`  | `0.04em` | Display caps |
| `--ls-cta`      | `0.10em` | CTA uppercase |
| `--ls-label`    | `0.16em` | Micro-label all-caps |
| `--ls-body`     | `0`      | Body |

### B.4 Spacing — 4 px system

```css
:root {
  --s-1: 4px;  --s-2: 8px;   --s-3: 12px; --s-4: 16px; --s-5: 20px;
  --s-6: 24px; --s-7: 32px;  --s-8: 40px; --s-9: 48px; --s-10: 64px;
  --s-11: 80px; --s-12: 96px; --s-13: 128px;
}
```

Section rhythm: `--s-12` between majors on desktop, `--s-10` on
tablet, `--s-9` on mobile.

### B.5 Radius

```css
:root {
  --r-0: 0;
  --r-1: 4px;
  --r-2: 8px;
  --r-3: 12px;      /* cards */
  --r-4: 16px;      /* sheets */
  --r-pill: 9999px; /* CTAs, chips */
  --r-circle: 50%;  /* mascot badge */
}
```

Brand default: **soft-corner cards** (`--r-3`) — softer than OKAMI's
hard edge, harder than Floema's editorial.

### B.6 Shadows / elevation

Lifts come from contrast on the seigaiha bands and from a single
torii glow on hover.

```css
:root {
  --e-1: 0 1px 2px rgba(14, 14, 14, 0.06);
  --e-2: 0 4px 12px rgba(14, 14, 14, 0.10);
  --e-3: 0 16px 32px -8px rgba(14, 14, 14, 0.16);
  --e-torii: 0 0 24px var(--torii-glow);   /* CTA hover */
}
```

### B.7 Motion

```css
:root {
  --d-fast: 120ms;
  --d-base: 240ms;
  --d-slow: 520ms;

  --ease-shuriken: cubic-bezier(0.16, 1, 0.3, 1);     /* primary — snap-in */
  --ease-koi:      cubic-bezier(0.34, 1.56, 0.64, 1); /* delight — overshoot */
  --ease-inout:    cubic-bezier(0.65, 0, 0.35, 1);
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Two named curves so future engineers don't write `cubic-bezier(…)`
inline. `--ease-shuriken` is the snap; `--ease-koi` is the bounce.

### B.8 Z-index

```
z-10  content
z-20  marquee / hero text
z-30  image overlays
z-40  nav background gradient
z-50  nav · mobile bottom bar
z-60  dropdowns · cart drawer
z-100 modal overlay
z-110 modal surface
z-200 takeover (drop landing)
z-9999 toasts · top modal
```

### B.9 Breakpoints

```
sm   ≥  410
md   ≥  768
lg   ≥ 1024
xl   ≥ 1280
2xl  ≥ 1536
```

Container: fluid up to `1440 px`, then centred with `--s-7`
gutters.

## C. Grid

24-column grid, gutter `--s-6`, outer margin `--s-7` desktop /
`--s-4` mobile. Common splits: 12 / 24 for product+detail, 18 / 24
+ 6 / 24 for editorial+aside, full-bleed for hero + seigaiha bands.

## D. Iconography

- 24 px stroke icons (Lucide or Phosphor).
- One mascot illustration set (chibi ninja in three poses: salute,
  hold-sword, victory).
- Kanji **忍者** used as a decorative inline element next to
  section titles, never as a body-content character.

## E. Imagery rules

- PLP card aspect ratio: **3 : 4 portrait** (matches oversize tee
  on-model framing).
- PDP gallery: square, 4 × 5, and 16 × 9 mixed (flat-lay, on-model,
  detail).
- All images via `next/image`; AVIF → WebP → JPEG.
- Alt text required; CI fails the build otherwise.

## F. Theming for drops

A drop overrides:

- `--torii` (rarely; only for a special drop, e.g. a Naruto-orange
  collaboration).
- `--seigaiha-*` (rarely; e.g. a Sakura drop swaps the wave for a
  petal pattern).

Set on `<html data-drop="…">` server-side. Components read from
tokens; no per-drop overrides in component code.

## G. Tailwind v4 config (re-implementation)

```ts
// tailwind.config.ts (excerpt)
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    screens: { sm: '410px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    colors: {
      torii:        'var(--torii)',
      'torii-bright':'var(--torii-bright)',
      'torii-deep': 'var(--torii-deep)',
      sumi:         'var(--sumi)',
      'sumi-2':     'var(--sumi-2)',
      'sumi-3':     'var(--sumi-3)',
      washi:        'var(--washi)',
      'washi-2':    'var(--washi-2)',
      indigo:       'var(--indigo)',
      'indigo-2':   'var(--indigo-2)',
      white:        'var(--white)',
      gold:         'var(--gold)',
      cherry:       'var(--cherry)',
      jade:         'var(--jade)',
      ok:           'var(--ok)',
      warn:         'var(--warn)',
      err:          'var(--err)',
      info:         'var(--info)',
      black:        '#000000',
    },
    fontFamily: {
      display: ['var(--f-display)'],
      sans:    ['var(--f-body)'],
      kanji:   ['var(--f-kanji)'],
      mono:    ['var(--f-mono)'],
    },
    extend: {
      borderRadius: { card: 'var(--r-3)', sheet: 'var(--r-4)', pill: 'var(--r-pill)' },
      boxShadow: {
        '1': 'var(--e-1)', '2': 'var(--e-2)', '3': 'var(--e-3)',
        torii: 'var(--e-torii)',
      },
      backgroundImage: {
        'seigaiha-light': 'var(--seigaiha-light)',
        'seigaiha-dark':  'var(--seigaiha-dark)',
        'seigaiha-red':   'var(--seigaiha-red)',
      },
      backgroundSize: { seigaiha: '96px 48px' },
      transitionTimingFunction: {
        shuriken: 'var(--ease-shuriken)',
        koi:      'var(--ease-koi)',
        inout:    'var(--ease-inout)',
      },
      keyframes: {
        shineSweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(200%)' } },
        koiBob:    { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-3px)' } },
      },
      animation: {
        'shine-sweep': 'shineSweep 1.6s var(--ease-shuriken) infinite',
        'koi-bob':     'koiBob 2.4s ease-in-out infinite',
      },
    },
  },
} satisfies Config
```

## H. Token pipeline

`tokens/source/*.json` → `scripts/build-tokens.ts` →

- `tokens/build/tokens.css` (the CSS variables above)
- `tokens/build/tokens.ts` (typed objects for Storybook / tests)
- `tokens/build/tailwind.preset.cjs`
- `tokens/build/figma.json` (Style-Dictionary)

No hand-editing of generated files.
