# Plan: AMANTCOM v2 — financing-led commerce

## This is not a rewrite

The blueprint's own build strategy puts "Catalogue MVP — homepage, product
listing, product detail, category/brand/price filters, admin product entry" as
**Phase 1**. That is finished. Measured against the blueprint's suggested data
model, the platform already has:

| Blueprint wants | AMANTCOM has |
|---|---|
| `products`, `product_images`, `product_specs` | `products` + `specs` jsonb + `product_media` |
| `product_variants` | `offers` (variant_sku, variant_attrs) |
| `inventory_items` | `offers.stock_quantity` + `inventory_reservations` |
| `categories`, `brands`, filters, pagination | `/catalog` facets + `FilterSidebar` |
| `wilayas`, `communes` | 58-wilaya shipping, COD-first |
| Admin product entry | admin console + CSV import + enrichment |
| `audit_logs` | `audit_log` (exists, unused) |

Everything below is **additive**: the multi-brand core, the migration runner,
the tenancy boundary, the admin console and the reviews/badges/newsletter work
from `c01c331` all carry forward untouched.

Three genuinely new layers: **identity**, **financing**, **partners**.

> **Naming question, not blocking.** The blueprint lives in
> `Pictures/el yusr project/`. Are AMANTCOM and El Yusr the same product, or a
> platform/brand pair like AMANTCOM/GLAIVE? It changes `stores` seeding, not
> architecture, so it is not a blocker — but answer it before Phase D.

## Decision 1 — Identity is phone-first, and `customers` is already it

Do **not** add a parallel `users` table. `customers` is already the right
anchor, and migration 005 already made it multi-brand correctly:

```sql
-- 005_stores.sql:179-180
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_normalized_key;
CREATE UNIQUE INDEX customers_store_phone_key ON customers(store_id, phone_normalized);
```

So a customer is already `(store_id, phone_normalized)` — verified phone as the
natural key, per brand. That gives a property worth building on deliberately:

> **A guest who checks out with COD and later verifies that same phone becomes
> the account holder of the orders they already placed.** No merge flow, no
> "claim your order" email. The row was always theirs.

Email is not identity here. Algerian retail runs on phone numbers, and a
financing application must bind to a *verified* one regardless.

New tables sit **beside** `customers`, not instead of it: `otp_challenges`,
`customer_sessions`.

**SMS is a procurement item, not a code item.** There is no provider wired in.
Phase A ships the sender as a seam with a `console` implementation for dev —
the same pattern used for the Neon DSN, where the operator supplies the thing
Claude must not hold. **No fixed-code OTP shortcut outside dev.** A hardcoded
`000000` that survives into production is how this goes badly wrong.

## Decision 2 — `FINANCING_TERMS_PUBLIC`, default `false`

The blueprint's §10 is right, and it is the single most important constraint
here:

> *"If you build a real financing product, legal/compliance review is not
> optional… Product monthly price must be calculated from verified business
> rules, not hardcoded visually."*

A card reading *"à partir de 4 500 DA/mois"* is a credit offer. In Algeria that
is regulated by the Banque d'Algérie. That is a licensing question and this plan
does not pretend otherwise.

The engineering answer is a single config flag:

```
FINANCING_TERMS_PUBLIC: bool = False
```

Everything builds and works behind it. The simulator computes, applications
flow, admin reviews, the whole workflow runs. What the flag controls is whether
any **public** surface displays a binding monthly figure. While `false`:

- the simulator shows a clearly-labelled **estimate**, computed server-side;
- product cards show price, never a monthly instalment;
- application results say "sous réserve d'acceptation", never "approuvé".

**The operator flips this flag. Never Claude.** It is the checkpoint where a
legal conversation has happened.

Corollary, stated once: **bank, religious and legal copy is supplied by the
operator, never generated here.** Sharia-compliance claims, partner bank names,
APR language, and legal notices are approval-gated content. Sections that need
them ship empty with a TODO rather than with plausible-sounding invented text.

## Decision 3 — Financing is store-scoped, like orders

Two models were possible:

- **(a) Store-scoped — CHOSEN.** Applications, rules and simulations carry
  `store_id`. Brand A's credit book is invisible to brand B. Per-brand policy is
  what a multi-brand operator actually needs: gaming peripherals and home
  appliances have different ticket sizes, different terms, different risk.
- (b) Platform-level, like `scrape_jobs` — one credit book across all brands.
  Rejected: it breaks the uniform 404 boundary, and it would make brand #2's
  launch change brand #1's lending exposure.

This is the decision that, made wrong, produces the fifth `store_id` bug. Every
financing table gets `store_id NOT NULL`, and every one that references a
product uses the **composite FK** pattern from migration 008
(`FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id)`) so a
cross-brand application line is unrepresentable rather than merely checked.

## Phases

> **Migration numbers shifted.** 009 went to `contact_messages` before Phase A
> started and 012 to the pilot product media, so Identity is 010, Financing
> core 011, Workflow 013.

### Phase A — Identity (migration 010)

Tables: `otp_challenges` (phone, code_hash, expires_at, attempts, consumed_at),
`customer_sessions` (token_hash, customer_id, expires_at, revoked_at).

Endpoints: `POST /auth/customer/request-otp`, `POST /auth/customer/verify`,
`GET /auth/customer/me`, `POST /auth/customer/logout`.

- Store from **Host** (a shopper never sends `x-store-id`).
- Rate-limited (global limiter already covers POST) **plus** per-phone
  throttling and attempt caps — OTP endpoints are an SMS-cost attack surface,
  not just a login.
- Codes stored **hashed**, single-use, short TTL.
- Sender seam: `api/services/sms/` with `ConsoleSender` shipped.

Unlocks for real: wishlist, saved addresses, order history — the things Phase 2
of the merchandising plan had to fake with `localStorage`.

**Phase A follow-ups (not blocking, decide before Phase D):**

- **Checkout still splits one phone into several customers.** COD checkout
  keys by digits-only (`normalize_phone`), so `0555…`, `+213555…` and `555…`
  are three customers. Verify reads across all of them (`legacy_phone_keys`)
  and binds to the oldest, so no history is lost at sign-in — but a shopper
  with two legacy rows is bound to one, and the other's orders stay
  unattached. Phase D order history must either union across
  `legacy_phone_keys` or merge the rows. Switching checkout to the canonical
  key is the real fix; it changes live checkout behaviour, so it is the
  operator's call.
  **Resolved for order history in Phase D:** `GET /account/orders`
  (`api/routes/customer_account.py`) unions across every legacy key, so all
  of a shopper's COD orders show in their account. Switching checkout itself
  to the canonical key is still the operator's call.
- **`hash_requester` is keyed with `jwt_secret`.** Key reuse across purposes,
  and rotating the JWT secret silently resets per-address OTP counts. Give it
  its own `OTP_HMAC_KEY`.
- **The `customers` name backfill in `api/services/orders.py`** is outside the
  guard suite (which scans `api/routes/`). It is scoped correctly today;
  extending the guard to `api/services/` is cheap.
- **The per-address cap trusts the leftmost `X-Forwarded-For`**, like the
  existing limiter. Spoofable if the platform does not overwrite it; the
  per-store hourly ceiling is the backstop either way.
- **`OTP_MAX_PER_IP_PER_HOUR=10` may be tight behind carrier-grade NAT.**
  Algerian mobile carriers commonly put many subscribers behind one public
  address, so on a busy day real shoppers could share one bucket. Watch 429s
  on `/auth/customer/request-otp` once live and raise it if they come from
  real traffic; the per-phone and per-store caps still bound cost.

### Phase B — Financing core (migration 011)

Tables: `financing_rules` (**versioned** — rules change, and an application must
forever reference the version it was evaluated under), `financing_simulations`
(anonymous allowed), `applications`, `application_items`,
`application_status_events`.

**The rules engine is a pure service** — `api/services/financing/rules.py`,
no DB, no I/O: `(cart, profile, rules) -> Decision`. This is the one part of
this whole plan that can have genuine, high-coverage unit tests, because it
needs no Postgres. Eligibility, instalment maths, caps and refusal reasons all
live there and get tested properly.

**Phase B as built:**

- Migration 011: `financing_rules` (versioned, one ACTIVE per store, terms
  frozen by a trigger — a change is a new version), `financing_simulations`,
  `applications` (figures snapshotted, arithmetic restated as CHECKs),
  `application_items` (price snapshot; composite FK pins the line to its
  store, product AND offer), `application_status_events` (append-only by
  trigger). No rule is seeded.
- Engine: flat markup per duration on the financed amount, whole-centime
  arithmetic, schedule sums exactly, every refusal reported at once,
  affordability assessed only when a profile and a debt-ratio cap exist.
- API: public `/financing/terms` + `/financing/simulate`; signed-in
  `/financing/applications` (open DRAFT, list, detail); admin
  `/financing/rules` (create, activate, retire, delete draft).

**Phase B follow-ups (not blocking):**

- **No admin UI for rules yet.** The operator creates rules through the API
  until the Phase C admin screens land.
- **`financing_simulations` has no retention.** Anonymous and rate-limited
  only by the global POST limiter. How long "what estimate was shown" must be
  kept is a compliance question — decide before adding a prune.
- **Stock is not checked** when a DRAFT is opened; reserving stock belongs at
  approval/conversion to an order (Phase C).
- **No cap on open drafts per customer.** A verified phone is required, which
  bounds abuse; revisit if drafts pile up.
- **Trigger bodies are syntax-unverified.** Every migration parses with the
  real Postgres parser (pglast), but its PL/pgSQL JSON output is broken for
  any trigger function, so the two trigger bodies in 011 were not checked
  internally. First real `apply_migrations.py` run will.

### Phase C — Application workflow (migration 013)

`financial_profiles`, `employment_profiles`, `required_documents`,
`uploaded_documents`.

Status machine: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED → SIGNED`.
Transitions are recorded in `application_status_events` — an audit trail is not
optional for credit decisions.

Admin review queue: third use of the image-queue pattern; it is the house
pattern now. **Must not inherit its accessibility defect** (icon-only buttons,
audit Critical #3).

Document storage: reuse whatever `product_media` uses. **Verify first** — a grep
of `api/services/` found no obvious uploader, so it may live in `workers/` or be
R2-direct. Read before writing.

**Phase C as built:**

- Migration 013: `financial_profiles` and `employment_profiles` (one per
  application, editable only while DRAFT — trigger), `required_documents`
  (operator-configured, none shipped), `uploaded_documents` (content
  immutable; added/removed only while DRAFT; reviewed only while
  UNDER_REVIEW — trigger). `applications` gains review columns and a guard
  trigger: legal transitions only, figures frozen, never deleted.
- Documents: there was no uploader anywhere (product_media is URL-only), so
  this is the platform's first. Through the API, 10 MB cap, type sniffed from
  magic bytes (PDF/JPEG/PNG/WebP), SHA-256, id-only object keys, PRIVATE
  bucket, fail-closed like SMS, served to admins as attachments only.
- Submission re-judges affordability with the declared profile under the
  application's OWN rule, which must still be ACTIVE; it never re-prices.
- Admin: queue, full file (with live stock beside the snapshot), document
  review, approve (blocked until every file is examined and each required
  type has an accepted one), reject (reason required, internal), mark signed
  (optional SHA-256 of the signed contract). Rules and required-documents
  screens. Every control named; a static test enforces it.

**Phase C — decisions that are the owner's, currently defaulted:**

- **Roles.** OPERATOR may open files and examine documents; only
  SUPER_ADMIN / ADMIN approve, reject, sign or change lending policy.
- **Signature.** "Signed" is recorded by an admin, with an optional hash of
  the signed contract file. No e-signature provider (plan: not in this pass).
- **Refusal wording.** The rejection reason is internal; the customer sees
  only "Non retenue". What a refused applicant is told is approved copy.
- **Zero required documents.** Until the operator configures some, a
  submission needs none.
- **Retention.** How long identity documents and refused files are kept is a
  personal-data-law question (Algerian law 18-07) for Phase F — nothing is
  deleted automatically today.
- **R2 must be provisioned** (a separate private bucket) before any document
  can be uploaded on the live site.

**Not built (follow-ups):** converting a SIGNED application into an order
and reserving its stock; a "request more documents" state (today a reviewer
refuses and the customer re-applies); notifications of status changes.

### Phase D — Storefront

Simulator page, `/apply` stepper, `/account/*`, and the QivoPay section rhythm
on Home. **The merchandising plan's Phase 2 merges in here** — category grid,
brand pages, FAQ, contact, legal pages, richer product detail. That plan is
superseded for sequencing only; its content still stands.

This is the parallelisable phase and the right place to offer a multi-agent
workflow.

**Phase D as built** (foundation inline, then an eight-agent fleet on disjoint
files, each unit reviewed; 0 blockers / 0 majors; wired and fixed after):

- Foundation: session layer (`lib/session.tsx`: CustomerProvider,
  useCustomer, RequireCustomer, open-redirect-safe `safeNext`), every Phase
  D call typed in `lib/api.ts`, `EstimateLabel` as the only caption a
  financing figure gets, `GET /account/orders[/{id}]` across legacy phone
  keys, labels tied to fields in `ui.tsx`, and a vitest that fails
  hand-written credit copy or an uncaptioned monthly figure.
- Pages: `/login`, `/account`, `/account/orders[/:id]`,
  `/account/applications[/:id]`, `/simulate` (+ `SimulatorPanel` on every
  product page), `/apply/:id` (4 steps), `/financement`. Home: financing
  CTA and band (only once a rule is active), account band.
- Security fix found in review: every id in an API path is one encoded
  segment (`seg()` in api.ts) — a crafted `/apply/..%2F..` link could
  otherwise send a request carrying the session token to another endpoint.
- The site-wide default SEO description still carried the old GLAIVE
  gaming copy and a "livraison rapide" claim; replaced.
- Verified in the browser WITHOUT a backend (redirects, error states,
  labels, 375px). The signed-in flows have never run against a live API.

**Phase D follow-ups:**

- **Not built:** brand pages (the catalogue's brand filter covers it for
  now); legal pages (deliberately — CGV/privacy/legal notice are operator
  copy; no public "à venir" page); wishlist and saved addresses (no backend;
  the merchandising plan chose localStorage).
- **Reviewer minors left (accessibility first):** focus drops to `<body>`
  when the Login code field locks and when a StepDocuments upload disables
  its input; `aria-current="step"` on a read-only application history and
  no current marker on terminal order states; the Simulator announces an
  ineligible result twice; the Login "valable X" line does not count down;
  local date/format helpers duplicated across pages; link-styled buttons
  copy Button's classes by hand.
- **Pre-existing, not Phase D:** two `<Link><Button>` nestings on Home
  (Sélection "Tout voir", brand callout "Découvrir") — invalid interactive
  nesting; `TVA incluse` on the product page is an unverified claim.
- **Still open from the top of this plan:** are El Yusr and AMANTCOM the
  same product? It was to be answered before Phase D and decides `stores`
  seeding.

### Phase E — Partners

`partners`, `partner_locations`, `partner_applications`. Public
`/partners/apply` form + admin queue. Smallest and most independent.

**Phase E as built (migration 014):**

- Tables store-scoped with composite FKs; an application carries a
  `partner_id` exactly when it is APPROVED (CHECK). No partner ships.
- Activity is a small factual enum (électroménager, multimédia, meuble,
  généraliste, autre). Landlines are accepted — a shop answers on a fixed
  line. No commune codes: the reference data does not exist here.
- No uniqueness on the applicant's phone: "already applied" would leak who
  applied. Every submission gets the same answer; the admin queue shows
  earlier applications from the same number instead.
- `POST /partners/apply` (public), `/partner-applications` queue with
  start-review / approve / reject (note required), `/partners` list with
  an active switch. Approve creates the partner and its first location in
  one transaction; a lost race rolls back with a 409.
- Storefront `/partenaires` (footer "Devenir partenaire"): no benefits,
  commissions, counts, logos or response times. Admin "Partners" page,
  covered by the icon-only-button guard.

**Not built:** partner user accounts (`partner_users`) and the blueprint's
merchant dashboard (product upload, stock, orders, settlement) — a separate
epic; editing partner details or adding locations after approval; a public
partner/store locator (publishing a partner's address needs their consent).

### Phase F — Prove it moved

Re-run the 10-dimension audit, **plus** a compliance checklist derived from §10:
what is gated, what is labelled an estimate, what still needs approved copy.
That checklist is the artefact that lets the operator walk into a legal
conversation prepared rather than improvising.

## Explicitly NOT in this pass

The blueprint lists 40+ tables and 30+ routes. Without a boundary this is
unbounded:

- **Digital signature** — no provider integration. Store `signed_at` + a
  document hash; wire a real e-signature vendor later.
- **Notifications** — no SMS/email infrastructure beyond the OTP seam.
- **Student program** (`/register/student-campuce`) — a marketing segment, not
  architecture.
- **Mobile app / PWA.**
- **CMS tables** (`homepage_sections`, `faqs` as data) — copy stays in code
  until there is a reason it should not.
- **Arabic category taxonomy** — the blueprint's six categories are QivoPay's.
  If AMANTCOM wants Arabic categories they are operator-supplied content, not
  something translated out of a competitor's site.

## Global constraints

Carried from the merchandising plan, plus the new ones:

- **Additive only.** Components gain props and sections; nothing is rewritten.
  Grep for callers before changing a signature.
- **French + DZD.** Arabic is additive if the operator supplies copy.
- **`store_id NOT NULL` on every new table**; composite FK wherever a financing
  row references a product.
- **404, never 403**, for cross-store access.
- **`FINANCING_TERMS_PUBLIC` gates every public credit figure.** No exceptions.
- **No OTP shortcut outside dev.** No fixed codes, no logged plaintext codes.
- **Rules engine is pure and properly tested.**
- **No invented bank / religious / legal / partner copy.** Ever.
- `python -m pytest tests/` must not drop below **421 passed**.
- Stay on `gaming-store`. No force git ops. Explicit paths, never `git add -A`.
- Briefs name files and line numbers and say "read before writing".

## Status carried in

- Phase 1 of the merchandising plan shipped: `c01c331` (migration 008, reviews,
  badges, newsletter). 421 passed, 6 skipped.
- **Migrations 008 and up have never run anywhere.** Local Postgres is parked
  (download failed, curl exit 4); Docker is blocked on WSL2's "Virtual Machine
  Platform" Windows feature, which needs an admin `wsl --install
  --no-distribution` plus a reboot.
- The Netlify clone is still live and public.
