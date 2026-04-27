"""
Scraper engine — wires the pieces and runs ONE job.

Pipeline (per master prompt + research):
    1. load_target(db, product_id)         → ProductTarget
    2. queries = build_queries(intents)    → [(intent, q), ...]
    3. results = search.search(queries)    → list[SearchResult]
    4. selected = ranker.rank_and_diversify(results, max=N)
    5. for url in selected (parallel sem=K):
         fetched   = fetcher.fetch(url)
         extracted = extractors.extract(fetched.html, url)
         verdict   = price_validator.validate_one(extracted, ...)
         persist scrape_sources row
       collect prices
    6. consensus = price_validator.consensus_of(prices)
       adjust each source's confidence vs consensus
    7. write competitor_prices rows (idempotent on day)
    8. mark scrape_jobs.status='COMPLETED', summary=...

Caller is responsible for committing the surrounding transaction.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.scraper import extractors, ranker, search as search_mod
from api.services.scraper.fetcher import TieredFetcher
from api.services.scraper.types import (
    ExtractedData, Intent, ProductTarget, ScrapeOutcome,
    ScrapedSourceRecord, SearchResult, SourceTier,
)
from api.services.scraper.utils.domain import host_of
from api.services.scraper.validators import price_validator

log = logging.getLogger("glstore.scraper.engine")


@dataclass
class ScrapeJobInput:
    job_id: UUID
    product_id: UUID
    intents: list[Intent]
    max_sources: int
    expected_price: Decimal | None = None


@dataclass
class ScraperConfig:
    searxng_url: str
    brave_api_key: str
    ddg_fallback_enabled: bool
    user_agent: str
    max_concurrent_fetches: int
    per_domain_rate_limit_s: float
    per_job_timeout_s: int
    min_confidence_for_price: float
    price_outlier_low_factor: Decimal
    price_outlier_high_factor: Decimal
    margin_alert_threshold_pct: float
    tier4_enabled: bool
    tier4_provider: str
    tier4_api_key: str
    proxies: list[str]


# ── Config loading ──────────────────────────────────────────────────────────

async def load_config(db: AsyncSession) -> ScraperConfig:
    row = await db.execute(
        text("SELECT value FROM app_settings WHERE key = 'scraper.config'"),
    )
    r = row.first()
    raw: dict[str, Any] = (r[0] if r and isinstance(r[0], dict)
                           else (json.loads(r[0]) if r else {}))
    return ScraperConfig(
        searxng_url=str(raw.get("searxng_url", "http://searxng:8080")),
        brave_api_key=str(raw.get("brave_api_key", "")),
        ddg_fallback_enabled=bool(raw.get("ddg_fallback_enabled", True)),
        user_agent=str(raw.get("user_agent", "GhirLaffaireBot/1.0")),
        max_concurrent_fetches=int(raw.get("max_concurrent_fetches", 3)),
        per_domain_rate_limit_s=float(raw.get("per_domain_rate_limit_seconds", 2.0)),
        per_job_timeout_s=int(raw.get("per_job_timeout_seconds", 90)),
        min_confidence_for_price=float(raw.get("min_confidence_for_price", 0.6)),
        price_outlier_low_factor=Decimal(str(raw.get("price_outlier_low_factor", 0.3))),
        price_outlier_high_factor=Decimal(str(raw.get("price_outlier_high_factor", 2.5))),
        margin_alert_threshold_pct=float(raw.get("margin_alert_threshold_pct", 0.10)),
        tier4_enabled=bool(raw.get("tier4_enabled", False)),
        tier4_provider=str(raw.get("tier4_provider", "")),
        tier4_api_key=str(raw.get("tier4_api_key", "")),
        proxies=list(raw.get("proxies") or []),
    )


# ── Target loader ───────────────────────────────────────────────────────────

async def load_target(db: AsyncSession, product_id: UUID) -> ProductTarget | None:
    row = await db.execute(text("""
        SELECT p.id, p.sku, p.name, p.brand, p.model, p.category,
               (SELECT MIN(COALESCE(o.sale_price, o.retail_price))
                  FROM offers o
                 WHERE o.product_id = p.id
                   AND o.is_active
                   AND o.retail_price > 0) AS expected_price
          FROM products p
         WHERE p.id = :id
    """), {"id": product_id})
    r = row.first()
    if not r:
        return None
    return ProductTarget(
        id=str(r[0]),
        sku=r[1],
        name=r[2],
        brand=r[3],
        model=r[4],
        category=r[5],
        expected_price=Decimal(str(r[6])) if r[6] is not None else None,
    )


# ── Engine ──────────────────────────────────────────────────────────────────

class ScraperEngine:
    def __init__(self, cfg: ScraperConfig) -> None:
        self.cfg = cfg
        from api.services.scraper.utils.proxy_manager import ProxyPool
        self._proxy_pool = ProxyPool(cfg.proxies)
        self._fetcher = TieredFetcher(
            user_agent=cfg.user_agent,
            per_domain_rate_limit_s=cfg.per_domain_rate_limit_s,
            proxy_pool=self._proxy_pool,
            confidence_threshold=cfg.min_confidence_for_price,
            tier4_enabled=cfg.tier4_enabled,
            tier4_provider=cfg.tier4_provider,
            tier4_api_key=cfg.tier4_api_key,
        )
        self._sem = asyncio.Semaphore(max(1, cfg.max_concurrent_fetches))

    # ── Main entry ──────────────────────────────────────────────────────────

    async def run_job(
        self,
        db: AsyncSession,
        job: ScrapeJobInput,
    ) -> ScrapeOutcome:
        started = time.monotonic()

        # Pull target details
        target = await load_target(db, job.product_id)
        if target is None:
            raise ValueError(f"product {job.product_id} not found")
        if job.expected_price is not None:
            target.expected_price = job.expected_price

        # Build queries
        queries: list[tuple[Intent, str]] = [
            (intent, search_mod.build_query(target, intent))
            for intent in job.intents
        ]

        # Search
        search_cfg = search_mod.SearchConfig(
            searxng_url=self.cfg.searxng_url,
            brave_api_key=self.cfg.brave_api_key,
            ddg_fallback=self.cfg.ddg_fallback_enabled,
            user_agent=self.cfg.user_agent,
        )
        try:
            search_results = await asyncio.wait_for(
                search_mod.search(queries, search_cfg),
                timeout=30,
            )
        except asyncio.TimeoutError:
            search_results = []
            log.warning("job %s: search timed out", job.job_id)

        selected = ranker.rank_and_diversify(
            search_results, max_total=job.max_sources,
        )

        log.info(
            "job %s: searched %d → selected %d (target=%s)",
            job.job_id, len(search_results), len(selected), target.name[:60],
        )

        # Fetch + extract concurrently with overall job timeout
        try:
            sources = await asyncio.wait_for(
                self._fetch_all(selected, target=target),
                timeout=self.cfg.per_job_timeout_s,
            )
        except asyncio.TimeoutError:
            log.warning("job %s: per-job timeout", job.job_id)
            sources = []

        # Cross-source consensus + confidence adjustment
        accepted_for_consensus: list[Decimal] = []
        for s in sources:
            verdict = price_validator.validate_one(
                s.extracted,
                tier=s.tier,
                expected_price=target.expected_price,
                low_factor=self.cfg.price_outlier_low_factor,
                high_factor=self.cfg.price_outlier_high_factor,
            )
            if verdict.accepted and s.extracted.price is not None:
                accepted_for_consensus.append(s.extracted.price)
            # Persist verdict notes onto the source
            s.confidence = verdict.confidence
            if verdict.notes:
                s.extracted.notes.extend(verdict.notes)
            if not verdict.accepted and verdict.reason:
                s.error_message = (s.error_message + " | " if s.error_message else "") + verdict.reason

        consensus = price_validator.consensus_of(accepted_for_consensus)

        # Adjust per-source confidence post-consensus (agreement boost / outlier drop)
        for s in sources:
            if s.extracted.has_price():
                s.confidence = price_validator.adjust_confidence_post_consensus(
                    s.extracted, consensus,
                )

        # Persist scrape_sources
        await self._persist_sources(db, job_id=job.job_id, sources=sources)

        # Persist competitor_prices (idempotent on day)
        prices_persisted = 0
        for s in sources:
            if (s.extracted.has_price()
                and s.extracted.currency == "DZD"
                and s.confidence >= self.cfg.min_confidence_for_price
                and s.error_message is None):
                inserted = await self._persist_price(
                    db,
                    product_id=job.product_id,
                    job_id=job.job_id,
                    source=s,
                )
                prices_persisted += int(inserted)

        # Compute summary
        our_price = target.expected_price
        vs_market_pct: float | None = None
        margin_alert = False
        if consensus.median_price and consensus.median_price > 0 and our_price:
            delta = (Decimal(str(our_price)) - consensus.median_price) / consensus.median_price
            vs_market_pct = float(round(delta, 4))
            margin_alert = vs_market_pct > self.cfg.margin_alert_threshold_pct

        by_tier: dict[str, int] = {}
        engines: dict[str, int] = {}
        succeeded = 0
        blocked = 0
        for s in sources:
            by_tier[s.tier.value] = by_tier.get(s.tier.value, 0) + 1
            engines[s.fetch_engine] = engines.get(s.fetch_engine, 0) + 1
            if s.extracted.has_price() or (s.title and s.fetch_engine != "skipped"):
                succeeded += 1
            if s.fetch_engine in ("rate_limited", "robots_disallow") or "block" in (s.error_message or "").lower():
                blocked += 1

        outcome = ScrapeOutcome(
            job_id=str(job.job_id),
            product_id=str(job.product_id),
            sources_attempted=len(selected),
            sources_succeeded=succeeded,
            sources_blocked=blocked,
            prices_found=len([1 for s in sources if s.extracted.has_price() and s.confidence >= self.cfg.min_confidence_for_price]),
            median_price=consensus.median_price,
            lowest_price=consensus.lowest_price,
            highest_price=consensus.highest_price,
            our_price=Decimal(str(our_price)) if our_price else None,
            vs_market_pct=vs_market_pct,
            margin_alert=margin_alert,
            by_tier=by_tier,
            fetch_engines_used=engines,
            duration_ms=int((time.monotonic() - started) * 1000),
            sources=sources,
        )
        log.info(
            "scrape job done",
            extra={
                "job_id":        str(job.job_id),
                "prices_found":  outcome.prices_found,
                "median_price":  outcome.median_price,
                "vs_market_pct": outcome.vs_market_pct,
                "margin_alert":  outcome.margin_alert,
                "duration_ms":   outcome.duration_ms,
                "event":         "scrape.done",
            },
        )
        return outcome

    # ── Internal: fetch all selected URLs concurrently ─────────────────────

    async def _fetch_all(
        self,
        selected: list[SearchResult],
        *,
        target: ProductTarget,
    ) -> list[ScrapedSourceRecord]:
        async def _one(sr: SearchResult) -> ScrapedSourceRecord:
            async with self._sem:
                fetch_result = await self._fetcher.fetch(sr.url, tier=sr.tier)
            extracted: ExtractedData
            if fetch_result.ok and fetch_result.html:
                try:
                    extracted = extractors.extract(fetch_result.html, sr.url)
                except Exception as e:                                # noqa: BLE001
                    extracted = ExtractedData(
                        url=sr.url, method="css_heuristic", confidence=0.0,
                        notes=[f"extractor crashed: {type(e).__name__}: {e}"],
                    )
            else:
                extracted = ExtractedData(
                    url=sr.url, method="css_heuristic", confidence=0.0,
                    notes=[fetch_result.error or "fetch failed"],
                )

            return ScrapedSourceRecord(
                url=sr.url,
                domain=sr.domain or host_of(sr.url),
                tier=sr.tier,
                intent=sr.intent,
                fetch_tier=fetch_result.tier,
                fetch_engine=fetch_result.engine,
                fetch_ms=fetch_result.fetch_ms,
                http_status=fetch_result.status,
                title=extracted.title or sr.title,
                snippet=sr.snippet,
                extracted=extracted,
                confidence=extracted.confidence,
                error_message=fetch_result.error,
            )

        return await asyncio.gather(*[_one(s) for s in selected])

    # ── Internal: persistence ──────────────────────────────────────────────

    async def _persist_sources(
        self,
        db: AsyncSession,
        *,
        job_id: UUID,
        sources: list[ScrapedSourceRecord],
    ) -> None:
        for s in sources:
            await db.execute(text("""
                INSERT INTO scrape_sources (
                    job_id, url, domain, tier, intent,
                    fetch_tier, fetch_engine, fetch_ms, http_status,
                    title, snippet, extracted, confidence, error_message
                ) VALUES (
                    :job, :url, :domain, :tier, :intent,
                    :ft, :fe, :fms, :hs,
                    :title, :snippet, CAST(:extracted AS JSONB), :conf, :err
                )
            """), {
                "job": job_id,
                "url": s.url[:2000],
                "domain": s.domain[:200],
                "tier": s.tier.value,
                "intent": s.intent,
                "ft": s.fetch_tier,
                "fe": s.fetch_engine[:80],
                "fms": s.fetch_ms,
                "hs": s.http_status,
                "title": (s.title or "")[:500] or None,
                "snippet": (s.snippet or "")[:1000] or None,
                "extracted": json.dumps(s.extracted.to_dict(), default=str),
                "conf": float(s.confidence),
                "err": (s.error_message or "")[:500] or None,
            })

    async def _persist_price(
        self,
        db: AsyncSession,
        *,
        product_id: UUID,
        job_id: UUID,
        source: ScrapedSourceRecord,
    ) -> bool:
        """Insert one competitor_prices row, or upsert by (product, domain, day)."""
        if source.extracted.price is None:
            return False
        await db.execute(text("""
            INSERT INTO competitor_prices (
                product_id, source_domain, source_url, price, currency,
                availability, confidence, scrape_job_id
            ) VALUES (
                :pid, :dom, :url, :price, :cur,
                :avail, :conf, :job
            )
            ON CONFLICT (product_id, source_domain, observed_at) DO UPDATE
                SET price        = EXCLUDED.price,
                    source_url   = EXCLUDED.source_url,
                    confidence   = EXCLUDED.confidence,
                    availability = EXCLUDED.availability,
                    scrape_job_id= EXCLUDED.scrape_job_id
        """), {
            "pid": product_id,
            "dom": source.domain[:200],
            "url": source.url[:2000],
            "price": source.extracted.price,
            "cur": source.extracted.currency or "DZD",
            "avail": source.extracted.availability,
            "conf": float(source.confidence),
            "job": job_id,
        })
        return True


__all__ = ["ScraperEngine", "ScraperConfig", "ScrapeJobInput", "load_config", "load_target"]
