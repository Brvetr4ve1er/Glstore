"""Tests for the retailer-adapter framework (Phase 9 Push 9-A).

Three layers under test:
  1. AdapterResult dataclass — shape + merge_from + is_empty + to_extracted
  2. classifier — register / dispatch / clear / error isolation
  3. images — srcset, data-src, og:image, picture, JSON-LD,
                  __NEXT_DATA__, lazy-load, sprite filtering, dedupe

The adapter implementations themselves (Ouedkniss, FB Marketplace,
Condor.dz, etc.) get their own files as they land in subsequent
sub-pushes — this file covers the framework.
"""
from __future__ import annotations

import re
import textwrap

import pytest

from api.services.scraper.retailers.base import (
    AdapterResult, RetailerAdapter,
)
from api.services.scraper.retailers.classifier import (
    clear_registry, get_adapter_for_url, register_adapter,
    registered_adapters,
)
from api.services.scraper.retailers.images import (
    extract_images, is_likely_product_image,
)


# ── Adapter test double ──────────────────────────────────────────────────

class _StubAdapter(RetailerAdapter):
    """Minimal adapter for classifier tests — no real extraction."""
    def __init__(self, name: str, patterns: list[str], result: AdapterResult | None = None,
                 raise_in_match: bool = False):
        self.name = name
        self.domain_patterns = [re.compile(p) for p in patterns]
        self._result = result or AdapterResult()
        self._raise_in_match = raise_in_match

    def matches(self, url: str) -> bool:
        if self._raise_in_match:
            raise RuntimeError("kaboom")
        return super().matches(url)

    async def extract(self, html: str, url: str) -> AdapterResult:
        return self._result


@pytest.fixture(autouse=True)
def _reset_registry():
    """Every test starts with an empty classifier registry. Production
    code's `register_default_adapters()` runs at module import; we
    deliberately wipe it here so registrations under test don't leak."""
    clear_registry()
    yield
    clear_registry()


# ── AdapterResult ────────────────────────────────────────────────────────

def test_adapter_result_default_is_empty():
    r = AdapterResult()
    assert r.is_empty()
    assert r.images == []
    assert r.raw_specs == {}
    assert r.confidence == 0.7


def test_adapter_result_not_empty_when_anything_filled():
    assert not AdapterResult(name="thing").is_empty()
    assert not AdapterResult(images=["http://x"]).is_empty()
    assert not AdapterResult(raw_specs={"k": 1}).is_empty()


def test_merge_from_fills_missing_only():
    a = AdapterResult(name="A only", brand=None)
    b = AdapterResult(name="B name", brand="B brand", description="bdesc")
    a.merge_from(b)
    assert a.name == "A only"        # already set, don't overwrite
    assert a.brand == "B brand"      # filled from other
    assert a.description == "bdesc"  # filled from other


def test_merge_from_unions_images_with_dedup():
    a = AdapterResult(images=["http://a.jpg", "http://shared.jpg"])
    b = AdapterResult(images=["http://shared.jpg", "http://b.jpg"])
    a.merge_from(b)
    assert a.images == ["http://a.jpg", "http://shared.jpg", "http://b.jpg"]


def test_merge_from_only_fills_missing_specs():
    a = AdapterResult(raw_specs={"power_w": 1400})
    b = AdapterResult(raw_specs={"power_w": 9999, "color": "red"})
    a.merge_from(b)
    assert a.raw_specs["power_w"] == 1400      # ours wins
    assert a.raw_specs["color"] == "red"       # filled from theirs


def test_to_extracted_round_trips_basic_fields():
    """The bridge to ExtractedData (engine's expected shape)."""
    from decimal import Decimal
    r = AdapterResult(
        name="Petrin MS 1400W",
        brand="MS",
        model="MS-SM8081",
        description="Mixer 1400W",
        price_dzd=Decimal("21900"),
        currency="DZD",
        in_stock=True,
        images=["http://cdn/p.jpg"],
        raw_specs={"power_w": 1400},
        confidence=0.9,
        adapter_name="ouedkniss",
    )
    e = r.to_extracted("http://example.com/p")
    assert e.title == "Petrin MS 1400W"
    assert e.price == Decimal("21900")
    assert e.currency == "DZD"
    assert e.availability == "in_stock"
    assert e.images == ["http://cdn/p.jpg"]
    assert e.specs == {"power_w": 1400}
    assert e.description == "Mixer 1400W"
    assert e.confidence == 0.9
    assert "adapter=ouedkniss" in e.notes


def test_to_extracted_falls_back_to_brand_model_when_no_name():
    r = AdapterResult(brand="Samsung", model="UE55", price_dzd=None)
    e = r.to_extracted("http://x")
    assert e.title == "Samsung UE55"


def test_to_extracted_marks_unknown_availability_when_in_stock_is_none():
    r = AdapterResult(name="x")
    e = r.to_extracted("http://x")
    assert e.availability == "unknown"


# ── classifier ───────────────────────────────────────────────────────────

def test_register_then_dispatch_returns_first_match():
    a = _StubAdapter("ouedkniss", [r"ouedkniss\.com"])
    register_adapter(a)
    found = get_adapter_for_url("https://www.ouedkniss.com/petrin-r")
    assert found is a


def test_dispatch_returns_none_for_unknown_url():
    register_adapter(_StubAdapter("ouedkniss", [r"ouedkniss\.com"]))
    assert get_adapter_for_url("https://random.com/x") is None


def test_dispatch_first_match_wins_over_later_registrations():
    """If you register a more-specific adapter FIRST, it wins. The
    classifier doesn't try to score 'most specific' — order matters."""
    a = _StubAdapter("specific", [r"foo\.example\.com/marketplace/"])
    b = _StubAdapter("generic",  [r"foo\.example\.com"])
    register_adapter(a)
    register_adapter(b)
    assert get_adapter_for_url("https://foo.example.com/marketplace/x").name == "specific"
    assert get_adapter_for_url("https://foo.example.com/other").name == "generic"


def test_register_rejects_adapter_without_name():
    bad = _StubAdapter("", [r"x"])
    with pytest.raises(ValueError):
        register_adapter(bad)


def test_register_rejects_adapter_without_patterns():
    bad = _StubAdapter("x", [])
    with pytest.raises(ValueError):
        register_adapter(bad)


def test_register_rejects_non_adapter_input():
    with pytest.raises(TypeError):
        register_adapter("not an adapter")  # type: ignore[arg-type]


def test_dispatch_isolates_a_crashing_adapter():
    """A buggy adapter mustn't take down the dispatcher — others
    should still get checked."""
    crasher = _StubAdapter("crash", [r"."], raise_in_match=True)
    healthy = _StubAdapter("good",  [r"good\.com"])
    register_adapter(crasher)
    register_adapter(healthy)
    assert get_adapter_for_url("https://good.com/x").name == "good"


def test_registered_adapters_returns_snapshot():
    a = _StubAdapter("a", [r"a"])
    b = _StubAdapter("b", [r"b"])
    register_adapter(a)
    register_adapter(b)
    snap = registered_adapters()
    snap.clear()
    # The internal registry isn't affected by mutations of the snapshot
    assert len(registered_adapters()) == 2


def test_dispatch_handles_none_and_empty_url():
    register_adapter(_StubAdapter("a", [r"."]))
    assert get_adapter_for_url("") is None
    assert get_adapter_for_url(None) is None  # type: ignore[arg-type]


# ── Image extraction ─────────────────────────────────────────────────────

def test_extract_images_from_plain_img_src():
    html = '<img src="/static/p.jpg">'
    out = extract_images(html, "https://shop.example.com/p")
    assert out == ["https://shop.example.com/static/p.jpg"]


def test_extract_images_resolves_protocol_relative():
    html = '<img src="//cdn.example.com/img.jpg">'
    out = extract_images(html, "https://shop.example.com/p")
    assert out == ["https://cdn.example.com/img.jpg"]


def test_extract_images_picks_largest_in_srcset():
    """Width descriptors (300w, 600w, 1200w) — pick the biggest."""
    html = """
    <img srcset="https://cdn/p-300.jpg 300w,
                 https://cdn/p-1200.jpg 1200w,
                 https://cdn/p-600.jpg 600w"
         src="https://cdn/fallback.jpg">
    """
    out = extract_images(html, "https://shop.example.com")
    # srcset wins over src; biggest entry wins inside srcset
    assert out[0] == "https://cdn/p-1200.jpg"


def test_extract_images_handles_lazy_load_data_src():
    """Lazy-load: the real URL lives in data-src; src is a placeholder."""
    html = """
    <img src="data:image/svg+xml;base64,placeholder"
         data-src="https://cdn/lazy.jpg">
    """
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/lazy.jpg" in out


def test_extract_images_picks_data_srcset_over_data_src():
    html = """
    <img src=""
         data-srcset="https://cdn/lazy-300.jpg 300w,
                      https://cdn/lazy-1200.jpg 1200w"
         data-src="https://cdn/lazy-fallback.jpg">
    """
    out = extract_images(html, "https://shop.example.com")
    assert out[0] == "https://cdn/lazy-1200.jpg"


def test_extract_images_picture_source():
    """<picture><source srcset="…"> — common for AVIF/WebP fallback."""
    html = """
    <picture>
        <source srcset="https://cdn/avif.avif" type="image/avif">
        <source srcset="https://cdn/webp.webp" type="image/webp">
        <img src="https://cdn/jpg.jpg">
    </picture>
    """
    out = extract_images(html, "https://shop.example.com")
    # All three should appear
    assert "https://cdn/avif.avif" in out
    assert "https://cdn/webp.webp" in out
    assert "https://cdn/jpg.jpg" in out


def test_extract_images_og_image_fallback():
    html = """
    <html><head>
      <meta property="og:image" content="https://cdn/social.jpg">
    </head><body></body></html>
    """
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/social.jpg" in out


def test_extract_images_json_ld_product():
    html = textwrap.dedent("""
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "X",
        "image": ["https://cdn/p1.jpg", "https://cdn/p2.jpg"]
      }
      </script>
    </head></html>
    """)
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/p1.jpg" in out
    assert "https://cdn/p2.jpg" in out


def test_extract_images_json_ld_image_as_object_with_url_field():
    html = textwrap.dedent("""
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "image": { "@type": "ImageObject", "url": "https://cdn/object.jpg" }
      }
      </script>
    </head></html>
    """)
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/object.jpg" in out


def test_extract_images_json_ld_with_at_graph_wrapper():
    html = textwrap.dedent("""
    <script type="application/ld+json">
    {"@context": "https://schema.org",
     "@graph": [
       {"@type": "WebPage"},
       {"@type": "Product", "image": "https://cdn/from-graph.jpg"}
     ]}
    </script>
    """)
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/from-graph.jpg" in out


def test_extract_images_next_data_payload():
    """Next.js / Nuxt SSR'd JSON state — common on modern e-com sites."""
    html = textwrap.dedent("""
    <script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"product":{
        "image": "https://cdn/next-hero.jpg",
        "imageUrl": "https://cdn/next-alt.png"
    }}}}
    </script>
    """)
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/next-hero.jpg" in out
    assert "https://cdn/next-alt.png" in out


def test_extract_images_link_preload_image():
    html = '<link rel="preload" as="image" href="https://cdn/preload-hero.jpg">'
    out = extract_images(html, "https://shop.example.com")
    assert "https://cdn/preload-hero.jpg" in out


def test_extract_images_filters_sprites_and_logos():
    html = """
    <img src="https://cdn/sprite.png">
    <img src="https://cdn/icon-cart.png">
    <img src="https://cdn/logo.svg">
    <img src="https://cdn/avatar.jpg">
    <img src="https://cdn/tracking-pixel.gif">
    <img src="https://cdn/legit-product.jpg">
    """
    out = extract_images(html, "https://shop.example.com")
    assert out == ["https://cdn/legit-product.jpg"]


def test_extract_images_filters_data_uri():
    html = '<img src="data:image/svg+xml;base64,abc"><img src="https://cdn/real.jpg">'
    out = extract_images(html, "https://shop.example.com")
    assert out == ["https://cdn/real.jpg"]


def test_extract_images_dedupes_across_sources():
    """Same URL appearing in og:image AND img tag should appear once."""
    html = textwrap.dedent("""
    <head><meta property="og:image" content="https://cdn/dup.jpg"></head>
    <body><img src="https://cdn/dup.jpg"><img src="https://cdn/unique.jpg"></body>
    """)
    out = extract_images(html, "https://shop.example.com")
    assert out.count("https://cdn/dup.jpg") == 1
    assert "https://cdn/unique.jpg" in out


def test_extract_images_respects_limit():
    imgs = "\n".join(f'<img src="https://cdn/p{i}.jpg">' for i in range(50))
    out = extract_images(imgs, "https://shop.example.com", limit=5)
    assert len(out) == 5


def test_extract_images_handles_empty_or_blank_html():
    assert extract_images("", "https://x") == []
    assert extract_images("   ", "https://x") == []
    assert extract_images("<html></html>", "https://x") == []


def test_extract_images_handles_malformed_json_ld():
    """Malformed JSON-LD shouldn't crash the whole extractor."""
    html = """
    <script type="application/ld+json">{ this is not json </script>
    <img src="https://cdn/real.jpg">
    """
    out = extract_images(html, "https://x")
    assert "https://cdn/real.jpg" in out


def test_extract_images_ranks_json_ld_above_plain_img():
    """JSON-LD images are the page author's canonical list — they
    should appear ABOVE plain <img> tags in the output."""
    html = textwrap.dedent("""
    <script type="application/ld+json">
      {"@type": "Product", "image": "https://cdn/canonical.jpg"}
    </script>
    <img src="https://cdn/incidental.jpg">
    """)
    out = extract_images(html, "https://x")
    assert out.index("https://cdn/canonical.jpg") < out.index("https://cdn/incidental.jpg")


# ── is_likely_product_image ──────────────────────────────────────────────

@pytest.mark.parametrize("url,expected", [
    # Definitely product
    ("https://cdn.example.com/products/123/main.jpg",   True),
    ("https://shop.com/img/items/abc.png",              True),
    ("https://store.com/uploads/2024/p.webp",           True),
    # Definitely junk
    ("https://cdn/sprite.png",                          False),
    ("https://cdn/logo.svg",                            False),
    ("https://shop.com/avatar.png",                     False),
    ("https://google.com/tracking-pixel.gif",           False),
    ("data:image/gif;base64,R0lGODlh",                  False),
    ("https://shop.com/favicon.ico",                    False),
    # Edge cases
    ("",                                                False),
    ("https://shop.com/",                               False),
    ("https://shop.com",                                False),
])
def test_is_likely_product_image(url, expected):
    assert is_likely_product_image(url) is expected
