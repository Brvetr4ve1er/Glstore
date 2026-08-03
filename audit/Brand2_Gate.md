# Brand #2 Gate — final review of the four must-fix items

**Date:** 2026-08-03 · **Branch:** `gaming-store` · **Baseline:** `06b3225` · **Head:** `3547fb1`
**Gate against:** `audit/Multistore_Readiness.md` §8
**Read-only:** nothing was modified, staged or committed. Working tree at the end of this
review is identical to its state at the start (`?? audit/Multistore_Readiness.md`,
`?? db/seed_ghir.sql`, `?? docs/superpowers/plans/brand2-mustfix.md`).

---

## 0. VERDICT — **GO on adding brand #2**

All four §8 blockers are **CLEARED**, and the strongly-recommended item (make the tenancy
tests actually execute) is **CLEARED** with a guard I tripped by executing it.

There is **no Critical** finding. There is **one Important** finding — a cross-platform
line-ending hazard in the new migration path (R1) — that must be checked with one command
before the owner's first `apply_migrations.py` run. It is a two-minute pre-flight, not a
code change.

### Evidence quality — read this before trusting any verdict below

| Claim | What actually backs it |
|---|---|
| `365 passed, 1 skipped` | **Executed** (`python -m pytest tests/`, 0.99s). This proves **no regression only.** No test in `tests/` imports `api.main`, any route, or `scripts/deploy/*`. Four `NOT NULL store_id` crashes already shipped past this same green suite. |
| Checksum parity (the highest-risk item) | **Executed.** Imported `api.core.migrations.discover_migrations` in the repo interpreter (sqlalchemy/pyjwt/asyncpg all confirmed **absent**), listed all 8 migrations, and asserted `Migration.checksum == hashlib.sha256(path.read_bytes()).hexdigest()` for each → `ALL MATCH: True`. Plus a byte-for-byte read of both INSERT statements. |
| The CI loud-skip guard | **Executed.** Parsed the committed YAML with PyYAML, extracted the literal `run:` string of the guard step, wrote it to a file and ran it with `bash --noprofile --norc -eo pipefail`. It printed `::error::…reported 1 skipped test(s)…` and **exited 1**. Also executed the "file renamed/deleted" case → `tests=0` → exited 1. The guard is **not** vacuous. |
| CLI failure paths of both new scripts | **Executed** — every invalid/missing-argument path, exit codes captured, no tracebacks. |
| `x-store` header repair | **Read only** in this review. I did not rebuild the task-3 venv. The mechanism (`request.state` ⇄ `scope["state"]`, `start_soon` copying context) is correct as read, and task-3's report contains an executed before/after table against the real `api.main.app`. |
| Everything else | **Static reading of the source.** |
| Any runtime behaviour against Postgres | **Not exercised.** No database was reachable. Every SQL claim is a reading of the statement text. |

---

## 1. Blocker 1 — [High] Migrations had no route to the live DB → **CLEARED**

`scripts/deploy/apply_migrations.py` (new, 425 lines) is that route.

### Checksum + INSERT parity — the item I was asked to verify with particular care

**There is no second implementation to drift from.** The script does not reimplement the
hash; it imports the runner's own discovery function
(`scripts/deploy/apply_migrations.py:102-107`) and writes `Migration.checksum` verbatim:

```python
from api.core.migrations import (
    _ADVISORY_LOCK_KEY,   # same lock namespace as the startup runner
    _BOOTSTRAP_FILENAME,  # "000_migrations_table.sql"
    Migration,
    discover_migrations,  # <- the single source of truth for checksums
)
```

Executed proof that the import works with the standard library alone and that the hash is
what it claims to be (repo interpreter, sqlalchemy absent):

```
sqlalchemy ABSENT / pyjwt ABSENT / asyncpg ABSENT
000_migrations_table.sql d9063866bef539ab …  007_per_store_theme.sql d83f5aa74ec1927a
checksum identity ALL MATCH: True
lock key 7809634719315880306   bootstrap 000_migrations_table.sql
```

The invariant that keeps this import legal (SQLAlchemy behind `TYPE_CHECKING` + a lazy
`_text()` at `api/core/migrations.py:60-70`) is itself guarded by
`tests/test_migrations.py` — 14 tests that import that module and execute in this
interpreter. So a future "clean-up" that adds a top-level `from sqlalchemy import text`
turns the suite red, not the deploy script.

**INSERT — byte-for-byte semantics compared, both directions:**

| | `api/core/migrations._apply_one:216-220` | `apply_migrations._apply:323-330` |
|---|---|---|
| Columns | `(filename, checksum, duration_ms, applied_at)` | identical, same order |
| Values | `(:fn, :cs, :dur, NOW())` | `($1, $2, $3, NOW())` |
| Conflict | `ON CONFLICT (filename) DO NOTHING` | identical |
| Bound values | `m.filename`, `m.checksum`, `int` ms | identical, same positions |
| Bootstrap row | `(:fn, :cs, 0, NOW())` (`:295-299`) | `($1, $2, 0, NOW())` (`:289-296`) — literal `0` in both |
| Tamper scope | `others` excludes `_BOOTSTRAP_FILENAME` (`:262`) | same split (`:383-384`); bootstrap drift is a **warning**, matching the runner |
| Tamper action | `raise MigrationChecksumMismatch` (`:309`) | abort, exit 1, nothing recorded (`_print_tampered`) |
| Lock | `pg_try_advisory_lock(_ADVISORY_LOCK_KEY)`, 30s @1s | same **imported** key, same 30s/1s loop (`:254-264`) |

`db/migrations/000_migrations_table.sql:24-28` confirms both write into
`filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, duration_ms INTEGER` — so
`ON CONFLICT (filename)` is inferable on both paths and the `int` duration binds cleanly.

**Verdict on the stated failure mode** ("a later persistent-host boot either re-applies
migrations or aborts with a false tamper error"): **cannot happen from an implementation
divergence.** It *can* happen from an input divergence — see **R1** below, which is the
single most important thing in this document.

The deliberate divergence (per-migration commits instead of one outer transaction with
savepoints) affects failure granularity only, never the recorded row. It is documented in
the module docstring at `:42-46` and in DEPLOY.md's "What it refuses to do" table.

### Executed CLI verification

| Command | Result |
|---|---|
| `python -m py_compile scripts/deploy/apply_migrations.py` | OK |
| `apply_migrations.py --dry-run` (no `DATABASE_URL`) | `✗ No connection string…` **exit 1**, no traceback |
| `apply_migrations.py` (no DSN) | same, exit 1 |
| `apply_migrations.py "postgresql://…" --dry-run` | `✗ asyncpg is required — run: pip install asyncpg`, exit 1 |
| `apply_migrations.py --nope` | argparse usage, exit 2 |

The Unicode guard at `:85-89` works — the glyphs degrade to `?` on this cp1252 console
instead of raising `UnicodeEncodeError`.

### DEPLOY.md section — accurate

"Applying migrations to a live database" (DEPLOY.md:175-249) correctly states: run after
any deploy that adds a `db/migrations/*.sql`; `--dry-run` first; Neon's **direct**
(non-pooled) string for DDL; the refusal matrix; the "if you deployed before this script
existed" symptom (silently reverted Theme Studio palette). The sample dry-run output
matches the code's actual print statements and arithmetic (`8 discovered → 1 pending →
6 skipped`). One claim needs a caveat — see R1.

---

## 2. Blocker 2 — [High] Registering brand #1's hostnames → **CLEARED**

`scripts/deploy/add_domain.py` (new, 564 lines). Shape (b) — a separate script — is the
right call: it has no `--name`, no `--prefix`, and issues no statement against `stores`
other than `SELECT`, so **a mistyped `--slug` structurally cannot create a phantom third
brand**. It imports `DOMAIN_RE`, `SLUG_RE`, `_normalize_domain`, `_normalize_dsn` from
`add_store.py` (`:90-95`) rather than copying them.

### The "silent no-op" trap — closed at two levels, verified by reading

`db/migrations/005_stores.sql:60` — `domain CITEXT NOT NULL UNIQUE`. A bare
`ON CONFLICT (domain) DO NOTHING` therefore **succeeds while attaching nothing** when
another brand owns the host. The script does **not** rely on that INSERT to detect it:

1. **Pre-flight, before any write** (`:344-359`): every domain is classified read-only via
   `_owner_of` into `to_insert` / `already` / `conflicts`. If `conflicts` is non-empty it
   prints the full mapping, then `_print_conflicts` names the owning store and slug and
   returns **1** — for the **whole batch**, so a valid hostname earlier in the list is not
   written either.
2. **Post-insert re-read** (`:431-437`): after each INSERT it re-reads the owner. A
   hostname taken by a concurrent writer between step 2 and the write lands in `conflicts`
   and is excluded from `written`; `:456-457` then returns 1 **before** the
   `✅ N hostname change(s) applied` line can print.

The success message is unreachable when any conflict exists. **It cannot print success
without attaching.**

### One-primary-per-store — honoured cleanly

`005_stores.sql:69` is a partial unique index (`ON store_domains(store_id) WHERE
is_primary = true`). `_print_primary_taken` (`:270-291`) refuses **before** the write,
names the current primary, and hands over the exact two-statement swap. `_explain_write_error`
(`:473-499`) translates a lost race by `sqlstate == "23505"` + constraint name into a
sentence instead of a raw `duplicate key value violates unique constraint`. Implicit
primary assignment matches `add_store.py`: a store with no primary gets one from the first
inserted host; a store that has one keeps it — nothing is ever demoted implicitly.

### What we store == what the resolver looks up

`add_store._normalize_domain:86-95` and `api/core/store_context.normalize_host:113-127`
are semantically identical (strip, lower, bracketed-IPv6 special case, split on first `:`).
`resolve_store_by_host:148-181` compares `d.domain = :host` against a CITEXT column, so the
stored lowercase value matches. ✅

### Executed CLI verification (no tracebacks anywhere)

| Invocation | Exit | Message |
|---|---|---|
| *(no args)* | 2 | argparse: `--slug` required |
| `--slug "Bad Slug" --domain ok.example.dz` | 2 | invalid slug + the schema regex |
| `--slug default --domain "https://oops.example.dz/x"` | 2 | "not a bare hostname" |
| `--slug default` | 2 | "no --domain given" + points at `--dry-run` and `add_store.py` |
| `--slug default --primary` | 2 | "--primary applies to the first --domain" |
| `--slug default --domain a.example.dz --domain A.Example.DZ` | 2 | case-insensitive duplicate caught |
| `--slug default --domain my-project.vercel.app` | 1 | "No connection string." |
| `--slug default --dry-run` | 1 | same (inspect mode passes validation) |

**Postgres is unavailable, so the happy path was not executed by me.** The write path,
the conflict refusal against a real unique index, `lower(slug::text) = $1` against CITEXT,
`$2::text` binding into a citext column, and the `LEFT JOIN … ORDER BY d.is_primary DESC
NULLS LAST` mapping query are **read-verified only**. Task-2's fake-connection harness
covers the control flow (10/10 cases); it does not prove Postgres parses the SQL.

### DEPLOY.md "Turning on multi-brand" runbook — accurate and correctly ordered

Steps A→G, writes-to column, and an explicit "If you do it in the wrong order" section.
Two claims I checked against the code and confirmed:

- **"`SINGLE_STORE_MODE=true` does not force every hostname onto the default store; Host
  resolution runs first and a registered domain always wins."** Correct —
  `require_store:212-223` resolves by Host, and only falls back when `store is None`. This
  correction of a previously-false doc claim is load-bearing: it is why Step E (verify
  before the flip) works at all.
- **"400 means `ALLOWED_HOSTS`, 404 means `store_domains`."** Correct — TrustedHostMiddleware
  is added at `api/main.py:96` and answers 400 before routing.

---

## 3. Blocker 3 — [Medium] `GET /events/{event_id}` → **CLEARED**

`api/routes/events.py:58-92`.

- **Guard runs before any data is returned.** The store now arrives as a *dependency*
  (`store: Store = Depends(require_admin_store_for(require_role("SUPER_ADMIN","ADMIN")))`,
  `:62`), so FastAPI resolves it before the handler body executes. Nothing is read from the
  DB until `store.id` exists.
- **404, not 403.** The predicate is inside the WHERE clause
  (`FROM events WHERE event_id = :id AND store_id = :sid`, `:80`); a miss falls through to
  the pre-existing `HTTPException(404, "event not found")` at `:87`. Another brand's event
  is indistinguishable from a nonexistent one.
- **Role requirement unchanged.** `SUPER_ADMIN, ADMIN` — moved from the router-level
  `dependencies=[...]` into the argument of `require_admin_store_for`. `require_admin_store_for`
  declares `admin=Depends(admin_dep)` (`store_context.py:347-352`), so authentication and the
  role check still run *before* store resolution; an insufficient role still 403s.
- **Shape matches the sibling exactly** — `api/routes/jobs.py:351-366` uses the identical
  construction. Verified side by side.
- **No remaining unscoped reads of the queues.** Grepped `FROM events` / `FROM sync_queue`
  across `api/`: every route-level occurrence now carries `store_id = :sid`
  (`jobs.py:76,77,108,111,209,227,362,400`; `events.py:80`). The only unscoped one is
  `api/core/health.py:123`, a platform-wide count already deferred in audit §9.
- Caller impact: none — the endpoint has no callers in `admin/` or `storefront/`.
- `docs/API.md:344-346` updated to state the scoping.

**Behaviour change worth knowing (by design):** a platform operator
(`admin_users.store_id IS NULL`) calling this endpoint **without** `x-store-id` now gets
**400**, not a result — `store_for_admin:303-308`'s deliberate "no implicit default store"
rule, identical to `GET /jobs/event/{job_id}`. The admin UI always sends the header; only a
raw curl / n8n caller notices.

---

## 4. Blocker 4 — [Medium] the `x-store` response header → **CLEARED (repaired, honest)**

Repaired rather than deleted, which is the better of the two allowed choices for a
multi-brand debug story.

- `bind_store(store, request=None)` (`store_context.py:78-99`) now also writes
  `request.state.store`. `Request.state` is backed by `scope["state"]` — one dict shared by
  every `Request` built from that scope, including `BaseHTTPMiddleware`'s own — so it
  travels *up*, which a ContextVar cannot (`start_soon` copies the context downward only).
  The docstring explains exactly this.
- `api/main.py:144` now reads `getattr(request.state, "store", None)`. The stale
  `from api.core.store_context import bound_store` import was removed. **No misleading
  comment survives** — the comment block at `:136-143` now describes the real mechanism.
- **All three dependencies covered.** Both binding sites pass the request:
  `require_store:237` and `store_for_admin:315`. `require_admin_store_for:352` delegates to
  `store_for_admin`; `resolve_store:398-403` delegates to one or the other. The early-return
  path in `require_store:206-210` re-binds so `request.state` cannot lag the ContextVar.
- **Absent on unscoped routes.** `/healthz` invokes no store dependency, so `scope["state"]`
  never gets a `store` key and `getattr(..., None)` yields None. Pinned by
  `test_x_store_header_is_absent_on_an_unscoped_route`.
- **Non-request callers are not broken.** `request` defaults to `None`; `_store_var.set()`
  is unconditional. I grepped every call site: `store_context.py` itself, `api/main.py`
  (read only), `api/services/events.py:33-34` (`bound_store()` read only, `emit_event`'s
  fallback), and `tests/`. **No worker or CLI path calls `bind_store` at all**, so nothing
  in `workers/` changes behaviour. `test_bind_store_without_a_request_still_binds_the_context_var`
  pins the one-argument form.

Nine new tenancy assertions were added (`tests/test_store_context.py:481-630`), including a
tripwire (`test_context_var_alone_never_reaches_the_middleware`) that fails if a future
Starlette makes the simpler read viable again. See **R2** for the one gap in that coverage.

---

## 5. Strongly-recommended item — the tenancy tests execute → **CLEARED**

`.github/workflows/tests.yml` (new). Checkout → setup-python 3.12 → `pip install -r
requirements.txt` → `python -m pytest tests/` → loud-skip guard. Python 3.12 matches
`docker/Dockerfile.{api,worker,scraper}` (`FROM python:3.12-slim`). `requirements.txt`
already pins `pytest==8.3.3` and `pytest-asyncio==0.24.0`, so the pytest step has its tool.

### I traced the guard, and then I ran it

The concern raised in my brief — "a guard that greps text can pass vacuously" — does not
apply: the guard parses the **JUnit XML counts**, not pytest's prose, precisely because
`pyproject.toml:5` already sets `addopts = ["-q", …]` and a second `-q` would suppress the
summary line. Executed, in this repo, with sqlalchemy genuinely absent:

```
$ bash --noprofile --norc -eo pipefail <extracted guard run: string>
1 skipped in 0.14s
tests/test_store_context.py: tests=1 passed=0 skipped=1 failures=0 errors=0
::error::tests/test_store_context.py reported 1 skipped test(s). …
GUARD EXIT=1
```

I also executed the vacuous-pass scenario the brief asked me to hunt for — the test file
renamed or deleted. `pytest` errors, `|| true` swallows it, and pytest still emits an XML
with `tests="0"`. The guard's third check (`passed <= 0`) fires:

```
tests/test_store_context.py: tests=0 passed=0 skipped=0 failures=0 errors=0
::error::tests/test_store_context.py reported zero passing tests.
GUARD-ON-EMPTY EXIT=1
```

If the XML is missing entirely, `ET.parse` raises and the step exits non-zero. GitHub's
default shell for Linux runners carries `-e`, so a non-zero heredoc exits the step and the
job. **There is no path where the tenancy suite fails to execute and CI still goes green.**

YAML parses (PyYAML 6.0.3, executed), and `"on":` is quoted so it stays a string key rather
than being coerced to `True` under YAML 1.1. `README.md:127-160` states plainly that a bare
`pytest` without `requirements.txt` silently skips the tenancy suite, and what to run
instead.

---

## 6. Residual risks

| # | Sev | Where | Finding |
|---|---|---|---|
| **R1** | **Important** | `scripts/deploy/apply_migrations.py` (via `api/core/migrations.py:107-114`); no `.gitattributes` anywhere in the repo | **CRLF/LF checkout drift can poison `_migrations`.** The checksum is `sha256(path.read_bytes())` — line endings are inside the hash. This machine has `core.autocrlf=true` and the repo has **no `.gitattributes`**, so a fresh `git clone` on Windows would give CRLF working-tree files while the Linux container has LF. Measured: `007_per_store_theme.sql` hashes `d83f5aa74ec1927a…` (LF) vs `2158883bce060234…` (CRLF). If the operator runs `apply_migrations.py` from a CRLF checkout, the rows recorded in `_migrations` disagree with what a Linux `api/core/migrations.py` computes — and a persistent host booting with `RUN_STARTUP_MIGRATIONS=true` aborts with `MigrationChecksumMismatch` and **refuses to start**. This is *not* a divergence between the two implementations (those are provably identical) — it is a divergence between checkouts, and it is new exposure because a Windows operator machine now writes `_migrations` rows for the first time. **Today's working tree is LF, so today's run is safe** — but verify before running, and `DEPLOY.md:240-242` ("nothing reports a false mismatch") states the guarantee without this caveat. Fix: add `.gitattributes` with `db/migrations/*.sql text eol=lf` (or run the script from WSL). |
| **R2** | Medium | `tests/test_store_context.py:497-521` vs `api/main.py:144` | **No test pins the production middleware.** `_build_stamped_app` *re-implements* the stamp ("Verbatim from api/main.py", `:509-510`) inside the test. The mechanism is pinned; `api/main.py`'s actual line is not. If someone reverts `api/main.py:144` to `bound_store()`, the whole tenancy suite still passes. |
| **R3** | Medium | `api/routes/events.py:58-92` | **Never executed, and no automated test covers it.** No test in `tests/` imports `api/routes/events.py`. The shape is copied verbatim from a working sibling and py-compiles; the first real proof is the first live request. Related, **pre-existing**: `event_id: str` is not UUID-validated, so a non-UUID path segment reaches `WHERE event_id = :id` against a UUID column → `invalid input syntax for type uuid` → **500, not 404**. Unchanged by this diff, but this is now the endpoint's only code path. |
| **R4** | Medium | `scripts/deploy/add_domain.py:412-441` | The write loop runs in autocommit with no `async with conn.transaction():` around it. Plan-time conflicts are refused before any write, so the only partial-write window is another writer taking a hostname between the plan and the write — at which point earlier inserts are already committed. The script is honest about it (`Already applied and COMMITTED this run: …`), and one line would close the window. Disclosed by task 2. |
| **R5** | Low | `scripts/deploy/apply_migrations.py:270-271` vs `:172` | The bootstrap DDL executes **before** the tamper check, so `_print_tampered`'s "Nothing was applied and nothing was recorded" is not literally exact. Harmless in practice: the bootstrap is `CREATE TABLE/INDEX IF NOT EXISTS`, and the tamper path is only reachable when `_migrations` already has rows — i.e. when the bootstrap is a no-op. |
| **R6** | Low | `DEPLOY.md:385` | `--dry-run` is documented as "write nothing, **exit 0**". Both scripts deliberately exit **1** when the plan itself is invalid (`add_domain`: foreign hostname, unknown slug, missing `store_domains` table; `apply_migrations`: checksum mismatch). The *behaviour* is right — a dry run must not report a clean bill of health — but the doc and the `--help` text overpromise. |
| **R7** | Low | `scripts/deploy/add_domain.py:270-291` | The `--primary` refusal does not print the domain→store mapping, while the conflict refusal (`:357-359`) does. Minor inconsistency in an otherwise uniform "always show the map" contract. |
| **R8** | Low | `scripts/deploy/add_domain.py` (`DOMAIN_RE` from `add_store.py:68`) | IPv6 literals cannot be attached: `_normalize_domain("[::1]")` correctly yields `::1`, but `DOMAIN_RE` has no colon, so it is rejected as invalid. Migration 005 seeds `127.0.0.1`, not `::1`, so nothing depends on it today — but an IPv6-reachable deployment has no way to register that host. |
| **R9** | Low | `.github/workflows/tests.yml` | **The workflow has never run on GitHub Actions.** The guard step was reproduced locally with the literal extracted `run:` string, which is the closest available proxy, but the full `pip install -r requirements.txt` on Python 3.12/ubuntu (`playwright==1.48.0`, `lxml==5.3.0`, `pydantic==2.9.2`) is unverified. Watch the first run. |
| **R10** | Low | `.github/workflows/tests.yml:49`, `.gitignore` | `store_context_junit.xml` is written to the repo root and is **not** gitignored. Ephemeral in CI; a developer reproducing the guard locally leaves an untracked artifact. (I created one during this review and deleted it.) |
| **R11** | Cosmetic, **pre-existing** | `DEPLOY.md:587` (of 588 lines) | The file has an **odd** number of ``` fences (41), so the last Troubleshooting row renders inside a phantom code block in some viewers. Confirmed pre-existing: at `06b3225` the count was 27, also odd, with the same trailing fence. Not introduced by this work. |
| **R12** | Informational | both new scripts | **Neither script has ever touched Postgres.** Unproven bets, read-verified only: asyncpg parameter-type inference on `pg_try_advisory_lock($1)` / `pg_advisory_unlock($1)`; `$2::text` binding into a `citext` column; `lower(slug::text) = $1` and `lower(d.domain::text) = $1` against CITEXT; `to_regclass('public.x')::text`; and asyncpg's simple-query protocol accepting our multi-statement migration scripts inside `conn.transaction()`. The last one is the same assumption `init_remote_db.py:67-71` already ships on. Also: per-migration transactions assume no `CREATE INDEX CONCURRENTLY` in any future migration — true for all 8 current files, and a constraint `api/core/migrations._apply_one` shares. |

**Unchanged from audit §9** (still deferred, still correct to defer): `products_export.py`
remains unmounted, unscoped and carrying a `NOT NULL` bug; there is still no way to
provision a store-scoped admin; `GET /healthz/details` still counts platform-wide.

---

## 7. The exact ordered sequence to go multi-brand

Run from a full checkout, on one machine, in this order. `$DIRECT` is Neon's **direct
(non-pooled)** connection string — the one from Step 1 of DEPLOY.md, *not* the pooled host
in Vercel's `DATABASE_URL`.

### Step 0 — pre-flight (closes R1). Do not skip.

```bash
cd "C:/Users/ROG STRIX/Desktop/antigravity/playground/GLstore"
git status --porcelain          # must be clean of edits to db/migrations/
python -c "from pathlib import Path; print({p.name: ('CRLF' if b'\r\n' in p.read_bytes() else 'LF') for p in Path('db/migrations').glob('*.sql')})"
```

**Every value must be `LF`.** If any says `CRLF`, do **not** run `apply_migrations.py` from
this checkout — the checksums it records will not match what a Linux container computes.
Run it from WSL / a Linux box, or re-clone with `git -c core.autocrlf=false clone …`.

```bash
pip install asyncpg
export DIRECT="postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb"
```

### Step 1 — apply pending migrations (closes blocker 1)

```bash
python scripts/deploy/apply_migrations.py "$DIRECT" --dry-run
```
Expect `007_per_store_theme.sql   sha256=d83f5aa74ec1927a…` as the only pending file. If
the sha256 shown is not `d83f5aa7…`, **stop** — you are on a CRLF checkout (Step 0).

```bash
python scripts/deploy/apply_migrations.py "$DIRECT"
python scripts/deploy/apply_migrations.py "$DIRECT" --dry-run   # must say "Nothing pending"
```

### Step 2 — look before you write (closes blocker 2, part 1)

```bash
python scripts/deploy/add_domain.py "$DIRECT" --slug default --dry-run
```
Writes nothing. Confirms brand #1's real slug (if it is not `default`, the script lists the
real ones), and shows that the only domains are `localhost` and `127.0.0.1`.

### Step 3 — attach brand #1's real hostnames — BEFORE any flag change

```bash
python scripts/deploy/add_domain.py "$DIRECT" --slug default \
  --domain <your-project>.vercel.app \
  --domain shop.yourdomain.com \
  --domain www.shop.yourdomain.com \
  --dry-run

# identical command, without --dry-run
python scripts/deploy/add_domain.py "$DIRECT" --slug default \
  --domain <your-project>.vercel.app \
  --domain shop.yourdomain.com \
  --domain www.shop.yourdomain.com
```

### Step 4 — create brand #2

```bash
python scripts/deploy/add_store.py "$DIRECT" \
  --slug appliances --name "Appliances DZ" --prefix APP \
  --domain appliances.yourdomain.com
```

### Step 5 — host config

Vercel → Domains: add every hostname from Steps 3 and 4. Then Settings → Environment
Variables: add each host to `ALLOWED_HOSTS` (or `*`) and each origin to `CORS_ORIGINS`.
**Redeploy.** Also make sure this redeploy contains `edb5788` — Step 6's `x-store` check
depends on it.

### Step 6 — verify while `SINGLE_STORE_MODE` is still `true`

```bash
python scripts/deploy/add_domain.py "$DIRECT" --slug default --dry-run   # eyeball the whole map
```
Tick off every hostname you expect to keep serving. **Anything missing 404s at Step 7.**

```bash
curl -sI https://<your-project>.vercel.app/api/v1/categories | grep -i '^x-store'
#   expect:  x-store: default

curl -sI -H "Host: appliances.yourdomain.com" https://<your-project>.vercel.app/api/v1/categories | grep -i '^x-store'
#   expect:  x-store: appliances

python scripts/deploy/smoke_test_checkout.py https://<your-project>.vercel.app \
  --store-host appliances.yourdomain.com
#   the order number must come back APP-2026-000001 — that prefix exists only on brand #2
```

This is the **only** end-to-end evidence any of this works against Postgres. Nothing in
this review substitutes for it.

### Step 7 — flip the flag, last

Vercel → Settings → Environment Variables → `SINGLE_STORE_MODE` = `false` → **Redeploy.**

```bash
curl -sI https://<your-project>.vercel.app/api/v1/categories | head -1   # 200, not 404
curl -sI https://shop.yourdomain.com/api/v1/categories        | head -1  # 200
curl -sI https://appliances.yourdomain.com/api/v1/categories  | head -1  # 200
```

**If anything 404s:** set `SINGLE_STORE_MODE=true` and redeploy to get the shop back up
immediately, then attach the missing host with `add_domain.py` and wait out the 60s domain
cache (`api/core/store_context._CACHE_TTL_SECONDS`). No redeploy is required for the
attach itself. A **400** means `ALLOWED_HOSTS`, not `store_domains`.

### Step 8 — theme brand #2

Admin → Settings → Theme, **with brand #2 selected** in the store picker. Per-store theming
is what migration 007 (Step 1) enabled.

---

*Reviewed 2026-08-03. Executed in this review: the full pytest suite; `discover_migrations`
+ checksum identity across all 8 migrations; every failure path of both new CLI scripts;
the CI loud-skip guard in both its trip case and its zero-tests case; the CRLF/LF hash
measurement; YAML parse of the workflow. Not executed: anything against Postgres, and the
GitHub Actions workflow itself.*
