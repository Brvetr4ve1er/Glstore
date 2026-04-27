# Architecture

## System overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        GHIR LAFFAIRE PLATFORM                      │
└────────────────────────────────────────────────────────────────────┘

   Storefront (future)              Admin Console
        │                                  │
        │  POST /orders                    │  full CRUD + intel
        ▼                                  ▼
   ┌─────────────────────────────────────────────────┐
   │               FastAPI (api/)                    │
   │  auth · products · import · enrichment · orders │
   │  ───────────────────────────────────────────────│
   │  Pydantic DTOs · JWT guard · rate limiter       │
   │  Async SQLAlchemy 2 + asyncpg                   │
   └────────────────┬────────────────────────────────┘
                    │
            ┌───────┴────────┐
            ▼                ▼
    ┌──────────────┐   ┌──────────────────────────┐
    │ PostgreSQL   │   │  Async workers           │
    │  Write Model │◀──│  (event + reservation)   │
    │              │   │  FOR UPDATE SKIP LOCKED  │
    └──────────────┘   └──────────────────────────┘
```

---

## Data model

The Write Model is authoritative. All reads currently hit it directly. A Read Model is layered later when scale demands.

### Entity map

```
products  ──┬── offers ──── inventory_reservations
            │      │
            │      └─ order_items ── orders ── customers
            │
            └── product_media
            └── observations  (entity_type='product' | 'offer')

events       (event sourcing for downstream sync)
sync_queue   (n8n / external bridge)
financial_transactions  (idempotent payment records)
admin_users  (auth)
```

### Key tables

| Table | Purpose |
|---|---|
| `products` | Canonical product catalog, one row per SKU family. `status` ENUM (`RAW → NORMALIZED → CLASSIFIED → VERIFIED → ACTIVE / NEEDS_FIX / ARCHIVED`). `completeness_score` (NUMERIC 0..1) recomputed by enrichment. `specs JSONB` for free-form attributes. |
| `offers` | Sellable variants under a product. Holds `purchase_price`, `retail_price`, `sale_price`, `currency`, `stock_quantity`, `reserved_quantity`. CHECK enforces `reserved <= stock` and `sale <= retail`. |
| `product_media` | Image/video URLs (binaries stored in R2). Partial unique index forces exactly one primary image per product. |
| `observations` | Fact-level audit trail. Every enrichment / scrape / manual fix appends a row with `field`, `value JSONB`, `source`, `confidence`. Enables consensus + "where did this fact come from?" |
| `customers` | Lightweight — no accounts, just contact info per order. |
| `orders` + `order_items` | COD-first, state-machine ENUM. `order_items` stores **price snapshots** (immutable after creation). |
| `inventory_reservations` | Stock holds with TTL. Released by `reservation_worker.py`. |
| `events` | Event-source rows with `retry_count`, `next_retry_at`, `last_error`. Workers claim via `FOR UPDATE SKIP LOCKED`. |
| `sync_queue` | Outgoing items for n8n / external systems. |
| `financial_transactions` | Idempotent payment records — `UNIQUE(order_id, kind, idempotency_key)`. |
| `admin_users` | Hashed bcrypt passwords, role ENUM, lockout fields. |

### State machines (enforced by ENUMs)

```
product_status_enum:
  RAW → NORMALIZED → CLASSIFIED → VERIFIED → ACTIVE
  any state ── NEEDS_FIX ── (re-enrich) ─→ NORMALIZED
  any state ── ARCHIVED  (terminal)

order_status_enum:
  PENDING ─[reserve]─▶ RESERVED ─[confirm]─▶ CONFIRMED ─▶ PACKED ─▶ SHIPPED ─▶ DELIVERED
                          │                       │
                          └─[cancel]─▶ CANCELLED ─┘ (release reservations)

payment_status_enum:
  UNPAID → PENDING → PAID → REFUNDED
                         └→ PARTIAL / FAILED
```

Invalid transitions cannot be represented in the type system; service code (`api/services/orders.py`) enforces them with row-locks (`SELECT ... FOR UPDATE`).

---

## Service layer (`api/services/`)

| Module | Responsibility |
|---|---|
| `orders.py` | `create_order` · `confirm_order` · `cancel_order` · `fetch_order`. Multi-row stock reservation, idempotency keys, FOR UPDATE locks. |
| `events.py` | `emit_event(...)` helper — single point of event creation. |
| `csv_parser.py` | Pure: CSV → list[RawProductRow]. NFD-normalised fuzzy header matching, RFC-4180 quoting, EU/US number parsing. |
| `csv_import.py` | Pure orchestrator: validates rows, dedupes slugs (cascade), batches upserts into `products` + `offers`. Idempotent on SKU. |
| `enrichment.py` | Pure: 60 brands + 65 category regex + spec extractors + ATTR_BUILDERS. `enrich(name, ...) → EnrichmentResult`. |
| `enrichment_runner.py` | DB bridge: loads product facts, runs `enrich()`, applies `UPDATE products SET ...`, writes `observations` rows. |

**Convention:** services are pure where possible; DB-coupled functions explicitly accept `db: AsyncSession` and never call `db.commit()` (that's the route's responsibility).

---

## Request flows

### 1. Bulk CSV import (Phase 1 + 2 auto-enrich)

```
[admin uploads CSV]
        │
        ▼
POST /api/v1/products/import/commit
        │
        ▼
csv_parser.parse(text)               ← detects delimiter, encoding, columns
        │
        ▼
csv_import.commit_import(db, rows)   ← upsert products + offers, idempotent
        │
        ▼
enrichment_runner.enrich_many(db)    ← brand/category/specs for each row
        │
        ▼
db.commit()
        │
        ▼
JSON: { diagnostic, report, enrichment }
```

### 2. Order creation (foundation)

```
POST /api/v1/orders/create
        │
        ▼
upsert_customer(phone)                       ← dedupe by normalised phone
        │
        ▼
SELECT offers WHERE id = ANY(...) FOR UPDATE ← row-lock
        │
        ▼
INSERT order + items + reservations          ← all in one TX
fn_reserve_stock(...) per item               ← atomic stock hold
        │
        ▼
emit_event('order.created')                  ← picked up by event_worker
db.commit()
```

### 3. Single-product enrichment (Phase 2)

```
POST /api/v1/products/{id}/enrich
        │
        ▼
enrichment_runner.enrich_one(db, id)
   │
   ├─ load facts (brand, category, specs, has_price, has_stock, has_image)
   ├─ enrichment.enrich(name, ...)         ← pure, no IO
   ├─ UPDATE products SET brand/category/specs/description/status/score
   └─ INSERT observations (audit trail)
        │
        ▼
db.commit()
```

---

## Frontend architecture (`admin/`)

```
admin/src/
├── App.tsx              ← BrowserRouter + AuthProvider + QueryClientProvider
├── main.tsx
├── index.css            ← brand tokens (Bold Blue / Yellow / Pink) + utilities
├── components/
│   ├── BrandLogo.tsx    ← cart + ? + crown SVG with motion
│   ├── Layout.tsx       ← sidebar shell, layoutId nav pill
│   └── ui.tsx           ← Button, Input, Select, Textarea, Card, Modal, etc.
├── lib/
│   ├── api.ts           ← typed fetch client (JWT, multipart, errors)
│   ├── auth.tsx         ← AuthProvider (JWT in localStorage)
│   ├── query.ts         ← TanStack QueryClient config
│   └── utils.ts         ← fmtMoney, fmtDate, status colour maps
└── pages/
    ├── Login.tsx
    ├── Dashboard.tsx
    ├── Products.tsx       ← virtualised list + filters + bulk actions
    ├── ProductDetail.tsx
    ├── ProductEditor.tsx  ← create + edit (one component)
    ├── ProductImport.tsx  ← drag-drop CSV → preview → commit
    ├── Orders.tsx
    └── OrderDetail.tsx
```

State: TanStack Query for server state, plain `useState` for ephemeral UI state. No Redux. No Zustand. No browser-side store.

Routing: React Router v7. Layout uses an `<Outlet />` so every authed page shares the sidebar.

Animation: Framer Motion for non-trivial transitions (`AnimatePresence`, `layoutId`, `whileHover`). CSS keyframes for ambient effects (sparkle pulse, crown bounce).

---

## Deployment topology

### Dev (current)
```
docker compose up -d
  ├── db                    PostgreSQL 16, schema + admin auto-seeded
  ├── api                   uvicorn --reload, source bind-mounted
  ├── event_worker          source bind-mounted
  └── reservation_worker    source bind-mounted
```
Admin runs out-of-container via `cd admin && npm run dev` on port 5174 with Vite proxying `/api` → `http://localhost:8000`.

### Prod (target — not yet built)
```
                   ┌─────────────┐
                   │  Cloudflare │  TLS, WAF, R2 origin
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              │     Caddy / Nginx     │  reverse proxy, HSTS
              └───────────┬───────────┘
                          │
          ┌───────────────┴────────────────┐
          ▼                                ▼
   ┌────────────┐                   ┌──────────────┐
   │  api (×N)  │                   │ admin static │
   │  uvicorn   │                   │ Vite build   │
   └─────┬──────┘                   └──────────────┘
         │
         ▼
   ┌────────────┐  ┌────────────────┐
   │ PostgreSQL │  │ event_worker × │
   │  (managed) │  │ reservation × ✕│
   └────────────┘  └────────────────┘
```

For multi-replica API, swap the in-process rate limiter for a Redis-backed `INCR/EXPIRE`. Workers are already safe to scale horizontally because of `FOR UPDATE SKIP LOCKED`.

---

## Security

| Surface | Defence |
|---|---|
| **Passwords** | bcrypt(12) at rest. Never returned by any endpoint. |
| **Auth tokens** | JWT (HS256), `type=access` claim verified. 60-min default TTL. `JWT_SECRET` ≥ 64 random chars. |
| **Brute force** | Lockout after 5 failures (15 min). Tracked via `failed_attempts` + `locked_until` on `admin_users`. |
| **AuthZ** | `require_role(...)` decorator on every write endpoint. Role hierarchy `SUPER_ADMIN > ADMIN > OPERATOR > VIEWER`. |
| **Injection** | All SQL via SQLAlchemy `text(...)` + bound parameters. **No string concatenation anywhere in the codebase.** |
| **Rate limiting** | In-process sliding window on mutating endpoints. Configurable per-minute. |
| **Headers** | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy applied to every response. |
| **CORS** | Whitelist via `CORS_ORIGINS` env. |
| **Trusted hosts** | Enforced in production via `TrustedHostMiddleware`. |
| **PII** | No customer accounts. Phone is normalised + dedupe-keyed but never returned to public endpoints. |
| **Containers** | Run as `uid=10001` (non-root). `postgres` bound to `127.0.0.1` in compose. |
| **Concurrency** | Order creation locks all relevant `offers` rows in one query. Double-charge prevented via `UNIQUE(order_id, kind, idempotency_key)`. Overselling prevented via `CHECK (reserved <= stock)` + `fn_reserve_stock`. |

---

## What's intentionally NOT built

- **No customer accounts.** Cart lives in the browser. POSTed at checkout. Eliminates a large authn/authz/PII surface.
- **No payment SDK.** `financial_transactions` is the integration point. Plug your gateway via a `/payments/webhook` route — events already carry idempotency.
- **No Read Model yet.** Direct reads from the Write Model. Add a `catalog_read` materialisation when metrics demand it, not before.
- **No Redis.** In-proc rate limit is fine for single-replica dev/staging. Required only at multi-replica scale.
- **No Kubernetes.** Docker Compose is the unit of deploy until traffic justifies otherwise.
