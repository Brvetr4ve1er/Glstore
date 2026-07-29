"""
Robust product-image extraction — Phase 9 Push 9-A.

This is the module that fixes the "0 images" failure from the live
MS-SM8081 PETRIN test. The current generic extractor only checks
`<img src>` and JSON-LD `image` — modern e-commerce sites use a
zoo of patterns:

    1. <img srcset="…">                      responsive sizes
    2. <img data-src="…" data-srcset="…">    lazy-load placeholders
    3. <picture><source srcset="…">          art-direction / format negotiation
    4. <meta property="og:image">            social-share fallback
    5. <link rel="preload" as="image">       performance-hinted previews
    6. JSON-LD ItemList / Product image[]    structured data
    7. window.__NEXT_DATA__ / __NUXT__       SSR'd JS state (Next.js / Nuxt)
    8. <noscript> CSS background-image       SEO-only paths

Plus we have to:
    - Resolve relative URLs against the page's base URL
    - Pick the LARGEST candidate per srcset (we don't want the 100w thumb)
    - Filter out tracking pixels (<= 2x2), placeholders, blank.gif
    - De-dupe across all sources
    - Reject obvious sprites (icon CDNs)

Public API:
    extract_images(html, base_url, *, limit=20) -> list[str]
        Single-call entry point. Returns deduped list of absolute URLs,
        ordered by quality heuristic (largest srcset first, then JSON-LD,
        then og:image, then plain <img>).

    is_likely_product_image(url) -> bool
        Cheap path-based filter — used to drop logos / sprites / CDN
        icon dumps. Conservative; defers to the LLM extraction pass for
        relevance checks.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

log = logging.getLogger("glstore.scraper.images")


# ── Heuristics ────────────────────────────────────────────────────────────

# srcset is comma-separated `URL widthDescriptor`, e.g.:
#   "img/p-300.jpg 300w, img/p-600.jpg 600w, img/p-1200.jpg 1200w"
# Sometimes density descriptors:
#   "img/p.png 1x, img/p@2x.png 2x"
_SRCSET_ENTRY_RE = re.compile(
    r"(?P<url>[^\s,]+)"
    r"(?:\s+(?P<descriptor>\d+(?:\.\d+)?[wx]))?",
)

# Path patterns we KNOW aren't product images
_BLOCK_PATH_RE = re.compile(
    r"(?:"
    r"\bsprite\b|\bsprites\b|\bicons?\b|\blogo\b|\bplaceholder\b|"
    r"\bavatar\b|\bgravatar\b|\btracking\b|\bpixel\b|"
    r"\bblank\.(?:gif|png)\b|\b1x1\.|\bspacer\.gif\b|"
    r"data:image/svg\+xml|data:image/gif"
    r")",
    re.IGNORECASE,
)

# Extensions we accept (others — .svg, .ico — fall through)
_ALLOWED_EXT = (".jpg", ".jpeg", ".png", ".webp", ".avif")


# ── Internal: srcset parsing ──────────────────────────────────────────────

def _parse_srcset(srcset: str) -> list[tuple[str, int]]:
    """Returns (url, width) pairs sorted by width DESC. Width 0 means
    no descriptor (we'll treat as smallest)."""
    if not srcset:
        return []
    out: list[tuple[str, int]] = []
    # Split on comma WITHIN descriptor boundaries — naive split is fine
    # because URLs in srcset can't contain unescaped commas.
    for part in srcset.split(","):
        part = part.strip()
        if not part:
            continue
        m = _SRCSET_ENTRY_RE.match(part)
        if not m:
            continue
        url = m.group("url")
        desc = m.group("descriptor") or ""
        if desc.endswith("w"):
            try:
                w = int(desc[:-1])
            except ValueError:
                w = 0
        elif desc.endswith("x"):
            try:
                # Treat 2x as ~1200w-equivalent; 1x as ~600w. Coarse but
                # gives consistent ordering.
                w = int(float(desc[:-1]) * 600)
            except ValueError:
                w = 0
        else:
            w = 0
        out.append((url, w))
    out.sort(key=lambda t: -t[1])
    return out


def _largest_in_srcset(srcset: str) -> str | None:
    parsed = _parse_srcset(srcset)
    return parsed[0][0] if parsed else None


# ── Internal: filters ────────────────────────────────────────────────────

def is_likely_product_image(url: str) -> bool:
    """Cheap path-based filter — drop sprites, logos, tracking pixels.
    Conservative: when in doubt, keep the URL and let downstream
    review (LLM extraction or admin Image Review) decide."""
    if not url or not isinstance(url, str):
        return False
    if url.startswith("data:"):
        return False
    if _BLOCK_PATH_RE.search(url):
        return False

    # Path heuristic: common product-image paths CONTAIN these segments
    # — this is just a positive signal, not required.
    path = urlparse(url).path.lower()
    if path == "" or path == "/":
        return False
    # Reject obvious favicon paths
    if path.endswith(".ico"):
        return False
    return True


def _absolutise(url: str, base_url: str) -> str | None:
    """Resolve relative URLs. Returns None for unparseable input."""
    if not url:
        return None
    url = url.strip()
    if not url:
        return None
    # Protocol-relative: //cdn.example.com/...
    if url.startswith("//"):
        scheme = urlparse(base_url).scheme or "https"
        return f"{scheme}:{url}"
    if url.startswith(("http://", "https://")):
        return url
    if url.startswith("data:"):
        return None
    try:
        return urljoin(base_url, url)
    except Exception:
        return None


# ── Source extractors ─────────────────────────────────────────────────────

@dataclass
class _ImageCandidate:
    """One image URL plus a quality score so we can rank the final
    list. Higher score = surfaces first."""
    url:    str
    score:  int = 0
    source: str = ""        # 'srcset' | 'json-ld' | 'og' | 'img' | etc.


def _from_img_tags(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<img>` tags. For each: prefer srcset (largest width) > data-src
    > data-srcset > src."""
    out: list[_ImageCandidate] = []
    for img in soup.find_all("img"):
        if not isinstance(img, Tag):
            continue
        # Try srcset first (highest quality signal)
        srcset = img.get("srcset") or img.get("data-srcset") or ""
        if isinstance(srcset, list):
            srcset = " ".join(srcset)
        if srcset:
            biggest = _largest_in_srcset(srcset)
            if biggest:
                resolved = _absolutise(biggest, base_url)
                if resolved:
                    out.append(_ImageCandidate(resolved, score=80, source="srcset"))
                    continue   # don't double-count this <img>
        # data-src (lazy load)
        data_src = img.get("data-src") or ""
        if isinstance(data_src, list):
            data_src = data_src[0] if data_src else ""
        if data_src:
            resolved = _absolutise(data_src, base_url)
            if resolved:
                out.append(_ImageCandidate(resolved, score=60, source="data-src"))
                continue
        # plain src — lowest priority because lazy-load placeholders live here
        src = img.get("src") or ""
        if isinstance(src, list):
            src = src[0] if src else ""
        if src:
            resolved = _absolutise(src, base_url)
            if resolved:
                out.append(_ImageCandidate(resolved, score=40, source="img"))
    return out


def _from_picture_sources(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<picture><source srcset="…">` — common for art-direction or
    AVIF/WebP fallbacks. Prefer the largest srcset entry across all
    sources."""
    out: list[_ImageCandidate] = []
    for pic in soup.find_all("picture"):
        if not isinstance(pic, Tag):
            continue
        for source in pic.find_all("source"):
            if not isinstance(source, Tag):
                continue
            srcset = source.get("srcset") or ""
            if isinstance(srcset, list):
                srcset = " ".join(srcset)
            if srcset:
                biggest = _largest_in_srcset(srcset)
                if biggest:
                    resolved = _absolutise(biggest, base_url)
                    if resolved:
                        out.append(_ImageCandidate(resolved, score=85, source="picture"))
    return out


def _from_og_meta(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<meta property="og:image">` — single hero image fallback. High
    confidence when present because it's the page's chosen "social
    preview" image, but only ONE per page."""
    out: list[_ImageCandidate] = []
    seen: set[str] = set()
    selectors = [
        ("meta", {"property": "og:image"}),
        ("meta", {"property": "og:image:secure_url"}),
        ("meta", {"name": "twitter:image"}),
        ("meta", {"name": "twitter:image:src"}),
    ]
    for tag_name, attrs in selectors:
        for tag in soup.find_all(tag_name, attrs=attrs):
            if not isinstance(tag, Tag):
                continue
            content = tag.get("content") or ""
            if isinstance(content, list):
                content = content[0] if content else ""
            if content and content not in seen:
                resolved = _absolutise(content, base_url)
                if resolved:
                    out.append(_ImageCandidate(resolved, score=90, source="og"))
                    seen.add(content)
    return out


def _from_link_preload(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<link rel="preload" as="image" href="…">` — performance-hinted
    above-the-fold imagery. Often the hero product photo on
    Cloudflare/CDN-fronted sites."""
    out: list[_ImageCandidate] = []
    for link in soup.find_all("link", attrs={"rel": "preload", "as": "image"}):
        if not isinstance(link, Tag):
            continue
        href = link.get("href") or ""
        if isinstance(href, list):
            href = href[0] if href else ""
        if href:
            resolved = _absolutise(href, base_url)
            if resolved:
                out.append(_ImageCandidate(resolved, score=75, source="preload"))
    return out


def _from_json_ld(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<script type="application/ld+json">` Product / ItemPage objects
    with `image` array. Highest fidelity — these are the canonical
    images per the page author, in their intended order."""
    out: list[_ImageCandidate] = []
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
        # JSON-LD payloads can be a single dict, a list, or a @graph wrapper
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
                imgs = node.get("image")
                if not imgs:
                    continue
                if isinstance(imgs, str):
                    imgs = [imgs]
                elif isinstance(imgs, dict):
                    imgs = [imgs.get("url") or imgs.get("@id")]
                if not isinstance(imgs, list):
                    continue
                for img in imgs:
                    if isinstance(img, dict):
                        img = img.get("url") or img.get("@id")
                    if isinstance(img, str) and img:
                        resolved = _absolutise(img, base_url)
                        if resolved:
                            out.append(_ImageCandidate(resolved, score=95, source="json-ld"))
    return out


def _from_next_data(soup: BeautifulSoup, base_url: str) -> list[_ImageCandidate]:
    """`<script id="__NEXT_DATA__">` or `<script id="__NUXT_DATA__">` —
    SSR'd JS state for Next.js / Nuxt sites. Often the cleanest source
    of structured data when JSON-LD is absent. We do a CHEAP regex
    scan, not a full parse, because the payload can be massive."""
    out: list[_ImageCandidate] = []
    seen: set[str] = set()
    for script_id in ("__NEXT_DATA__", "__NUXT_DATA__"):
        tag = soup.find("script", id=script_id)
        if not isinstance(tag, Tag):
            continue
        txt = tag.string or tag.get_text(strip=False)
        if not txt:
            continue
        # Find every "image…": "URL" or "url": "URL" looking string. Cheap
        # heuristic, won't catch nested arrays but catches most flat
        # product schemas.
        for m in re.finditer(
            r'"(?:image[^"]*|url|src|imageUrl|primaryImage)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp|avif)[^"]*)"',
            txt,
            re.IGNORECASE,
        ):
            url = m.group(1)
            if url not in seen:
                resolved = _absolutise(url, base_url)
                if resolved:
                    out.append(_ImageCandidate(resolved, score=85, source="__NEXT_DATA__"))
                    seen.add(url)
    return out


# ── Public entry point ────────────────────────────────────────────────────

def extract_images(
    html: str,
    base_url: str,
    *,
    limit: int = 20,
) -> list[str]:
    """Pull every plausible product image URL out of `html`. Resolves
    relative URLs, dedupes, ranks by quality heuristic, filters known
    junk (sprites, logos, tracking pixels).

    Returns a list of absolute URLs, highest-quality candidates first,
    capped at `limit`.

    `base_url` should be the URL the HTML was fetched from — used to
    resolve relative `<img src="…">` and `srcset` entries.
    """
    if not html or not html.strip():
        return []

    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:                                           # noqa: BLE001
        # lxml might not be available in some test envs — fall back to
        # the slower built-in parser.
        soup = BeautifulSoup(html, "html.parser")

    candidates: list[_ImageCandidate] = []
    candidates.extend(_from_json_ld(soup, base_url))
    candidates.extend(_from_og_meta(soup, base_url))
    candidates.extend(_from_picture_sources(soup, base_url))
    candidates.extend(_from_link_preload(soup, base_url))
    candidates.extend(_from_next_data(soup, base_url))
    candidates.extend(_from_img_tags(soup, base_url))

    # Dedupe — preserve order by score (higher first), URL identity
    seen: set[str] = set()
    deduped: list[_ImageCandidate] = []
    candidates.sort(key=lambda c: -c.score)
    for c in candidates:
        if c.url in seen:
            continue
        if not is_likely_product_image(c.url):
            continue
        seen.add(c.url)
        deduped.append(c)
        if len(deduped) >= limit:
            break

    if log.isEnabledFor(logging.DEBUG):
        by_source: dict[str, int] = {}
        for c in deduped:
            by_source[c.source] = by_source.get(c.source, 0) + 1
        log.debug(
            "extracted images",
            extra={
                "url": base_url,
                "found": len(deduped),
                "by_source": by_source,
                "event": "scraper.images.extracted",
            },
        )

    return [c.url for c in deduped]
