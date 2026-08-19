# Deploy your first store — Vercel + Neon (≈ $0 to start)

This ships the **React storefront + FastAPI backend + Postgres** as one live store
on a free Vercel subdomain. Everything the code needs is already prepared —
this doc is the click-path for the parts only you can do (create accounts,
paste secrets, hit deploy). I can't create accounts or enter your credentials.

```
  Browser ──► storefront (Vercel static CDN)
                 │  /api/v1/*  (same origin)
                 ▼
              FastAPI  (Vercel Python function)
                 │
                 ▼
              Neon Postgres  (free serverless DB)
```

Your store launches with **checkout fully wired** — store resolution, per-brand
order numbering, stock reservation and Cash-on-Delivery all work end to end and
are smoke-testable from the first deploy.

**The public catalog starts empty, on purpose.** The 14 GLAIVE products in
`db/seed_gaming.sql` are a layout fixture, not sellable stock — their names are
SteelSeries' actual product line (Arctis Nova, Apex Pro TKL, Aerox 3, QcK,
GameDAC), inserted under `brand = 'GLAIVE'`. The seed therefore archives them as
it loads (`status='ARCHIVED'` **and** offers deactivated), so they stay in the
database as a rendering reference but never reach the storefront and cannot be
ordered. Import your real catalog through the admin's CSV import before you
share the link.

---

## Cost reality (no surprises)

| | Building / testing | Once it's really selling |
|---|---|---|
| Vercel | **$0** (Hobby) | ~$20/mo (**Pro** — Vercel's ToS says Hobby is non-commercial) |
| Neon Postgres | **$0** (free tier) | $0 until you outgrow 0.5 GB |
| Domain | **$0** (`*.vercel.app`) | ~$12/yr when you want a real name |

You can build, demo and test for **$0**. Move to Vercel Pro when it's genuinely
taking paid orders.

---

## Prerequisites (all free)

1. A **GitHub** account with this repo pushed to it (or use the Vercel CLI — see Step 4b).
2. A **Neon** account → https://neon.tech
3. A **Vercel** account → https://vercel.com
4. Locally: **Python 3.11+** and `pip install asyncpg` (only for the one-time DB init).

---

## Step 1 — Create the Neon database

1. In Neon, create a new **Project** (name it e.g. `glstore`). Region: pick the one closest to your customers.
2. Neon creates a database. Copy the **connection string**. Use the **direct** (non-pooled) one for setup — it looks like:
   `postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

> Keep this string secret — it's full database access.

## Step 2 — Initialize the database (one time)

From the repo root, with `asyncpg` installed:

```bash
pip install asyncpg
python scripts/deploy/init_remote_db.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb" --brand "GLAIVE" --prefix GLV
```

This applies `schema → seeds → migrations` in the correct order, loads the 14
GLAIVE fixture products **as archived**, records all migrations, and brands the
store. You should see:

```
✅ Database initialized.
   store:      GLAIVE (slug=default, prefix=GLV, currency=DZD)
   products:   14  (0 live on the storefront)
   offers:     ...
   migrations: 000_… 001_… 002_… 003_… 004_… 005_stores.sql 006_store_scope_orders.sql
```

(The store `slug` stays `default` on purpose — that's what the single-store
fallback resolves.)

## Step 3 — Generate a JWT secret

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```
Copy the output — you'll paste it as `JWT_SECRET` in Step 4.

## Step 4 — Deploy on Vercel

### 4a. Via GitHub (recommended — gives auto-deploys)

1. Push the branch you want to deploy:
   ```bash
   git push origin gaming-store
   ```
2. In Vercel → **Add New… → Project** → import the repo.
3. **Set the Production Branch to `gaming-store`** — Settings → Git → Production Branch.
   **Do this before the first deploy.**

   > ⚠️ **This is the easiest way to deploy nothing that works.** The repo's default
   > branch is `main`, so Vercel pre-fills `main` and a straight "Import → Deploy"
   > builds it. `main` is the pre-multi-store snapshot: no `stores` table, no
   > per-brand routing, no `api/index.py`, no `vercel.json`. It will either fail to
   > build or come up as a store that cannot take an order — and the error messages
   > won't point at the branch. Everything in this document assumes `gaming-store`.

4. Vercel reads `vercel.json` — **leave the framework/build settings at their auto-detected defaults** (the JSON drives everything).
5. Before the first deploy, open **Settings → Environment Variables** and add all of these (Production scope):

| Name | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `DB_SERVERLESS` | `true` |
| `RUN_STARTUP_MIGRATIONS` | `false` |
| `SINGLE_STORE_MODE` | `true` |
| `ALLOWED_HOSTS` | `*` |
| `DATABASE_URL` | `postgresql+asyncpg://USER:PASSWORD@ep-xxxx.neon.tech/neondb` |
| `JWT_SECRET` | *(the string from Step 3)* |
| `CORS_ORIGINS` | `https://<your-project>.vercel.app` |

> Note the `DATABASE_URL` here uses the **`postgresql+asyncpg://`** prefix (SQLAlchemy driver form),
> and you can use Neon's **pooled** host here for runtime. Query params like `?sslmode=require` are fine.

6. Click **Deploy**. You don't know your exact `*.vercel.app` URL until the first
   deploy finishes — that's OK, `SINGLE_STORE_MODE=true` + `ALLOWED_HOSTS=*` mean
   any hostname works. After it deploys, update `CORS_ORIGINS` to the real URL and redeploy.

> **Python version:** `.python-version` pins **3.12** and Vercel reads it automatically —
> there is nothing to configure. Don't "upgrade" it casually: `asyncpg==0.29.0` publishes
> no wheel for 3.13+, so bumping that file breaks the build with
> `No matching distribution found for asyncpg==0.29.0`. To move to a newer Python you must
> raise the `asyncpg` pin in **both** `requirements.txt` and `api/requirements.txt` first.
> 3.12 is also what CI and all three Dockerfiles use, so local, CI and production agree.

### 4b. Via Vercel CLI (no GitHub needed)

```bash
npm i -g vercel
vercel            # first run: log in + link the project
vercel env add ENVIRONMENT production    # repeat for each var in the table above
vercel --prod     # deploy
```

## Step 5 — Verify it's live

Open `https://<your-project>.vercel.app`. You should see the storefront shell —
branding, navigation, search, theme — with **an empty catalog**. That is the
expected first-deploy state: the seeded products are archived (see the top of
this document), so there is nothing to sell until you import real stock.

Confirm the app and database are actually talking:

```bash
BASE=https://<your-project>.vercel.app

curl -s $BASE/healthz                      # -> {"status":"ok"}
curl -s $BASE/api/v1/storefront/theme      # -> your store's palette, proves store resolution
curl -s "$BASE/api/v1/products?page=1&page_size=1"   # -> {"items":[],...} EXPECTED while empty
```

An empty `items` array with HTTP 200 is a **pass** here: the request reached the
function, resolved a store and queried Postgres. A 500 or a 404 is not.

### Then import your catalog, and only then test an order

Checkout cannot be verified against an empty shop — there is no offer to buy.
Import real stock through the admin's CSV import first, then place a test order:

```bash
BASE=https://<your-project>.vercel.app

# 1. categories now reflect your imported catalog
curl -s $BASE/api/v1/catalog/categories | head

# 2. grab a real offer id from a product (requires imported stock)
curl -s "$BASE/api/v1/products?page=1&page_size=1"

# 3. place a test COD order (replace OFFER_ID)
curl -s -X POST $BASE/api/v1/orders/create -H 'Content-Type: application/json' -d '{
  "customer_name":"Test","customer_phone":"0555123456",
  "items":[{"offer_id":"OFFER_ID","quantity":1}],
  "shipping_address":{"wilaya":"Alger","commune":"Alger Centre","street":"1 rue test"},
  "payment_method":"COD","shipping_cost":0,"discount_amount":0
}'
# → returns an order with "order_number":"GLV-2026-000001" and status "RESERVED"
```

If the order comes back with a `GLV-…` number, **checkout works end to end** —
store resolution, per-store order numbering, stock reservation and the order
event are all wired.

## Verify checkout end to end (automated)

The manual curl steps above are also wrapped in one script that does the same
four checks and prints PASS/FAIL for each — useful for a quick post-deploy
check or to run from CI against a staging environment.

> **Requires stock.** It buys something, so it needs at least one ACTIVE product
> with an active offer. Against a freshly initialized store it stops at
> `FAIL [2/4 list products] … nothing ACTIVE to sell` — that is the empty
> catalog, not a broken deploy. Import first, then run this.

```bash
python scripts/deploy/smoke_test_checkout.py https://<your-project>.vercel.app
# or, if GLSTORE_BASE_URL is already set in the shell:
python scripts/deploy/smoke_test_checkout.py
# once you run more than one brand, test one specific brand:
python scripts/deploy/smoke_test_checkout.py https://<your-project>.vercel.app \
  --store-host appliances.yourdomain.com
```

It performs, in order: `GET /healthz`, `GET /api/v1/products` (grabs a real
product id), `GET /api/v1/products/{id}` (grabs a real offer id), then
`POST /api/v1/orders/create` with a COD test order for that offer. It exits
`0` only if every step passed, and exits `1` — printing which step failed and
the response body — otherwise.

**This creates a real order** (customer `Smoke Test`, phone `0555000111`) in
whatever database the target URL is wired to. Point it at a test/staging
deployment, not production, unless you're fine seeing that order in the
ledger. This is standard-library-only Python — no `pip install` needed.

---

## Applying migrations to a live database

**Run this after any deploy that adds a file to `db/migrations/`.** Nothing else
will apply it. Code ships on push; schema does not.

Why there is a separate step at all: `RUN_STARTUP_MIGRATIONS=false` in the Step 4
env table, because serverless has no single startup to hang a schema change off —
every cold start would race every other one. And `init_remote_db.py` (Step 2)
deliberately refuses any database that already has a `products` table, so it can
never be the answer either. This script is the third door, and the only one that
opens onto a live database.

```bash
pip install asyncpg   # same one-off dependency as Step 2

# 1. ALWAYS dry-run first. It writes nothing — not one row, not even the
#    tracking table — and just tells you what a real run would do.
python scripts/deploy/apply_migrations.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb" --dry-run

# 2. then apply
python scripts/deploy/apply_migrations.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb"
```

(Or omit the connection string and set `DATABASE_URL`.)

> **Use Neon's DIRECT, non-pooled connection string** — the same one from Step 1,
> *not* the pooled host you put in the Vercel `DATABASE_URL`. This is DDL: it holds
> a session-scoped advisory lock and runs each migration in its own transaction,
> and a pooler is free to hand you a different backend mid-session, which would
> silently break both.

A clean dry run looks like this:

```
→ discovered 8 migration file(s) in db/migrations
→ connecting (TLS) …

→ 1 migration(s) WOULD be applied, in this order:
   · 007_per_store_theme.sql   sha256=d83f5aa74ec1927a…
   (6 already applied, would be skipped.)

Dry run — nothing was written. Re-run without --dry-run to apply.
```

Then the real run prints `✅ Applied 1 migration(s): …` and lists everything now
recorded in `_migrations`. **Re-running is safe**: a second run finds nothing
pending, says so, and exits 0.

### If you deployed before this script existed

You probably have exactly this situation: `007_per_store_theme.sql` is in the repo
but not in your database. The symptom is quiet rather than loud — the storefront
falls back to the pre-007 global theme, so **the palette you saved in Theme Studio
appears to have been forgotten**. Dry-run, then apply; the theme comes back.

### What it refuses to do

| It stops when | Because |
|---|---|
| The database has no `products` table | It migrates, it doesn't initialize. Run `init_remote_db.py` (Step 2) first. |
| An already-applied migration's file has changed | Migrations are immutable once applied. If the file and the recorded SQL differ, nobody can say what the database actually contains. Restore the file from git and put the change in a **new** migration. Nothing is applied and nothing is recorded. |
| Another process holds the migration lock | It takes the same Postgres advisory lock `api/core/migrations.py` takes, so a persistent replica booting with `RUN_STARTUP_MIGRATIONS=true` can't run migrations underneath it. |
| A migration's SQL fails | That one migration is rolled back; migrations that already succeeded in this run stay committed. Fix the SQL and re-run — it resumes from where it stopped. |

Every applied file is recorded in `_migrations` with the SHA-256 of its bytes, in
exactly the format `api/core/migrations.py` uses. So the two paths agree: if you
ever move to a persistent host and flip `RUN_STARTUP_MIGRATIONS=true`, nothing
re-applies and nothing reports a false mismatch.

To see the state at any time, in Neon's SQL editor:

```sql
SELECT filename, applied_at FROM _migrations ORDER BY filename;
```

---

## 🔒 Before you share the link: rotate the admin password

The seeded admin (`brvetr4veler@gmail.com` / `brveadmin`) is **in the repo**, so
change it once the API is public:

```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_NEW_PASSWORD', bcrypt.gensalt(12)).decode())"
```
Then in Neon's SQL editor:
```sql
UPDATE admin_users SET password_hash = '<hash-from-above>'
 WHERE email = 'brvetr4veler@gmail.com';
```

---

## Managing your store (admin)

The public storefront is fully live and taking orders without the admin app.
To manage the catalog/orders, run the **admin** app locally against your live API:

```bash
# admin/.env.local
VITE_API_URL=https://<your-project>.vercel.app/api/v1
```
Then add your local admin origin to `CORS_ORIGINS` on Vercel (e.g.
`https://<your-project>.vercel.app,http://localhost:5174`) and redeploy.

The admin's store picker is wired: it loads your stores from `GET /stores` and
sends the selected one as the `x-store-id` header on every call, so catalog
reads and writes always act on the same brand. See
[Running more than one brand](#running-more-than-one-brand) once you have a
second one.

---

## Running more than one brand

This platform hosts **several brands you own** — GLAIVE gaming gear, a home-appliance
brand, whatever comes next — each with its own domain, look, catalog and orders, all
managed from **one admin login**. It is not a marketplace: there are no third-party
vendors, no commissions and no payouts. One brand = one row in `stores`.

Each store is fully isolated — its own products, offers, customers, orders and order
numbering. That is what migration 005 built, so adding brand #2 rewrites nothing.

## Turning on multi-brand

Multi-brand is off by default: `SINGLE_STORE_MODE=true`. Turning it on is a single
env-var flip — and **that flip has to be the last thing you do.**

Do them in this order. "If you do it in the wrong order" below says exactly what
breaks otherwise.

| Step | Do | Writes to |
|---|---|---|
| **A** | See what you actually have | — (read only) |
| **B** | Attach brand #1's **real** hostnames | `store_domains` |
| **C** | Create brand #2 | `stores` + `store_domains` |
| **D** | DNS, Vercel domains, `ALLOWED_HOSTS`, `CORS_ORIGINS` | your host |
| **E** | Verify **while the fallback is still on** | — (read only) |
| **F** | **Only now** set `SINGLE_STORE_MODE=false` | Vercel env |
| **G** | Give brand #2 its own look | `stores.theme` |

(Lettered so they don't collide with the numbered deploy steps at the top of this doc.)

### Step A — see what you actually have

In Neon's SQL editor:

```sql
SELECT slug, name, order_prefix, status FROM stores ORDER BY slug;

SELECT s.slug, d.domain, d.is_primary
  FROM store_domains d JOIN stores s ON s.id = d.store_id
 ORDER BY s.slug, d.is_primary DESC;
```

A deployment that has only ever run one brand answers `default | Default Store | GL`
(or whatever `init_remote_db.py --brand/--prefix` set) and exactly **two** domains:
`localhost` and `127.0.0.1`. Migration 005 seeded those for local development.

**Your live `<project>.vercel.app` URL is not in that list.** That is the entire
problem this runbook exists to solve — see Step F.

Without a SQL console, the same answer comes from the script you will use in Step B —
with no `--domain` and `--dry-run` it only looks:

```bash
python scripts/deploy/add_domain.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb" \
  --slug default --dry-run
```
```
Domain → store mapping (every brand on this database):

  default   "Default Store"  ←
      · localhost   (primary)
      · 127.0.0.1
```

### Step B — attach brand #1's real hostnames

Every hostname that must keep working after the flip has to be a `store_domains` row:
the `*.vercel.app` URL, your apex domain, `www`, any staging host.

```bash
pip install asyncpg   # same one-off dependency as the DB init in Step 2 above

# ALWAYS look first — writes nothing, prints the full domain → store mapping
python scripts/deploy/add_domain.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb" \
  --slug default \
  --domain <your-project>.vercel.app \
  --domain shop.yourdomain.com \
  --dry-run

# then the same command without --dry-run
```

(Or omit the connection string and set `DATABASE_URL`. Use Neon's **direct**,
non-pooled string, same as Step 2.)

`add_domain.py` only ever writes `store_domains`. It has no `--name` and no
`--prefix`, **cannot create a store**, and refuses a slug that does not exist —
so a typo is an error listing your real slugs, not a phantom third brand.
(`add_store.py` is the opposite tool: it *creates* a brand, and requires the exact
`--name`/`--prefix` of an existing slug, which is why it is the wrong instrument for
"I just need to add a hostname".)

| Flag | Meaning |
|---|---|
| `--slug` | an **existing** store's slug, from Step A |
| `--domain` | bare hostname, repeatable — no scheme, no port, no path |
| `--primary` | make the first `--domain` this store's primary (see below) |
| `--dry-run` | report + print the mapping, write nothing, exit 0. Legal with no `--domain` — that is the inspect mode from Step A |

What it refuses:

- **A hostname that already belongs to another brand** → exits non-zero naming the
  owner, and writes nothing for the whole batch. `store_domains.domain` is globally
  unique, so a hostname routes to exactly one brand; moving one is a deliberate
  two-step (`DELETE` it from the other store, then re-run).
- **`--primary` when the store already has a different primary** → exits non-zero and
  hands you the two-statement swap. One primary per store is enforced by the
  `store_domains_one_primary_per_store` index; the script never demotes anything
  implicitly. You rarely need `--primary` — the primary only builds absolute URLs,
  **every** attached domain routes.

Re-running with hostnames the store already owns writes nothing and exits 0.

> Host lookups are cached for 60s (`api/core/store_context._CACHE_TTL_SECONDS`), so a
> newly attached domain can take a minute (or a redeploy) to start resolving.

### Step C — create brand #2

```bash
python scripts/deploy/add_store.py "postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb" \
  --slug appliances \
  --name "Appliances DZ" \
  --prefix APP \
  --domain appliances.yourdomain.com \
  --domain www.appliances.yourdomain.com
```

(Or omit the connection string and set `DATABASE_URL`. Use Neon's **direct**,
non-pooled string, same as Step 2.)

```
✅ Store ready.
   id:       6f0c…-…
   slug:     appliances
   name:     Appliances DZ
   prefix:   APP   (order numbers look like APP-2026-000001)
   currency: DZD
   domains:  appliances.yourdomain.com*, www.appliances.yourdomain.com
```

What the arguments mean:

| Flag | Rules | Notes |
|---|---|---|
| `--slug` | lowercase, hyphen-separated (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) | permanent internal key for the brand |
| `--name` | 1–200 chars | shown in the admin's store picker |
| `--prefix` | UPPERCASE, 2–10 chars (`^[A-Z][A-Z0-9]{1,9}$`) | prefixes every order number for this brand |
| `--domain` | bare hostname, repeatable | **first one becomes the primary**; optional — you can add domains later |
| `--currency` | 3-letter ISO code, default `DZD` | |

The script validates all of that in Python before it connects, so a typo gets a plain
message instead of a Postgres constraint error. It is **idempotent** — re-running the
exact same command inserts nothing and exits 0. Two refusals worth knowing:

- **Slug already exists with different details** → it changes nothing and exits non-zero.
  `order_prefix` is baked into every order number that brand has already issued, so a
  rename is never something a deploy script should do quietly. Use a different `--slug`,
  or edit the existing store deliberately.
- **A domain already points at another brand** → it says so and exits non-zero rather
  than silently leaving the hostname on the old store. Remove it there first, then re-run.

> There is no "create store" button in the admin — the console only *switches between*
> stores that already exist. This script is the supported way to create one.
> To add a hostname to a brand that already exists, use `add_domain.py` (Step B) —
> `add_store.py` would make you re-type that brand's exact `--name` and `--prefix`
> and exits 1 if either differs.

### Step D — point domains at the deployment

1. **DNS**: add a `CNAME` for `appliances.yourdomain.com` → `cname.vercel-dns.com`
   (or whatever your host tells you). Repeat for each `--domain` you registered.
2. **Vercel** → Settings → Domains → add each hostname to the same project. All brands
   are served by one deployment; the API tells them apart by the `Host` header via the
   `store_domains` table.
3. **`ALLOWED_HOSTS`**: with `ENVIRONMENT=production` this must admit every brand
   hostname, e.g. `appliances.yourdomain.com,www.appliances.yourdomain.com,glaive.yourdomain.com`
   (or stay `*`). A host that isn't listed gets a `400 Invalid host header` before any
   route runs.
4. **`CORS_ORIGINS`**: add each brand's origin (`https://appliances.yourdomain.com`, …)
   plus your local admin origin. Redeploy after changing env vars.

### Step E — verify, while the fallback is still on

This is the step that makes Step F boring.

`SINGLE_STORE_MODE=true` does **not** force every hostname onto the `default` store.
Host resolution runs *first* and a registered domain always wins; the flag only decides
what happens to an **unrecognised** Host — fall back to `default` (on) or `404` (off).
So every domain you attached in Steps B–C already routes correctly **right now**, and
you can prove it before you take the net away.

```bash
# brand #2, resolved by Host — places a REAL COD order on the new brand
python scripts/deploy/smoke_test_checkout.py https://appliances.yourdomain.com

# or, before DNS has propagated: same connection, different Host header
python scripts/deploy/smoke_test_checkout.py https://<your-project>.vercel.app \
  --store-host appliances.yourdomain.com
```

`--store-host` sets the `Host` header without changing where the request connects. An
order number coming back as `APP-2026-000001` is the proof — that prefix exists only on
the new store.

Then re-run Step A's second query and tick off, one by one, every hostname you expect to
keep serving. **Anything missing from that list 404s the moment you do Step F.**

### Step F — set `SINGLE_STORE_MODE=false`

On Vercel → Settings → Environment Variables, then redeploy:

| Name | Value |
|---|---|
| `SINGLE_STORE_MODE` | `false` |

That removes the fallback: an unrecognised Host is now a hard
`404 "No store is configured for this address."` Deliberate — serving the wrong brand's
catalog after a DNS typo is worse than an error page.

Leaving it `true` is not safe once you have two brands either: any hostname you forgot
to register keeps quietly resolving to `default`, so brand #2's URL would serve brand
#1's catalog. Flip it, so a mistake fails loudly instead of selling from the wrong shop.

### If you do it in the wrong order

**Setting `SINGLE_STORE_MODE=false` before Step B is the one that hurts.**

The only hostnames migration 005 seeds are `localhost` and `127.0.0.1`. Your live
`<project>.vercel.app` URL is not one of them, and with the fallback off there is
nothing left to catch it:

- **Every public page 404s** — `No store is configured for this address.` Storefront,
  catalog, checkout, for every visitor, from the first request after the redeploy.
- **The admin console keeps working**, which makes it confusing: it sends `x-store-id`,
  and admin routes resolve their store from that authenticated header, never from `Host`
  (`api/core/store_context.py` — Host is client-controlled, so it is a routing signal,
  not an authorization one). The dashboard stays green while the shop is dark.
- **Recovery is Step B**: attach the hostname, then wait out the 60s domain cache. No
  redeploy needed — though setting the flag back to `true` gets the shop up immediately
  while you finish.

Two smaller reversals:

- **Creating brand #2 (Step C) before attaching brand #1's domains (Step B)** is
  harmless. Both only write `store_domains`, and neither can take a hostname the other
  owns — the scripts refuse and exit non-zero.
- **Skipping Step D's `ALLOWED_HOSTS`** fails differently: `400 Invalid host header`,
  raised by TrustedHostMiddleware *before* any route runs, so store resolution never
  happens at all. A 400 means `ALLOWED_HOSTS`; a 404 means `store_domains`.

### Step G — give the brand its own look

Storefront theming is **per store** — it lives in `stores.theme`, not in a global
setting. Two brands on one deployment therefore look nothing alike.

- Public read: `GET /storefront/theme` resolves the store from the `Host` header and
  returns **that** store's theme, so each domain boots its own palette with no redeploy.
- Editing it: admin → **Settings → Theme**, with the target brand selected in the store
  picker (scope `storefront`). The admin sends the selected store in the `x-store-id`
  header and the write lands on that store's row only.
- A brand whose theme is still empty falls back to the old global
  `app_settings['storefront.theme']` value, so nothing renders blank before you have
  themed it.
- **The admin console's own theme stays global** (`app_settings['admin.theme']`, scope
  `admin`). That is your operator chrome, not a brand asset — restyling it does not
  touch any storefront.

Product images, copy and catalog are per store too: a new brand starts with an **empty
catalog**. The 14 seeded GLAIVE products belong to the `default` store, are not
shared, and are archived on load anyway (see the top of this document) — so a new
brand and brand #1 both start with nothing on the shelf until you import stock.

### Who can manage which brand

`admin_users.store_id` decides:

- **`NULL` = platform operator** — the seeded owner account. Sees every store in the
  picker, and must name one via `x-store-id` on store-scoped calls. This is the "one
  person, several brands" setup.
- **Set to a store id** = scoped operator. Sees and touches only that brand; naming a
  different store is a `403`.

Platform-wide settings (scraper config, LLM config) are restricted to platform
operators, so a scoped admin of one brand cannot change behaviour for the others.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every page 404s "No store is configured" | That hostname has no `store_domains` row and the fallback is off. Attach it: `python scripts/deploy/add_domain.py "<direct-neon-url>" --slug <slug> --domain <hostname>` — run it with `--dry-run` first to see the current mapping. (**Single brand:** `SINGLE_STORE_MODE` not `true` is the other way to get here, or the DB init never created the `default` store — re-run Step 2.) |
| A new brand's domain serves the *old* brand's catalog | That domain isn't registered to the new store, so it falls through to the `default` store. Check the mapping (`add_domain.py --slug <slug> --dry-run`) and attach it. `SINGLE_STORE_MODE=true` is what makes the fallthrough silent rather than a 404 — it does **not** override a domain that *is* registered. See "Turning on multi-brand". |
| Both brands look identical | The new store's `stores.theme` is still empty, so it falls back to the global pre-007 theme. Theme it in admin → Settings → Theme **with that store selected**. |
| 400 "Invalid host header" | `ALLOWED_HOSTS` not set to `*` (or your domain) with `ENVIRONMENT=production`. |
| API 500 on first request after idle | Serverless **cold start** (~1–2s) + Neon waking from scale-to-zero. Normal; the next request is fast. |
| CORS errors in the browser console | `CORS_ORIGINS` must include the exact origin you're loading from. Update + redeploy. |
| `prepared statement` errors | Ensure `DB_SERVERLESS=true` is set (uses NullPool + disabled statement cache). |
| DB init says "already initialized" | The DB already has tables. That's `init_remote_db.py` refusing to clobber a live database — for a schema change you want `apply_migrations.py` instead (see "Applying migrations to a live database"). Use a fresh Neon branch, or `--force`, only if you really meant to re-initialize. |
| A shipped change behaves like the old code (e.g. the saved storefront theme reverts) | A `db/migrations/*.sql` reached the repo but not the database — `RUN_STARTUP_MIGRATIONS=false` means deploys never apply migrations. Run `python scripts/deploy/apply_migrations.py "<direct-neon-url>" --dry-run`. |
```
