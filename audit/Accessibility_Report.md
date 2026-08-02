# GLstore — Accessibility Audit (WCAG 2.1 AA)

**Scope:** `storefront/src/**` (public shop, React 19 + Vite) and `admin/src/**` (ops dashboard, React 19 + Vite).
**Branch:** `gaming-store` @ `760b8b7` · **Audit date:** 2026-07-31 · **Read-only** — no source file was modified.
**Method:** every finding below was confirmed by reading the cited file/line, or by a repo-wide grep whose result is quoted. Nothing here is inferred from screenshots or a running app — this was a static-code audit, so items marked "verify visually" have not been confirmed in a live screen reader/browser session.
`gaming-store/` (the static GLAIVE prototype) is out of scope per the task brief (storefront/admin only).

Tooling note (CONFIRMED): neither `storefront/package.json` nor `admin/package.json` lists `eslint-plugin-jsx-a11y`, `axe`, or `pa11y`, and neither repo has any accessibility test. `grep` for `jsx-a11y|axe|pa11y` across both `package.json` files returns nothing. This is why the systemic issues below (form labels, missing ARIA on async state) are consistent across dozens of files — there is no lint gate that would catch them.

---

## Summary — top findings by severity

| # | Severity | Finding | WCAG SC |
|---|---|---|---|
| 1 | **Critical** | No form `<label>` in either app is programmatically associated with its control (no `htmlFor`/`id`, no wrapping) | 1.3.1 A, 4.1.2 A |
| 2 | **Critical** | Validation errors are shown as unassociated `<p>` text — no `aria-invalid`, no `aria-describedby`, no focus/announcement on failed submit | 3.3.1 A, 4.1.2 A, 4.1.3 AA |
| 3 | **Critical** | Global Image Queue approve/reject/primary buttons are icon-only with zero accessible name | 4.1.2 A, 1.1.1 A |
| 4 | **Critical** | Admin login password-visibility toggle is keyboard-unreachable (`tabIndex={-1}`) and has no accessible name | 2.1.1 A, 4.1.2 A |
| 5 | High | Admin `Modal` (used for every dialog in the app) has no `role="dialog"`, no `aria-modal`, no focus trap, no focus return | 2.4.3 A, 4.1.2 A |
| 6 | High | Inline errors (login failure, error boundary) are never announced — no `role="alert"`/`aria-live` anywhere in either codebase | 4.1.3 AA |
| 7 | High | `--color-text-3` fails contrast (3.3–4.0:1, needs 4.5:1) for normal-size text, and is used pervasively as hint/label/sub text | 1.4.3 AA |
| 8 | High | Admin app has **no** reduced-motion accommodation at all (storefront has two independent mechanisms; admin has neither) | 2.3.3 AAA / best practice |
| 9 | Medium | Admin app has no skip-navigation link (storefront has one) | 2.4.1 A |
| 10 | Medium | Heading hierarchy skips a level (h1→h3) on ~7 of the 12 `PageHeader`-based admin pages, and on storefront `OrderTracking` | 1.3.1 A |
| 11 | Medium | Disclosure widgets (mega menu, theme switcher) have incomplete/missing `aria-expanded`/`aria-haspopup`/`aria-controls` | 4.1.2 A |
| 12 | Low | Mobile nav drawer and mega menu trap no focus and don't return it to the trigger on close | 2.4.3 A |

---

## CRITICAL

### 1. No `<label>` is programmatically associated with its form control — repo-wide
**WCAG 1.3.1 Info and Relationships (A), 4.1.2 Name, Role, Value (A) — CONFIRMED**

`grep -r "htmlFor" storefront/src admin/src` → **zero matches** in either tree. Both shared UI kits render the label as a sibling `<label>` with no `htmlFor`, and the control as a sibling `<input>`/`<select>`/`<textarea>` with no `id`:

- `storefront/src/components/ui.tsx:64-68` (`Input`), `:109-113` (`Select`), `:137-141` (`Textarea`)
- `admin/src/components/ui.tsx:81-85` (`Input`), `:108-112` (`Textarea`), `:135-139` (`Select`)

```tsx
{label && (
  <label className="text-[10px] font-bold ...">{label}</label>
)}
...
<input ref={ref} className={...} {...props} />
```
No `id` is ever passed by any of the ~30 call sites checked (e.g. `storefront/src/pages/Checkout.tsx:135-163`, `admin/src/pages/ProductEditor.tsx:260-394`). A screen reader focusing these fields announces only the field's type (e.g. "edit text"), not what it is for. The one manually-built field, the admin login password input, has the same defect independently: `admin/src/pages/Login.tsx:92-104` — a bare `<label>` followed by a sibling `<input>`, no `htmlFor`/`id`.

This affects **every form in both applications**: storefront Checkout (name, phone, email, wilaya, commune, street, notes), admin Login, ProductEditor (name/SKU/slug/prices/offers), ProductImport, Settings, ThemeStudio.

**Fix:** give each generated `id` via `useId()` inside `Input`/`Select`/`Textarea`, set `htmlFor={id}` on the label and `id={id}` on the control (letting an explicit `id` prop passed by the caller override it, since `{...props}` is spread last).

### 2. Validation errors are visually shown but not programmatically exposed, and failed submission is silent to assistive tech
**WCAG 3.3.1 Error Identification (A), 4.1.2 Name, Role, Value (A), 4.1.3 Status Messages (AA) — CONFIRMED**

`storefront/src/components/ui.tsx:94-95` and `admin/src/components/ui.tsx:98`:
```tsx
{error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
```
This `<p>` is not linked to the input via `aria-describedby`, and the input never receives `aria-invalid="true"`. In `storefront/src/pages/Checkout.tsx:73-87`, `validate()` populates an `errors` object on failed submit but never moves focus and never announces anything — the `mut.isPending` state simply returns to `false` and the page looks unchanged to a screen reader user. The identical pattern reappears in `admin/src/pages/ProductEditor.tsx` (`error={errors.name}` etc. at lines 260, 268, 275, 364, 378, 386, 394) — confirmed by grep, same shared `Input` component, same gap.

**Fix:** wire `aria-invalid={!!error}` and `aria-describedby={error ? errorId : undefined}` in the shared `Input`/`Select`/`Textarea`; on failed `validate()`, move focus to the first invalid field and/or render a `role="alert"` summary.

### 3. Global Image Queue: approve/reject/set-primary buttons have no accessible name
**WCAG 4.1.2 Name, Role, Value (A), 1.1.1 Non-text Content (A) — CONFIRMED**

`admin/src/pages/ImageReview.tsx:504-513`, inside `QueueItemCard` (used by the `/images` global moderation queue):
```tsx
<Button variant="outline" size="sm" loading={pending} onClick={onReject}>
  <XIcon size={11} />
</Button>
<Button variant="ghost" size="sm" loading={pending} onClick={() => onApprove(false)}>
  <Check size={11} />
</Button>
<Button variant="accent" size="sm" loading={pending} onClick={() => onApprove(true)}>
  <Star size={11} />
</Button>
```
No `aria-label`, no `title`, no visible text — only a `lucide-react` SVG icon, which carries no accessible text. A screen reader announces all three as "button". Compare to the sibling per-product view (`ImageCard`, same file, lines 251-259), which does the same three actions but includes both visible text *and* a `title` attribute (`title="Rejeter"` etc.) — so the defect is specific to the global queue, not the whole feature. Since the whole point of this page is a bulk moderation queue, this makes the page's core workflow unusable non-visually.

**Fix:** add `aria-label="Rejeter"` / `"Approuver"` / `"Définir comme principale"` to the three buttons at `ImageReview.tsx:505,508,511`.

### 4. Admin login: password-visibility toggle is keyboard-unreachable and unnamed
**WCAG 2.1.1 Keyboard (A), 4.1.2 Name, Role, Value (A) — CONFIRMED**

`admin/src/pages/Login.tsx:105-112`:
```tsx
<button
  type="button"
  tabIndex={-1}
  onClick={() => setShowPw(v => !v)}
  className="absolute right-3 top-1/2 -translate-y-1/2 ..."
>
  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
</button>
```
`tabIndex={-1}` removes this control from the keyboard tab sequence entirely — a keyboard-only user cannot reach it by any means (there is no other control that toggles visibility). It also has no `aria-label`, so even if reached (e.g. via a screen reader's "next control" gesture, which does not respect `tabIndex=-1` the same way but still surfaces no name) it announces as an unnamed button.

**Fix:** remove `tabIndex={-1}` and add `aria-label={showPw ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}`.

---

## HIGH

### 5. Admin `Modal` has no dialog semantics and no focus management
**WCAG 2.4.3 Focus Order (A), 4.1.2 Name, Role, Value (A) — CONFIRMED**

`admin/src/components/ui.tsx:216-257` — the one shared `Modal` component used for every admin dialog:
```tsx
<motion.div className={cn('fixed inset-0 z-50 flex items-center justify-center p-4')} ...>
  <motion.div className={cn('glass w-full flex flex-col max-h-[90vh] relative', maxWidth)} ...>
```
No `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby` (despite rendering a `title` prop as an `<h2>` right there at `:244` that could trivially be referenced), no focus moved into the dialog on open, no focus trap (Tab can reach controls behind the backdrop, which are only visually hidden), and no focus returned to the triggering element on close. Escape-to-close is also not implemented (only backdrop click / explicit close button at `:245-248`).

Compare to `storefront/src/components/ProductGallery.tsx:121-130`, whose fullscreen lightbox *does* set `role="dialog" aria-modal="true" aria-label=...` and Escape-to-close (`ProductGallery.tsx:32`) — so the pattern is known in this codebase, just not applied to the admin `Modal`, which is the more consequential of the two since it backs every confirmation/edit dialog in the ops console.

**Fix:** add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title `id`; on open, move focus to the dialog (or first focusable descendant); on close, return focus to the element that opened it; trap Tab within the dialog while open; handle `Escape`.

### 6. No `aria-live`/`role="alert"` anywhere in either codebase — inline errors are silent to screen readers
**WCAG 4.1.3 Status Messages (AA) — CONFIRMED**

`grep -r "aria-live\|role=\"status\"\|role=\"alert\"" storefront/src admin/src` → **zero matches**. Concretely:

- `admin/src/pages/Login.tsx:116-124` — the login-failure message (`{err && <motion.p>...}`) has no `role="alert"`/`aria-live`. A screen reader user who submits wrong credentials gets no signal that anything happened.
- `storefront/src/components/ErrorBoundary.tsx:47-51` and `admin/src/components/ErrorBoundary.tsx` (same pattern) — the caught-error UI renders an `<h2>` "Oups, une erreur est survenue" but nothing moves focus to it or announces it; a screen reader user stays wherever they were and has no idea the route crashed.
- The Checkout/ProductEditor field errors from Finding 2 have the same gap at the per-field level.

The one place this *is* handled adequately is toast notifications: `react-hot-toast@2.4.1`'s internal default (`storefront/node_modules/react-hot-toast/dist/index.mjs:2`, `ariaProps:{role:"status","aria-live":"polite"}`) applies to every `toast()` call in both apps, so success/error toasts (order created, image approved, theme saved, etc.) *are* announced — this is a library default, not something this codebase implemented, and it uses `polite` even for error toasts (not `assertive`), but it is functioning. The gap is specifically the *inline* error UI that does not go through toast.

**Fix:** wrap the Login error paragraph and the ErrorBoundary heading region in `role="alert"`, and move focus to them on mount.

### 7. `--color-text-3` fails WCAG AA contrast for normal text, and is used pervasively below 18px
**WCAG 1.4.3 Contrast (Minimum) (AA) — CONFIRMED (computed from the actual token values)**

Token source: `storefront/src/index.css:39` (`--color-text-3: #6e6e7c`) and `admin/src/index.css:36` (`--color-text-3: #6b6b85`), against each app's own surface ramp.

| Pair | Storefront | Admin | AA normal-text threshold |
|---|---|---|---|
| text-3 on surface-0 | 3.99:1 | 3.83:1 | 4.5:1 — **FAIL** |
| text-3 on surface-1 | 3.84:1 | 3.70:1 | 4.5:1 — **FAIL** |
| text-3 on surface-2 | 3.60:1 | 3.52:1 | 4.5:1 — **FAIL** |
| text-3 on surface-3 | 3.27:1 | 3.26:1 | 4.5:1 — **FAIL** |

(Computed via the standard WCAG relative-luminance formula against the exact hex values in both `index.css` files; all four surface tokens fail for normal-weight text below 18pt/14pt-bold, i.e. everywhere it's actually used. They clear only the 3:1 "large text" threshold.)

This is not a hypothetical pairing — `text-3` is the designated "hint/tertiary" token and is used at 10-12px in dozens of places that are the *only* copy in their context (not decorative), e.g.:
- `storefront/src/components/ui.tsx:95` — `Input` hint text (`text-xs`, 12px)
- `storefront/src/components/ui.tsx:185` — `EmptyState` description
- `admin/src/components/ui.tsx:185` — `StatCard` label (`text-[10px]`)
- `admin/src/components/ui.tsx:279` — `PageHeader` subtitle
- Both `index.css` files' input `placeholder:text-[var(--color-text-3)]` (`ui.tsx:78` storefront, `:89` admin)

**Fix:** either lighten `--color-text-3` (e.g. to something ≥`#8a8a96`-ish on the darkest surface actually used) until it clears 4.5:1 against every surface it's paired with, or restrict its use to ≥18px/14px-bold contexts and large decorative labels only, promoting current 10-13px usages to `text-2` (which passes at 8-10:1 in both apps).

### 8. Admin app has no reduced-motion accommodation at all
**WCAG 2.3.3 Animation from Interactions (AAA) — best-practice gap, asymmetric within this codebase — CONFIRMED**

`storefront/src/index.css:257-265` has:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
and `storefront/src/App.tsx:68` wraps the whole tree in `<MotionConfig reducedMotion="user">`, so `framer-motion` animations *also* respect the OS setting.

`grep "prefers-reduced-motion" admin/src` → **zero matches**, and `admin/src/App.tsx:87-98` calls `AOS.init({ duration: 400, easing: 'ease-out-cubic', once: true, offset: 20 })` with no `disable` option (AOS does not auto-respect `prefers-reduced-motion`; it needs an explicit `disable: () => matchMedia(...).matches` callback). Admin also has no `MotionConfig` wrapper at all — its own `framer-motion` usage (the `Modal`, `StatCard` hover, `NavItem` active-pill animation, etc.) is unconditional. Combined with the perpetual-loop CSS keyframes it shares with storefront (`sparkle-pulse`, `crown-bounce`, `shimmer` — all `infinite`), admin has strictly weaker motion accommodation than storefront despite being the more animation-heavy of the two apps (it also loads AOS on top of framer-motion).

**Fix:** add the same `@media (prefers-reduced-motion: reduce)` block to `admin/src/index.css`; wrap `admin/src/App.tsx`'s tree in `<MotionConfig reducedMotion="user">`; pass `disable: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches` to `AOS.init()`.

---

## MEDIUM

### 9. Admin has no skip-navigation link
**WCAG 2.4.1 Bypass Blocks (A) — CONFIRMED**

`storefront/index.html:17` has a working skip link:
```html
<a href="#main" class="sr-only focus:not-sr-only ...">Aller au contenu</a>
```
targeting `<main id="main">` in `storefront/src/App.tsx:41`. `admin/index.html` has no equivalent element (confirmed by full read), and `admin/src/components/Layout.tsx:174` renders `<main className="flex-1 overflow-y-auto ...">` with **no `id` at all** — there is nothing to skip to even if a link were added. Every admin page sits behind a persistent 240px sidebar with a logo, store picker, 8 nav items, an easter-egg card, a theme switcher, and a user/logout block (`Layout.tsx:118-171`) — a keyboard user must tab through all of it on every route change, since `App.tsx`'s `<Routes>` remount `Layout`'s children but not `Layout` itself, so the sidebar isn't literally re-traversed on in-app navigation, but a fresh page load or reload always requires the full traversal.

**Fix:** add `id="main"` to `Layout.tsx:174`'s `<main>`, and add a skip link (mirroring `storefront/index.html:17`) to `admin/index.html`.

### 10. Heading hierarchy skips a level on most `PageHeader`-based admin pages
**WCAG 1.3.1 Info and Relationships (A) — CONFIRMED**

`admin/src/components/ui.tsx:272-284` — `PageHeader` unconditionally renders an `<h1>`. It is used at the top of 12 admin pages (`grep '<PageHeader'` → `CatalogGraph.tsx:404`, `IssueExplorer.tsx:51`, `Dashboard.tsx:40`, `ImageReview.tsx:100,361`, `Orders.tsx:41`, `OrderDetail.tsx:67`, `ProductEditor.tsx:231`, `JobsConsole.tsx:72`, `ProductImport.tsx:74`, `Products.tsx:73`, `Settings.tsx:175`, `ThemeStudio.tsx:237`). On several of these, the next heading in the page is an `<h3>` with no `<h2>` in between:

- `admin/src/pages/ProductEditor.tsx:252,319,340,354` — four `<h3>` section headers ("…", offer fields, etc.), zero `<h2>` anywhere in the file
- `admin/src/pages/Settings.tsx:186` — first section heading is `<h3>` right after the `PageHeader` `<h1>` at `:175`
- `admin/src/pages/ThemeStudio.tsx:330` — same, first heading after `PageHeader` (`:237`) is `<h3>`
- `admin/src/pages/OrderDetail.tsx:121,162,171` — same pattern
- `admin/src/pages/ProductImport.tsx:228` — same pattern (though this file also has an `<h2>` later at `:367`, so the hierarchy is inconsistent rather than uniformly h1→h3)

This breaks screen-reader users' heading-level navigation (e.g. NVDA/JAWS "next heading at this level" or the headings-list overview), which relies on levels not being skipped to convey nesting depth.

Storefront has one isolated instance of the same defect: `storefront/src/pages/OrderTracking.tsx:72` (`<h1>`) → `:175` (`<h3>`), no `<h2>` between them. The rest of storefront's headings (checked in `Home.tsx`, `Cart.tsx`, `Checkout.tsx`, `ProductDetail.tsx`, `SearchResults.tsx`) follow correct h1→h2→h3 order.

**Fix:** either demote these section headers to `<h2>` (simplest, since there is no intermediate heading they should nest under), or, if the design intent is that `PageHeader`'s title is a page banner rather than a true `<h1>`, insert real `<h2>` section headings and keep `<h3>` for true subsections.

### 11. Disclosure widgets: incomplete or missing ARIA state
**WCAG 4.1.2 Name, Role, Value (A) — CONFIRMED**

- `storefront/src/components/Navbar.tsx:107-115` — the "Toutes les catégories" mega-menu trigger has `aria-expanded={megaOpen}` (good) but no `aria-haspopup` and no `aria-controls` pointing at the menu panel rendered at `:133-160`.
- `admin/src/components/ThemeSwitcher.tsx:62-80` — the theme-preset dropdown trigger has **no `aria-expanded` at all** (confirmed: the `<button>` at `:62-67` carries only a `title` attribute), despite `FilterSidebar`'s own `Section` component (`storefront/src/components/FilterSidebar.tsx:171-179`) and Navbar's mega-menu button correctly using `aria-expanded` for the identical show/hide-panel pattern elsewhere in the same two codebases — so the omission is an inconsistency, not a missing pattern.

**Fix:** add `aria-haspopup="true" aria-controls={menuId}` to the Navbar mega-menu trigger; add `aria-expanded={open} aria-haspopup="listbox"` to `ThemeSwitcher.tsx:62-67`.

---

## LOW

### 12. Mobile nav drawer / mega menu: no focus trap, no focus return
**WCAG 2.4.3 Focus Order (A) — CONFIRMED**

`storefront/src/components/Navbar.tsx:166-212` (mobile drawer) and `:132-160` (mega menu): both are dismissed via backdrop click (`onClick={() => setMobileOpen(false)}` / outside-click listener at `:33-39`) but neither moves focus into the panel on open, traps Tab while open, or returns focus to the button that opened it on close. Lower severity than Finding 5 because these panels don't fully overlay all page content the way the admin `Modal` and the `ProductGallery` lightbox do, so the practical impact (tabbing into visually-hidden content) is smaller, but the missing "return focus to trigger" behavior still disorients keyboard users on every open/close cycle.

**Fix:** on open, focus the first interactive element in the panel; on close, return focus to the trigger button (`Navbar.tsx:55` / `:107`).

---

## Notes on what was checked and found acceptable

To keep this report to genuine findings, the following were specifically checked and are **not** flagged:

- **`ProductGallery.tsx` fullscreen lightbox** (`storefront/src/components/ProductGallery.tsx:121-172`) correctly uses `role="dialog"`, `aria-modal="true"`, `aria-label`, Escape-to-close, and arrow-key navigation (`:29-39`). This is the one dialog in either codebase that gets ARIA right — it should be the template for Finding 5's fix, not an outlier to copy from elsewhere.
- **`ProductGallery.tsx` zoom hero** (`:56-67`) is a `<div role="button" tabIndex={0}>` with a proper `onKeyDown` handler for Enter/Space (`:66`) — correctly keyboard-operable despite not being a native `<button>`.
- **`Cart.tsx` quantity stepper** (`storefront/src/pages/Cart.tsx:210-229`) has `aria-label="Diminuer"`/`"Augmenter"` on both increment/decrement buttons.
- **Checkbox/radio inputs that wrap their `<input>` inside the `<label>`** (e.g. `FilterSidebar.tsx:67-75` "En stock uniquement", `Checkout.tsx:213-222` payment method) are correctly associated via implicit wrapping — this pattern is only broken for the `Input`/`Select`/`Textarea` components, which use sibling (not wrapping) labels.
- **`lang` attributes** are set correctly per app (`storefront/index.html:2` → `lang="fr"`, `admin/index.html:2` → `lang="en"`), matching each app's actual UI language.
- **Toast notifications** are announced via `react-hot-toast`'s built-in `role="status" aria-live="polite"` default (see Finding 6 discussion) — this works out of the box and required no app-level ARIA code.
- **`no-store_id` product/image thumbnails using `alt=""`** (e.g. `admin/src/pages/Products.tsx:199`, `IssueExplorer.tsx:150`, `CatalogGraph.tsx:1354`) were checked and are adjacent to a visible text product name in every case found — empty `alt` to avoid redundant announcement is the correct choice there, not a violation.
- Primary/accent button text color (`--color-jet-black` on `--color-electric-blue`/`--color-neon-yellow`) passes AA comfortably in both apps (5.5–13.6:1, computed) — the buttons themselves are not a contrast problem.

## Full contrast computation (for reference)

Computed with the standard WCAG relative-luminance formula against the literal hex values in `storefront/src/index.css:22-53` and `admin/src/index.css:19-51`.

| Pair | Storefront | Admin |
|---|---|---|
| text-1 on surface-0/1/2/3 | 15.1–18.4:1 (pass) | 15.7–18.5:1 (pass) |
| text-2 on surface-0/1/2/3 | 8.0–9.8:1 (pass) | 8.4–9.9:1 (pass) |
| **text-3 on surface-0/1/2/3** | **3.3–4.0:1 (fail normal text)** | **3.3–3.8:1 (fail normal text)** |
| brand color as text on surfaces | 5.8–6.4:1 (pass) | 7.2–7.8:1 (pass) |
| accent (yellow) as text on surfaces | 11.3–12.5:1 (pass) | 12.7–13.8:1 (pass) |
| punk (pink) as text on surfaces | 5.1–5.6:1 (pass) | 5.1–5.6:1 (pass) |
| jet-black text on primary/accent buttons | 5.6–12.4:1 (pass) | 5.5–13.6:1 (pass) |
| white/text-1 on primary/accent buttons (not used in code — checked defensively) | 1.5–2.9:1 (would fail) | 1.3–2.4:1 (would fail) |

The last row is included only to note that the codebase avoids this failure mode by using `jet-black` (not `text-1`/white) as button-label color for `primary`/`accent` variants (`storefront/src/components/ui.tsx:16-17`, `admin/src/components/ui.tsx:22-25`) — confirmed correct, not a defect.
