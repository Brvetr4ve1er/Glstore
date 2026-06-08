# SHINOBI — Branch Context & Extraction Guide

> **Read this first.** This document is the complete record of the
> SHINOBI work that lives on the branch `claude/shinobi-shop-rebuild`
> inside the **Glstore** repo. It tells you exactly what's here, what
> is the real deliverable vs. reference material, and **how to lift
> the website out into its own standalone repo** so you can drop it
> from Glstore.

---

## 1. TL;DR — what to grab

The entire shippable website is **one self-contained folder**:

```
apps/site/
```

It has **no dependencies on the rest of the Glstore repo** (verified:
no imports, paths, or references escape the folder; its only external
dependency is `astro` from npm). You can copy that folder anywhere,
run `npm install && npm run dev`, and it works.

Everything else on the branch (`docs/shinobi-rebuild/`) is **planning
and design reference** — useful to keep, but not required to run the
site.

---

## 2. Branch inventory

This branch (`claude/shinobi-shop-rebuild`) adds **two** things to the
Glstore repo and nothing else. It does not modify any existing Glstore
code.

### 2a. THE DELIVERABLE — `apps/site/` (the actual website)

A complete, working **Astro static site**. This is what you deploy.

```
apps/site/
├─ package.json              # deps: astro only
├─ astro.config.mjs          # static-output config
├─ tsconfig.json             # ~ alias → ./src (internal only)
├─ netlify.toml              # one-click Netlify deploy config
├─ .gitignore
├─ README.md                 # full dev + deploy + edit guide (FR)
├─ public/
│  ├─ admin/
│  │  ├─ index.html          # Decap CMS admin shell
│  │  └─ config.yml          # the admin form schema (owner editor)
│  ├─ assets/
│  │  ├─ mascot.svg          # chibi-ninja brand mark
│  │  ├─ seigaiha-light.svg  # wave pattern (paper)
│  │  ├─ seigaiha-dark.svg   # wave pattern (indigo)
│  │  └─ seigaiha-red.svg    # wave pattern (torii red)
│  └─ images/designs/        # (empty) where uploaded design images land
└─ src/
   ├─ styles/tokens.css      # ALL brand tokens (colour/font/spacing)
   ├─ layouts/Base.astro     # html shell + fonts + SEO meta
   ├─ components/
   │  ├─ Header.astro        # sticky nav + mascot
   │  └─ Footer.astro        # dark footer + WhatsApp/IG buttons
   ├─ lib/                   # the designer engine (pure, no DOM, testable)
   │  ├─ mockups.ts          # SVG product mockups + print-area rects
   │  ├─ bg-remove.ts        # background removal (chroma flood-fill + AI)
   │  ├─ compositor.ts       # placement maths + canvas render + PNG export
   │  └─ order.ts            # WhatsApp hand-off (Web Share API + fallback)
   ├─ scripts/
   │  └─ builder.ts          # the designer's DOM controller
   ├─ content/
   │  ├─ config.ts           # content-collection schemas (validation)
   │  ├─ site.json           # ◆ brand, contact, boutique, policies
   │  ├─ bases/*.json        # ◆ 5 product bases + prices
   │  └─ designs/*.json      # ◆ 8 anime designs
   └─ pages/
      ├─ index.astro         # Home
      ├─ custom.astro        # ◆ the Designer (Printify-style mockup studio)
      ├─ boutique.astro      # shop page + LocalBusiness JSON-LD
      └─ 404.astro           # branded 404

◆ = content the owner edits (directly or via /admin/)
```

### The Designer (`/custom`) — how it works

A Redbubble/Printify-style studio, **100% client-side** (no server,
no paid API):

1. Pick a product → a recolourable SVG mockup renders (t-shirt,
   hoodie, mug, tote), each with a defined print area.
2. Upload an image (or pick a gallery design). The **background is
   removed automatically** by an edge flood-fill chroma key
   (`bg-remove.ts`) — instant, offline. A "Découpe IA" button lazily
   loads `@imgly/background-removal` (ONNX, ~40 MB, on demand) for
   complex photos. Tools: tolerance slider, eyedropper, keep-original.
3. Place the design on the print area (drag / scale / rotate).
4. **Front + back**: a recto/verso switcher gives each side its own
   independent design; adding a verso design adds +500 DA. Mug/tote
   stay single-sided.
5. **Customer note**: a free-text field is included in the WhatsApp
   message.
6. Order: on mobile every side's preview + print-ready transparent PNG
   share straight to WhatsApp via the Web Share API (`order.ts`);
   desktop downloads them + opens WhatsApp pre-filled.

Photographic mockups are supported via an optional `raster` field on a
mockup (one product photo per colour/side) — see the note at the
bottom of `mockups.ts`; the default vector mockups need no assets.

The four `lib/*.ts` modules are pure logic (no framework). The only
optional external dependency is the AI model, fetched at runtime only
if the user taps "Découpe IA".

### 2b. THE REFERENCE — `docs/shinobi-rebuild/` (planning + design)

Strategy, design system, and a standalone HTML design-system preview.
**Not required to run the site** — keep it if you want the rationale,
delete it if you only want the running site.

```
docs/shinobi-rebuild/
├─ README.md                       # index of the doc set
├─ BRANCH-CONTEXT.md               # ← this file
├─ 00-source-data.md               # the owner's brand data (verbatim)
├─ 01-executive-summary.md
├─ 02-audit-and-sitemap.md
├─ 03-user-flows-and-ux.md
├─ 04-competitive-analysis.md
├─ 05-rebuild-strategy.md
├─ 06-design-system.md             # the tokens that became tokens.css
├─ 07-component-library.md         # incl. the Custom Builder spec (§6)
├─ 08-technical-architecture.md    # (the "if it ever grows" plan)
├─ 09-folder-structure.md
├─ 10-data-and-cms-schemas.md
├─ 11-roadmap.md
├─ 12-launch-checklist.md
└─ preview/
   ├─ index.html                   # standalone design-system showcase
   └─ assets/*.svg                  # same brand assets

NOTE: docs 08–10 describe a much larger Next.js + FastAPI + Postgres
architecture. That was the FIRST plan, before you clarified the site
only needs to take WhatsApp/Instagram orders. The ACTUAL build in
apps/site/ is the simpler, correct one. Treat docs 08–10 as
"future, only if you ever add real online checkout."
```

### 2c. What this branch does NOT touch

Nothing in `api/`, `admin/`, `storefront/`, `workers/`, `db/`, etc.
The two commits only **add** `apps/site/` and `docs/shinobi-rebuild/`.
Removing the branch removes only those two folders.

---

## 3. The two commits on this branch

```
98c1fe3  feat(shinobi): build the real Astro site
fb2dbc5  docs(shinobi): full rebuild plan + live HTML preview
```

Both are additive. Neither edits existing Glstore files.

---

## 4. Extract into a standalone repo

Pick whichever matches your comfort level. All three give you a clean
`shinobi-site` repo containing only the website.

### Option A — Simplest (copy the folder, fresh git)

On your machine, after checking out the branch:

```bash
# 1. get the branch
git fetch origin
git checkout claude/shinobi-shop-rebuild

# 2. copy the site out of the Glstore repo
cp -R apps/site ~/shinobi-site

# 3. (optional) also keep the design docs alongside it
cp -R docs/shinobi-rebuild ~/shinobi-site/docs

# 4. make it its own repo
cd ~/shinobi-site
rm -rf node_modules dist .astro      # clean any build artifacts
git init
git add .
git commit -m "Initial commit: SHINOBI site"

# 5. point it at a new empty GitHub repo and push
git remote add origin git@github.com:YOURNAME/shinobi-site.git
git push -u origin main

# 6. run it
npm install
npm run dev          # → http://localhost:4321
```

That's it. The new repo has no trace of Glstore.

### Option B — Preserve git history with `git subtree split`

If you want the commit history of `apps/site/` to come with it:

```bash
git checkout claude/shinobi-shop-rebuild

# create a branch that contains ONLY apps/site/ history, rerooted
git subtree split --prefix=apps/site -b shinobi-only

# make a fresh repo from that branch
mkdir ~/shinobi-site && cd ~/shinobi-site
git init
git pull /path/to/Glstore shinobi-only

git remote add origin git@github.com:YOURNAME/shinobi-site.git
git push -u origin main
```

### Option C — `git filter-repo` (cleanest, needs the tool)

```bash
# install: pip install git-filter-repo
git clone <glstore-url> shinobi-site
cd shinobi-site
git checkout claude/shinobi-shop-rebuild
git filter-repo --path apps/site/ --path-rename apps/site/:
# now the repo root IS the site; history trimmed to just those files
git remote add origin git@github.com:YOURNAME/shinobi-site.git
git push -u origin main --force
```

> Recommendation: **Option A** unless you specifically need the
> 2-commit history. It's the least error-prone.

---

## 5. Remove SHINOBI from the Glstore repo

After you've extracted it, drop it from Glstore. Two ways:

### If the branch was never merged to main (current state)

Nothing to clean on `main` — the SHINOBI work only exists on the
branch. Just delete the branch:

```bash
git branch -D claude/shinobi-shop-rebuild           # local
git push origin --delete claude/shinobi-shop-rebuild # remote
```

`main` never had these files, so it stays clean.

### If you ever merged it and want it gone

```bash
git checkout main
git rm -r apps/site docs/shinobi-rebuild
git commit -m "Remove SHINOBI (moved to its own repo)"
git push
```

---

## 6. Run, build, deploy (quick reference)

Full detail is in **`apps/site/README.md`** (in French). Short version:

```bash
cd apps/site
npm install
npm run dev          # local dev with live reload → :4321
npm run build        # static output → apps/site/dist/
npm run preview      # serve the production build
```

**Deploy (free):** push the standalone repo to GitHub → on Netlify
"Import an existing project" → it reads `netlify.toml` and builds
automatically. Then enable Identity + Git Gateway in the Netlify
dashboard so the owner can log into `/admin/`.

---

## 7. Before going live — the one required change

The WhatsApp number is currently a placeholder:

```
apps/site/src/content/site.json  →  contact.whatsappNumber: "213555000000"
```

Swap it for the real number in **international format without the `+`**
(e.g. `213` + the mobile number). Either edit the JSON directly or do
it through the `/admin/` panel once deployed. Every "Commander sur
WhatsApp" button updates automatically.

Other owner-flagged confirmations (from `00-source-data.md` §
"Items the owner flagged"): the full email address, the ready-made
(non-custom) prices, and the delivery cost (likely 690 DA). None block
launch — they're already wired with sensible defaults in `site.json`.

---

## 8. How the site actually works (one paragraph)

Astro renders 4 static HTML pages at build time. The Custom Builder
on `/custom` is ~150 lines of vanilla JS that reads its catalogue from
a JSON block embedded in the page, recomputes the price on every
selection, hides the size/side steps for products that don't have them
(mug, tote), and rewrites a `wa.me/<number>?text=<order>` link so the
order arrives **pre-filled** in the owner's WhatsApp. Instagram has no
pre-fill API, so its button copies the order to the clipboard and
opens the DM. No server, no database, no payment — orders live in the
chat apps the shop already uses. Hosting cost: **€0/month**.

---

## 9. What was verified working (live demo, this session)

- Home + nav routing
- Builder live pricing: T-shirt 2 200 → Sweat+verso+L = 3 800 DA
- Conditional steps: Mug → 1 000 DA, size + side steps auto-hidden
- WhatsApp link built with the full pre-filled order
- Instagram "copy to clipboard" (verified clipboard contents)
- Boutique page + `ClothingStore` JSON-LD present
- Branded 404
- Mobile layout (390px)
- Production build: 4 pages, clean, ~1.6s
