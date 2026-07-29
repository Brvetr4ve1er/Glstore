"""
LLM-driven enrichment. Tier-2 atop the rule engine (Phase 2).

The rule engine fills brand + category + extracted specs deterministically.
The LLM step adds:
  - description (2-3 French sentences)
  - seo_description (≤160 chars)
  - extra_specs (deeper attributes — refresh rate, energy class, dimensions…)
  - selling_angles + hooks (marketing copy)
  - confidence_score + recommendation_score (0..1)

We do NOT hit the network for scraping yet (Phase 5). Prompt is built solely
from the existing product row + active offers, so it works fully offline
against a local Ollama install.

Caller is responsible for db.commit().
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import llm

log = logging.getLogger("glstore.llm_enrich")


# ── Prompt construction ─────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are the Ghir Laffaire Product Intelligence engine for an Algerian electronics retailer.

Your job: read the structured product info and produce a single JSON object that enriches it for an Algerian customer.

You MUST output ONE valid JSON object only. No markdown, no commentary, no fenced code blocks.

Required shape:
{
  "description":         "2-3 sentence French product description, mentions brand+category+2 standout features",
  "seo_description":     "1-sentence French SEO meta (max 160 chars)",
  "specs":               { "snake_case_key": "value", ... },     // 3-8 deeper attributes (energy_class, refresh_rate, dimensions_cm, weight_kg, warranty, …)
  "selling_angles":      ["French sales hook 1", "hook 2", "hook 3"],
  "marketing_hooks":     ["Punchy social-media-ready 1-liner in French", "another"],
  "buyer_fit":           "1-sentence French description of the ideal buyer profile",
  "price_position":      "budget" | "midrange" | "premium",
  "pros":                ["French pro 1", "French pro 2", "French pro 3"],
  "cons":                ["French con 1", "French con 2"],
  "confidence_score":    0.0-1.0,                                // how grounded this enrichment is
  "recommendation":      "Bon Achat" | "À considérer" | "Surcoté" | "À éviter"
}

Rules:
- All text MUST be in French.
- Do not fabricate specs you cannot infer. Empty arrays / null are acceptable.
- snake_case keys for specs.
- Don't repeat the brand/category that is already in the input — extend, don't restate.
- Keep description natural — avoid starting every product with the same phrase.
- confidence_score should be lower when input is sparse (e.g. missing model, no specs).
"""


def _build_user_prompt(product: dict[str, Any]) -> str:
    parts: list[str] = ["PRODUCT INPUT:"]
    parts.append(f"Name:        {product.get('name')}")
    if product.get("brand"):     parts.append(f"Brand:       {product['brand']}")
    if product.get("category"):  parts.append(f"Category:    {product['category']}")
    if product.get("model"):     parts.append(f"Model:       {product['model']}")
    if product.get("subcategory"): parts.append(f"Subcategory: {product['subcategory']}")
    if product.get("barcode"):   parts.append(f"Barcode:     {product['barcode']}")
    if product.get("mpn"):       parts.append(f"MPN:         {product['mpn']}")

    if product.get("retail_price"):
        cur = product.get("currency") or "DZD"
        parts.append(f"Price:       {product['retail_price']} {cur}")

    specs = product.get("specs") or {}
    cleaned = {k: v for k, v in specs.items() if not k.startswith("_")}
    if cleaned:
        parts.append("Existing specs:")
        for k, v in list(cleaned.items())[:10]:
            parts.append(f"  - {k}: {v}")

    if product.get("description"):
        parts.append(f"Existing description: {product['description'][:300]}")

    parts.append("")
    parts.append("Output the JSON object now.")
    return "\n".join(parts)


# ── DB facts loader ─────────────────────────────────────────────────────────

async def _load_product_facts(db: AsyncSession, product_id: UUID) -> dict[str, Any] | None:
    row = await db.execute(text("""
        SELECT
            p.id, p.sku, p.name, p.brand, p.model, p.category, p.subcategory,
            p.description, p.specs, p.barcode, p.mpn, p.completeness_score,
            (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
               FROM offers o
              WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0) AS price,
            (SELECT MIN(o.currency) FROM offers o
              WHERE o.product_id = p.id AND o.is_active) AS currency
          FROM products p
         WHERE p.id = :id
    """), {"id": product_id})
    r = row.first()
    if not r:
        return None
    specs = r[8] if isinstance(r[8], dict) else (json.loads(r[8]) if r[8] else {})
    return {
        "id": r[0], "sku": r[1], "name": r[2], "brand": r[3], "model": r[4],
        "category": r[5], "subcategory": r[6], "description": r[7],
        "specs": specs,
        "barcode": r[9], "mpn": r[10], "completeness": float(r[11] or 0),
        "retail_price": float(r[12]) if r[12] is not None else None,
        "currency": r[13] or "DZD",
    }


async def _add_observation(
    db: AsyncSession, *, product_id: UUID, field_name: str, value: Any,
    source: str, confidence: float,
) -> None:
    # store_id (NOT NULL after migration 005) is derived from the product so
    # this writer needs no store threading — an observation belongs to the
    # same store as the product it describes.
    await db.execute(text("""
        INSERT INTO observations (store_id, entity_type, entity_id, field, value, source, confidence)
        SELECT p.store_id, 'product', :pid, :field, CAST(:val AS JSONB), :src, :conf
          FROM products p WHERE p.id = :pid
    """), {
        "pid": product_id, "field": field_name,
        "val": json.dumps({"v": value}),
        "src": source, "conf": confidence,
    })


# ── Result shape ────────────────────────────────────────────────────────────

@dataclass
class LLMEnrichmentResult:
    product_id: UUID
    sku: str
    backend: str               # "ollama" | "openai_compat" | "anthropic"
    model: str
    fields_filled: list[str]   # which DB columns were updated
    specs_added: int
    description_changed: bool
    completeness_before: float
    completeness_after: float
    raw_payload: dict[str, Any]   # what the LLM returned (for audit)

    def to_dict(self) -> dict[str, Any]:
        return {
            "product_id": str(self.product_id),
            "sku": self.sku,
            "backend": self.backend,
            "model": self.model,
            "fields_filled": self.fields_filled,
            "specs_added": self.specs_added,
            "description_changed": self.description_changed,
            "completeness_before": self.completeness_before,
            "completeness_after": self.completeness_after,
            "raw_payload": self.raw_payload,
        }


# ── Apply LLM payload onto product row ──────────────────────────────────────

async def _apply_payload(
    db: AsyncSession, product_id: UUID, facts: dict[str, Any], payload: dict[str, Any], source: str,
) -> tuple[list[str], int, bool]:
    """Selectively merge the LLM payload into products.* + observations.
    Returns (fields_filled, specs_added, description_changed)."""
    fields_filled: list[str] = []
    description_changed = False

    new_description = (payload.get("description") or "").strip() or None
    if new_description and (not facts.get("description") or len(facts["description"]) < 30):
        await db.execute(
            text("UPDATE products SET description = :d, updated_at = NOW(), version = version + 1 WHERE id = :id"),
            {"d": new_description, "id": product_id},
        )
        await _add_observation(
            db, product_id=product_id, field_name="description",
            value=new_description, source=source, confidence=0.85,
        )
        fields_filled.append("description")
        description_changed = True

    # Merge specs (LLM keys go in alongside rule-engine keys; LLM does NOT
    # overwrite existing keys to avoid clobbering high-confidence rule output)
    existing_specs = dict(facts.get("specs") or {})
    payload_specs = (payload.get("specs") or {}) if isinstance(payload.get("specs"), dict) else {}
    specs_added = 0
    new_specs = dict(existing_specs)
    for k, v in payload_specs.items():
        key = str(k)[:60]
        if key in new_specs:
            continue
        new_specs[key] = v
        specs_added += 1
        await _add_observation(
            db, product_id=product_id, field_name=f"spec.{key}",
            value=v, source=source, confidence=0.65,
        )

    # Add aux fields under namespaced spec keys so we don't pollute the schema:
    aux_keys = {
        "_seo_description":  payload.get("seo_description"),
        "_selling_angles":   payload.get("selling_angles"),
        "_marketing_hooks":  payload.get("marketing_hooks"),
        "_buyer_fit":        payload.get("buyer_fit"),
        "_price_position":   payload.get("price_position"),
        "_pros":             payload.get("pros"),
        "_cons":             payload.get("cons"),
        "_recommendation":   payload.get("recommendation"),
        "_llm_confidence":   payload.get("confidence_score"),
    }
    for k, v in aux_keys.items():
        if v is None:
            continue
        if k in new_specs and new_specs[k] == v:
            continue
        new_specs[k] = v
        specs_added += 1
        await _add_observation(
            db, product_id=product_id, field_name=f"spec.{k}",
            value=v, source=source, confidence=0.60,
        )

    if specs_added:
        await db.execute(
            text("UPDATE products SET specs = CAST(:s AS JSONB), updated_at = NOW(), version = version + 1 WHERE id = :id"),
            {"s": json.dumps(new_specs), "id": product_id},
        )
        fields_filled.append(f"specs(+{specs_added})")

    return fields_filled, specs_added, description_changed


# ── Public entry ────────────────────────────────────────────────────────────

async def enrich_one(db: AsyncSession, product_id: UUID, *, cfg: llm.LLMConfig | None = None) -> LLMEnrichmentResult:
    """Run one product through the LLM. Caller commits."""
    facts = await _load_product_facts(db, product_id)
    if not facts:
        raise ValueError("product not found")

    if cfg is None:
        cfg = await llm.load_config(db)

    completeness_before = facts["completeness"]

    system = _SYSTEM_PROMPT
    user = _build_user_prompt(facts)
    raw, parsed = await llm.chat(cfg, system, user, json_mode=True)
    if not parsed:
        raise llm.LLMError(
            f"LLM returned unparseable output (first 400 chars): {raw[:400]}"
        )

    source = f"llm:{cfg.kind}:{cfg.model}"
    fields_filled, specs_added, desc_changed = await _apply_payload(
        db, UUID(str(product_id)), facts, parsed, source,
    )

    # Recompute completeness inline by re-reading the row.
    new_score_row = await db.execute(text("""
        SELECT
          (CASE WHEN p.brand    IS NOT NULL AND UPPER(p.brand) NOT IN ('INCONNU','UNKNOWN','') THEN 0.18 ELSE 0 END +
           CASE WHEN p.category IS NOT NULL AND LOWER(p.category) NOT IN ('other','autre','electromenager','') THEN 0.18 ELSE 0 END +
           CASE WHEN p.description IS NOT NULL AND length(p.description) >= 30 THEN 0.10 ELSE 0 END +
           CASE WHEN (p.barcode IS NOT NULL AND p.barcode <> '') OR (p.mpn IS NOT NULL AND p.mpn <> '') THEN 0.06 ELSE 0 END +
           CASE WHEN EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id AND o.is_active AND o.retail_price > 0) THEN 0.18 ELSE 0 END +
           CASE WHEN COALESCE((SELECT SUM(o.stock_quantity - o.reserved_quantity) FROM offers o WHERE o.product_id = p.id AND o.is_active), 0) > 0 THEN 0.10 ELSE 0 END +
           CASE WHEN EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.is_primary AND m.status = 'STORED') THEN 0.10 ELSE 0 END +
           LEAST(
              (SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(p.specs, '{}'::jsonb)) AS k WHERE k NOT LIKE '\\_%'),
              3
           ) * (0.10 / 3.0)
          ) AS score
          FROM products p WHERE p.id = :id
    """), {"id": product_id})
    new_score = float(new_score_row.scalar_one() or 0)
    new_score = round(min(new_score, 1.0), 3)

    # Status auto-bump if we now exceed VERIFIED threshold
    new_status_row = await db.execute(text("""
        SELECT status, brand, category FROM products WHERE id = :id
    """), {"id": product_id})
    s_row = new_status_row.first()
    cur_status = s_row[0] if s_row else None
    has_brand = bool(s_row and s_row[1])
    has_cat = bool(s_row and s_row[2])

    if has_brand and has_cat and new_score >= 0.85:
        new_status = "VERIFIED"
    elif has_brand and has_cat:
        new_status = "CLASSIFIED"
    elif not has_brand or not has_cat:
        new_status = "NEEDS_FIX"
    else:
        new_status = cur_status or "NORMALIZED"

    await db.execute(text("""
        UPDATE products
           SET completeness_score = :s,
               status             = :st,
               updated_at         = NOW(),
               version            = version + 1
         WHERE id = :id
    """), {"s": new_score, "st": new_status, "id": product_id})

    return LLMEnrichmentResult(
        product_id=UUID(str(product_id)),
        sku=facts["sku"],
        backend=cfg.kind,
        model=cfg.model,
        fields_filled=fields_filled,
        specs_added=specs_added,
        description_changed=desc_changed,
        completeness_before=completeness_before,
        completeness_after=new_score,
        raw_payload=parsed,
    )
