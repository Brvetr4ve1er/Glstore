# API Reference

Base path: **`/api/v1`**

All admin endpoints require `Authorization: Bearer <jwt>` from `POST /auth/login`. Roles enforced server-side via `require_role(...)`. Hierarchy: `SUPER_ADMIN > ADMIN > OPERATOR > VIEWER`.

Live OpenAPI: **`http://localhost:8000/docs`** (dev only).

---

## Auth

### `POST /auth/login`
Public. Lockout-aware (5 fails → 15 min lock).

```json
// request
{ "email": "brvetr4veler@gmail.com", "password": "brveadmin" }

// response 200
{ "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

Errors: `401 Invalid credentials`, `423 Account locked`.

---

## Products — read

### `GET /products?q=&category=&brand=&status=&page=&page_size=`
Returns paginated list. By default excludes `ARCHIVED`. Search `q` matches name OR sku OR brand.

```json
{
  "items": [{
    "id": "uuid",
    "sku": "TV-SAM-55",
    "slug": "tv-samsung-55",
    "name": "TV SAMSUNG 55 4K UHD",
    "brand": "SAMSUNG",
    "category": "TV",
    "specs": {...},
    "completeness_score": 0.85,
    "status": "VERIFIED",
    "primary_image": "https://...",
    "min_price": 93000,
    "available": 4
  }],
  "page": 1, "page_size": 24, "total": 567
}
```

### `GET /products/{id}`
Full detail with offers + media arrays.

---

## Products — write
*Requires SUPER_ADMIN / ADMIN / OPERATOR.*

### `POST /products` `201`
Body matches `ProductCreate`. `initial_offer` optional.

### `PATCH /products/{id}`
All fields optional. Only sent fields are updated. Slug uniqueness validated server-side.

### `DELETE /products/{id}?hard=false`
Default = soft archive (sets status='ARCHIVED', deactivates all offers). `?hard=true` blocked if any `order_items` reference it (returns `409 Conflict`).

### `POST /products/{id}/offers` `201`
### `PATCH /products/{id}/offers/{offer_id}`
### `DELETE /products/{id}/offers/{offer_id}`
Block deletion if any `inventory_reservations` are ACTIVE on the offer.

---

## Products — bulk import (Phase 1)
*Requires SUPER_ADMIN / ADMIN / OPERATOR.*

### `POST /products/import/preview`
Multipart file upload. **No DB writes.** Returns the parsed diagnostic + 20-row sample + validation issues.

```json
{
  "diagnostic": {
    "delimiter": ",",
    "headers": [...],
    "mapped_fields": { "name": "Nom", "sku": "SKU", ... },
    "unmapped_headers": [...],
    "total_lines": 568, "parsed_rows": 567,
    "skipped_empty": 0, "skipped_no_name": 0
  },
  "report": {
    "parsed_rows": 567,
    "valid_rows": 567,
    "blocked_rows": 0,
    "products_to_create": 567,
    "products_to_update": 0,
    "offers_to_create": 567,
    "offers_to_update": 0,
    "issues": [{ "line_number": 2, "field": "brand", "severity": "warning", "message": "..." }],
    "sample_preview": [...]
  }
}
```

### `POST /products/import/commit?auto_enrich=true`
Multipart file upload. **Writes products + offers, idempotent on SKU.** With `auto_enrich=true` (default), runs the rule engine on all imported rows in the same request.

```json
{
  "diagnostic": {...},
  "report": {
    "products_created": 567,
    "products_updated": 0,
    "offers_created": 567,
    "offers_updated": 0,
    "blocked_rows": 0,
    "issues": [...]
  },
  "enrichment": {
    "total": 567,
    "enriched": 567,
    "skipped": 0,
    "by_status": { "CLASSIFIED": 412, "VERIFIED": 89, "NEEDS_FIX": 66 },
    "avg_completeness_before": 0.300,
    "avg_completeness_after": 0.682
  }
}
```

Limits: 16 MiB upload cap. Encodings tried in order: `utf-8-sig → utf-8 → cp1252 → latin-1`.

---

## Enrichment (Phase 2)
*Requires SUPER_ADMIN / ADMIN / OPERATOR.*

### `POST /products/{id}/enrich`
Run the rule engine on a single product. Updates brand / category / specs / description / status / completeness_score in one transaction.

```json
{
  "product_id": "uuid",
  "sku": "TV-SAM-55",
  "brand_before": null,
  "brand_after": "SAMSUNG",
  "category_before": "Electromenager",
  "category_after": "TV",
  "completeness_before": 0.30,
  "completeness_after": 0.78,
  "status_after": "CLASSIFIED",
  "auto_attrs_added": 6
}
```

### `POST /products/enrich-all?only_status=RAW&only_status=NORMALIZED&only_status=NEEDS_FIX&limit=5000`
Bulk pass.

### `GET /products/enrichment/stats`
Status histogram + average completeness.

---

## Catalog Quality (Phase 3)

### `GET /products/{id}/issues`
Returns the actionable issue list for a single product.

```json
{
  "product_id": "uuid",
  "completeness_score": 0.42,
  "summary": { "error": 1, "warning": 2, "info": 1 },
  "issues": [{
    "code": "missing_brand",
    "field": "brand",
    "severity": "error",
    "message": "Brand is missing or unknown.",
    "fix_hint": {
      "suggested_value": "SAMSUNG",
      "options": ["SAMSUNG", "HISENSE", "MIDEA", "..."]
    }
  }]
}
```

Issue codes (stable):
`missing_brand`, `missing_category`, `missing_description`, `missing_image`,
`missing_price`, `no_stock`, `missing_barcode_or_mpn`, `low_completeness`, `low_specs`.

### `GET /products/issues/summary`
Catalog-wide histogram of products affected by each issue.

```json
{
  "total": 567,
  "by_issue": {
    "missing_brand": 66,
    "missing_category": 12,
    "missing_description": 412,
    "missing_image": 567,
    "missing_price": 0,
    "no_stock": 88,
    "missing_barcode_or_mpn": 8,
    "low_completeness": 178,
    "low_specs": 234
  }
}
```

### `GET /products/issues/list?code=<code>&page=1&page_size=50`
Paginated list of products affected by a specific issue, ordered by lowest completeness first. Used by the bulk triage UI.

### `GET /brands`
Canonical brand catalog (60 brands) + per-brand product counts in DB. Used by the brand-autocomplete fixer.

---

## LLM enrichment (Phase 4)

### `GET /settings/llm` *(OPERATOR+)*
Returns the active LLM config. `api_key` is replaced by `••••••••` and `api_key_set: bool` indicates whether one is stored.

```json
{
  "kind": "ollama",
  "endpoint": "http://host.docker.internal:11434",
  "model": "llama3.1:8b",
  "api_key": "••••••••",
  "api_key_set": false,
  "temperature": 0.1,
  "max_tokens": 2048,
  "timeout_seconds": 90,
  "json_mode": true
}
```

### `PUT /settings/llm` *(ADMIN+)*

```json
{ "kind": "ollama" | "openai_compat" | "anthropic",
  "endpoint": "...", "model": "...",
  "api_key": null | "" | "sk-...",
  "temperature": 0.1, "max_tokens": 2048,
  "timeout_seconds": 90, "json_mode": true }
```

`api_key` rules: `null` clears the stored key, `""` keeps it, anything else overwrites.

### `POST /settings/llm/ping` *(OPERATOR+)*

```json
{
  "kind": "ollama",
  "endpoint": "http://host.docker.internal:11434",
  "model": "llama3.1:8b",
  "online": true,
  "models": ["llama3.1:8b", "qwen2.5:7b", "mistral:7b"],
  "error": null
}
```

### `POST /products/{id}/enrich-llm` *(OPERATOR+)*

Synchronous LLM enrichment. Merges payload onto `products.specs` (additive — never overwrites existing keys), updates `description` only if missing/short, recomputes `completeness_score` inline, auto-bumps status to VERIFIED when ≥0.85.

```json
{
  "product_id": "uuid",
  "sku": "TV-SAM-55",
  "backend": "ollama",
  "model": "llama3.1:8b",
  "fields_filled": ["description", "specs(+9)"],
  "specs_added": 9,
  "description_changed": true,
  "completeness_before": 0.42,
  "completeness_after": 0.78,
  "raw_payload": {
    "description": "...",
    "specs": {...},
    "selling_angles": [...],
    "pros": [...],
    ...
  }
}
```

Errors: `502` if the LLM call itself fails (transport, parse, etc.); `404` if product not found.

### `POST /products/enrich-llm-bulk?only_status=NEEDS_FIX&only_status=CLASSIFIED&limit=50` *(OPERATOR+)*

Sequential, fail-soft. Stops on connection-level errors. Lowest-completeness products go first.

```json
{
  "total_attempted": 50,
  "enriched": 47,
  "failed": 3,
  "avg_completeness_before": 0.41,
  "avg_completeness_after": 0.76,
  "backend": "ollama",
  "model": "llama3.1:8b",
  "failure_samples": [...]
}
```

```json
{
  "total": 567,
  "average_completeness": 0.682,
  "by_status": {
    "RAW": { "count": 0, "avg_completeness": 0 },
    "CLASSIFIED": { "count": 412, "avg_completeness": 0.71 },
    "VERIFIED": { "count": 89, "avg_completeness": 0.92 },
    "NEEDS_FIX": { "count": 66, "avg_completeness": 0.42 }
  }
}
```

---

## Orders

### `POST /orders/create`  *(public — storefront)*
Idempotent via optional `idempotency_key`. Reserves stock atomically.

### `POST /orders/{id}/confirm`  *(OPERATOR+)*
Transitions RESERVED → CONFIRMED, consumes reservations.

### `POST /orders/{id}/cancel`  *(OPERATOR+)*
Releases reservations, marks CANCELLED.

### `GET /orders[/{id}]`  *(VIEWER+)*
Paginated list / single fetch.

---

## Events

### `POST /events`  *(OPERATOR+)*
n8n / external system entry point. Idempotent via `event_id UUID`.

### `GET /events/{event_id}`  *(ADMIN+)*
Inspect retry state, last error.

---

## Conventions

| Header | Purpose |
|---|---|
| `Authorization: Bearer <jwt>` | required for all admin endpoints |
| `x-request-id` | client-supplied or auto-generated; echoed in response + logs |

### Errors

```json
{ "error": "validation_failed", "detail": [...], "request_id": "..." }
{ "error": "rate_limit_exceeded", "request_id": "..." }
{ "detail": "human-readable explanation" }
```

| Code | Meaning |
|---|---|
| 400 | Validation / business rule violation |
| 401 | Missing or invalid JWT |
| 403 | Authenticated but lacks role |
| 404 | Resource not found |
| 409 | Conflict (slug dupe, archive blocked, etc.) |
| 422 | Pydantic schema rejection |
| 423 | Account locked |
| 429 | Rate limit |
| 500 | Unhandled — request_id in body for log correlation |
