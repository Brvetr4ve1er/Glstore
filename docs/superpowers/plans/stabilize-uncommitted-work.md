# Plan: Stabilize the uncommitted work

## Context

The repo has ~79 files of uncommitted work (52 modified + 27 never-committed)
sitting on top of commit `48a1b79` on branch `gaming-store`. Prior sessions
already lost work permanently because it was never committed. The code
compiles and 365 tests pass, but nothing is saved, nothing is reviewable, and
nothing can be rolled back independently.

This plan gets the work into git history in coherent, revertable chunks and
adds a real verification path for the checkout flow.

**Nothing is pushed to any remote by this plan.** All work stays local on the
`gaming-store` branch.

## Global Constraints

- **Branch:** work stays on `gaming-store`. Never checkout/create another
  branch, never push, never touch `main`.
- **No force operations.** Never `git reset --hard`, `git clean -fdx`,
  `git checkout -- <file>`, `git stash drop`, or `git rebase`. Nothing that
  can destroy uncommitted work.
- **No source-code behaviour changes.** These tasks are about git hygiene and
  verification tooling. Do not refactor, rename, reformat, or "improve"
  application code. The only source edits allowed are the ones a task
  explicitly names.
- **Preserve every file.** No task deletes a source file. Untracking a build
  artifact (`git rm --cached`) is allowed where a task names it; deleting it
  from disk is not.
- **Verify before committing:** `python -m pytest tests/` must report 365
  passed before any commit that touches Python.
- **Commit messages:** conventional-commit style, subject ≤ 72 chars, plus a
  body explaining what and why. Do not add AI/tool attribution or co-author
  trailers.

## Task 1: Stop tracking build artifacts

Build artifacts are tracked in git, so every diff is polluted with hundreds of
irrelevant changes (this is a major reason the working tree looks like chaos).

**Requirements:**

1. Replace `.gitignore` at the repo root with a complete set of ignores.
   The file currently contains only `node_modules`. It must end up covering,
   each on its own line, with comment headers grouping them:
   - `node_modules/`
   - `__pycache__/`
   - `*.py[cod]`
   - `.pytest_cache/`
   - `*.tsbuildinfo`
   - `admin/dist/`
   - `storefront/dist/`
   - `.env`
   - `.superpowers/`
   - `.vercel/`
2. Untrack (but DO NOT delete from disk) everything now ignored, using
   `git rm -r --cached --quiet` for these paths only:
   - `admin/dist`
   - `storefront/dist`
   - every tracked `__pycache__` directory
   - every tracked `*.tsbuildinfo` file
   - `.env` (it holds secrets and must not be tracked)
3. Confirm `.env.example` REMAINS tracked (it is the template and must stay).
4. Commit only the `.gitignore` change plus the untracking. No source files in
   this commit.

**Verification:**
- `git status --porcelain | grep -c "dist/\|__pycache__\|tsbuildinfo"` returns 0
- `git ls-files | grep -c "__pycache__\|/dist/\|tsbuildinfo"` returns 0
- `git ls-files .env` prints nothing; `git ls-files .env.example` prints `.env.example`
- `.env` still exists on disk (`test -f .env`)
- `admin/dist` still exists on disk

## Task 2: Commit the multi-store foundation

The multi-store (superstore) migration plus the checkout and admin wiring that
completes it. This is one coherent feature and belongs in one commit.

**Requirements:**

1. Stage and commit exactly these paths (all are already-written, working code —
   do not modify them):
   - `db/migrations/005_stores.sql`
   - `db/migrations/006_store_scope_orders.sql`
   - `api/core/store_context.py`
   - `api/core/security.py`
   - `api/core/config.py`
   - `api/routes/stores.py`
   - `api/routes/orders.py`
   - `api/routes/public_orders.py`
   - `api/routes/products.py`
   - `api/routes/catalog.py`
   - `api/routes/images.py`
   - `api/routes/enrichment.py`
   - `api/routes/issues.py`
   - `api/routes/products_import.py`
   - `api/routes/auth.py`
   - `api/services/orders.py`
   - `api/services/events.py`
   - `api/services/enrichment_runner.py`
   - `api/services/llm_enrichment.py`
   - `api/services/csv_import.py`
   - `api/main.py`
   - `admin/src/lib/store.tsx`
   - `admin/src/lib/api.ts`
   - `admin/src/lib/auth.tsx`
   - `admin/src/components/Layout.tsx`
   - `admin/src/App.tsx`
   - `admin/src/vite-env.d.ts`
2. Before committing, run `python -m pytest tests/` and confirm 365 passed.
3. Commit message subject: `feat: multi-store foundation with scoped checkout and admin`
4. Body must mention: per-store catalogs/orders/customers via `store_id`,
   host-based store resolution, per-store order numbering, and the admin store
   picker.

**Verification:**
- `git show --stat HEAD` lists the files above and no others
- `python -m pytest tests/` → 365 passed
- Working tree still contains the remaining uncommitted files (deploy plumbing etc.)

## Task 3: Commit the Vercel deploy plumbing

The serverless deployment path (Vercel + Neon) is an independent concern from
multi-store and gets its own commit.

**Requirements:**

1. Stage and commit exactly these paths (already written — do not modify):
   - `vercel.json`
   - `.vercelignore`
   - `api/index.py`
   - `api/requirements.txt`
   - `api/core/db.py`
   - `scripts/deploy/init_remote_db.py`
   - `DEPLOY.md`
   - `.env.example`
   - `storefront/src/lib/api.ts`
   - `storefront/src/vite-env.d.ts`
2. Commit message subject: `feat: Vercel serverless deploy path with Neon Postgres`
3. Body must mention: the FastAPI ASGI entrypoint, serverless DB engine
   (NullPool + disabled statement cache), the one-time remote DB init script,
   and that `SINGLE_STORE_MODE`/`ALLOWED_HOSTS` make a platform subdomain work.

**Verification:**
- `git show --stat HEAD` lists the files above and no others
- `python -c "import json; json.load(open('vercel.json'))"` succeeds

## Task 4: Commit remaining work and add a checkout smoke test

Anything still uncommitted after Tasks 2-3 gets committed, and we add the
verification the plan is missing: a runnable end-to-end checkout smoke test.

**Requirements:**

1. Create `scripts/deploy/smoke_test_checkout.py`:
   - Takes a base URL as argv[1], defaulting to env `GLSTORE_BASE_URL`, then
     `http://localhost:8000`.
   - Uses only the Python standard library (`urllib.request`, `json`) — it must
     run with no pip installs.
   - Performs, in order, printing a clear PASS/FAIL line per step:
     1. `GET /healthz` → expect HTTP 200
     2. `GET /api/v1/products?page=1&page_size=1` → expect 200 and at least one
        item; extract the first product's `id`
     3. `GET /api/v1/products/{id}` → expect 200; extract the first offer's `id`
        from the `offers` array
     4. `POST /api/v1/orders/create` with a COD test order for that offer,
        quantity 1, customer name `Smoke Test`, phone `0555000111`, shipping
        address `{"wilaya":"Alger","commune":"Centre","address":"1 rue test"}`
        → expect HTTP 201, and an `order_number` in the response
   - Exits 0 only if every step passed; exits 1 otherwise, printing which step
     failed and the response body it got.
   - Prints the created `order_number` and `status` on success.
   - Module docstring explains this is the real proof the store-scoped checkout
     works, and that it creates a REAL order in whatever DB it points at (so
     point it at a test/staging DB, not production).
2. Add a "Verify checkout end to end" section to `DEPLOY.md` documenting how to
   run it, immediately after the existing Step 5 verification content.
3. Stage and commit the smoke test, the `DEPLOY.md` update, and every remaining
   uncommitted/untracked file in the repo EXCEPT anything matched by
   `.gitignore`.
4. Commit message subject: `chore: add checkout smoke test and remaining work`

**Verification:**
- `python -m py_compile scripts/deploy/smoke_test_checkout.py` succeeds
- `python scripts/deploy/smoke_test_checkout.py http://127.0.0.1:9` exits
  non-zero and prints a clear failure (nothing is listening on port 9) — proves
  the failure path works without needing a live DB
- `git status --porcelain` shows a clean tree (no modified, no untracked)
- `python -m pytest tests/` → 365 passed
