"""
Search layer — multi-intent + cascading backends.

For each `Intent` we issue a tailored query:
    commercial → "{brand} {model} prix algérie"        → wants retailer pages
    technical  → "{brand} {model} fiche technique"     → wants spec sheets
    review     → "{brand} {model} avis test"           → wants review sites

Backends, in order:
    1. SearXNG  (self-hosted, multi-engine aggregator)
    2. Brave Search API (if api_key configured)
    3. DuckDuckGo HTML (free, rate-limited, last resort)

Each backend returns `list[SearchResult]`. The orchestrator dedupes by domain
+ ranks by `SourceTier`.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from api.services.scraper.types import Intent, ProductTarget, SearchResult, SourceTier
from api.services.scraper.utils.domain import classify_url, host_of, should_skip

log = logging.getLogger("glstore.scraper.search")


# ── Query builders (research-aligned: multilingual hint + DZ market) ────────

def _q_token(value: str | None) -> str:
    return (value or "").strip()


def build_query(target: ProductTarget, intent: Intent) -> str:
    parts = [_q_token(target.brand), _q_token(target.model) or _q_token(target.name)]
    base = " ".join(p for p in parts if p)
    if not base:
        base = _q_token(target.name)

    if intent == "commercial":
        return f'{base} prix algerie'
    if intent == "technical":
        return f'{base} fiche technique specifications'
    if intent == "review":
        return f'{base} avis test review'
    return base


# ── Config ──────────────────────────────────────────────────────────────────

@dataclass
class SearchConfig:
    searxng_url: str = ""
    brave_api_key: str = ""
    ddg_fallback: bool = True
    user_agent: str = "GhirLaffaireBot/1.0"
    timeout_s: float = 12.0
    per_intent_max: int = 8


# ── SearXNG ─────────────────────────────────────────────────────────────────

async def _search_searxng(query: str, cfg: SearchConfig) -> list[SearchResult]:
    if not cfg.searxng_url:
        return []
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_s) as client:
            r = await client.get(
                cfg.searxng_url.rstrip("/") + "/search",
                params={
                    "q": query,
                    "format": "json",
                    "safesearch": "1",
                    "language": "fr",
                },
                headers={"User-Agent": cfg.user_agent},
            )
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception as e:                                           # noqa: BLE001
        log.warning("searxng failed: %s", e)
        return []
    out: list[SearchResult] = []
    for item in (data.get("results") or [])[: cfg.per_intent_max]:
        url = item.get("url") or ""
        if not url or should_skip(url):
            continue
        out.append(SearchResult(
            title=item.get("title", "")[:300],
            url=url,
            snippet=(item.get("content") or "")[:600],
            domain=host_of(url),
            tier=classify_url(url),
            engine="searxng",
        ))
    return out


# ── Brave Search ────────────────────────────────────────────────────────────

async def _search_brave(query: str, cfg: SearchConfig) -> list[SearchResult]:
    if not cfg.brave_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_s) as client:
            r = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": cfg.per_intent_max, "country": "DZ"},
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": cfg.brave_api_key,
                    "User-Agent": cfg.user_agent,
                },
            )
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception as e:                                           # noqa: BLE001
        log.warning("brave failed: %s", e)
        return []
    items = (data.get("web") or {}).get("results") or []
    out: list[SearchResult] = []
    for item in items[: cfg.per_intent_max]:
        url = item.get("url") or ""
        if not url or should_skip(url):
            continue
        out.append(SearchResult(
            title=(item.get("title") or "")[:300],
            url=url,
            snippet=(item.get("description") or "")[:600],
            domain=host_of(url),
            tier=classify_url(url),
            engine="brave",
        ))
    return out


# ── DuckDuckGo HTML (last resort) ───────────────────────────────────────────

_UDDG_RE = re.compile(r"uddg=([^&]+)")


def _resolve_ddg_redirect(href: str) -> str:
    if not href:
        return href
    try:
        p = urlparse(href)
        qs = parse_qs(p.query)
        if "uddg" in qs:
            return unquote(qs["uddg"][0])
        m = _UDDG_RE.search(href)
        if m:
            return unquote(m.group(1))
    except Exception:
        pass
    return href


async def _search_ddg_html(query: str, cfg: SearchConfig) -> list[SearchResult]:
    url = "https://html.duckduckgo.com/html/?q=" + quote_plus(query)
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_s, follow_redirects=True) as client:
            r = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                                  "Chrome/124.0 Safari/537.36",
                    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
                },
            )
        if r.status_code != 200:
            return []
    except Exception as e:                                           # noqa: BLE001
        log.warning("ddg failed: %s", e)
        return []

    soup = BeautifulSoup(r.text, "lxml")
    out: list[SearchResult] = []
    for res in soup.select(".result")[: cfg.per_intent_max]:
        a = res.select_one(".result__a")
        s = res.select_one(".result__snippet")
        if not a:
            continue
        href = a.get("href") or ""
        href = _resolve_ddg_redirect(href)
        if not href or should_skip(href):
            continue
        out.append(SearchResult(
            title=a.get_text(strip=True)[:300],
            url=href,
            snippet=(s.get_text(strip=True) if s else "")[:600],
            domain=host_of(href),
            tier=classify_url(href),
            engine="duckduckgo_html",
        ))
    return out


# ── Public entry point ──────────────────────────────────────────────────────

async def search(
    queries: Iterable[tuple[Intent, str]],
    cfg: SearchConfig,
) -> list[SearchResult]:
    """Run all queries, with backend cascade per query. Tags each result with
    its `intent` so the ranker can quota-balance across intents."""
    all_results: list[SearchResult] = []
    for intent, q in queries:
        results: list[SearchResult] = []
        if cfg.searxng_url:
            results = await _search_searxng(q, cfg)
        if not results and cfg.brave_api_key:
            results = await _search_brave(q, cfg)
        if not results and cfg.ddg_fallback:
            results = await _search_ddg_html(q, cfg)
        for r in results:
            r.intent = intent
        all_results.extend(results)
    return all_results
