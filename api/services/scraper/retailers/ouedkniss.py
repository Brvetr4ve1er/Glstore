"""
Ouedkniss adapter — Phase 9 Push 9-B.

Ouedkniss.com is the dominant Algerian classifieds + electronics
marketplace. The site is Nuxt-based and serves both server-rendered
HTML (with JSON-LD `Product` schema for many listings) AND a hydrated
JS state under `__NUXT_DATA__` containing the canonical listing payload.

Strategy (most-trusted source first):

    1. **JSON-LD `Product`** — when present, this is the cleanest
       source. Provides `name`, `description`, `image[]`, `offers.price`,
       `offers.priceCurrency`, sometimes `brand`, sometimes `category`.
       Confidence: 0.92.

    2. **`__NUXT_DATA__` payload** — Ouedkniss's Nuxt app SSRs the
       full announce object. We do a CHEAP regex scan rather than a
       full JSON parse because the payload can be megabytes. We catch
       the listing's title, price, location, condition, and image URLs.
       Confidence: 0.78.

    3. **CSS heuristic** — defensive last-ditch. h1 for title, common
       price-bearing selectors, location chips. Confidence: 0.55.

The image extraction pass is delegated to `extract_images()` from
the shared `images.py` utility — it already handles every Ouedkniss
image pattern (CDN srcset, `__NUXT_DATA__` regex, og:image).

Anti-bot: Ouedkniss uses Cloudflare. The engine should be at Tier 2+
(Playwright stealth) before invoking this adapter — we declare
`requires_stealth = True` so the fetcher escalates automatically.

Why this is its own module rather than a generic improvement: Ouedkniss
listings are user-generated, which means the page often contains a
WHOLE inventory CSV dump from the seller's back-office (see the live
MS-SM8081 PETRIN test — 22 spec keys, half of them inventory noise).
A generic extractor can't tell the difference between a real product
spec and "Stock Maximum: 999999". This adapter knows where the LISTING-
SPECIFIC fields are and ignores the rest. The `spec_sanitizer` (Push 7)
catches anything that still slips through.
"""
from __future__ import annotations

import json
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.services.scraper.retailers.base import AdapterResult, RetailerAdapter
from api.services.scraper.retailers.images import extract_images

log = logging.getLogger("glstore.scraper.ouedkniss")


# ── Domain matchers ──────────────────────────────────────────────────────

_DOMAIN_PATTERNS = [
    # Listing pages live at /<slug>-<id> or /annonces/<category>/<slug>
    # We accept any ouedkniss.com URL — the adapter has CSS-fallbacks for
    # both PDP and search-result-style pages.
    re.compile(r"https?://(?:www\.|m\.)?ouedkniss\.com/", re.IGNORECASE),
]


# ── Price normalisation ──────────────────────────────────────────────────

# Price strings on Ouedkniss come as:
#   "21 900 DA"        with non-breaking spaces
#   "21,900 DA"        comma-thousand
#   "21900 DA"         no separator
#   "1.500.000 DA"     dot-thousand (less common)
#   "Prix sur demande" → no price → returns None
#
# We strip every non-digit AFTER deciding which separator is decimal vs
# thousands. Ouedkniss prices are almost always whole DZD; treating the
# last comma/dot as thousands is safe.
_PRICE_RE = re.compile(
    r"(\d[\d\s  .,]*)",   # ASCII space + nbsp + narrow nbsp
)
_NON_DIGIT_RE = re.compile(r"\D")


def _parse_dzd(text: str | None) -> tuple[Decimal | None, str | None]:
    """Returns (decimal_price_or_none, original_label_or_none).
    None price on 'Prix sur demande' or unparseable input."""
    if not text:
        return (None, None)
    label = text.strip()
    if not label:
        return (None, None)
    # Normalise weird whitespace early
    label = label.replace(" ", " ").replace(" ", " ")
    label = re.sub(r"\s+", " ", label).strip()
    # Reject "no price" sentinels
    lower = label.lower()
    if any(s in lower for s in ("sur demande", "à débattre", "negotiable",
                                "contactez", "non précisé")):
        return (None, label)
    m = _PRICE_RE.search(label)
    if not m:
        return (None, label)
    digits = _NON_DIGIT_RE.sub("", m.group(1))
    if not digits:
        return (None, label)
    try:
        return (Decimal(digits), label)
    except InvalidOperation:
        return (None, label)


# ── Condition / Wilaya extraction ────────────────────────────────────────

_CONDITION_RE = re.compile(
    # Each alternative needs to consume the whole word so the trailing
    # \b lands at a real boundary. "Reconditionnée" has both é AND
    # trailing e — the original `[ée]` only matched ONE char and then
    # the leftover `e` broke the closing word boundary.
    r"\b("
    r"neuf|"
    r"occasion|"
    r"reconditionn(?:é|ée|ee|e)|"
    r"d(?:é|e)ball(?:é|ée|ee|e)|"
    r"pro|particulier"
    r")\b",
    re.IGNORECASE,
)

# 48 wilaya names (FR + EN spellings where they differ). Used both to
# detect location AND to filter out spec keys that look like wilaya
# names ("Alger" appearing in a spec field is location, not a spec).
_WILAYAS = frozenset({
    "adrar", "chlef", "laghouat", "oum el bouaghi", "batna", "béjaïa",
    "biskra", "béchar", "blida", "bouira", "tamanrasset", "tébessa",
    "tlemcen", "tiaret", "tizi ouzou", "alger", "djelfa", "jijel", "sétif",
    "saïda", "skikda", "sidi bel abbès", "annaba", "guelma", "constantine",
    "médéa", "mostaganem", "msila", "mascara", "ouargla", "oran", "el bayadh",
    "illizi", "bordj bou arréridj", "boumerdès", "el tarf", "tindouf",
    "tissemsilt", "el oued", "khenchela", "souk ahras", "tipaza", "mila",
    "aïn defla", "naâma", "aïn témouchent", "ghardaïa", "relizane",
})


def _ascii_fold(s: str) -> str:
    """Strip diacritics for case-insensitive wilaya matching."""
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFKD", s)
        if not unicodedata.combining(c)
    ).lower()


def _detect_wilaya(text: str | None) -> str | None:
    """Match a wilaya name as a WHOLE WORD — not a substring. The
    naive substring check made "Algerian" match "Alger" (false positive
    so common it broke a unit test on first try)."""
    if not text:
        return None
    folded = _ascii_fold(text)
    for w in _WILAYAS:
        # Multi-word wilaya names ("Tizi Ouzou", "Sidi Bel Abbès") need
        # their internal spaces preserved; single words still get word
        # boundaries on both sides.
        pattern = re.compile(rf"\b{re.escape(_ascii_fold(w))}\b")
        if pattern.search(folded):
            return w.title()
    return None


def _detect_condition(text: str | None) -> str | None:
    """Map any of the regex alternatives back to a canonical English
    label. The regex is permissive about trailing -e/-ée so the key
    set covers every match shape it produces."""
    if not text:
        return None
    m = _CONDITION_RE.search(text)
    if not m:
        return None
    raw = m.group(1).lower()
    # Map by prefix — both "reconditionné" and "reconditionnée" should
    # collapse to the same canonical value.
    if raw == "neuf":
        return "new"
    if raw == "occasion":
        return "used"
    if raw.startswith("reconditionn"):
        return "refurbished"
    if raw.startswith("deball") or raw.startswith("déball"):
        return "open_box"
    if raw == "pro":
        return "professional"
    if raw == "particulier":
        return "private"
    return raw


# ── JSON-LD pass (highest confidence) ────────────────────────────────────

def _extract_json_ld(soup: BeautifulSoup) -> dict[str, Any] | None:
    """Find the first `<script type="application/ld+json">` containing
    a Product (or ItemPage with Product nested). Return None if absent
    or unparseable."""
    for script in soup.find_all("script", type="application/ld+json"):
        if not isinstance(script, Tag):
            continue
        try:
            txt = script.string or script.get_text(strip=True)
            if not txt:
                continue
            payload = json.loads(txt)
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        for c in candidates:
            if not isinstance(c, dict):
                continue
            graph = c.get("@graph") if "@graph" in c else [c]
            if not isinstance(graph, list):
                graph = [c]
            for node in graph:
                if not isinstance(node, dict):
                    continue
                t = node.get("@type", "")
                if isinstance(t, list):
                    if "Product" in t:
                        return node
                elif t == "Product":
                    return node
    return None


def _from_json_ld(node: dict[str, Any]) -> AdapterResult:
    """Map a JSON-LD Product node to AdapterResult. Best-case path."""
    name = node.get("name") if isinstance(node.get("name"), str) else None
    desc = node.get("description") if isinstance(node.get("description"), str) else None

    brand = None
    b = node.get("brand")
    if isinstance(b, dict):
        brand = b.get("name") or b.get("@id")
    elif isinstance(b, str):
        brand = b

    category = None
    cat = node.get("category")
    if isinstance(cat, str):
        category = cat
    elif isinstance(cat, dict):
        category = cat.get("name")

    price_dzd: Decimal | None = None
    price_label: str | None = None
    in_stock: bool | None = None
    offers = node.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if isinstance(offers, dict):
        p = offers.get("price")
        if p is not None:
            try:
                price_dzd = Decimal(str(p))
                price_label = f"{p} {offers.get('priceCurrency') or 'DZD'}"
            except (InvalidOperation, ValueError):
                pass
        avail = offers.get("availability") or ""
        if isinstance(avail, str):
            if "InStock" in avail:
                in_stock = True
            elif "OutOfStock" in avail or "SoldOut" in avail:
                in_stock = False

    return AdapterResult(
        name=name,
        description=desc,
        brand=brand,
        category=category,
        price_dzd=price_dzd,
        price_label=price_label,
        in_stock=in_stock,
        confidence=0.92,
    )


# ── __NUXT_DATA__ pass ───────────────────────────────────────────────────
#
# Ouedkniss serves Nuxt-rendered HTML; the listing payload lives in
# `<script id="__NUXT_DATA__">`. We do REGEX extraction (not a JSON
# parse) for two reasons:
#   1. The payload can be > 500 KB and includes the whole site header,
#      footer, related listings, etc.
#   2. Nuxt uses a custom array-based encoding, not vanilla JSON, so a
#      naive json.loads() won't even work on much of it.

_NUXT_TITLE_RE = re.compile(r'"title"\s*:\s*"([^"]{3,200})"')
_NUXT_PRICE_RE = re.compile(r'"price"\s*:\s*(\d+(?:\.\d+)?)')
_NUXT_DESC_RE  = re.compile(r'"description"\s*:\s*"((?:[^"\\]|\\.){10,3000})"')
_NUXT_CITY_RE  = re.compile(r'"(?:city_name|location_name|wilaya|location)"\s*:\s*"([^"]{2,80})"')
_NUXT_COND_RE  = re.compile(r'"(?:condition|state|etat)"\s*:\s*"([^"]{3,30})"')


def _from_nuxt(soup: BeautifulSoup) -> AdapterResult:
    """Cheap regex pass over the __NUXT_DATA__ payload. Gracefully
    returns empty AdapterResult if the script isn't there."""
    out = AdapterResult(confidence=0.78)
    tag = soup.find("script", id="__NUXT_DATA__")
    if not isinstance(tag, Tag):
        return out
    payload = tag.string or tag.get_text(strip=False)
    if not payload:
        return out

    if (m := _NUXT_TITLE_RE.search(payload)):
        out.name = m.group(1).strip()
    if (m := _NUXT_PRICE_RE.search(payload)):
        try:
            out.price_dzd = Decimal(m.group(1))
            out.price_label = f"{m.group(1)} DZD"
        except InvalidOperation:
            pass
    if (m := _NUXT_DESC_RE.search(payload)):
        # Unescape JSON string body
        out.description = m.group(1).encode().decode("unicode_escape", errors="ignore")
    if (m := _NUXT_CITY_RE.search(payload)):
        wilaya = _detect_wilaya(m.group(1)) or m.group(1)
        out.source_metadata["wilaya"] = wilaya
    if (m := _NUXT_COND_RE.search(payload)):
        cond = _detect_condition(m.group(1))
        if cond:
            out.source_metadata["condition"] = cond
    return out


# ── CSS heuristic pass (last-ditch) ──────────────────────────────────────

def _from_css(soup: BeautifulSoup) -> AdapterResult:
    """Defensive selectors for when neither JSON-LD nor __NUXT_DATA__
    surface enough data. Ouedkniss has redesigned their PDP markup
    multiple times — these selectors target the most stable patterns."""
    out = AdapterResult(confidence=0.55)

    # Title: always a single h1 on listing pages
    h1 = soup.find("h1")
    if isinstance(h1, Tag):
        title = h1.get_text(strip=True)
        if title and len(title) > 2:
            out.name = title

    # Price: look for any element whose text matches "<digits> DA"
    # within the body (avoids picking up DA in the footer).
    for tag in soup.find_all(["span", "div", "p"], limit=200):
        if not isinstance(tag, Tag):
            continue
        txt = tag.get_text(" ", strip=True)
        if not txt or len(txt) > 60:
            continue
        if re.search(r"\b\d[\d\s .,]{1,15}\s*(?:DA|DZD)\b", txt, re.IGNORECASE):
            price_dzd, label = _parse_dzd(txt)
            if price_dzd is not None:
                out.price_dzd = price_dzd
                out.price_label = label
                break

    # Description: find largest text block within an <article> or
    # the longest <p> on the page (Ouedkniss often wraps it loosely)
    desc_candidates: list[str] = []
    for sel in ("article", "[class*=description]", "[class*=detail]"):
        for tag in soup.select(sel):
            if not isinstance(tag, Tag):
                continue
            txt = tag.get_text(" ", strip=True)
            if 30 < len(txt) < 4000:
                desc_candidates.append(txt)
    if not desc_candidates:
        for p in soup.find_all("p"):
            if not isinstance(p, Tag):
                continue
            txt = p.get_text(" ", strip=True)
            if 30 < len(txt) < 2000:
                desc_candidates.append(txt)
    if desc_candidates:
        # Pick the longest — usually the listing body
        out.description = max(desc_candidates, key=len)

    # Location / condition: scan all visible text (cheap)
    body_txt = soup.get_text(" ", strip=True)[:5000] if soup.body else ""
    wilaya = _detect_wilaya(body_txt)
    if wilaya:
        out.source_metadata["wilaya"] = wilaya
    cond = _detect_condition(body_txt)
    if cond:
        out.source_metadata["condition"] = cond

    return out


# ── Adapter ──────────────────────────────────────────────────────────────

class OuedknissAdapter(RetailerAdapter):
    name             = "ouedkniss"
    domain_patterns  = _DOMAIN_PATTERNS
    requires_stealth = True       # Ouedkniss is Cloudflare-fronted
    # Cloudflare CAPTCHA pages are typically under 2 KB. 1 KB is the
    # base ABC default; we keep it because some legitimate stub pages
    # (404, redirect with body) can be in the 1-2 KB range and we'd
    # rather try to extract than refuse.
    min_html_size    = 1024

    async def extract(self, html: str, url: str) -> AdapterResult:
        if not html or len(html) < self.min_html_size:
            log.info(
                "Ouedkniss page too small — likely CAPTCHA",
                extra={"url": url[:120], "html_size": len(html or ""),
                       "event": "scraper.ouedkniss.too_small"},
            )
            return AdapterResult()

        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:                                       # noqa: BLE001
            soup = BeautifulSoup(html, "html.parser")

        # Cascade with explicit "who-won" tracking. Confidence reflects
        # the HIGHEST-fidelity tier that actually produced primary
        # content (name / price / images / specs). Side-channels like
        # source_metadata always merge — they don't influence confidence.
        result = AdapterResult()
        won_by: str | None = None

        # Tier 1: JSON-LD (highest fidelity, ~0.92)
        ld = _extract_json_ld(soup)
        if ld is not None:
            result = _from_json_ld(ld)
            won_by = "json-ld"

        # Tier 2: __NUXT_DATA__ — always merge (catches wilaya / condition
        # even when JSON-LD also won), but only own the confidence floor
        # if NUXT was the first tier to produce primary content.
        nuxt = _from_nuxt(soup)
        result.merge_from(nuxt)
        if won_by is None and not nuxt.is_empty():
            result.confidence = nuxt.confidence
            won_by = "nuxt"

        # Tier 3: CSS heuristic — last-ditch
        css = _from_css(soup)
        result.merge_from(css)
        if won_by is None and not css.is_empty():
            result.confidence = css.confidence
            won_by = "css"

        if won_by:
            result.source_metadata.setdefault("extraction_tier", won_by)

        # Images: always run the multi-source extractor. Cheap and
        # consistent across all retailers.
        result.images = extract_images(html, url, limit=15)

        # Ouedkniss currency is always DZD
        result.currency = "DZD"

        # Surface metadata so the LLM merge step has classifieds context
        # (used vs new, seller wilaya, etc.).
        if "ouedkniss" not in result.source_metadata:
            result.source_metadata["source"] = "ouedkniss"

        return result


# Note: registration is performed by `classifier.register_default_adapters()`
# rather than as a module-level side-effect. Module imports are cached, so
# a side-effect registration wouldn't re-fire after `clear_registry()` in
# tests — making tests both flaky and dependent on import order.
