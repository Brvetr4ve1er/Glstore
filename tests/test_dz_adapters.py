"""Tests for the remaining DZ retailer adapters (Phases 9-C / 9-D / 9-E).

One test file covers Facebook Marketplace, Condor.dz, and the mid-tier
bundle (Carrefour/Yassir/Cosmos/Numidis) because they share the same
shape: 2-tier extraction, JSON-LD primary path, CSS heuristic fallback,
multi-source images.

Where each adapter has a CHARACTER trait we test for it specifically:
    · FB Marketplace: login-wall detection (returns is_empty), 0.55 cap
    · Condor.dz: brand always set to "Condor" regardless of input
    · Mid-tier: source_metadata.source carries the per-retailer slug
"""
from __future__ import annotations

import textwrap
from decimal import Decimal

import pytest

from api.services.scraper.retailers import (
    clear_registry, get_adapter_for_url, register_default_adapters,
)
from api.services.scraper.retailers.condor   import CondorAdapter
from api.services.scraper.retailers.facebook import FacebookMarketplaceAdapter
from api.services.scraper.retailers.midtier  import MidTierDZAdapter, _which_retailer


@pytest.fixture(autouse=True)
def _registry_with_all_adapters():
    clear_registry()
    register_default_adapters()
    yield
    clear_registry()


# ───────────────────────────────────────────────────────────────────────
# Facebook Marketplace
# ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,should_match", [
    ("https://www.facebook.com/marketplace/item/1234567890",            True),
    ("https://m.facebook.com/marketplace/item/9999",                     True),
    ("https://web.facebook.com/marketplace/item/x",                      True),
    ("https://www.facebook.com/share/AbCdEfGhIj",                        True),
    ("https://facebook.com/marketplace/algiers/electronics",             True),
    ("https://www.facebook.com/somepage",                                False),  # not /marketplace
    ("https://twitter.com/marketplace",                                  False),
])
def test_fb_classifier_matches_marketplace_urls_only(url, should_match):
    a = get_adapter_for_url(url)
    if should_match:
        assert a is not None
        assert a.name == "facebook_marketplace"
    else:
        assert a is None or a.name != "facebook_marketplace"


def test_fb_marketplace_documents_login_constraint():
    """Engine reads `requires_login` to know FB needs manual URL entry."""
    a = FacebookMarketplaceAdapter()
    assert a.requires_login is True
    # Stealth would be wasted on FB — they detect at TLS+behaviour level
    assert a.requires_stealth is False


@pytest.mark.asyncio
async def test_fb_login_wall_returns_empty_with_note():
    """Unauth response is FB's generic login wall → adapter returns
    empty result so engine falls through to manual-entry path."""
    login_wall = "<html><body>" + ("Log into Facebook to continue " * 200) + "</body></html>"
    a = FacebookMarketplaceAdapter()
    r = await a.extract(login_wall, "https://www.facebook.com/marketplace/item/123")
    assert r.is_empty()
    assert r.source_metadata.get("note") == "facebook_login_wall"


FB_PUBLIC_HTML = textwrap.dedent("""\
    <html><head>
      <meta property="og:type" content="product">
      <meta property="og:title" content="Samsung 55-inch QLED TV — Like New">
      <meta property="og:description" content="Used Samsung QLED in mint condition, full warranty remaining.">
      <meta property="og:image" content="https://scontent.fdz1-1.fna.fbcdn.net/img/p1.jpg">
      <meta property="og:price:amount" content="125000">
      <meta property="og:price:currency" content="DZD">
      <meta property="og:locale" content="fr_DZ">
    </head><body>""" + ("a" * 5000) + """</body></html>
""")


@pytest.mark.asyncio
async def test_fb_extracts_from_public_og_meta():
    a = FacebookMarketplaceAdapter()
    r = await a.extract(FB_PUBLIC_HTML, "https://www.facebook.com/marketplace/item/123")
    assert r.name == "Samsung 55-inch QLED TV — Like New"
    assert r.description and "QLED" in r.description
    assert r.price_dzd == Decimal("125000")
    assert "https://scontent.fdz1-1.fna.fbcdn.net/img/p1.jpg" in r.images
    assert r.source_metadata.get("locale") == "fr_DZ"


@pytest.mark.asyncio
async def test_fb_caps_confidence_at_0_55():
    """We can't verify FB data without auth → confidence must NEVER
    exceed 0.55, even when every meta tag is populated."""
    a = FacebookMarketplaceAdapter()
    r = await a.extract(FB_PUBLIC_HTML, "https://www.facebook.com/marketplace/item/123")
    assert r.confidence <= 0.55


@pytest.mark.asyncio
async def test_fb_handles_non_dzd_currency():
    """If the listing's currency is EUR/USD, we capture it but don't
    populate price_dzd (downstream LLM merge handles conversion)."""
    eur_html = FB_PUBLIC_HTML.replace(
        '<meta property="og:price:currency" content="DZD">',
        '<meta property="og:price:currency" content="EUR">',
    )
    a = FacebookMarketplaceAdapter()
    r = await a.extract(eur_html, "https://www.facebook.com/marketplace/item/123")
    assert r.currency == "EUR"
    assert r.price_dzd is None     # not auto-converted
    assert r.source_metadata.get("price_currency_unconverted") == "EUR"


# ───────────────────────────────────────────────────────────────────────
# Condor.dz
# ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,should_match", [
    ("https://www.condor.dz/televiseurs/55-pouces",      True),
    ("https://condor.dz/refrigerateur",                  True),
    ("http://www.CONDOR.dz/x",                            True),
    ("https://www.condor.fr/x",                           False),  # not .dz
    ("https://condor-electronics.dz/x",                   False),  # not the .dz host
])
def test_condor_classifier(url, should_match):
    a = get_adapter_for_url(url)
    if should_match:
        assert a is not None and a.name == "condor_dz"
    else:
        assert a is None or a.name != "condor_dz"


CONDOR_JSON_LD_HTML = textwrap.dedent("""\
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "TV LED Smart Condor 55\\" 4K UHD",
        "description": "Téléviseur 55 pouces 4K avec Android TV intégré.",
        "sku": "CN-LED55-4K",
        "mpn": "LED55ULM",
        "offers": {
          "@type": "Offer",
          "price": "89900",
          "priceCurrency": "DZD",
          "availability": "https://schema.org/InStock"
        }
      }
      </script>
    </head><body>""" + ("a" * 4000) + """</body></html>
""")


@pytest.mark.asyncio
async def test_condor_json_ld_path():
    a = CondorAdapter()
    r = await a.extract(CONDOR_JSON_LD_HTML, "https://www.condor.dz/tv-led-55")
    assert r.name and "55" in r.name
    assert r.brand == "Condor"           # always Condor, regardless of source
    assert r.model == "LED55ULM"
    assert r.price_dzd == Decimal("89900")
    assert r.in_stock is True
    assert r.confidence >= 0.85


@pytest.mark.asyncio
async def test_condor_brand_is_always_condor_even_if_jsonld_says_otherwise():
    """Vendor stores sometimes ship template-default brand strings.
    For Condor.dz we KNOW everything is Condor-branded, so we override."""
    misbranded = CONDOR_JSON_LD_HTML.replace(
        '"name": "TV LED Smart Condor 55',
        '"brand": "Wrong Brand", "name": "TV LED Smart Condor 55',
    )
    a = CondorAdapter()
    r = await a.extract(misbranded, "https://www.condor.dz/x")
    assert r.brand == "Condor"


CONDOR_CSS_ONLY_HTML = textwrap.dedent("""\
    <html><body>
      <main>
        <h1>Réfrigérateur Condor No Frost 350L</h1>
        <span class="price-current">75 000 DA</span>
        <div class="product-description">
          Réfrigérateur Condor 350 litres No Frost, garantie 2 ans.
          """ + ("Caractéristiques techniques. " * 30) + """
        </div>
        <table class="specifications">
          <tr><th>Capacité</th><td>350L</td></tr>
          <tr><th>Couleur</th><td>Inox</td></tr>
          <tr><th>Énergie</th><td>A++</td></tr>
        </table>
      </main>
    </body></html>
""")


@pytest.mark.asyncio
async def test_condor_css_path_when_no_json_ld():
    a = CondorAdapter()
    r = await a.extract(CONDOR_CSS_ONLY_HTML, "https://www.condor.dz/refrigerateur")
    assert r.name and "Réfrigérateur" in r.name
    assert r.brand == "Condor"
    assert r.price_dzd == Decimal("75000")
    assert r.description and "350 litres" in r.description
    assert r.raw_specs.get("Capacité") == "350L"
    assert r.raw_specs.get("Couleur") == "Inox"
    assert r.confidence < 0.8       # CSS path lower confidence


@pytest.mark.asyncio
async def test_condor_dl_dt_dd_specs_format():
    """PrestaShop-style <dl><dt>K</dt><dd>V</dd></dl> spec format."""
    html = textwrap.dedent("""\
        <html><body><h1>Lave-linge Condor 8kg</h1>
          <span class="price">42500 DA</span>
          <dl class="product-attributes">
            <dt>Capacité</dt><dd>8 kg</dd>
            <dt>Vitesse essorage</dt><dd>1200 RPM</dd>
            <dt>Classe énergétique</dt><dd>A++</dd>
          </dl>
        """ + ("padding " * 500) + """
        </body></html>
    """)
    a = CondorAdapter()
    r = await a.extract(html, "https://condor.dz/lave-linge")
    assert r.raw_specs.get("Capacité") == "8 kg"
    assert r.raw_specs.get("Vitesse essorage") == "1200 RPM"


# ───────────────────────────────────────────────────────────────────────
# Mid-tier bundle
# ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,expected_slug", [
    ("https://carrefour.dz/produit/x",                "carrefour_dz"),
    ("https://www.carrefour.dz/produit/x",            "carrefour_dz"),
    ("https://yassirmall.com/p/123",                  "yassir_mall"),
    ("https://www.yassirmall.com/p/123",              "yassir_mall"),
    ("https://cosmos.dz/tv",                          "cosmos_dz"),
    ("https://numidis.com/electronique/123",          "numidis"),
    ("https://random.dz/x",                           None),
])
def test_midtier_classifier_routes_correctly(url, expected_slug):
    a = get_adapter_for_url(url)
    if expected_slug is not None:
        assert a is not None
        assert a.name == "midtier_dz"
        assert _which_retailer(url) == expected_slug
    else:
        assert a is None or a.name != "midtier_dz"


MIDTIER_JSON_LD_HTML = textwrap.dedent("""\
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Cafetière Philips HD7461",
        "description": "Cafetière filtre 1000W avec verseuse 1.2L.",
        "brand": { "@type": "Brand", "name": "Philips" },
        "category": "Petit Électroménager / Cafetières",
        "mpn": "HD7461/20",
        "offers": {
          "@type": "Offer",
          "price": "8500",
          "priceCurrency": "DZD",
          "availability": "https://schema.org/InStock"
        }
      }
      </script>
    </head><body>""" + ("a" * 4000) + """</body></html>
""")


@pytest.mark.asyncio
async def test_midtier_json_ld_path_carrefour():
    a = MidTierDZAdapter()
    r = await a.extract(MIDTIER_JSON_LD_HTML, "https://www.carrefour.dz/p/cafetiere")
    assert r.name == "Cafetière Philips HD7461"
    assert r.brand == "Philips"
    assert r.category == "Petit Électroménager / Cafetières"
    assert r.model == "HD7461/20"
    assert r.price_dzd == Decimal("8500")
    assert r.in_stock is True
    assert r.source_metadata.get("source") == "carrefour_dz"


@pytest.mark.asyncio
async def test_midtier_source_metadata_tracks_retailer_per_url():
    """Same adapter, different URLs → different `source_metadata.source`."""
    a = MidTierDZAdapter()
    r1 = await a.extract(MIDTIER_JSON_LD_HTML, "https://yassirmall.com/p/123")
    assert r1.source_metadata.get("source") == "yassir_mall"

    r2 = await a.extract(MIDTIER_JSON_LD_HTML, "https://cosmos.dz/p/abc")
    assert r2.source_metadata.get("source") == "cosmos_dz"

    r3 = await a.extract(MIDTIER_JSON_LD_HTML, "https://numidis.com/electronique/x")
    assert r3.source_metadata.get("source") == "numidis"


MIDTIER_CSS_ONLY_HTML = textwrap.dedent("""\
    <html><body>
      <h1>Téléviseur Samsung 65" Crystal UHD</h1>
      <a class="product-brand">Samsung</a>
      <span itemprop="price" content="155000">155 000 DA</span>
      <div id="description">
        Téléviseur Samsung 65 pouces Crystal UHD 4K.
        """ + ("Détails. " * 100) + """
      </div>
      <ul class="product-features">
        <li><span class="name">Diagonale</span><span class="value">65"</span></li>
        <li><span class="name">Résolution</span><span class="value">4K UHD</span></li>
      </ul>
    </body></html>
""")


@pytest.mark.asyncio
async def test_midtier_css_path_extracts_full_data():
    a = MidTierDZAdapter()
    r = await a.extract(MIDTIER_CSS_ONLY_HTML, "https://yassirmall.com/p/samsung-tv")
    assert r.name and "65" in r.name
    assert r.brand == "Samsung"
    assert r.price_dzd == Decimal("155000")
    assert r.description and "Crystal UHD" in r.description
    assert r.raw_specs.get("Diagonale") == '65"'
    assert r.raw_specs.get("Résolution") == "4K UHD"
    assert r.source_metadata.get("source") == "yassir_mall"


@pytest.mark.asyncio
async def test_midtier_itemprop_price_attribute_extraction():
    """Schema.org microdata: <span itemprop=price content=N> — value
    in the attribute, not the text node."""
    html = textwrap.dedent("""\
        <html><body><h1>X</h1>
          <span itemprop="price" content="42000"></span>
        """ + ("a" * 5000) + """
        </body></html>
    """)
    a = MidTierDZAdapter()
    r = await a.extract(html, "https://www.carrefour.dz/p/x")
    assert r.price_dzd == Decimal("42000")


# ───────────────────────────────────────────────────────────────────────
# Cross-adapter sanity — all 4 register and dispatch independently
# ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,expected_adapter", [
    ("https://www.ouedkniss.com/petrin-r",                      "ouedkniss"),
    ("https://www.facebook.com/marketplace/item/123",            "facebook_marketplace"),
    ("https://www.condor.dz/refrigerateur",                      "condor_dz"),
    ("https://carrefour.dz/p/x",                                  "midtier_dz"),
    ("https://yassirmall.com/p/123",                              "midtier_dz"),
    ("https://cosmos.dz/tv",                                      "midtier_dz"),
    ("https://numidis.com/x",                                     "midtier_dz"),
])
def test_classifier_dispatches_each_adapter_for_its_domain(url, expected_adapter):
    a = get_adapter_for_url(url)
    assert a is not None, f"no adapter matched {url!r}"
    assert a.name == expected_adapter, f"{url!r} dispatched to {a.name!r}, expected {expected_adapter!r}"


def test_all_adapters_load():
    """Sanity: register_default_adapters() registers all expected adapters.

    Updated from 4 → 6 when jumia_dz and batolis_com were migrated from
    the old extractors/ system to the retailers/ adapter framework.
    """
    from api.services.scraper.retailers import registered_adapters
    names = {a.name for a in registered_adapters()}
    assert names == {
        "ouedkniss",
        "facebook_marketplace",
        "jumia_dz",
        "condor_dz",
        "batolis_com",
        "midtier_dz",
    }
