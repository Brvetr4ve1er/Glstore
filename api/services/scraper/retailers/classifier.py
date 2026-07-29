"""
URL → adapter dispatcher — Phase 9 Push 9-A.

Given a URL, returns the most-specific RetailerAdapter that handles
it, or None if only the generic extractor cascade applies.

The classifier is intentionally a flat priority list rather than a
trie / domain map because:
  - We have ≤ 10 adapters total; linear scan is sub-microsecond.
  - Subdomains and path matching are easier to express with regex
    than with a hostname-keyed map (e.g. `m.facebook.com/marketplace/`
    needs path matching to distinguish from generic FB scraping).

Adapters register themselves at import time via `register_adapter()`.
The order of registration determines priority — first match wins. The
public `register_default_adapters()` is called from `__init__.py` and
imports each retailer module so its registration side-effect runs.
"""
from __future__ import annotations

import logging

from api.services.scraper.retailers.base import RetailerAdapter

log = logging.getLogger("glstore.scraper.classifier")


# ── Registry ──────────────────────────────────────────────────────────────

_REGISTRY: list[RetailerAdapter] = []


def register_adapter(adapter: RetailerAdapter) -> None:
    """Add an adapter to the dispatch table. First-match-wins, so order
    matters: register more-specific adapters BEFORE more-generic ones.

    Usage from a retailer module:
        class OuedknissAdapter(RetailerAdapter):
            ...

        register_adapter(OuedknissAdapter())
    """
    if not isinstance(adapter, RetailerAdapter):
        raise TypeError(f"register_adapter: expected RetailerAdapter, got {type(adapter).__name__}")
    if not adapter.name:
        raise ValueError(f"register_adapter: adapter.name must be set ({adapter!r})")
    if not adapter.domain_patterns:
        raise ValueError(f"register_adapter: adapter.domain_patterns must be non-empty ({adapter!r})")
    _REGISTRY.append(adapter)
    log.debug(
        "registered adapter",
        extra={
            "adapter": adapter.name,
            "patterns": [p.pattern for p in adapter.domain_patterns],
            "event": "scraper.adapter.registered",
        },
    )


def get_adapter_for_url(url: str) -> RetailerAdapter | None:
    """Returns the first registered adapter whose `domain_patterns`
    match `url`, or None if no adapter applies. The engine should fall
    through to the generic extractor cascade when this returns None."""
    if not url or not isinstance(url, str):
        return None
    for adapter in _REGISTRY:
        try:
            if adapter.matches(url):
                return adapter
        except Exception:                                       # noqa: BLE001
            # A broken adapter mustn't take down the dispatcher. Log
            # and continue — the generic fallback will pick up the slack.
            log.exception(
                "adapter match crashed",
                extra={
                    "adapter": adapter.name,
                    "url":     url[:120],
                    "event":   "scraper.adapter.match_error",
                },
            )
    return None


def registered_adapters() -> list[RetailerAdapter]:
    """Read-only snapshot of every adapter currently in the registry.
    Used by tests + by /healthz/details for "which adapters are loaded?"
    diagnostics."""
    return list(_REGISTRY)


def clear_registry() -> None:
    """Test-only: wipe the registry so tests don't leak state.
    Production code MUST NOT call this."""
    _REGISTRY.clear()


# ── Bootstrap ─────────────────────────────────────────────────────────────

def register_default_adapters() -> None:
    """Imports every retailer module so each one's `register_adapter()`
    side-effect runs. Called from `retailers/__init__.py`.

    Idempotent: re-importing a module is a no-op for the registry
    because the modules guard their registration (or the classifier
    de-dupes by name — see below).

    Order matters — most-specific FIRST so e.g. m.facebook.com/marketplace/
    routes to the Marketplace adapter rather than a generic facebook one.
    """
    # Avoid re-registering on repeated calls (the package's __init__
    # invokes us once at import; tests may call again after clear_registry).
    # Guard uses a stable adapter name that's always present after a full load.
    if any(a.name == "ouedkniss" for a in _REGISTRY):
        return

    # Adapters registered in priority order. Most-specific URL patterns first
    # (e.g. /marketplace/ before a generic facebook.com).
    # We import + instantiate explicitly — module-level side-effect registration
    # doesn't survive a test's clear_registry() + register_default_adapters() cycle.

    # Ouedkniss.com — DZ classifieds + electronics marketplace (Nuxt/Vue/Cloudflare)
    from api.services.scraper.retailers.ouedkniss import OuedknissAdapter
    register_adapter(OuedknissAdapter())

    # Facebook Marketplace — OG meta-only (ToS-bound; admin URL-paste flow)
    from api.services.scraper.retailers.facebook import FacebookMarketplaceAdapter
    register_adapter(FacebookMarketplaceAdapter())

    # Jumia.dz — DZ branch of Pan-African e-commerce marketplace (Magento)
    from api.services.scraper.retailers.jumia import JumiaAdapter
    register_adapter(JumiaAdapter())

    # Condor.dz — Algerian electronics manufacturer's own-brand storefront
    from api.services.scraper.retailers.condor import CondorAdapter
    register_adapter(CondorAdapter())

    # Batolis.com — DZ retailer running WooCommerce
    from api.services.scraper.retailers.batolis import BatolisAdapter
    register_adapter(BatolisAdapter())

    # Mid-tier DZ bundle — carrefour.dz / yassirmall.com / cosmos.dz / numidis.com
    from api.services.scraper.retailers.midtier import MidTierDZAdapter
    register_adapter(MidTierDZAdapter())
