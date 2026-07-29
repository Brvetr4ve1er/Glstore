"""Tests for the Ouedkniss adapter (Phase 9 Push 9-B).

Three extraction tiers under test:
  1. JSON-LD path (highest confidence) — when ouedkniss serves
     `<script type="application/ld+json">{Product}</script>`
  2. __NUXT_DATA__ path — Nuxt SSR'd JS state when JSON-LD is absent
  3. CSS heuristic — defensive fallback for redesigned PDPs

Plus the supporting machinery:
  - DZD price normalisation (handles "21 900 DA", non-breaking spaces,
    "Prix sur demande", etc.)
  - Wilaya detection (48 provinces, ASCII-folded)
  - Condition mapping (neuf → new, occasion → used, …)
  - URL classifier dispatch (/path → adapter)

We use realistic but synthetic HTML — actual Ouedkniss listings are
copyright + their HTML is too volatile to ship as test fixtures.
"""
from __future__ import annotations

import textwrap
from decimal import Decimal

import pytest

from api.services.scraper.retailers import (
    AdapterResult,
    clear_registry,
    get_adapter_for_url,
    register_default_adapters,
)
from api.services.scraper.retailers.ouedkniss import (
    OuedknissAdapter,
    _detect_condition,
    _detect_wilaya,
    _parse_dzd,
)


@pytest.fixture(autouse=True)
def _registry_with_ouedkniss():
    """Each test starts with a clean registry containing only the
    default-loaded adapters (Ouedkniss is the only one in 9-B)."""
    clear_registry()
    register_default_adapters()
    yield
    clear_registry()


# ── DZD price normalisation ─────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("21 900 DA",                Decimal("21900")),    # NBSP thousand
    ("21 900 DA",                Decimal("21900")),    # narrow NBSP
    ("21 900 DA",                Decimal("21900")),    # ASCII space
    ("21,900 DA",                Decimal("21900")),    # comma thousand
    ("21900 DA",                 Decimal("21900")),    # no separator
    ("1.500.000 DA",             Decimal("1500000")),  # dot thousand
    ("DZD 45000",                Decimal("45000")),    # currency prefix
    ("Prix : 21900",             Decimal("21900")),    # label noise
    ("8 500,00 DA",              Decimal("850000")),   # comma decimal — we treat as thousand (whole DZD only)
])
def test_parse_dzd_extracts_numeric_price(text, expected):
    price, _ = _parse_dzd(text)
    assert price == expected


@pytest.mark.parametrize("text", [
    "Prix sur demande",
    "PRIX SUR DEMANDE",
    "À débattre",
    "Negotiable",
    "Contactez le vendeur",
    "non précisé",
])
def test_parse_dzd_returns_none_for_no_price_sentinels(text):
    price, label = _parse_dzd(text)
    assert price is None
    assert label is not None


def test_parse_dzd_handles_empty_or_garbage():
    assert _parse_dzd(None) == (None, None)
    assert _parse_dzd("") == (None, None)
    assert _parse_dzd("   ") == (None, None)


# ── Wilaya detection ────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("Localisation : Alger - Centre",                   "Alger"),
    ("Wilaya: Tizi Ouzou",                               "Tizi Ouzou"),
    ("Annaba, à débattre",                               "Annaba"),
    ("Béjaïa centre",                                    "Béjaïa"),
    ("BÉJAÏA",                                           "Béjaïa"),     # ASCII-folded match
    ("BEJAIA",                                           "Béjaïa"),     # diacritic-stripped input
    ("Sidi Bel Abbès",                                   "Sidi Bel Abbès"),
])
def test_detect_wilaya_recognises_all_48(text, expected):
    assert _detect_wilaya(text) == expected


def test_detect_wilaya_returns_none_for_no_match():
    assert _detect_wilaya("This text has no Algerian province") is None
    assert _detect_wilaya("") is None
    assert _detect_wilaya(None) is None


# ── Condition mapping ───────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("État : Neuf",                  "new"),
    ("Occasion - bon état",          "used"),
    ("Reconditionné par le vendeur", "refurbished"),
    ("Reconditionnée",               "refurbished"),
    ("Déballé jamais utilisé",       "open_box"),
    ("vendeur Particulier",          "private"),
    ("Pro vérifié",                  "professional"),
])
def test_detect_condition_maps_french_to_canonical(text, expected):
    assert _detect_condition(text) == expected


def test_detect_condition_returns_none_for_no_match():
    assert _detect_condition("Hello world") is None
    assert _detect_condition("") is None


# ── Classifier dispatch ─────────────────────────────────────────────────

@pytest.mark.parametrize("url,should_match", [
    ("https://www.ouedkniss.com/petrin-r-21900",         True),
    ("https://ouedkniss.com/annonces/electromenager/x",   True),
    ("https://m.ouedkniss.com/listing/123",                True),
    ("http://www.OUEDKNISS.com/x",                          True),    # case-insensitive
    ("https://jumia.dz/mixer-d-12345.html",                 False),
    ("https://www.condor.dz/tv-55-pouces",                  False),
    ("https://random.com/ouedkniss-redirect",               False),    # path mention only, no host match
])
def test_classifier_dispatches_ouedkniss_urls(url, should_match):
    a = get_adapter_for_url(url)
    if should_match:
        assert a is not None
        assert a.name == "ouedkniss"
    else:
        assert a is None or a.name != "ouedkniss"


def test_ouedkniss_requires_stealth_for_engine_escalation():
    """Engine reads `requires_stealth` to decide whether to escalate
    fetcher tier before invoking the adapter."""
    a = get_adapter_for_url("https://www.ouedkniss.com/x")
    assert a is not None
    assert a.requires_stealth is True


# ── JSON-LD extraction path (highest confidence) ────────────────────────

JSON_LD_HTML = textwrap.dedent("""\
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "PETRIN MS 1400W ROUGE",
        "description": "Mixeur planétaire 1400W avec bol inox 6L.",
        "brand": { "@type": "Brand", "name": "MS" },
        "category": "Cuisine / Mixeurs",
        "image": [
          "https://cdn.ouedkniss.com/img/p1.jpg",
          "https://cdn.ouedkniss.com/img/p2.jpg"
        ],
        "offers": {
          "@type": "Offer",
          "price": "21900",
          "priceCurrency": "DZD",
          "availability": "https://schema.org/InStock"
        }
      }
      </script>
    </head><body><h1>PETRIN MS 1400W ROUGE</h1>
    <p>Padding so we pass the min_html_size check. """ + ("Lorem ipsum " * 200) + """</p>
    </body></html>
""")


@pytest.mark.asyncio
async def test_json_ld_path_extracts_clean_product_data():
    a = OuedknissAdapter()
    r = await a.extract(JSON_LD_HTML, "https://www.ouedkniss.com/petrin")
    assert r.name == "PETRIN MS 1400W ROUGE"
    assert r.brand == "MS"
    assert r.category == "Cuisine / Mixeurs"
    assert r.description and "1400W" in r.description
    assert r.price_dzd == Decimal("21900")
    assert r.in_stock is True
    assert r.confidence >= 0.9
    assert r.currency == "DZD"
    assert "https://cdn.ouedkniss.com/img/p1.jpg" in r.images


@pytest.mark.asyncio
async def test_json_ld_path_handles_missing_optional_fields():
    """Listing without brand, category, availability still produces
    a usable result."""
    minimal = textwrap.dedent("""\
        <html><head>
          <script type="application/ld+json">
          {"@type": "Product", "name": "Bare item",
           "offers": {"price": "1000", "priceCurrency": "DZD"}}
          </script>
        </head><body>""" + ("a" * 5000) + """</body></html>
    """)
    a = OuedknissAdapter()
    r = await a.extract(minimal, "https://www.ouedkniss.com/x")
    assert r.name == "Bare item"
    assert r.price_dzd == Decimal("1000")
    assert r.brand is None
    assert r.category is None
    assert r.in_stock is None       # availability missing → unknown


@pytest.mark.asyncio
async def test_json_ld_out_of_stock_detected():
    html = textwrap.dedent("""\
        <html><head>
          <script type="application/ld+json">
          {"@type": "Product", "name": "Sold",
           "offers": {"price": "500", "availability": "https://schema.org/OutOfStock"}}
          </script>
        </head><body>""" + ("a" * 5000) + """</body></html>
    """)
    a = OuedknissAdapter()
    r = await a.extract(html, "https://www.ouedkniss.com/x")
    assert r.in_stock is False


# ── __NUXT_DATA__ path (mid-tier confidence) ────────────────────────────

NUXT_ONLY_HTML = textwrap.dedent("""\
    <html><body>
      <h1>Page rendered without JSON-LD</h1>
      <p>""" + ("body padding " * 500) + """</p>
      <script id="__NUXT_DATA__" type="application/json">
        {"props": {"pageProps": {"announce": {
          "title": "Climatiseur LG Inverter 18000 BTU",
          "price": 89500,
          "description": "Climatiseur Inverter neuf, garantie 2 ans.",
          "city_name": "Alger",
          "condition": "Neuf"
        }}}}
      </script>
    </body></html>
""")


@pytest.mark.asyncio
async def test_nuxt_data_extracts_when_json_ld_absent():
    a = OuedknissAdapter()
    r = await a.extract(NUXT_ONLY_HTML, "https://www.ouedkniss.com/x")
    assert r.name == "Climatiseur LG Inverter 18000 BTU"
    assert r.price_dzd == Decimal("89500")
    assert "Inverter" in (r.description or "")
    assert r.source_metadata.get("wilaya") == "Alger"
    assert r.source_metadata.get("condition") == "new"
    # Mid-tier confidence — somewhere around 0.78
    assert 0.55 < r.confidence <= 0.85


@pytest.mark.asyncio
async def test_nuxt_data_resilient_to_missing_keys():
    """If the payload only has title, the adapter still returns a usable
    result without crashing on the missing price/desc/city regexes."""
    html = textwrap.dedent("""\
        <html><body><h1>x</h1><p>""" + ("a" * 5000) + """</p>
          <script id="__NUXT_DATA__">{"props":{"a":{"title":"Just a title here"}}}</script>
        </body></html>
    """)
    a = OuedknissAdapter()
    r = await a.extract(html, "https://www.ouedkniss.com/x")
    assert r.name == "Just a title here"
    assert r.price_dzd is None


# ── CSS heuristic path (lowest confidence, defensive) ───────────────────

CSS_ONLY_HTML = textwrap.dedent("""\
    <html><body>
      <main>
        <h1>Réfrigérateur Samsung 350L No Frost</h1>
        <div class="meta">
          <span>Localisation : Oran</span>
          <span>État : Occasion</span>
        </div>
        <article class="description">
          Réfrigérateur Samsung 350 litres No Frost en très bon état,
          utilisé 2 ans, livré avec garantie restante du fabricant.
          """ + ("Détails techniques. " * 30) + """
        </article>
        <div class="price-block">
          <span class="price">75 000 DA</span>
        </div>
      </main>
    </body></html>
""")


@pytest.mark.asyncio
async def test_css_path_when_json_ld_and_nuxt_absent():
    a = OuedknissAdapter()
    r = await a.extract(CSS_ONLY_HTML, "https://www.ouedkniss.com/x")
    assert r.name == "Réfrigérateur Samsung 350L No Frost"
    assert r.price_dzd == Decimal("75000")
    assert r.description and "Samsung 350 litres" in r.description
    assert r.source_metadata.get("wilaya") == "Oran"
    assert r.source_metadata.get("condition") == "used"
    # Lowest confidence
    assert r.confidence < 0.7


# ── CAPTCHA / tiny page guard ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_returns_empty_result_on_tiny_html_likely_captcha():
    """A < 4 KB page is almost always a Cloudflare CAPTCHA — we don't
    pretend to extract from it."""
    a = OuedknissAdapter()
    r = await a.extract("<html><body>cf-challenge</body></html>", "https://www.ouedkniss.com/x")
    assert r.is_empty()


@pytest.mark.asyncio
async def test_returns_empty_result_on_blank_html():
    a = OuedknissAdapter()
    assert (await a.extract("", "https://x")).is_empty()
    assert (await a.extract(None, "https://x")).is_empty()    # type: ignore[arg-type]


# ── Always-on image extraction ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_images_always_extracted_even_in_css_path():
    """Multi-source image extractor runs unconditionally — even when
    the adapter falls all the way to CSS heuristics."""
    html = CSS_ONLY_HTML.replace(
        "</main>",
        '<img src="https://cdn.ouedkniss.com/listings/r1.jpg">'
        '<img srcset="https://cdn.ouedkniss.com/listings/r2-300w.jpg 300w, '
                     'https://cdn.ouedkniss.com/listings/r2-1200w.jpg 1200w">'
        '</main>',
    )
    a = OuedknissAdapter()
    r = await a.extract(html, "https://www.ouedkniss.com/x")
    assert "https://cdn.ouedkniss.com/listings/r1.jpg" in r.images
    # srcset → picks largest width
    assert "https://cdn.ouedkniss.com/listings/r2-1200w.jpg" in r.images


# ── Cascade merge: JSON-LD wins, but Nuxt fills gaps ────────────────────

CASCADE_HTML = textwrap.dedent("""\
    <html><head>
      <script type="application/ld+json">
      {"@type": "Product", "name": "JSON-LD title",
       "offers": {"price": "5000"}}
      </script>
    </head><body><h1>Different CSS title</h1>
      <p>""" + ("desc " * 500) + """</p>
      <script id="__NUXT_DATA__">{"props":{"a":{
        "title": "Nuxt title (should be ignored)",
        "city_name": "Constantine",
        "condition": "Occasion"
      }}}</script>
    </body></html>
""")


@pytest.mark.asyncio
async def test_cascade_keeps_json_ld_fields_but_fills_gaps_from_nuxt_and_css():
    a = OuedknissAdapter()
    r = await a.extract(CASCADE_HTML, "https://www.ouedkniss.com/x")
    # JSON-LD wins for fields it provided
    assert r.name == "JSON-LD title"
    assert r.price_dzd == Decimal("5000")
    # NUXT fills gaps (wilaya, condition not in JSON-LD)
    assert r.source_metadata.get("wilaya") == "Constantine"
    assert r.source_metadata.get("condition") == "used"
    # JSON-LD path → high confidence preserved
    assert r.confidence >= 0.85
