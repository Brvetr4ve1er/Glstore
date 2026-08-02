# GLstore — Frontend Architecture Audit

**Date:** 2026-07-31 · **Branch:** `gaming-store` @ `760b8b7` · **Tree:** clean
**Scope:** `storefront/src/**` (React 19 + Vite), `admin/src/**` (React 19 + Vite), `gaming-store/**` (static)
**Method:** every file in both `src/` trees was read. Every claim below cites `file:line`. Findings are labelled **CONFIRMED** (read from source, reproducible by grep) or **SUSPECTED** (inferred, not proven).
**Read-only:** no source file was modified, staged, or committed.

Companion documents: `audit/_shared_context.md`, `audit/Architecture.md`. Where this report and the Chief Architect's model overlap (theme globality, the `x-store-id` read/write split), I defer to that document and only add the *client-side* half of the story.

---

## 0. The 60-second model

Two React 19 SPAs, both Vite + Tailwind v4 + TanStack Query v5 + Framer Motion + react-hot-toast + lucide, both consuming a hand-written `lib/api.ts` fetch wrapper, both driven by a **hand-mirrored copy of the same 36-token design system** (`lib/theme.ts` + `index.css`). Plus a third, entirely separate static prototype (`gaming-store/`) with its own incompatible token namespace.

The code is well-organised and unusually consistent in its *primitives*. The defects cluster in three places:

1. **Error states are the exception, not the rule.** 21 of 40 data-fetching paths render no error UI. Six of them render a *false negative* — "no results", "nothing to fix", "no orders yet" — when the request actually failed. Three render a **permanent spinner** on error.
2. **The rebrand from Ghir Laffaire → GLAIVE stopped at the storefront's front door.** The admin login screen, the admin `<title>`, the admin logo, both category dropdowns, six storefront SEO strings and the storefront `package.json` still say Ghir Laffaire. The admin's category lists cannot express a single gaming category that the seed actually ships.
3. **The design-token system is a partial fiction.** 4 of 36 tokens have zero consumers anywhere; the token *names* no longer describe their values in the storefront; ~78 generated Tailwind colour utilities are never used because every colour reference is an arbitrary-value escape hatch; and the "mirrored deliberately" theme registries have already drifted.

---

## 1. Top findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | **High** | Admin category dropdowns cannot express the shipped catalog — 7 of 8 (Products) and 16 of 16 (Editor) options match nothing in `db/seed_gaming.sql` | `admin/src/pages/Products.tsx:118-127`, `admin/src/pages/ProductEditor.tsx:17-21` |
| F2 | **High** | Six data paths render a **false negative** on error (`"Aucun résultat"`, `"Nothing to fix here"`, `"No orders yet"`, `"Rien à valider"`) — an API outage is indistinguishable from an empty result | `SearchResults.tsx:72`, `IssueExplorer.tsx:100`, `Dashboard.tsx:172`, `ImageReview.tsx:144,417`, `SearchBox.tsx:106` |
| F3 | **High** | `StoreProvider` has no error branch. A failed `GET /stores` renders the whole admin with `currentId = null` → every subsequent request omits `x-store-id` → 400 on every page, with no explanation | `admin/src/lib/store.tsx:38-42, 85-91` |
| F4 | **High** | Admin login screen is fully branded **"GHiR LAFFAiRE"** with the old palette, old tagline and `admin@ghirlaffaire.dz` placeholder | `admin/src/pages/Login.tsx:65-76,85`, `admin/index.html:7-8` |
| F5 | **Medium-High** | Three pages render a **permanent spinner** on a failed fetch — `isPending || !form` is false-then-null forever, no error, no retry | `Settings.tsx:162,547`, `ThemeStudio.tsx:208-209` |
| F6 | **Medium-High** | Cart re-validation (the *only* client-side stock/price safety net) has no error handling — on failure the user checks out against stale localStorage prices silently | `storefront/src/pages/Cart.tsx:24-30` |
| F7 | **Medium-High** | `idempotency_key` is regenerated on every submit, so a retry after a lost response creates a **duplicate order** — the exact case the key exists to prevent | `storefront/src/pages/Checkout.tsx:105` |
| F8 | **Medium** | Theme registries were "mirrored deliberately" and **have already drifted**: `midnight` sets `--color-neon-yellow` in admin, omits it in storefront | `admin/src/lib/theme.ts:157` vs `storefront/src/lib/theme.ts:97-112` |
| F9 | **Medium** | `bindPreviewChannel` accepts `postMessage` from any embedder with **no origin check** (documented as intentional) — any site that iframes the storefront can restyle it | `storefront/src/lib/theme.ts:429-459` |
| F10 | **Medium** | Admin has **zero responsive layout** — fixed 240px sidebar, `h-dvh overflow-hidden`, no breakpoint, no drawer. 10 breakpoint classes exist app-wide, none in the shell | `admin/src/components/Layout.tsx:116-118` |

---

## 2. Component Inventory

`✅ Live` = imported and rendered. `⚠️ Partial` = rendered, but has dead props/branches. `❌ Dead` = proven zero consumers.

### 2.1 Storefront (`storefront/src/`)

| Component / module | File | Used by | Status |
|---|---|---|---|
| `App` | `App.tsx` | `main.tsx:36` | ✅ Live |
| `RoutedShell`, `PageFallback` | `App.tsx:25,36` | `App.tsx:74` | ✅ Live |
| `Navbar` | `components/Navbar.tsx:20` | `App.tsx:40` | ✅ Live |
| `Footer` | `components/Footer.tsx:28` | `App.tsx:58` | ⚠️ 4 links point at non-existent routes (§4.3) |
| `BrandLogo` | `components/BrandLogo.tsx:10` | `Navbar:66,180`, `Footer:55`, `Home:175` | ✅ Live |
| `SearchBox` | `components/SearchBox.tsx:15` | `Navbar:71,102`, `Home:49`, `SearchResults:62` | ⚠️ `onNavigate` prop never passed at any of the 4 sites |
| `ProductCard` | `components/ProductCard.tsx:15` | `Home:161`, `Catalog:141`, `ProductDetail:463`, `SearchResults:89` | ⚠️ `size` prop never passed at any of the 4 sites |
| `ProductGallery` | `components/ProductGallery.tsx:12` | `ProductDetail.tsx:146` | ⚠️ `heroRef` assigned, never read (`:17,57`); lightbox lacks scroll-lock/focus-trap |
| `FilterSidebar` (+ local `Section`, `PriceInput`) | `components/FilterSidebar.tsx:31,165,199` | `Catalog.tsx:96,191` | ⚠️ 2 queries, zero loading/error states; no debounce (§4.2) |
| `SortMenu` | `components/SortMenu.tsx:10` | `Catalog.tsx:91` | ✅ Live |
| `Breadcrumbs` | `components/Breadcrumbs.tsx:9` | 7 pages | ✅ Live |
| `SEO` | `components/SEO.tsx:26` | 9 pages | ⚠️ 6 call sites still say "Ghir Laffaire" (§5.1) |
| `ScrollReveal` | `components/ScrollReveal.tsx:35` | 4 pages | ⚠️ `delay`, `once`, `amount` props never passed |
| `STAGGER_CONTAINER`, `STAGGER_ITEM` | `components/ScrollReveal.tsx:62,70` | 4 pages | ✅ Live |
| `ErrorBoundary` | `components/ErrorBoundary.tsx:15` | `App.tsx:42,73` | ✅ Live · near-verbatim duplicate of admin's |
| `Button` | `components/ui.tsx:12` | 8 files | ✅ Live |
| `Spinner` | `components/ui.tsx:43` | `App.tsx:28`, `ui.tsx:34` | ✅ Live |
| `Input` | `components/ui.tsx:61` | `Checkout`, `OrderTracking` | ✅ Live (has `leftIcon`/`rightIcon`; admin's does not) |
| `Select` | `components/ui.tsx:106` | `Checkout:171`, `SortMenu:12` | ✅ Live |
| `Textarea` | `components/ui.tsx:134` | `Checkout:201` | ✅ Live |
| `Tag` | `components/ui.tsx:160` | `ProductCard:52,62`, `ProductDetail:178` | ✅ Live |
| `EmptyState` | `components/ui.tsx:176` | 5 pages | ✅ Live |
| `Card` | `components/ui.tsx:192` | `OrderTracking.tsx:80` | ✅ Live (1 consumer) |
| `CartProvider` / `useCart` | `lib/cart.tsx:131,172` | `App:67` + 4 pages | ✅ Live |
| `pushRecent` | `lib/recently-viewed.ts:17` | `ProductDetail.tsx:35` | ⚠️ Write-only — nothing reads it |
| `getRecent` | `lib/recently-viewed.ts:6` | internal only | ⚠️ Exported, no external consumer |
| **`useRecentlyViewed`** | **`lib/recently-viewed.ts:30`** | **nothing** | **❌ Dead — proven** |
| **`pluralize`** | **`lib/format.ts:31`** | **nothing** | **❌ Dead — proven** |
| `slugify` | `lib/format.ts:22` | tests only (`__tests__/format.test.ts`) | ⚠️ No production consumer; re-implemented in `admin/src/pages/ProductEditor.tsx:25` |
| `cn`, `fmtMoney`, `fmtNumber`, `categoryIcon` | `lib/format.ts` | widely | ✅ Live |
| `deriveTags` | `lib/tags.ts:37` | `ProductCard:16`, `ProductDetail:78` | ⚠️ Spec keys are appliance-era (`btu`, `capacity_l`, `energy_class`, `smart_tv`) — §5.2 |
| `WILAYAS` | `lib/wilayas.ts` | `Checkout.tsx:178` | ✅ Live |
| theme: `applyTheme`, `loadCached`, `refreshThemeFromServer`, `bindCrossTabSync`, `bindPreviewChannel` | `lib/theme.ts` | `main.tsx:16-32` | ✅ Live |
| `cache` | `lib/theme.ts:363` | internal only | ⚠️ Exported unnecessarily |
| Pages (9) | `pages/*.tsx` | `App.tsx:14-22` lazy routes | ✅ All 9 routed |

### 2.2 Admin (`admin/src/`)

| Component / module | File | Used by | Status |
|---|---|---|---|
| `App`, `AppRoutes`, `RequireAuth` | `App.tsx:87,38,33` | `main.tsx` | ✅ Live |
| `Layout` (+ `NavItem`, `StorePicker`) | `components/Layout.tsx:106,23,65` | `App.tsx:63` | ⚠️ No responsive shell (F10) |
| `BrandLogo` | `components/BrandLogo.tsx` | `Layout:124`, `Login:65` | ⚠️ Hardcodes the **old** palette — ignores the theme entirely (§5.3) |
| `ThemeSwitcher` | `components/ThemeSwitcher.tsx:20` | `Layout.tsx:149` | ⚠️ Theme query has no error branch; French-only UI |
| `IssuePanel` (+ 8 local sub-components) | `components/IssuePanel.tsx:61` | `pages/ProductDetail.tsx:132` | ⚠️ `if (!data) return null` (`:91`) — panel vanishes on error |
| `ErrorBoundary` | `components/ErrorBoundary.tsx:15` | `App.tsx:55,104` | ✅ Live · duplicate of storefront's; French copy |
| `Button` | `components/ui.tsx:15` | 10 files | ✅ Live |
| `Spinner` | `components/ui.tsx:55` | 11 files | ✅ Live |
| `Badge` | `components/ui.tsx:69` | `Dashboard`, `Orders`, `OrderDetail`, `ProductDetail` | ✅ Live |
| `Input` | `components/ui.tsx:78` | `Login`, `IssuePanel`, `ProductEditor`, `Settings` | ⚠️ No icon slots → `Login.tsx:96-113` hand-rolls a password field |
| `Textarea` | `components/ui.tsx:105` | `IssuePanel:28`, `ProductEditor:15` | ✅ Live |
| `Select` | `components/ui.tsx:132` | `Products`, `Orders`, `JobsConsole`, `ProductEditor`, `Settings` | ⚠️ No `error` prop (storefront's has one) |
| `Card` | `components/ui.tsx:156` | 8 files | ✅ Live |
| `StatCard` | `components/ui.tsx:161` | `Dashboard:53`, `ImageReview:373` | ✅ Live |
| `Modal` | `components/ui.tsx:216` | `OrderDetail.tsx:7` | ⚠️ No `role="dialog"`, no `aria-modal`, no focus trap, no Escape, no scroll-lock (§6.4) |
| `EmptyState` | `components/ui.tsx:260` | 7 files | ✅ Live |
| `PageHeader` | `components/ui.tsx:272` | 9 pages | ✅ Live |
| `AuthProvider` / `useAuth` | `lib/auth.tsx:21,62` | `App:102`, `Layout:107`, `Login:11` | ⚠️ Malformed JWT → `NaN < Date.now()` is false → bad token never cleared (`:30`) |
| `StoreProvider` / `useStore` | `lib/store.tsx:37,96` | `App:63`, `Layout:66` | ⚠️ F3 + writes localStorage during render (`:58-60`) |
| `applyTheme`, `PRESETS`, `withOverride`, `resolveTheme`, `presetKeys`, `importThemeJson`, `exportThemeJson`, `loadCachedTheme`, `bindCrossTabSync`, `TOKENS` | `lib/theme.ts` | `App`, `main`, `Settings`, `ThemeStudio`, `ThemeSwitcher` | ✅ Live |
| `cacheKey`, `tokenSpec`, `isPresetKey`, `cacheTheme`, `ALL_TOKEN_KEYS` | `lib/theme.ts:34,118,403,468,113` | internal to `theme.ts` only | ⚠️ Exported with no external consumer |
| **`readLive`** | **`lib/theme.ts:527`** | **nothing (0 refs internal or external)** | **❌ Dead — proven** |
| **`blankTheme`** | **`lib/theme.ts:565`** | **nothing (0 refs internal or external)** | **❌ Dead — proven** |
| `cn`, `fmtMoney`, `fmtDate`, `fmtAgo`, `fmtPercent`, `*_STATUS_COLORS` | `lib/utils.ts` | widely | ✅ Live |
| Pages (14 modules, 15 routes) | `pages/*.tsx` | `App.tsx:17-31` | ✅ All routed (`ImageReview` exports both `default` and `GlobalImageQueue`) |

### 2.3 Proven-dead CSS

| Class | Declared | Consumers |
|---|---|---|
| `.speed-lines` | `admin/src/index.css:180` | **0 in either app** |
| `.glow-pink` | `admin/src/index.css:161`, `storefront/src/index.css:179` | **0 in either app** |
| `.crown-bounce` | `storefront/src/index.css:282-286` | **0 in storefront** (used only by `admin/src/components/BrandLogo.tsx:65`) |

---

## 3. Data-fetching audit — does every path handle loading AND error?

**Answer: no. 21 of 40 paths have no error branch.** Six of those render a false negative; three hang.

`L` = loading state · `E` = error state · `∅` = empty state.

### 3.1 Storefront — 14 paths

| # | Path | File:line | L | E | ∅ | Note |
|---|---|---|---|---|---|---|
| 1 | `catalog` list | `pages/Catalog.tsx:40` | ✅ | ✅ | ✅ | **Reference implementation** — copy this |
| 2 | `product` detail | `pages/ProductDetail.tsx:27` | ✅ | ✅ | n/a | Good |
| 3 | `related` products | `pages/ProductDetail.tsx:54` | ❌ | ❌ | ✅ | Acceptable — section hides |
| 4 | `featured` (Home) | `pages/Home.tsx:15` | ✅ | ❌ | ❌ | Error → silent empty grid |
| 5 | `categories` (Home) | `pages/Home.tsx:16` | ❌ | ❌ | ❌ | Error → empty category grid, no message |
| 6 | `categories` (Navbar) | `components/Navbar.tsx:26` | ❌ | ❌ | ❌ | Mega-menu + mobile drawer render empty |
| 7 | `search-suggest` | `components/SearchBox.tsx:51` | ✅ | ❌ | ✅ | **False negative** — `:106` shows "Aucun résultat" on network error |
| 8 | `search` results | `pages/SearchResults.tsx:28` | ✅ | ❌ | ✅ | **False negative** — `:72` shows "Aucun résultat pour …" on error |
| 9 | `brands` (filter) | `components/FilterSidebar.tsx:32` | ❌ | ❌ | ❌ | Brand facet silently empty |
| 10 | `price-bounds` | `components/FilterSidebar.tsx:33` | ❌ | ❌ | ❌ | Falls back to `0 … 1 000 000` placeholders (`:35-36`) — shows fabricated bounds |
| 11 | `offer-availability` | `pages/Cart.tsx:24` | ❌ | ❌ | n/a | **F6 — safety-critical** |
| 12 | `createOrder` (mut) | `pages/Checkout.tsx:38` | ✅ | ⚠️ | n/a | Toast only, no inline/persistent error |
| 13 | `trackOrder` (mut) | `pages/OrderTracking.tsx:51` | ✅ | ⚠️ | n/a | Error copy hardcoded to "no match" (`:115`) — a 500 reads as a wrong order number |
| 14 | `storefront/theme` | `lib/theme.ts:370` | n/a | ✅ | n/a | Deliberate silent fallback, documented at `:379-383`. Correct. |

### 3.2 Admin — 26 paths

| # | Path | File:line | L | E | ∅ | Note |
|---|---|---|---|---|---|---|
| 1 | `stores` | `lib/store.tsx:38` | ⚠️ | ❌ | ❌ | **F3** — gate at `:85` only fires while `isLoading`; on error it renders through with no store |
| 2 | `dashboard-stats` | `pages/Dashboard.tsx:19` | ✅ | ❌ | n/a | Error → three "0" stat cards presented as fact |
| 3 | `enrichment-stats` | `pages/Dashboard.tsx:20` | ✅ | ❌ | n/a | Error → 0% completeness bar |
| 4 | `orders-recent` | `pages/Dashboard.tsx:25` | ✅ | ❌ | ✅ | **False negative** — `:172` "No orders yet" |
| 5 | `products` | `pages/Products.tsx:31` | ✅ | ✅ | ✅ | Good |
| 6 | `enrichAll` (mut) | `pages/Products.tsx:42` | ✅ | ✅ | n/a | Good |
| 7 | `orders` | `pages/Orders.tsx:18` | ✅ | ✅ | ✅ | Good |
| 8 | `order` detail | `pages/OrderDetail.tsx:18` | ✅ | ✅ | n/a | Good |
| 9-10 | confirm / cancel (muts) | `pages/OrderDetail.tsx:25,36` | ✅ | ✅ | n/a | Good |
| 11 | `product` detail | `pages/ProductDetail.tsx:16` | ✅ | ✅ | n/a | Good |
| 12-13 | enrich / intel (muts) | `pages/ProductDetail.tsx:22,35` | ✅ | ✅ | n/a | ⚠️ Intel poll is uncancellable (§4.5) |
| 14 | `product` (editor hydrate) | `pages/ProductEditor.tsx:63` | ✅ | ❌ | n/a | Error → blank "edit" form rendered as if the product were empty |
| 15-16 | preview / commit import (muts) | `pages/ProductImport.tsx` | ✅ | ✅ | n/a | Good |
| 17 | `issues-summary` | `pages/IssueExplorer.tsx:36` | ❌ | ❌ | n/a | All tab counts silently 0 |
| 18 | `issues-list` | `pages/IssueExplorer.tsx:42` | ✅ | ❌ | ✅ | **False negative** — `:100-105` "Nothing to fix here" on error. Also hardcoded `page 1, size 100` with no pagination while showing "Showing N of M" (`:44,121`) |
| 19 | `product` (image review) | `pages/ImageReview.tsx:50` | ⚠️ | ❌ | n/a | Header shows "Chargement…" forever |
| 20 | `product-images` | `pages/ImageReview.tsx:55` | ✅ | ❌ | ✅ | **False negative** — `:144` "Rien à valider" |
| 21-22 | global queue + summary | `pages/ImageReview.tsx:~370,413` | ✅ | ❌ | ✅ | **False negative** at `:417` |
| 23 | `jobs-stats` | `pages/JobsConsole.tsx:48` | ✅ | ❌ | n/a | Stat tiles show 0 |
| 24 | `jobs-list` | `pages/JobsConsole.tsx:54` | ✅ | ✅ (`:167`) | ✅ | Good |
| 25 | `catalog-graph` | `pages/CatalogGraph.tsx:204` | ✅ (`:441`) | ✅ (`:446`) | ✅ | Good — the only page with `refetch()` wired to the error UI |
| 26 | `llm-config` | `pages/Settings.tsx:39` | ✅ | ❌ | n/a | **F5 — permanent spinner.** `:162` `if (cfgQuery.isPending \|\| !form)`; the hydration effect (`:47-61`) only runs on `data`, so on error `form` stays `null` forever |
| 27 | `theme` (admin, Settings) | `pages/Settings.tsx:~540` | ✅ | ❌ | n/a | **F5** — same shape at `:547` |
| 28 | `theme` ×2 (Studio) | `pages/ThemeStudio.tsx:208-209` | ✅ | ❌ | n/a | **F5** — `isPending \|\| !draft` |
| 29 | `theme` (switcher) | `components/ThemeSwitcher.tsx:25` | ❌ | ❌ | n/a | `onPick` early-returns if `!theme` (`:49`) — switcher becomes a silent no-op |
| 30 | `product-issues` | `components/IssuePanel.tsx:65` | ✅ | ❌ | ✅ | `:91` `if (!data) return null` — the whole quality panel disappears |

### 3.3 The pattern

`Catalog.tsx:117-130` is the correct shape and exists in the codebase already:

```
isPending ? <skeleton/> : isError ? <EmptyState title="Erreur" …/> : items.length === 0 ? <EmptyState …/> : <grid/>
```

It is used in **4 of 40** paths. Everywhere else the ternary collapses to `isPending ? … : items.length === 0 ? …`, which is why an error and an empty set are indistinguishable to the user. This is a mechanical, low-risk fix.

---

## 4. Findings in detail

### F1 — Admin category lists cannot express the shipped catalog · **High** · CONFIRMED

`db/seed_gaming.sql` ships exactly seven categories: `Headsets` (3), `Keyboards` (3), `Mice` (3), `Mousepads` (2), `Accessories` (2), `Controllers` (1), `Audio` (1).

- `admin/src/pages/Products.tsx:118-127` offers: Smartphone, Laptop, Tablet, TV, Refrigerator, Washing Machine, **Audio**, Accessory. **Only `Audio` matches.** Every other option filters to zero rows.
- `admin/src/pages/ProductEditor.tsx:17-21` offers 16 categories — Smartphone … AC, Accessory, `Gaming`. **Not one gaming category is present.** An operator creating a GLAIVE headset cannot assign it `Headsets`, so it will never appear under the storefront's `/c/Headsets` route (`storefront/src/components/Navbar.tsx:14`) or in `categoryIcon`'s map (`storefront/src/lib/format.ts:36-42`, which *is* gaming-correct).

These are also **two divergent hardcoded lists inside one app** (8 vs 16 entries, different spellings: `Accessory` vs `Accessories`). A `GET /categories` endpoint already exists and is already consumed by the storefront (`storefront/src/lib/api.ts:100`); the admin's `lib/api.ts` never wraps it.

**Fix:** delete both literals, add `fetchCategories()` to `admin/src/lib/api.ts`, drive both selects from it.

### F2 — Six false-negative empty states · **High** · CONFIRMED

Listed in §3. The severity is not cosmetic: `IssueExplorer` is the catalog-quality triage tool, and on a backend blip it tells the operator **"Nothing to fix here · No products match this issue"** (`admin/src/pages/IssueExplorer.tsx:102-103`). `Dashboard` reports **"No orders yet"** (`:175`). A merchant reading either of those makes a business decision on a lie.

### F3 — `StoreProvider` has no error branch · **High** · CONFIRMED

```
admin/src/lib/store.tsx:85
  if (!resolvedId && isLoading) { return <Spinner/> }
```

On a failed `GET /stores`: `isLoading` → `false`, `data` → `undefined`, `stores` → `[]`, `resolvedId` → `persisted` (often `null`). The guard falls through and renders the app. `StorePicker` returns `null` at `:68`, so the operator sees **no indication anything is wrong**. Meanwhile `admin/src/lib/api.ts:37-38` only sets `x-store-id` when `getSelectedStoreId()` is truthy — so every request goes out unscoped. Per `audit/_shared_context.md` §4, a platform operator (`store_id IS NULL`) then gets **400 on every admin route**.

Secondary: `store.tsx:58-60` writes `localStorage` **during render**. The docstring (`:21-25`) justifies this as necessary to beat the first child query. It works, but it makes the render impure — under React 19 StrictMode double-render it writes twice, and any future `useSyncExternalStore`/concurrent-rendering change will surface it. An effect + a render gate (`if (!resolvedId) return <Spinner/>`) achieves the same guarantee safely.

### F4 — Rebrand did not reach the admin · **High** · CONFIRMED

| Location | Content |
|---|---|
| `admin/src/pages/Login.tsx:68-69` | `GHiR LAFFAiRE` wordmark |
| `admin/src/pages/Login.tsx:72` | `Fast · Reliable · Yours` |
| `admin/src/pages/Login.tsx:85` | placeholder `admin@ghirlaffaire.dz` |
| `admin/src/pages/Login.tsx:133` | `Inspired by Shibuya punk · Built for Algeria` |
| `admin/index.html:7-8` | `<title>Ghir Laffaire — Admin Console</title>` |
| `admin/index.html:6` | `theme-color="#0D0D0D"` (old jet-black) |
| `admin/src/index.css:4` | header comment `GHIR LAFFAIRE — Design Tokens` |
| `admin/src/components/BrandLogo.tsx:34,43,64,69` | hardcoded `#FFD400`, `#1E466B`, `#FF2E7A`, `#3DA9FC` — the old palette |
| `admin/src/components/ui.tsx:1` | `Unified UI primitives — Ghir Laffaire brand` |
| `storefront/package.json:2` | `"name": "ghir-laffaire-storefront"` |
| `storefront/src/pages/Cart.tsx:79,101` | SEO `"Votre panier — Ghir Laffaire"` |
| `storefront/src/pages/Checkout.tsx:54,113` | SEO `"Finaliser votre commande — Ghir Laffaire"` |
| `storefront/src/pages/OrderConfirmation.tsx:24` | SEO `"…enregistrée — Ghir Laffaire"` |
| `storefront/src/pages/OrderTracking.tsx:66` | SEO `"…votre commande Ghir Laffaire…"` |
| `storefront/src/pages/SearchResults.tsx:42` | SEO `"Résultats pour … sur Ghir Laffaire."` |
| `storefront/src/pages/Catalog.tsx:59` | SEO `"électroménager, smartphones, TV, audio, accessoires"` — appliance copy on a gaming catalog |

The storefront strings are `<meta name="description">` values (`components/SEO.tsx:36`), so they reach search engines and social previews. The admin ones are the first thing an operator sees.

### F5 — Permanent spinner on failed fetch · **Medium-High** · CONFIRMED

`admin/src/pages/Settings.tsx:162`:
```tsx
if (cfgQuery.isPending || !form) { return <Spinner/> }
```
`form` is populated only by the effect at `:47-61`, which is gated on `cfgQuery.data`. On error `isPending` is `false` and `data` is `undefined`, so `form` stays `null` and the condition stays `true` **forever**. No error, no retry, no navigation hint. Identical shape at `Settings.tsx:547` (admin theme) and `ThemeStudio.tsx:208-209` (both scopes).

### F6 — Cart re-validation failure is silent · **Medium-High** · CONFIRMED

`storefront/src/pages/Cart.tsx:24-30` fetches `POST /offers/availability` — per `audit/Architecture.md` §4(a) step 6 this is the mechanism that catches price changes and stock exhaustion between "add to cart" and "checkout". It destructures `{ data: avail }` only. The reconcile effect (`:37`) opens with `if (!avail) return`.

On failure: no toast, no banner, no disabled checkout. `liveByOfferId` (`:94`) is empty, so `CartLine` renders no warnings (`:161`), the `+` button falls back to `item.available` from localStorage (`:224`), and the summary shows the cached `cart.subtotal`. The user proceeds to `/checkout` believing stale prices and stale stock. The order then fails server-side (or succeeds at a price the customer never saw).

**Minimum fix:** surface `isError` as a banner and disable "Passer la commande" until a successful revalidation.

### F7 — Idempotency key defeats itself · **Medium-High** · CONFIRMED

`storefront/src/pages/Checkout.tsx:105`:
```ts
idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
```
This runs inside `onSubmit`, so **every submit attempt gets a new key**. The backend's `(store_id, idempotency_key)` partial unique index (`audit/_shared_context.md` §3) can therefore never collapse a retry. The realistic failure: order POST succeeds server-side, response is lost (mobile network, common in the target market), user taps "Confirmer la commande" again → a second key → a second order, second stock reservation, second COD delivery.

The `loading={mut.isPending}` on the button (`:262`) covers only the in-flight double-click, not the post-failure retry.

**Fix:** generate the key once per cart contents — e.g. `useMemo` keyed on the cart signature, or persist it alongside the cart in localStorage and clear it in `onSuccess` next to `cart.clear()` (`:42`).

### F8 — Theme registries have already drifted · **Medium** · CONFIRMED

`storefront/src/lib/theme.ts:17-19` documents the decision:
> "The token list and presets are mirrored from admin/src/lib/theme.ts deliberately — keeping these as separate copies is simpler than extracting a shared package…"

I diffed all 11 presets × 36 tokens across both files. **10 presets are byte-identical; `midnight` is not.**

| | admin | storefront |
|---|---|---|
| `midnight` → `--color-neon-yellow` | `#FFD400` (`admin/src/lib/theme.ts:157`) | **absent** (`storefront/src/lib/theme.ts:97-112`) |

Consequence: with the `midnight` preset selected, the admin renders accents in `#FFD400` while the storefront falls back to its `index.css` default `#FFC400` (`storefront/src/index.css:24`). One preset, two brands. This is the first drift; there is no test, lint rule, or CI check that would catch the second.

### F9 — `postMessage` preview channel has no origin check · **Medium** · CONFIRMED

`storefront/src/lib/theme.ts:441-455` accepts `{ type: 'gl:theme:preview', theme }` from `window.parent` and applies it. Lines 429-432 state the omission is intentional ("we don't validate origin (the iframe and the admin can be at different hosts in production)"). Line 459 also broadcasts readiness with `postMessage(…, '*')`.

Blast radius is genuinely limited — `applyTheme` (`:315-344`) re-whitelists keys against `ALLOWED_KEY_SET` and re-validates values with per-kind regexes (`:70-87`), and it never caches preview themes. But an attacker who can frame the storefront can still set `--color-text-1` equal to `--color-surface-0` (both pass the colour regex) and make prices, stock warnings and the COD notice invisible — a UI-redressing vector on a checkout flow.

**Fix:** pass the admin origin in via `import.meta.env.VITE_STUDIO_ORIGIN` and compare `e.origin`; target that origin instead of `'*'` in the ready ping. Both are one-line changes.

### F10 — Admin is desktop-only, storefront is responsive · **Medium** · CONFIRMED

Breakpoint-class distribution (`sm:|md:|lg:|xl:|2xl:`):

| App | Files with responsive classes | Shell |
|---|---|---|
| storefront | 13 of 22 `.tsx` (86 occurrences) | `Navbar` has a mobile drawer (`:166-212`), `Catalog` has a filter drawer (`:178-195`) |
| admin | 10 of 24 `.tsx` (38 occurrences), **none in `Layout`, `ui`, `Products`, `Orders`** | `Layout.tsx:116-118` — `flex h-dvh overflow-hidden` + fixed `w-[240px]` sidebar |

The admin's two highest-traffic pages (`Products`, `Orders`) are fixed-width CSS grids (`Products.tsx:166,192`: `40px 1fr 110px 90px 80px 90px 80px`; `Orders.tsx:67,103`) inside a container that never collapses. On a phone the sidebar consumes 240px of a 375px viewport and the tables overflow with no horizontal scroll container on the row wrapper.

Whether the admin *should* be mobile-usable is a product call — but it should be a decision, not an accident. Today nothing documents it.

### 4.2 — Unbounded query-per-keystroke · **Medium** · CONFIRMED

| Input | File:line | Debounced? |
|---|---|---|
| Storefront search box | `components/SearchBox.tsx:24-27` | ✅ 220 ms |
| Storefront price min/max | `components/FilterSidebar.tsx:215-218` → `Catalog.tsx:41` query key | ❌ |
| Admin product search | `pages/Products.tsx:66-69` → `:32` query key | ❌ |
| Admin jobs search | `pages/JobsConsole.tsx:137` → `:55` query key | ❌ |

Typing `50000` into the price filter fires 5 `GET /products` requests and 5 `setPage(1)` resets (`Catalog.tsx:28`). Typing a 20-char product name in the admin fires 20 requests, each returning `page_size=100`. The debounce primitive already exists in `SearchBox.tsx:24-27` and is simply not reused.

### 4.3 — Footer links to routes that do not exist · **Medium** · CONFIRMED

`storefront/src/components/Footer.tsx:20-23` renders four links under "Service":
`/help/livraison`, `/help/garantie`, `/help/retours`, `/help/contact`.

`storefront/src/App.tsx:45-53` declares exactly nine routes; none start with `/help`. All four fall through to `<Route path="*" element={<NotFound/>}/>` (`:53`). Four of the five links in the site's trust/service column are 404s — on a COD storefront where "Retours" and "Garantie" are the primary purchase objections.

### 4.4 — Products table's "Status" column shows stock · **Medium** · CONFIRMED

`admin/src/pages/Products.tsx:171` renders a header cell labelled `Status`; `:216-219` fills it with `${p.available} left` / `OOS`. The source comment admits it: `{/* Status — not in list item, use available */}`. The actual `product_status_enum` (RAW/NORMALIZED/…/ACTIVE) — the axis the whole enrichment pipeline turns on, and the axis the status filter chips at `:135-153` filter by — is invisible in the table those chips filter. `ProductListItem` in `admin/src/lib/api.ts:107-115` indeed omits `status`, while the storefront's copy has it as optional (`storefront/src/lib/api.ts:52`).

### 4.5 — Uncancellable 3-minute intel poll · **Medium** · CONFIRMED

`admin/src/pages/ProductDetail.tsx:36-59` runs a `while (Date.now() < deadline)` loop inside `mutationFn`, polling `fetchIntelJob` every 2.5 s for up to 180 s, with no `AbortSignal` (the `req` helper accepts one — `admin/src/lib/api.ts:29` — it is simply never passed). React Query does not abort a mutation on unmount, so navigating away leaves up to 72 more requests in flight, followed by `toast` + `invalidateQueries` calls fired against an unmounted route.

### 4.6 — `Orders` "Customer" column shows a UUID fragment · **Low-Medium** · CONFIRMED

`admin/src/pages/Orders.tsx:70` header `Customer`; `:108-110` renders `{o.customer_id.slice(0,8)}…` at 60% opacity. `OrderListItem` (`admin/src/lib/api.ts:440`) carries `customer_id` but no name or phone — yet `TrackedOrder` on the *public* side does expose `customer_name` (`storefront/src/lib/api.ts:232`). The operator's order list is less informative than the customer's own tracking page.

### 4.7 — Smaller confirmed items

| Item | File:line | Severity |
|---|---|---|
| `OrderConfirmation` depends entirely on `location.state`; on refresh it degrades to printing the raw internal UUID (`ID interne : …`) with no order number and no fetch fallback | `pages/OrderConfirmation.tsx:17-18, 71-75` | Low-Medium |
| `buyNow` uses a magic `setTimeout(…, 100)` to let the reducer flush before navigating | `pages/ProductDetail.tsx:116-119` | Low |
| Order payload sends `notes` twice — top-level and inside `shipping_address` | `pages/Checkout.tsx:102,106` | Low |
| `ImageCard`'s `pending` prop is `approveMut.isPending \|\| rejectMut.isPending` — one action disables **every** card in the grid | `pages/ImageReview.tsx:167,430` | Low |
| `ProductGallery` lightbox: no body-scroll lock, no focus trap, focus is not restored on close | `components/ProductGallery.tsx:119-174` | Low-Medium |
| Malformed JWT → `parseJwt` returns `{}` → `NaN < Date.now()` is `false` → the bad token is never cleared | `lib/auth.tsx:15-34` | Low |
| Hardcoded Anthropic model list will go stale | `pages/Settings.tsx:33` | Low |
| `heroRef` declared and attached, never dereferenced | `components/ProductGallery.tsx:17,57` | Low |
| `<html class="dark">` in both apps; **zero** `dark:` variants exist in either codebase | `storefront/index.html:2`, `admin/index.html:2` | Low |
| `<body class="bg-[#08080a]">` hardcodes surface-0; harmless only because unlayered `index.css` beats `@layer utilities` | `storefront/index.html:16`, `admin/index.html:16` | Low |
| Admin has **no skip link**; storefront has one | `storefront/index.html:17` vs `admin/index.html:16-18` | Low |

### 4.8 — SUSPECTED (not proven)

- **AOS + Framer Motion coexist.** `admin/src/App.tsx:5-6,89-94` initialises AOS once at mount with `once: true`; `admin/src/index.css:240-248` sets `[data-aos="fade-up-sm"] { opacity: 0 }` globally. Only 3 pages use `data-aos` (11 attributes, all in `Products`, `Orders`, `OrderDetail`) and all of them are **lazily mounted routes** that did not exist when `AOS.init()` ran. AOS 2.3.4 ships a MutationObserver that should call `refreshHard`, so this probably works — but nothing calls `AOS.refresh()` on route change, and if the observer is ever disabled those elements stay at `opacity: 0` permanently. Two animation systems for eleven elements is not worth this risk. **Not reproduced in a browser.**
- **Google Fonts CLS.** Both apps load Inter + Bricolage Grotesque + JetBrains Mono render-blocking from `fonts.googleapis.com` with `display=swap` and no `size-adjust`/`ascent-override` fallback metrics (`storefront/index.html:10-12`, `admin/index.html:10-12`). Bricolage Grotesque is used on the hero `<h1>` (`Home.tsx:38`) at `text-7xl`. A swap at that size will shift the hero. **Not measured.**

---

## 5. UI Consistency

### 5.1 One design system, two implementations

`storefront/src/components/ui.tsx` and `admin/src/components/ui.tsx` are sibling files with the same job. They agree on `Button`, `Spinner`, `Card`, `EmptyState`, `Input`, `Select`, `Textarea` — and disagree on all of the following:

| Aspect | Storefront | Admin |
|---|---|---|
| Button radius | `rounded-xl` (`ui.tsx:14`) | `rounded-lg` (`ui.tsx:18`) |
| Button `md` padding | `px-4 py-2.5` (`:24`) | `px-4 py-2` (`:36`) |
| Button `lg` padding | `px-6 py-3` (`:25`) | `px-6 py-2.5` (`:37`) |
| Button glow | `0_0_22px` (`:16-17`) | `0_0_18px` (`:22-25`) |
| `outline` variant text | `text-…-text-1` (`:19`) | `text-…-text-2` (`:32`) |
| Input height / radius | `h-11 rounded-xl` (`:78`) | `h-10 rounded-lg` (`:89`) |
| Input icon slots | `leftIcon` + `rightIcon` (`:57-58`) | none → `Login.tsx:96-113` hand-rolls a password field |
| Input `hint` | yes (`:56,95`) | no |
| Select `error` prop | yes (`:104,127`) | no (`:132`) |
| Card padding | `p-6` (`:193`) | `p-5` (`:157`) |
| Chip component | `Tag` — 5 semantic tones (`:160-173`) | `Badge` — free-form `colorClass` string (`:69-75`) |
| `.badge` font-size | `0.68rem`, tracking `0.06em` (`index.css:213-214`) | `0.72rem`, tracking `0.04em` (`index.css:227-228`) |
| `EmptyState` desc | `text-sm max-w-md` (`:185`) | `text-xs max-w-xs` (`:265`) |
| Modal | none | `ui.tsx:216` |
| `PageHeader`, `StatCard` | none | `ui.tsx:272,161` |
| Glass opacity default | `0.62` (`index.css:66`) | `0.78` (`index.css:64`) |
| Glass blur default | `24px` (`index.css:64`) | `18px` (`index.css:62`) |

Nothing is *wrong* here in isolation — but the same `<Button variant="accent" size="lg">` renders at two different sizes with two different corner radii depending on which app it is in, and there is no shared package, no Storybook, and no visual regression test to notice when they diverge further.

### 5.2 Copy language: the admin is accidentally bilingual

Twelve of twenty-four admin `.tsx` files contain French; twelve are English-only. The split runs *through the same screen*:

| Surface | Language | Evidence |
|---|---|---|
| Sidebar nav | English | `Layout.tsx:13-21` — "Dashboard", "Products", "Catalog Quality", "Image Review", "Orders", "Jobs Console" |
| Sidebar theme switcher (directly below it) | French | `ThemeSwitcher.tsx:71,66,120` — "Thème", "Changer de thème", "Studio complet" |
| Dashboard, Products, Orders, Login, ProductEditor, ProductImport | English | e.g. `Dashboard.tsx:42,175`; `Products.tsx:85,107` |
| Jobs Console | French | `JobsConsole.tsx:74,82,119,125,138` — "Tâches asynchrones", "Manuel", "Statut", "Tous statuts" |
| Image Review | French | `ImageReview.tsx:64,93,101,113,146` — "Image confirmée", "Retour au produit", "Validation des images", "En attente", "Rien à valider" |
| Product Detail toasts | French | `ProductDetail.tsx:37,50,54` — "Lancement de la recherche web…", "Scrape + LLM en cours…", "Timeout (3 min). Voir Jobs Console." |
| Error boundary | French | `ErrorBoundary.tsx:48,51,55,75` — "Quelque chose a planté", "Réessayer" |
| Settings page header | **Both in one string** | `Settings.tsx:177` — `"Apparence · LLM enrichment backend · ping it · roll out"` |

There is no i18n layer in either app — every string is a literal. The storefront is consistently French (correct for the market); the admin is a coin flip per file. `admin/index.html:2` declares `lang="en"`.

### 5.3 Brand assets diverge from the brand

`storefront/src/components/BrandLogo.tsx:26-35` draws the GLAIVE mark entirely from tokens (`var(--color-electric-blue)`, `var(--color-neon-yellow)`, `var(--color-hot-pink)`) — it re-themes correctly with every preset.

`admin/src/components/BrandLogo.tsx` draws a *different* mark with **hardcoded hexes**: `#3DA9FC`, `#FFD400`, `#1E466B`, `#0D0D0D`, `#FF2E7A` (lines 34, 43-44, 48, 51-52, 56, 59, 64, 69). It is immune to the theme system it sits next to, and it is the *old* Ghir Laffaire palette. Same for `admin/src/pages/CatalogGraph.tsx:1109-1116` (a whole fallback palette) and `admin/src/components/ThemeSwitcher.tsx:105` (swatch fallbacks).

### 5.4 Interaction-pattern inconsistencies

| Pattern | Where it is done one way | Where it is done another |
|---|---|---|
| Destructive confirm | `Modal` + reason textarea (`OrderDetail.tsx:7` + cancel flow) | native `confirm()` (`ProductEditor.tsx:210`) |
| Error surfacing | inline `<EmptyState>` (`Catalog.tsx:124`) | toast only (`Checkout.tsx:48`) | 
| Loading | `shimmer` skeleton (`Home.tsx:148`, `Dashboard.tsx:95`) | centred `Spinner` (`Products.tsx:178`, `Settings.tsx:165`) |
| Pagination | `Button variant="outline" size="sm"` (`Catalog.tsx:155-170`) | raw `<button>` with inline classes (`Products.tsx:255-268`, `Orders.tsx:137-144`) |
| Tab-pill highlight | `motion.div layoutId` (`Layout.tsx:41`, `JobsConsole.tsx:107`, `IssueExplorer.tsx:75`) | plain conditional classes (`Products.tsx:286-299` `FilterChip`) |
| Cross-app duplication | `Section` in `FilterSidebar.tsx:165` | different `Section` in `Checkout.tsx:279`; `Row` duplicated in `Cart.tsx:244` and `Checkout.tsx:290`; `FilterChip` in `Catalog.tsx:201` and `Products.tsx:277`; `slugify` in `format.ts:22` and `ProductEditor.tsx:25`; `ErrorBoundary` near-verbatim in both apps |

---

## 6. Design tokens & theme system

### 6.1 Token consumption matrix — 4 of 36 tokens are inert

Measured by counting `var(--token)` references **plus** the Tailwind v4 utility form each token generates, across all `.tsx` and `index.css` in each app, excluding declarations and `lib/theme.ts`.

| Token | admin | storefront | Verdict |
|---|---|---|---|
| `--color-info` | 0 | 0 | **inert everywhere** |
| `--color-soft-white` | 0 | 0 | **inert everywhere** |
| `--duration-fast` | 0 | 0 | **inert everywhere** |
| `--duration-slow` | 0 | 0 | **inert everywhere** |
| `--color-success` | 14 | 0 | inert in storefront |
| `--color-warning` | 2 | 0 | inert in storefront |
| `--color-danger` | 1 | 0 | inert in storefront |
| `--color-bold-blue` | 7 | 0 | inert in storefront |
| `--duration-base` | 1 | 0 | near-inert |
| `--radius-*` (6) | via 147 `rounded-*` utility uses | same | ✅ live |
| `--glass-*` (3), `--font-*` (3), `--color-surface-*` (5), `--color-text-*` (3), `--bg-glow-*` (3) | ✅ | ✅ | live |

The Theme Studio (`admin/src/pages/ThemeStudio.tsx`, 972 lines) presents all 36 as editable. Four of them do nothing anywhere; four more do nothing on the customer-facing surface. The storefront hardcodes `emerald-500` seven times (`ui.tsx:165`, `ProductDetail.tsx:331,337,515`, …) exactly where `--color-success` should be; the admin does it fifteen times.

### 6.2 Zero Tailwind colour utilities are used

`@theme { --color-electric-blue: … }` in Tailwind v4 generates `bg-electric-blue`, `text-electric-blue`, `border-electric-blue`, `ring-…`, `from-…`, `fill-…`. I grepped every one of those forms for all 13 custom colour tokens across both apps:

```
*-success:0  *-warning:0  *-danger:0  *-info:0  *-soft-white:0  *-bold-blue:0
*-electric-blue:0  *-neon-yellow:0  *-hot-pink:0  *-jet-black:0
*-brand:0  *-accent:0  *-punk:0
```

**Every single colour reference in both apps uses the arbitrary-value form** `bg-[var(--color-electric-blue)]`. This is what makes runtime theming work (arbitrary `var()` survives to the browser), so it is a *deliberate* consequence — but it means ~78 generated utility classes ship unused, editors give no autocomplete, and typos like `bg-[var(--color-electirc-blue)]` fail silently to `transparent` with no build error.

### 6.3 There is no typographic or spacing scale

The registry covers colour, radius, glass, motion and font-*family*. It does not cover font size, line height, letter spacing or space. The result, counted across `.tsx` files:

- **393 arbitrary Tailwind values** (149 storefront, 244 admin), the top offenders being `text-[10px]` (**55×** in the storefront alone), `tracking-[0.22em]` (13×), `tracking-[0.2em]` (7×), `tracking-[0.18em]` (5×), `max-w-[1400px]` (18×).
- Three near-identical uppercase-label recipes coexist: `text-[10px] font-bold … tracking-[0.18em]` (`ui.tsx:65`), `text-[10px] font-black … tracking-[0.22em]` (`Cart.tsx:128`), `text-[10px] font-black … tracking-[0.2em]` (`ProductDetail.tsx:396`).
- The Theme Studio cannot change a single font size, because no font-size token exists.

Notably, **the static prototype is more systematised than the shipping apps**: `gaming-store/assets/css/styles.css:42-59` defines a full `--fs-100 … --fs-700` `clamp()` scale, `--lh-*`, `--tracking-*` and a 10-step `--s-*` spacing scale. That work was never ported.

### 6.4 Token names no longer describe their values

`storefront/src/index.css:20-27` documents it plainly: *"Token NAMES are kept … but the VALUES are re-mapped."*

| Token | Admin value | Storefront value |
|---|---|---|
| `--color-electric-blue` | `#3DA9FC` (blue) | `#FF5A1F` (**orange**) |
| `--color-neon-yellow` | `#FFD400` | `#FFC400` (amber) |
| `--color-hot-pink` | `#FF2E7A` | `#FF2D78` (magenta) |
| `--color-bold-blue` | `#1E466B` | `#3A0D00` (**ember brown**) |

Every storefront component reads `--color-electric-blue` to mean "primary orange". A developer moving between the two apps reads the same identifier and gets a different colour and a different hue family. The semantic aliases (`--color-brand`, `--color-accent`) exist in both `index.css` files and would solve this — but they are **not in the token registry**, so:

- `Button variant="primary"` sets its background from `--color-electric-blue` (themeable) and its glow from `--color-brand-glow` (`ui.tsx:16` / `:22`) — **which no preset can override**. Selecting `midnight` gives a cyan button with an orange halo in the storefront, and `.glow-brand` / `.glow-yellow` (`index.css:177-178`) have the same problem.
- `.no-img-placeholder` (`storefront/src/index.css:304-309`) hardcodes `rgba(61,169,252,0.10)` and `rgba(255,212,0,0.08)` — the *old* Ghir Laffaire blue and yellow — on every product card without an image.

### 6.5 Accessibility of the theme-driven chrome

- Admin `Modal` (`ui.tsx:216-257`): no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no focus trap, no Escape handler, no body scroll lock, no focus restore. Only the backdrop `onClick` closes it. The storefront's lightbox (`ProductGallery.tsx:127-129`) *does* set `role="dialog" aria-modal="true" aria-label` and handles Escape (`:32`) — the correct pattern exists, in the other app.
- `aria-label` count: storefront 20, admin 9. `role=`: storefront 3, admin 5.
- One `<img>` without `alt` (`admin/src/pages/ImageReview.tsx:207`).
- Light presets (`paper`, `dune`, `spring`) invert the surface ramp but **not** `--color-electric-blue`'s companion `--color-jet-black`, which `Button variant="primary"` uses as its *text* colour (`ui.tsx:16`). Contrast under light presets is unverified — no contrast checking exists in the Theme Studio's validation (`storefront/src/lib/theme.ts:70-87` validates *syntax* only).

---

## 7. `gaming-store/` — assessment

**What it is (CONFIRMED):** 8 static HTML pages, 594 lines of hand-written CSS, 961 lines of vanilla JS (`app.js` 785 + `data.js` 176). Zero network calls — grepping `fetch(`, `XMLHttpRequest` and `/api/` across all JS and HTML returns exactly one hit, and it is prose inside a mock checkout page: `gaming-store/assets/js/app.js:641` reads *"In the real platform this posts to `POST /api/v1/orders/create`…"*. All catalog data is the hardcoded array in `data.js`. This matches `audit/Architecture.md` §2.1 exactly.

**It is a third, incompatible design system.** Not a variant — a disjoint namespace:

| | React apps | gaming-store |
|---|---|---|
| Surface token | `--color-surface-1` | `--c-surface-1` (`styles.css:16`) |
| Brand token | `--color-electric-blue` = `#FF5A1F` | `--c-brand` = **`#ff5101`** (`styles.css:20`) |
| Display font | Bricolage Grotesque (`index.html:12`) | **Archivo** (`gaming-store/index.html:16`) |
| Type scale | none (55× `text-[10px]`) | `--fs-100 … --fs-700` `clamp()` (`styles.css:42-49`) |
| Spacing scale | none | `--s-1 … --s-10` (`styles.css:58-59`) |
| Delivery | Tailwind v4 + Vite | plain CSS, no build |

So "GLAIVE orange" is `#FF5A1F` in the product and `#ff5101` in the study — visibly different, and neither references the other.

**It ships features the real storefront does not:** side-by-side spec comparison (`compare.html`), a 3-question guided recommender (`quiz.html`), a software-ecosystem landing page (`software.html`), a wishlist, a quick-view modal, and a *rendered* recently-viewed rail. That last one is pointed: the React storefront has a complete `recently-viewed` module that writes on every product view (`ProductDetail.tsx:35`) and whose reader hook `useRecentlyViewed` (`lib/recently-viewed.ts:30`) is **provably dead** — the feature was ported half-way.

**Recommendation — archive it, harvest three things first.** In order:
1. **The type + spacing scales** (`styles.css:42-59`) — port them into `@theme` and the token registry. This is the single highest-value fix in this report's §6.3, and the work is already done in this directory.
2. **The `compare` and `quiz` flows** — file them as product specs; they are the only competitive-differentiation UX in the repo.
3. **The recently-viewed rail** — it makes the dead React module live for the cost of one component.

Then move `gaming-store/` to `docs/prototypes/gaming-store/` (or a separate branch) and state in `CLAUDE.md` §3 that it is a frozen design study. Leaving it at the repo root beside two live apps, with a README describing it as *"Part of the Ghir Laffaire commerce platform repo"*, invites exactly the "which storefront do you mean?" ambiguity the user's own memory file already flags.

**What it is not:** a candidate for integration. Wiring 785 lines of vanilla JS to `/api/v1` would duplicate `lib/api.ts`, `lib/cart.tsx`, the theme bootstrap and the store-resolution contract in a third dialect, and it would need its own build step to consume the token system. The React storefront already covers its shipping scope.

---

## 8. Coverage gap (confirming, not repeating, the Architect's F-7.5)

`audit/Architecture.md` §7.5 establishes that no backend test starts the app. The frontend half is worse:

| | Test runner | Test files | Tests | Covers |
|---|---|---|---|---|
| `storefront` | vitest ^2.1.4 | 2 (`__tests__/format.test.ts`, `tags.test.ts`) | pure functions only | `fmtMoney`, `slugify`, `categoryIcon`, `deriveTags` |
| `admin` | **none** — no `test` script, no runner in `package.json` | **0** | **0** | nothing |

Zero component tests, zero render tests, zero route tests, zero MSW/fetch mocks in either app. Consequently **none of F1–F10 could have been caught by CI** — not the false-negative empty states, not the permanent spinners, not the store-context failure, not the theme drift, not the dead props.

Three cheap, high-yield additions, in order:
1. **A snapshot test over the two `PRESETS` objects** — would have caught F8 in one assertion.
2. **A render test per page with MSW returning 500** — asserting the page shows *something other than* an empty state. Catches F2 and F5 in one harness.
3. **`ts-prune` or `knip` in CI** — mechanically catches every ❌ Dead entry in §2.

### Dependency drift between the two apps

| Package | storefront | admin |
|---|---|---|
| `framer-motion` | `^11.11.1` | `^12.9.4` (**major**) |
| `tailwind-merge` | `^2.5.4` | `^3.2.0` (**major**) |
| `lucide-react` | `^0.453.0` | `^0.507.0` |
| `@tanstack/react-query` | `^5.59.0` | `^5.74.4` |
| `retry` default | `1` (`lib/query.ts:8`) | `2` (`lib/query.ts:8`) |
| `mutations.retry` | unset | `0` (`lib/query.ts:11-13`) |

Two major-version splits on the animation and class-merge libraries that the shared-by-copy `ui.tsx` primitives depend on.

---

## 9. Recommended order of work

**Now (correctness / trust):**
1. F7 — hoist `idempotency_key` out of `onSubmit` (`Checkout.tsx:105`). One-line class of bug, duplicate-order consequence.
2. F6 — surface `isError` on the cart availability query and gate the checkout button (`Cart.tsx:24`).
3. F3 — add an error branch to `StoreProvider` (`store.tsx:85`).
4. F5 — replace `isPending || !form` with an explicit `isError` branch in `Settings.tsx:162,547` and `ThemeStudio.tsx:208-209`.
5. F2 — apply the `Catalog.tsx:117-130` ternary shape to the six false-negative sites.

**Next (product correctness):**
6. F1 — delete both category literals, drive from `GET /categories`.
7. F4 — one rebrand sweep over the 16 locations in §4.4.
8. §4.3 — add the four `/help/*` routes or remove the links.
9. §4.4 — add `status` to the admin's `ProductListItem` and render it in the column labelled `Status`.

**Then (systemic):**
10. §6.3 — port `gaming-store`'s `--fs-*` / `--s-*` scales into `@theme` and the registry; replace the 393 arbitrary values incrementally.
11. F8 — extract `theme.ts` to a shared workspace package, or add the preset snapshot test.
12. §6.4 — add `--color-brand-glow` / `--color-accent-glow` / `--color-punk-glow` to the token registry so glows follow presets.
13. §2 — delete the proven-dead symbols and CSS; add `knip` to CI.
14. F9 — origin-check the preview channel.
15. §7 — decide `gaming-store`'s fate and record it in `CLAUDE.md`.

---

## 10. What I did not verify

- No browser was run. All animation, layout-shift, contrast and AOS findings are static-analysis only; §4.8 is explicitly labelled SUSPECTED.
- No Lighthouse / CLS / bundle-size measurement.
- Light-preset contrast ratios were not computed.
- `ThemeStudio.tsx` (972 lines) and `CatalogGraph.tsx` (1378 lines) were read structurally — outline, hooks, query wiring, hardcoded palettes — not line-by-line. `CatalogGraph` in particular contains a self-contained graph subsystem (`SvgRenderer` `:725-888`, `CanvasRenderer` `:889-1092`, d3-force layout, localStorage persistence) that warrants its own review; the main component body spans `:176-689` and would benefit from extraction, but I did not audit its simulation logic.
- I did not verify server responses; every client-side claim about API shape is read from the hand-written `lib/api.ts` types, which `audit/_shared_context.md` §2 warns may already have drifted from the backend.

---

*Frontend audit, 2026-07-31. Read-only: no source file was modified.*
