"""
Domain classification — derives SourceTier from a URL.

Keyed off the deep-research source tables. Patterns are checked in priority
order so 'samsung.com' wins over a generic 'com' rule. Unknown domains get
SourceTier.GENERAL.

Adding a new source: append (substring, tier) here. No code change elsewhere.
"""
from __future__ import annotations

from urllib.parse import urlparse

from api.services.scraper.types import SourceTier


# Order-sensitive: longer / more specific patterns first.
_DOMAIN_TIERS: list[tuple[str, SourceTier]] = [
    # ── Manufacturer / official ─────────────────────────────────────
    ("condor.dz",                 SourceTier.OFFICIAL),
    ("brandt.dz",                 SourceTier.OFFICIAL),
    ("iris.dz",                   SourceTier.OFFICIAL),
    ("samsung.com/levant",        SourceTier.OFFICIAL),
    ("samsung.com",               SourceTier.OFFICIAL),
    ("lg.com/dz",                 SourceTier.OFFICIAL),
    ("lg.com",                    SourceTier.OFFICIAL),
    ("hisense.com",               SourceTier.OFFICIAL),
    ("midea.com",                 SourceTier.OFFICIAL),
    ("tcl.com",                   SourceTier.OFFICIAL),
    ("geant-electronics.com",     SourceTier.OFFICIAL),

    # ── Algerian retailers (research confidence 70-85) ─────────────
    ("jumia.dz",                  SourceTier.RETAILER),
    ("batolis.com",               SourceTier.RETAILER),
    ("elhamizonline.com",         SourceTier.RETAILER),
    ("extrastoresdz.com",         SourceTier.RETAILER),
    ("by-lafamille.com",          SourceTier.RETAILER),
    ("homecenterdz.com",          SourceTier.RETAILER),
    ("sache.dz",                  SourceTier.RETAILER),
    ("proxima.market",            SourceTier.RETAILER),

    # ── Aggregators ─────────────────────────────────────────────────
    ("prixalgerie.com",           SourceTier.AGGREGATOR),
    ("diardzair.com.dz",          SourceTier.AGGREGATOR),
    ("diardzair.com",             SourceTier.AGGREGATOR),

    # ── Classifieds (research confidence 50, treat as floor) ────────
    ("ouedkniss.com",             SourceTier.CLASSIFIED),

    # ── Reviews (specs only, no commercial price) ──────────────────
    ("lesnumeriques.com",         SourceTier.REVIEW),
    ("01net.com",                 SourceTier.REVIEW),
    ("frandroid.com",             SourceTier.REVIEW),
    ("techradar.com",             SourceTier.REVIEW),
    ("tomsguide.fr",              SourceTier.REVIEW),
    ("rtings.com",                SourceTier.REVIEW),
    ("gsmarena.com",              SourceTier.REVIEW),
    ("trustpilot.com",            SourceTier.REVIEW),
    ("quechoisir.org",            SourceTier.REVIEW),

    # ── Internationals (low geo-relevance for DZ market) ───────────
    ("amazon.fr",                 SourceTier.RETAILER),
    ("amazon.com",                SourceTier.RETAILER),
    ("aliexpress.com",            SourceTier.RETAILER),
]


def host_of(url: str) -> str:
    """Lowercased host without leading 'www.'."""
    try:
        h = (urlparse(url).hostname or "").lower()
    except Exception:
        return ""
    if h.startswith("www."):
        h = h[4:]
    return h


def classify_url(url: str) -> SourceTier:
    if not url:
        return SourceTier.GENERAL
    host = host_of(url)
    if not host:
        return SourceTier.GENERAL
    full = host + (urlparse(url).path or "")
    for pattern, tier in _DOMAIN_TIERS:
        if pattern in full:
            return tier
    return SourceTier.GENERAL


# ── Skip lists ──────────────────────────────────────────────────────────────

# Never scrape our own storefront, login pages, infrastructure.
_NEVER_FETCH = (
    "ghirlaffaire.dz",
    "/login", "/account", "/cart", "/checkout",
    "facebook.com", "instagram.com", "tiktok.com",
    "twitter.com", "x.com",
)


def should_skip(url: str) -> str | None:
    """Return reason-string if URL should be skipped, else None."""
    if not url:
        return "empty url"
    low = url.lower()
    for marker in _NEVER_FETCH:
        if marker in low:
            return f"never_fetch: {marker}"
    return None


# ── Domain hints used by the tier-router ────────────────────────────────────

# Domains we know need browser rendering — skip Tier 1 entirely.
JS_HEAVY_DOMAINS = (
    "ouedkniss.com",
    "aliexpress.com",
    "facebook.com",
    "amazon.fr",
    "amazon.com",
)

# Domains we know are Cloudflare-protected — go straight to Tier 3.
PROTECTED_DOMAINS = (
    "ouedkniss.com",          # documented in research report
)


def needs_browser(url: str) -> bool:
    host = host_of(url)
    return any(d in host for d in JS_HEAVY_DOMAINS)


def needs_stealth(url: str) -> bool:
    host = host_of(url)
    return any(d in host for d in PROTECTED_DOMAINS)
