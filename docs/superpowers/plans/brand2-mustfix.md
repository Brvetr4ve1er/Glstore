# Plan: the 4 must-fix items before brand #2

## Context

`audit/Multistore_Readiness.md` returned **GO, conditional** on adding a second brand,
with four blockers. This plan closes all four, plus the strongly-recommended item
(make the tenancy tests actually execute).

Baseline: branch `gaming-store`, HEAD `06b3225`, tree clean,
`365 passed, 1 skipped` in the repo interpreter (399 passed with `requirements.txt` installed).

## Global Constraints

- Stay on branch `gaming-store`. Never push, never touch `main`, never switch branches.
- No force git ops: no `reset --hard`, `clean`, `checkout -- <file>`, `stash`, `rebase`,
  `commit --amend`. Never `git add -A|.|-u` — stage explicit paths only.
- **Do not break the public storefront.** Anonymous traffic must keep resolving by Host.
- `python -m pytest tests/` must not drop below `365 passed`. More is fine.
- Store-scoped tables (must always carry `store_id`): products, offers, product_media,
  observations, customers, orders, order_items, inventory_reservations,
  financial_transactions, events, sync_queue.
  Platform-level, must NOT gain `store_id`: scrape_jobs, intel_jobs, scrape_sources,
  competitor_prices.
- Cross-store access to a resource returns **404, never 403**.
- Conventional commit subject ≤72 chars + body. No AI/tool attribution, no Co-Authored-By.

## Task 1: Give migrations a route to the live database (HIGH)

Today there is **no way to apply a migration to production**. `RUN_STARTUP_MIGRATIONS=false`
on Vercel (correct — serverless has no single startup), and `scripts/deploy/init_remote_db.py`
refuses any database that already has a `products` table. So migration 007 — and every future
migration — is stranded. Until 007 runs, brand #1's storefront silently loses its saved theme.

**Requirements:**

1. Create `scripts/deploy/apply_migrations.py`, modelled closely on the existing
   `scripts/deploy/init_remote_db.py` (read it first; match its argparse shape,
   `_normalize_dsn`, `ssl=True` connect, PASS/FAIL prints, non-zero exit on failure).
   It must:
   - Take a DSN as argv[1] or `DATABASE_URL`.
   - Discover `db/migrations/*.sql` in filename order.
   - Read the `_migrations` table and apply only those NOT already recorded.
   - Record each applied migration as `(filename, checksum, duration_ms, applied_at)` using
     **SHA-256 of the file bytes** — byte-identical to how `api/core/migrations.py` computes
     and stores it, so the two paths agree and nothing double-applies. Read that module and
     match it exactly.
   - Detect a **checksum mismatch** on an already-applied migration and ABORT with a clear
     message (an edited applied migration is the classic footgun; `api/core/migrations.py`
     already treats it as fatal — do the same).
   - Support `--dry-run` that lists what WOULD be applied and exits 0 without writing.
   - Be safe to re-run: a second run with nothing pending prints so and exits 0.
2. Add a "Applying migrations to a live database" section to `DEPLOY.md` explaining when to
   run it (after any deploy that adds a `db/migrations/*.sql`), the `--dry-run` first step,
   and that Neon's **direct** (non-pooled) connection string should be used for DDL.
3. Do NOT change `api/core/migrations.py`, and do NOT edit any existing migration file.

**Verification:**
- `python -m py_compile scripts/deploy/apply_migrations.py`
- `python scripts/deploy/apply_migrations.py --dry-run` with no DSN exits non-zero with a
  readable message (not a traceback)
- Show, by reading both files side by side, that the checksum + insert shape matches
  `api/core/migrations.py`. Quote both.
- `python -m pytest tests/` → ≥365 passed

## Task 2: Make registering an existing brand's domains possible (HIGH)

Only `localhost` and `127.0.0.1` are seeded in `store_domains` (migration 005). The moment
`SINGLE_STORE_MODE=false` is set, the live `<project>.vercel.app` URL returns
`404 "No store is configured for this address."` (`api/core/store_context.py:208-213`).

`scripts/deploy/add_store.py` exists but is built for creating a NEW store: pointed at an
existing slug it demands the exact matching `--name`/`--prefix` and otherwise exits 1 without
doing anything — a real footgun for the "I just want to add a hostname" case.

**Requirements:**

1. Add a way to attach domains to an **existing** store without re-specifying its identity.
   Design decision is yours, but it must be unambiguous and safe. Two acceptable shapes:
   (a) `scripts/deploy/add_store.py --slug <existing> --add-domain <host>` where `--name`
       and `--prefix` become optional when `--add-domain` is used; or
   (b) a separate `scripts/deploy/add_domain.py`.
   Justify your choice in the report.
2. It must:
   - Refuse to attach a hostname already owned by a DIFFERENT store (exit non-zero, say which
     store owns it). `store_domains.domain` is globally unique, so a bare
     `ON CONFLICT DO NOTHING` silently succeeds — that is the bug to avoid. The existing
     `add_store.py` already solved this; reuse its approach.
   - Be idempotent: re-attaching the same host to the same store is a no-op, exit 0.
   - Honour the one-primary-per-store partial unique index
     (`store_domains_one_primary_per_store`) — adding a second primary must fail cleanly,
     not with a raw DB error.
   - Print the resulting domain→store mapping so the operator can eyeball it.
3. Add a **"Turning on multi-brand"** runbook to `DEPLOY.md` with the exact, ordered steps:
   inspect current stores (`SELECT slug,name,order_prefix FROM stores;`), attach brand #1's
   real hostnames FIRST, verify, and only THEN set `SINGLE_STORE_MODE=false`. State plainly
   what breaks if the order is reversed.

**Verification:**
- `python -m py_compile` on every script touched
- Invalid/missing args exit non-zero with a readable message, no traceback
- Postgres is unavailable, so the happy path cannot execute — say so explicitly and trace it
- `python -m pytest tests/` → ≥365 passed

## Task 3: Close the last cross-brand read + restore store visibility (MEDIUM)

Two small, independent fixes.

**Requirements:**

1. **`GET /events/{event_id}`** (`api/routes/events.py:58-77`) is the last endpoint that
   returns another brand's row. `events.store_id` is NOT NULL (migration 005), and `POST
   /events` was already scoped in this effort. Add `require_admin_store_for` + `AND store_id
   = :sid` to the lookup, returning **404** (not 403) when the event belongs to another store.
   Follow the exact shape already used at `api/routes/jobs.py:362`. Preserve the endpoint's
   existing role requirement.
2. **The `x-store` response header is dead code** (`api/main.py:141-143`). The middleware calls
   `bound_store()`, but the ContextVar set inside a dependency does not propagate back to the
   middleware's context, so the header never fires. Investigate, then EITHER make it work
   (e.g. have `bind_store()` also stash on `request.state`, and read that in the middleware)
   OR delete the three lines and the comment. Do not leave a claim the code does not honour.
   State which you chose and why. If you make it work, confirm it fires for all three
   dependencies (`require_store`, `resolve_store`, `require_admin_store_for`) and is ABSENT on
   unscoped routes like `/healthz`.

**Verification:**
- `python -m py_compile api/routes/events.py api/main.py`
- `python -m pytest tests/` → ≥365 passed
- For item 2, state exactly how you determined the header does or does not fire

## Task 4: Make the tenancy tests actually execute

`tests/test_store_context.py` (40 assertions, mutation-tested) currently SKIPS in the repo
interpreter because `sqlalchemy`/`pyjwt` are not installed there — both ARE pinned in
`requirements.txt`. The only automated guard on the brand boundary does not run.

**Requirements:**

1. Do NOT add dependencies and do NOT weaken the tests to make them run.
2. Add a CI workflow (`.github/workflows/tests.yml`) that installs `requirements.txt` and runs
   `python -m pytest tests/`, so the tenancy tests execute somewhere reliable. Keep it minimal
   and standard (checkout, setup-python, pip install, pytest). Pin the Python version to one
   the codebase supports.
3. Make a skip of the tenancy file **loud**: add a check so that if
   `tests/test_store_context.py` skips in CI, the run FAILS rather than reporting green.
   (`pytest -p no:cacheprovider --strict-markers` alone will not do this — implement an
   explicit guard, e.g. a CI step that greps the pytest summary for a skip of that file, or a
   `-W error`-style mechanism you can justify. Choose something simple and robust.)
4. Add a short "Running the tests" section to `DEPLOY.md` or `README.md` stating that a bare
   `pytest` without `requirements.txt` installed silently skips the tenancy suite, and what to
   run to get the real result.

**Verification:**
- The workflow YAML parses (`python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/tests.yml'))"`
  — if PyYAML is unavailable, say so and verify by careful reading instead)
- `python -m pytest tests/` locally still ≥365 passed
- Explain in the report exactly how the loud-skip guard would catch a regression
