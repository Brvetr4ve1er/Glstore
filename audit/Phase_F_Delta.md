# AMANTCOM — Phase F re-audit: the delta

> Re-run of the 10-dimension audit taken at the start of the merchandising plan
> (score ~61/100), against branch `gaming-store` on 2026-09-24. The delta covers
> everything since that baseline: the merchandising work and financing
> Phases A–F. It is not "what Phase F did".
>
> Every number below was re-measured, not recalled. Method: a static scan of
> `storefront/src` and `admin/src` (test files excluded, comments stripped for
> copy checks), the production build, both test suites, and a live 375 px pass
> in the browser. Where a number could not be re-measured, the row says so.

## Scorecard

| Dimension | Baseline | Now | Δ | Why — in one line |
|---|---|---|---|---|
| Brand specificity | 4 | **4** | 0 | The identity is fixed in both apps and guarded by a test. The default catalog is still SteelSeries-derived, so the score stays at 4 (see *Blocker*). |
| Copy specificity | 8 | **9** | +1 | Still 0 boilerplate hits. Every unbacked promise is gone, including the "48h" the baseline praised, and two test guards keep it that way. |
| Visual identity | 7 | **7** | 0 | Unchanged. The admin console now carries the same mark as the storefront. |
| UX logic | 7 | **8** | +1 | The new flows have real loading, error and empty states. Caveat: the signed-in flows have never run against a live API. |
| Content quality | 3 | **3** | 0 | 3 pilot product images is not a catalog (see *Blocker*). |
| Responsiveness | 6 | **7** | +1 | Checked live at 375 px on 13 routes, with no horizontal overflow. The baseline was never checked live. |
| Accessibility | 3 | **6** | +3 | All 4 Critical findings are closed and guarded by tests; 3 of 4 High are closed. Contrast (H7), the skip link and `text-[10px]` are still open. |
| Performance | 6 | **6** | 0 | The bundle grew 148 → 155.6 kB gzip (+5 %). It stays route-split, but nothing got faster. |
| Engineering | 8 | **8** | 0 | Tests tripled and there are strong static guards. But the largest component doubled, magic numbers grew, and the migrations are unapplied. The two cancel out. |
| Business understanding | 9 | **9** | 0 | Financing is gated behind a legal checkpoint, and COD, DZD and the wilayas are intact. |
| **Total** | **61** | **67** | **+6** | |

## Blocker for Brand and Content — one item, named once

The baseline's most urgent finding was that the catalog is SteelSeries' product
line under another name. **It is still true of the repository's default data:**

- `docker-compose.yml:13` still mounts `db/seed_gaming.sql`, which still
  contains the SteelSeries-derived names (Arctis/Aerox/Rival/QcK/GameDAC/
  ClearCast).
- `docker-compose.yml:14` mounts `db/seed_glaive_starter.sql`: 15 invented
  GLAIVE products, loaded `ACTIVE`. The file's own header says not to leave them
  active on a shop taking real orders, and gives the SQL to archive them.

What the live Neon database holds is not visible from here — the operator runs
those commands. The identity layer is done, and the logo-removal test now
fails *only* because of catalog data. Brand and Content move when the real
catalog and its photographs replace these seeds; no code change will move them.

## The numbers

| Measure | Baseline | Now |
|---|---|---|
| Boilerplate phrases in code (20 patterns, EN + FR) | 0 | 0 |
| Unbacked claims in code: delivery times, free delivery, "garantie", "approuvé", "DA/mois", speed promises | ≥ 1 ("Livraison 48h" in the hero) | **0**, guarded |
| Retired brand strings (Ghir Laffaire / GLAIVE / gaming) in storefront code | 5 SEO descriptions + defaults | **0**, guarded |
| Retired brand in the admin (logo, login, theme preset) | cart/crown mark, "GHiR LAFFAiRE" | AMANTCOM shield (not yet guarded by a test) |
| Storefront loading / error / empty / toast states | 13 / 10 / 41 / 4 | 89 / 66 / 44 / 5 |
| `htmlFor` (storefront / admin) | 0 / 0 | 15 / 5 |
| `role="alert"` (storefront / admin) | 0 / 0 | 26 / 2 |
| `aria-live` + `role="status"` (storefront) | 0 | 2 + 21 |
| Admin buttons with no accessible name | ≥ 3 (image queue) | **0 of 151**, guarded console-wide |
| `text-[10px]` (storefront) | 55 | 59 (admin: 109) |
| `w-[1400px]` magic width (storefront) | 18 | 22 |
| `<img>` with `alt` | 5 / 5 | 6 / 6 |
| Product images in data | 0 | 3 (pilot media, migration 012) |
| JS bundle, entry chunk | 466 kB / 148 kB gzip | 490.7 kB / 155.6 kB gzip, 60 chunks, 21 lazy routes |
| CSS | — | 66.0 kB / 11.8 kB gzip |
| Tests | 414 | **956 backend passed (6 skipped) + 302 storefront** |
| Largest component | 577 lines | 1 164 (`ProductDetail.tsx`); admin 1 379 (`CatalogGraph.tsx`) |
| Inline `style={{}}` (storefront / admin) | 2 | 6 / 52 |
| 375 px horizontal overflow | not checked | 0 of 13 routes (live) |

## Accessibility — finding by finding

Findings are numbered as in `audit/Accessibility_Report.md`.

| # | Finding | Status | Evidence |
|---|---|---|---|
| C1 | No label tied to its control | **Closed** | Shared `Input`/`Textarea`/`Select` in both apps use `htmlFor`/`id`. The admin login password field is fixed in Phase F. |
| C2 | Errors not exposed programmatically | **Closed** | `aria-invalid` plus `aria-describedby` on the error text (admin `ui.tsx`, Phase F; storefront, Phase D). |
| C3 | Image queue buttons icon-only | **Closed in Phase F** | The compact card still had three unnamed icons, *after* the plan said this was fixed. Now guarded across all 151 admin buttons. |
| C4 | Login password toggle unreachable and unnamed | **Closed in Phase F** | `tabIndex={-1}` is removed. The toggle is named and has `aria-pressed`. |
| H5 | Admin Modal is not a dialog | **Closed in Phase F** | `role="dialog"`, `aria-modal`, `aria-labelledby`. Focus moves in on open, Tab stays inside, Escape closes, and focus returns to the opener. Covered by a static test; **not yet exercised in a browser**, because every admin dialog needs a live API. |
| H6 | Errors never announced | **Closed** | The storefront has 26 alerts. In the admin, the login error and both error boundaries now announce themselves (Phase F). |
| H7 | `--color-text-3` fails contrast | **Open** | The storefront `#6e6e7c` scores 3.27–3.99:1 and the admin `#6b6b85` scores 3.26–3.83:1; both need 4.5:1. The smallest change that passes on every surface is storefront `#858593` and admin `#82829c`. It is a one-token change, but a visual decision, so it is left to the operator (Theme Studio can apply it without a deploy). |
| H8 | No reduced motion in the admin | **Closed in Phase F** | `MotionConfig reducedMotion="user"`, AOS disabled when the OS asks, and a CSS media rule. |
| M9 | No skip link | Open | 0 in either app. |

## What Phase F itself changed

The audit found defects the per-phase guards had missed. Phase F fixed them
rather than just reporting them:

- **Brand:**
  - "Ghir Laffaire" is gone from 5 storefront SEO descriptions.
  - The admin logo, login wordmark, theme-preset label and font preview now use AMANTCOM.
  - The login email placeholder no longer reads `admin@ghirlaffaire.dz`, and the "Shibuya punk" footer is removed.
- **Claims:** the empty cart promised free delivery above 50 000 DZD, a commercial term nothing implements. It is removed.
- **New guard, `brand-copy.test.ts`:** every storefront page, component and lib file must carry no retired brand, no delivery, price, warranty or refund promise, and no speed promise. The speed rule covers blueprint §10: "avoid promises like instant approval".
- **Accessibility:** C3, C4, H5 and H8 are closed, and H6 is closed for the admin. The admin guard now covers every file, not five screens. The empty Cart and Checkout pages now have an `<h1>`, verified live.

## What is still open and why it holds a score down

- **Brand / Content:** the demo catalog; see *Blocker*.
- **Performance:** +7.6 kB gzip since the baseline. Nothing was traded for it.
- **Engineering:**
  - `ProductDetail.tsx` has grown past 1 100 lines.
  - `text-[10px]` and `w-[1400px]` bypass the token system more than they did.
  - The admin has 52 inline styles.
  - Migrations 010–014 have never been applied to a database, and their PL/pgSQL trigger bodies are not verified by the SQL parser. Apply them to a Neon branch before production.
- **Accessibility:** contrast (H7), the skip link, and the Phase D reviewer minors (focus drops to `<body>` in two places; the simulator's double announcement).
- **Pre-existing, noted in Phase D:**
  - Two `<Link><Button>` nestings on Home.
  - "TVA incluse" on the product page is an unverified fiscal claim. It is listed in the compliance checklist.

The compliance side of Phase F is in
`docs/compliance/financing-compliance-checklist.md`.
