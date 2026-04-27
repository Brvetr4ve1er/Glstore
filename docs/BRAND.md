# Brand — Ghir Laffaire

> *Fast. Reliable. Yours.*
> Inspired by Shibuya punk culture · Built for Algeria.

---

## Core palette

| Token | Hex | Role |
|---|---|---|
| **Bold Blue** | `#1E466B` | Primary anchor — trust, depth. Used for confirmed-state badges and deep card tints. |
| **Electric Blue** | `#3DA9FC` | Highlight + interaction. Primary buttons, links, focus rings, in-flight states. |
| **Neon Yellow** | `#FFD400` | Mystery + win. Active nav pill, "Sign in" CTA, headline punk-stripe underline. Highest attention. |
| **Hot Pink** | `#FF2E7A` | Punk energy. Danger / cancelled / error toasts. Crown accents on the logo. |
| **Jet Black** | `#0D0D0D` | Page surface base. Outline strokes on the logo for that comic-punk weight. |
| **Soft White** | `#F7F7F7` | Primary text. |

## Surface ramp (dark theme)

| Token | Hex | Use |
|---|---|---|
| `--color-surface-0` | `#0a0a0d` | Page background |
| `--color-surface-1` | `#0f0f15` | Sidebar |
| `--color-surface-2` | `#15151d` | Card base |
| `--color-surface-3` | `#1c1c28` | Card hover / input bg |
| `--color-surface-4` | `#2a2a3d` | Borders |

## Text ramp

| Token | Hex | Use |
|---|---|---|
| `--color-text-1` | `#f7f7f7` | Primary content |
| `--color-text-2` | `#b6b6c6` | Secondary / labels |
| `--color-text-3` | `#6b6b85` | Muted / metadata |

## Status mapping (admin)

| State family | Token used |
|---|---|
| In-flight (RESERVED, SHIPPED, CONFIRMED, etc.) | Electric Blue / Bold Blue |
| Awaiting / needs review | Neon Yellow |
| Failure / cancelled / error | Hot Pink |
| Success / delivered / paid | Emerald |
| Inactive / archived | Surface 3 + Text 3 |

---

## Typography

| Family | Use |
|---|---|
| **Inter** (300–900) | UI body + headings |
| **Bricolage Grotesque** (400–900) | Display: hero headlines, the "GHiR LAFFAiRE" wordmark italic |
| **JetBrains Mono** (400/500/700) | Numbers, SKUs, technical values (`.num` class) |

The wordmark always italicises and lowercases the lowercase `i`'s — `GHiR LAFFAiRE`. The Y in "Yours" leans right with a `transform: skewX(-3deg)` in display contexts.

---

## Motion vocabulary

| Pattern | Where |
|---|---|
| **Active nav pill** — `layoutId="nav-active-bg"` morphs the yellow background between routes | `Layout.tsx` |
| **Logo tilt** — `whileHover={{ rotate: -6, scale: 1.06 }}` + spring (320, 18) | `BrandLogo.tsx` |
| **Crown bounce** — CSS keyframe, 1.8s ease-in-out infinite | logo SVG |
| **Sparkle pulse** — CSS keyframe, 2.4s, staggered delay | logo SVG |
| **Stagger reveal** — Framer Motion variants, 0.08s stagger | dashboard stats, page-enter |
| **Modal** — gradient-top stripe + spring scale-in (380, 30) | `ui.tsx` Modal |
| **Stat hover lift** — `whileHover={{ y: -2 }}` | `StatCard` |

---

## Logo construction

The brand mark is composed of:
1. **Yellow speed lines** (3 left of cart) — momentum
2. **Bold-blue cart body** with jet-black outline — commerce + trust
3. **Neon-yellow mystery box** with jet-black `?` — the hook of the brand
4. **Hot-pink crown** above the box — punk royalty
5. **Electric-blue sparkles** (top-right + mid-right) — magic / win

All elements share the **2 px jet-black outline** to feel hand-drawn, comic-poster.

Available variants:
- 64-px favicon (`admin/public/favicon.svg`)
- 36-px sidebar header (`BrandLogo size={34}`)
- 56-px login centerpiece (`BrandLogo size={56}`)
- Pure mark (no wordmark): `<BrandLogo showWordmark={false} />`
- With tagline strip: `<BrandLogo showTagline />`

---

## Voice

| Tone | Example |
|---|---|
| Direct, confident | *"567 products synced"* (toast) |
| Bilingual fluent | UI in English; product copy + descriptions in French |
| Punk hype where it earns it | *"Punk mode on. Move fast. Stay reliable."* (sidebar callout) |
| Numbers respected | Always tabular, monospaced, with proper locale formatting |

Avoid:
- Emoji in UI (except where pictograms are intentional — category labels)
- Generic SaaS copy (*"Welcome to your dashboard"* → no. *"Live overview · Fast. Reliable. Yours."* → yes.)
- Stock illustrations. The brand mark IS the illustration system.

---

## Accessibility

- Focus ring: `2px solid var(--color-electric-blue)` with 2px offset.
- Contrast: every brand colour combo verified against AA on `--color-surface-0`. Yellow + black for CTAs is AAA.
- Motion: all decorative animations respect `prefers-reduced-motion` via Framer Motion's reduced-motion API. *(TODO: explicit query in `index.css` for the ambient CSS keyframes.)*

---

## File map

| What | Where |
|---|---|
| Design tokens | `admin/src/index.css` (`@theme` block) |
| Logo component | `admin/src/components/BrandLogo.tsx` |
| Favicon | `admin/public/favicon.svg` |
| Buttons / inputs | `admin/src/components/ui.tsx` |
| Status colour maps | `admin/src/lib/utils.ts` |
| Page title | `admin/index.html` |
