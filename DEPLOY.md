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

Your store launches with a **real catalog** — the 14 seeded GLAIVE products —
and can take Cash-on-Delivery orders immediately.

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

This applies `schema → seeds → migrations` in the correct order, seeds the 14
GLAIVE products, records all migrations, and brands the store. You should see:

```
✅ Database initialized.
   store:      GLAIVE (slug=default, prefix=GLV, currency=DZD)
   products:   14
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

1. Push this repo to GitHub (the branch you want to deploy).
2. In Vercel → **Add New… → Project** → import the repo.
3. Vercel reads `vercel.json` — **leave the framework/build settings at their auto-detected defaults** (the JSON drives everything).
4. Before the first deploy, open **Settings → Environment Variables** and add all of these (Production scope):

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

5. Click **Deploy**. You don't know your exact `*.vercel.app` URL until the first
   deploy finishes — that's OK, `SINGLE_STORE_MODE=true` + `ALLOWED_HOSTS=*` mean
   any hostname works. After it deploys, update `CORS_ORIGINS` to the real URL and redeploy.

### 4b. Via Vercel CLI (no GitHub needed)

```bash
npm i -g vercel
vercel            # first run: log in + link the project
vercel env add ENVIRONMENT production    # repeat for each var in the table above
vercel --prod     # deploy
```

## Step 5 — Verify it's live

Open `https://<your-project>.vercel.app` — you should see the storefront with the
GLAIVE catalog. Then smoke-test the full order path from a terminal:

```bash
BASE=https://<your-project>.vercel.app

# 1. catalog loads (store resolves on the vercel host)
curl -s $BASE/api/v1/catalog/categories | head

# 2. grab a real offer id from a product
curl -s "$BASE/api/v1/products?page=1&page_size=1"

# 3. place a test COD order (replace OFFER_ID)
curl -s -X POST $BASE/api/v1/orders/create -H 'Content-Type: application/json' -d '{
  "customer_name":"Test","customer_phone":"0555123456",
  "items":[{"offer_id":"OFFER_ID","quantity":1}],
  "shipping_address":{"wilaya":"Alger","commune":"Alger Centre","address":"1 rue test"},
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
check or to run from CI against a staging environment:

```bash
python scripts/deploy/smoke_test_checkout.py https://<your-project>.vercel.app
# or, if GLSTORE_BASE_URL is already set in the shell:
python scripts/deploy/smoke_test_checkout.py
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

> Note: the admin app's own multi-store wiring (store selection header) is a
> known follow-up — the public store does not depend on it. Ping me to finish
> that when you want full in-app catalog management.

---

## Going multi-store later (your superstore)

When you're ready for brand #2, you don't rewrite anything:

1. Set `SINGLE_STORE_MODE=false` on Vercel.
2. Insert the new store + its domains:
   ```sql
   INSERT INTO stores (slug, name, order_prefix) VALUES ('ghir','Ghir Laffaire','GHIR');
   INSERT INTO store_domains (store_id, domain, is_primary)
     SELECT id, 'ghir.yourdomain.com', true FROM stores WHERE slug='ghir';
   ```
3. Add that domain to the Vercel project + register the first store's real domain too.

Each store is fully isolated (its own products, orders, customers) — that's what
migration 005 built.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every page 404s "No store is configured" | `SINGLE_STORE_MODE` not `true`, or the DB init didn't create the `default` store. Re-run Step 2. |
| 400 "Invalid host header" | `ALLOWED_HOSTS` not set to `*` (or your domain) with `ENVIRONMENT=production`. |
| API 500 on first request after idle | Serverless **cold start** (~1–2s) + Neon waking from scale-to-zero. Normal; the next request is fast. |
| CORS errors in the browser console | `CORS_ORIGINS` must include the exact origin you're loading from. Update + redeploy. |
| `prepared statement` errors | Ensure `DB_SERVERLESS=true` is set (uses NullPool + disabled statement cache). |
| DB init says "already initialized" | The DB already has tables. Use a fresh Neon branch, or re-run with `--force`. |
```
