"""
Unified Product Intelligence — scrape + LLM extract + tiered merge.

This is the welded pipeline that orbital-perihelion's `LLMService.enrichProduct`
had as a single function. We split it across two phases (4 + 5) for
modularity, and now combine them here.

Flow:
    1. load_target(product_id) → ProductTarget (sku, name, brand, category, expected_price)
    2. ScraperEngine.run_job(...)
         → scrapes 6 sources via tier 1→4 cascade
         → returns ScrapeOutcome with sources + extracted prices
    3. build_markdown_bundle(sources)
         → concatenated, ranked, trimmed scraped text
    4. llm.chat(system, user, json_mode=True)
         → CPO-style structured output
    5. apply_payload(db, product_id, parsed, scrape_outcome)
         → tiered overwrite per master prompt:
              brand/category  : FILL ONLY (don't overwrite human edits)
              description     : ALWAYS OVERWRITE
              specs (sub-keys): ALWAYS OVERWRITE per-key
              images          : APPEND non-duplicate URLs as PENDING (human reviews)
              competitor_prices: dedupe + insert (Phase 5 already did this)
              status          : auto-bump per existing rules

Returns FullIntelResult — the caller commits.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import llm
from api.services.scraper import engine as scraper_engine
from api.services.scraper.engine import ScrapeJobInput
from api.services.scraper.types import ScrapeOutcome

log = logging.getLogger("glstore.full_intel")


# ── Result + telemetry shape ────────────────────────────────────────────────

@dataclass
class FullIntelResult:
    product_id: UUID
    sku: str
    backend: str                       # "ollama" | "openai_compat" | "anthropic"
    model: str
    scrape_sources_count: int
    prices_found: int
    fields_filled: list[str]           # ["brand", "category", "description", "specs(+9)", "images(+3)"]
    images_added: int                  # count of new image URLs queued for review
    images_pending: int                # total currently-PENDING product_media rows
    completeness_before: float
    completeness_after: float
    status_before: str
    status_after: str
    raw_payload: dict[str, Any]
    scrape_summary: dict[str, Any]
    duration_ms: int
    error: str | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "product_id": str(self.product_id),
            "sku": self.sku,
            "backend": self.backend,
            "model": self.model,
            "scrape_sources_count": self.scrape_sources_count,
            "prices_found": self.prices_found,
            "fields_filled": self.fields_filled,
            "images_added": self.images_added,
            "images_pending": self.images_pending,
            "completeness_before": self.completeness_before,
            "completeness_after": self.completeness_after,
            "status_before": self.status_before,
            "status_after": self.status_after,
            "raw_payload": self.raw_payload,
            "scrape_summary": self.scrape_summary,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "notes": self.notes,
        }


# ── Prompt construction (CPO-style, French DZ market) ──────────────────────

_SYSTEM_PROMPT = """You are the Ghir Laffaire Product Intelligence Engine for an Algerian electronics retailer.

You receive scraped web content about a single product. Extract every piece of structured data into a single JSON object that fills the canonical product schema.

Output ONE valid JSON object — no markdown, no fenced code blocks, no commentary.

Required shape:
{
  "brand":           "Detected brand (UPPERCASE or capitalized — match the manufacturer's spelling)",
  "model":           "Manufacturer model code if visible",
  "category":        "Category — one of: TV | Smartphone | Laptop | Tablet | Refrigerator | Freezer | Washing Machine | Dishwasher | Microwave | Oven | Cooktop | Cooker | AC | Fan | Blender | Mixer | Kettle | Iron | Coffee Machine | Toaster | Vacuum | Fryer | Hair Dryer | Beauty | Audio | Gaming | Accessory",
  "subcategory":     "Optional finer label (e.g. 'Smart TV')",
  "description":     "2-3 French sentences. Mention brand, category, and 2 standout features.",
  "seo_description": "1-sentence French SEO meta (max 160 chars).",
  "specs":           { "snake_case_key": "value", ... },
  "images":          ["https://absolute-url-1.jpg", "https://absolute-url-2.jpg"],
  "selling_angles":  ["Sales hook in French 1", "hook 2", "hook 3"],
  "marketing_hooks": ["Punchy 1-liner in French for social"],
  "buyer_fit":       "1-sentence French description of the ideal buyer",
  "price_position":  "budget" | "midrange" | "premium",
  "pros":            ["French pro 1", "French pro 2", "French pro 3"],
  "cons":            ["French con 1", "French con 2"],
  "competitor_prices": [
    { "source": "Retailer name", "url": "https://...", "price": 89000, "currency": "DZD", "availability": "En stock|Rupture|Inconnu" }
  ],
  "confidence_score": 0.0-1.0,
  "recommendation":   "Bon Achat" | "À considérer" | "Surcoté" | "À éviter"
}

RULES:
- ALL text fields in French (description, pros, cons, buyer_fit, selling_angles, marketing_hooks).
- Image URLs MUST be absolute (https://). Skip logos and icons. Only product photos.
- Spec keys in snake_case. Adapt to the product category.
- Competitor prices: only what's clearly visible in the scraped text. No fabrication.
- If a field is genuinely unknowable from the scraped content, omit it (don't return empty string or null — just omit the key).
- confidence_score reflects how grounded your extraction is in the scraped text (0.3 = mostly guessed, 0.9 = rich real data).
"""


def _build_user_prompt(target: scraper_engine.ProductTarget, scrape_outcome: ScrapeOutcome) -> str:
    """Concatenate scraped text + product metadata into the LLM input."""
    parts: list[str] = ["PRODUCT TO ENRICH:"]
    parts.append(f"Name: {target.name}")
    parts.append(f"SKU: {target.sku}")
    if target.brand:    parts.append(f"Current brand:    {target.brand}")
    if target.model:    parts.append(f"Current model:    {target.model}")
    if target.category: parts.append(f"Current category: {target.category}")
    if target.expected_price:
        parts.append(f"Our retail price: {target.expected_price} DZD")

    parts.append("")
    parts.append(f"SCRAPED WEB CONTENT ({scrape_outcome.sources_succeeded} sources fetched):")
    parts.append("=" * 60)

    # Per-source block: ranked, trimmed
    char_budget = 12_000
    used = 0
    for s in scrape_outcome.sources:
        if used >= char_budget:
            break
        if not s.extracted.has_price() and not s.extracted.title and not s.extracted.specs:
            continue  # skip sources that yielded no useful data

        block_lines = [
            f"\n[{s.tier.value.upper()}] {s.domain}",
            f"URL: {s.url}",
        ]
        if s.extracted.title:        block_lines.append(f"Title: {s.extracted.title[:200]}")
        if s.extracted.has_price():  block_lines.append(f"Price: {s.extracted.price} {s.extracted.currency}")
        if s.extracted.availability != "unknown":
            block_lines.append(f"Availability: {s.extracted.availability}")
        if s.extracted.images:
            block_lines.append(f"Images: {', '.join(s.extracted.images[:3])}")
        if s.extracted.specs:
            specs_short = {k: v for k, v in list(s.extracted.specs.items())[:8]}
            block_lines.append(f"Specs: {json.dumps(specs_short, ensure_ascii=False)[:600]}")
        if s.extracted.description:
            block_lines.append(f"Description: {s.extracted.description[:400]}")

        block = "\n".join(block_lines)
        parts.append(block)
        used += len(block)

    parts.append("")
    parts.append("=" * 60)
    parts.append("Output the JSON object now. ONLY the JSON object. No markdown fences.")
    return "\n".join(parts)


# ── Apply payload to DB (tiered overwrite policy — Q2 answer was 'd') ──────

async def _apply_payload(
    db: AsyncSession,
    product_id: UUID,
    parsed: dict[str, Any],
    target: scraper_engine.ProductTarget,
    source_tag: str,
) -> tuple[list[str], int]:
    """Apply the LLM's structured output. Returns (fields_filled_list, images_added).

    Policy (Q2 = d):
      - brand     : FILL ONLY if currently empty/Inconnu
      - category  : FILL ONLY if currently empty/'Electromenager'/'other'
      - model     : FILL ONLY if currently empty
      - description: ALWAYS OVERWRITE
      - specs     : merge — LLM keys overwrite per-key (specs are renewable)
      - images    : APPEND non-duplicate URLs as PENDING (review queue)
      - status    : recomputed from completeness inline
    """
    fields_filled: list[str] = []

    # ── Identity (fill-only) ────────────────────────────────────────
    new_brand    = parsed.get("brand")
    new_category = parsed.get("category")
    new_model    = parsed.get("model")

    set_clauses: list[str] = []
    set_params: dict[str, Any] = {"id": product_id}

    if new_brand and (not target.brand or target.brand.upper() in ("INCONNU", "UNKNOWN", "")):
        set_clauses.append("brand = :b")
        set_params["b"] = str(new_brand).strip()
        fields_filled.append("brand")

    if new_category and (not target.category or target.category.lower() in ("electromenager", "other", "autre", "")):
        set_clauses.append("category = :c")
        set_params["c"] = str(new_category).strip()
        fields_filled.append("category")

    if new_model:
        # Only overwrite if model is empty
        if not target.model:
            set_clauses.append("model = :m")
            set_params["m"] = str(new_model).strip()
            fields_filled.append("model")

    # ── Description (always overwrite) ──────────────────────────────
    new_desc = parsed.get("description")
    if new_desc and isinstance(new_desc, str) and len(new_desc) >= 20:
        set_clauses.append("description = :desc")
        set_params["desc"] = new_desc.strip()
        fields_filled.append("description")

    # Apply identity + description in one UPDATE
    if set_clauses:
        set_clauses.append("updated_at = NOW()")
        set_clauses.append("version = version + 1")
        await db.execute(
            text(f"UPDATE products SET {', '.join(set_clauses)} WHERE id = :id"),
            set_params,
        )

    # ── Specs (merge, per-key overwrite) ────────────────────────────
    specs_added = 0
    new_specs = parsed.get("specs") or {}
    aux_keys = {
        "_seo_description":  parsed.get("seo_description"),
        "_selling_angles":   parsed.get("selling_angles"),
        "_marketing_hooks":  parsed.get("marketing_hooks"),
        "_buyer_fit":        parsed.get("buyer_fit"),
        "_price_position":   parsed.get("price_position"),
        "_pros":             parsed.get("pros"),
        "_cons":             parsed.get("cons"),
        "_recommendation":   parsed.get("recommendation"),
        "_llm_confidence":   parsed.get("confidence_score"),
        "_intel_source":     source_tag,
    }
    for k, v in aux_keys.items():
        if v is not None:
            new_specs[k] = v

    if new_specs and isinstance(new_specs, dict):
        # Load current specs, merge LLM keys in
        cur = await db.execute(
            text("SELECT specs FROM products WHERE id = :id"),
            {"id": product_id},
        )
        existing = cur.scalar_one_or_none() or {}
        if isinstance(existing, str):
            existing = json.loads(existing)
        merged = dict(existing)
        for k, v in new_specs.items():
            key = str(k)[:60]
            if v is None:
                continue
            merged[key] = v
            specs_added += 1
        await db.execute(
            text("UPDATE products SET specs = CAST(:s AS JSONB), updated_at = NOW(), version = version + 1 WHERE id = :id"),
            {"id": product_id, "s": json.dumps(merged)},
        )
        if specs_added:
            fields_filled.append(f"specs(+{specs_added})")

    # ── Images (append unique, mark PENDING for human review — Q4) ─
    images_added = 0
    new_images = parsed.get("images") or []
    if isinstance(new_images, list):
        # Get currently-stored URLs for dedupe
        existing_urls_row = await db.execute(
            text("SELECT url FROM product_media WHERE product_id = :id"),
            {"id": product_id},
        )
        existing_urls = {r[0] for r in existing_urls_row.all()}

        for img_url in new_images:
            if not isinstance(img_url, str):
                continue
            url = img_url.strip()
            if not url.startswith(("http://", "https://")):
                continue
            if url in existing_urls:
                continue
            # Insert as PENDING — admin reviews before STORED.
            # product_media.store_id is NOT NULL (migration 005). Derive it
            # from the product being enriched rather than threading store_id
            # through this whole pipeline — media always belongs to the same
            # store as its product (same derive-from-parent pattern as the
            # observations writers in enrichment_runner.py / llm_enrichment.py).
            await db.execute(text("""
                INSERT INTO product_media (
                    id, store_id, product_id, url, kind, position, is_primary,
                    status, source, alt_text
                )
                SELECT :id, p.store_id, :pid, :url, 'image', 0, false,
                       'PENDING', 'SCRAPED', :alt
                  FROM products p
                 WHERE p.id = :pid
            """), {
                "id": uuid4(),
                "pid": product_id,
                "url": url[:2000],
                "alt": (parsed.get("description") or target.name)[:300],
            })
            existing_urls.add(url)
            images_added += 1

        if images_added:
            fields_filled.append(f"images(+{images_added})")

    # ── Append observations row per atomic field for audit ─────────
    for f in fields_filled:
        # Strip count suffixes like "specs(+9)" → "specs"
        base_field = f.split("(")[0]
        await db.execute(text("""
            INSERT INTO observations (entity_type, entity_id, field, value, source, confidence)
            VALUES ('product', :pid, :field, CAST(:val AS JSONB), :src, :conf)
        """), {
            "pid": product_id,
            "field": base_field,
            "val": json.dumps({"v": True}),  # marker — full payload kept in raw_payload
            "src": source_tag,
            "conf": float(parsed.get("confidence_score") or 0.7),
        })

    return fields_filled, images_added


# ── Status auto-bump (replicates rule-engine logic) ────────────────────────

async def _recompute_status_and_completeness(db: AsyncSession, product_id: UUID) -> tuple[float, str]:
    """Inline SQL recomputation. Mirrors enrichment.compute_completeness()."""
    score_row = await db.execute(text("""
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
          ) AS score,
          p.brand, p.category
          FROM products p WHERE p.id = :id
    """), {"id": product_id})
    r = score_row.first()
    if not r:
        return 0.0, "RAW"
    score = round(min(float(r[0] or 0), 1.0), 3)
    has_brand = bool(r[1] and r[1].upper() not in ("INCONNU", "UNKNOWN", ""))
    has_cat   = bool(r[2] and r[2].lower() not in ("other", "autre", "electromenager", ""))

    if has_brand and has_cat and score >= 0.85:
        new_status = "VERIFIED"
    elif has_brand and has_cat:
        new_status = "CLASSIFIED"
    elif not has_brand or not has_cat:
        new_status = "NEEDS_FIX"
    else:
        new_status = "NORMALIZED"

    await db.execute(text("""
        UPDATE products
           SET completeness_score = :s,
               status             = :st,
               updated_at         = NOW(),
               version            = version + 1
         WHERE id = :id
    """), {"s": score, "st": new_status, "id": product_id})
    return score, new_status


# ── Public entry point ────────────────────────────────────────────────────

async def enrich_full_intel(
    db: AsyncSession,
    product_id: UUID,
    *,
    cfg: llm.LLMConfig | None = None,
    max_sources: int = 6,
    job_id: UUID | None = None,
) -> FullIntelResult:
    """Run the full pipeline on one product. Caller commits on success."""
    import time
    started = time.monotonic()

    target = await scraper_engine.load_target(db, product_id)
    if target is None:
        raise ValueError(f"product {product_id} not found")

    cur = await db.execute(
        text("SELECT completeness_score, status FROM products WHERE id = :id"),
        {"id": product_id},
    )
    cur_row = cur.first()
    completeness_before = float(cur_row[0] or 0) if cur_row else 0.0
    status_before = (cur_row[1] if cur_row else "RAW") or "RAW"

    if cfg is None:
        cfg = await llm.load_config(db)

    # ── Stage 1: Scrape ─────────────────────────────────────────
    # Allocate a NEW scrape_jobs row to satisfy the scrape_sources FK.
    # The intel_jobs row (job_id passed in) is the user-facing tracker;
    # the scrape_jobs row is a technical artifact for the scraper's
    # internal bookkeeping. We link them via intel_jobs.scrape_summary
    # later so the audit trail is preserved.
    scrape_job_id = uuid4()
    await db.execute(text("""
        INSERT INTO scrape_jobs (
            id, product_id, status, max_sources, intents, expected_price
        ) VALUES (
            :id, :pid, 'PENDING', :max, :intents,
            (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
               FROM offers o
              WHERE o.product_id = :pid AND o.is_active AND o.retail_price > 0)
        )
    """), {
        "id":      scrape_job_id,
        "pid":     product_id,
        "max":     max_sources,
        "intents": ["commercial", "technical", "review"],
    })
    # Commit immediately so the scrape engine's nested INSERTs into
    # scrape_sources can satisfy the foreign key.
    await db.commit()

    scraper_cfg = await scraper_engine.load_config(db)
    se = scraper_engine.ScraperEngine(scraper_cfg)
    scrape_input = ScrapeJobInput(
        job_id=scrape_job_id,
        product_id=product_id,
        intents=["commercial", "technical", "review"],
        max_sources=max_sources,
        expected_price=target.expected_price,
    )
    scrape_outcome = await se.run_job(db, scrape_input)
    log.info(
        "intel scrape complete",
        extra={
            "product_id":        str(product_id),
            "sources_succeeded": scrape_outcome.sources_succeeded,
            "prices_found":      scrape_outcome.prices_found,
            "event":             "intel.scrape.complete",
        },
    )

    # ── Stage 2: LLM extract ──────────────────────────────────
    user_prompt = _build_user_prompt(target, scrape_outcome)
    raw, parsed = await llm.chat(cfg, _SYSTEM_PROMPT, user_prompt, json_mode=True)
    if not parsed:
        raise llm.LLMError(
            f"LLM returned unparseable output (first 400 chars): {raw[:400]}"
        )

    # ── Stage 3: Apply ────────────────────────────────────────
    source_tag = f"intel:{cfg.kind}:{cfg.model}"
    fields_filled, images_added = await _apply_payload(
        db, product_id, parsed, target, source_tag,
    )

    # ── Stage 4: Recompute completeness + status ──────────────
    completeness_after, status_after = await _recompute_status_and_completeness(db, product_id)

    # ── Stage 5: Tally pending images for return value ───────
    pending_row = await db.execute(text("""
        SELECT COUNT(*) FROM product_media
         WHERE product_id = :id AND status = 'PENDING'
    """), {"id": product_id})
    images_pending = int(pending_row.scalar_one())

    duration_ms = int((time.monotonic() - started) * 1000)

    return FullIntelResult(
        product_id=product_id,
        sku=target.sku,
        backend=cfg.kind,
        model=cfg.model,
        scrape_sources_count=scrape_outcome.sources_succeeded,
        prices_found=scrape_outcome.prices_found,
        fields_filled=fields_filled,
        images_added=images_added,
        images_pending=images_pending,
        completeness_before=completeness_before,
        completeness_after=completeness_after,
        status_before=status_before,
        status_after=status_after,
        raw_payload=parsed,
        scrape_summary=scrape_outcome.to_summary_dict(),
        duration_ms=duration_ms,
    )
