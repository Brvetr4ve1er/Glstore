"""Tests for the scraper's generic extractor.
Requires: beautifulsoup4 + lxml (already in requirements)."""
from decimal import Decimal

import pytest

from api.services.scraper.extractors import generic


JSON_LD_HTML = """<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product",
 "name":"Samsung Galaxy A54 5G","brand":{"@type":"Brand","name":"Samsung"},
 "sku":"SM-A546B","image":["https://example.com/p.jpg"],
 "offers":{"@type":"Offer","price":"42999","priceCurrency":"DZD",
           "availability":"https://schema.org/InStock"}}
</script></head><body><h1>fallback</h1></body></html>"""


OG_HTML = """<html><head>
<meta property="og:title" content="Frigo Hisense 350L" />
<meta property="og:image" content="https://example.com/h.jpg" />
<meta property="product:price:amount" content="58 900" />
<meta property="product:price:currency" content="DZD" />
<meta property="product:availability" content="in stock" />
</head><body></body></html>"""


CSS_HTML = """<html><body>
<h1>TV LG 55 Smart UHD</h1>
<div class="product-price"><span class="price">93.000 DA</span></div>
</body></html>"""


def _has_lxml() -> bool:
    try:
        import lxml  # noqa: F401
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _has_lxml(), reason="lxml not installed")


def test_jsonld_winning_pass():
    ed = generic.extract(JSON_LD_HTML, "https://example.com/p")
    assert ed.title == "Samsung Galaxy A54 5G"
    assert ed.price == Decimal("42999")
    assert ed.currency == "DZD"
    assert ed.availability == "in_stock"
    assert ed.method == "json_ld"
    assert ed.confidence >= 0.9
    assert "https://example.com/p.jpg" in ed.images


def test_jsonld_extracts_brand_and_sku():
    ed = generic.extract(JSON_LD_HTML, "https://example.com/p")
    assert ed.specs.get("brand") == "Samsung"
    assert ed.specs.get("sku") == "SM-A546B"


def test_opengraph_pass():
    ed = generic.extract(OG_HTML, "https://example.com/og")
    assert ed.title == "Frigo Hisense 350L"
    assert ed.price == Decimal("58900")
    assert ed.currency == "DZD"
    assert ed.availability == "in_stock"
    assert ed.method == "opengraph"


def test_css_heuristic_dz_price():
    """The DZD '93.000 DA' edge case must end up as 93000."""
    ed = generic.extract(CSS_HTML, "https://example.com/css")
    assert ed.title and "TV LG" in ed.title
    assert ed.price == Decimal("93000")
    assert ed.currency == "DZD"
    assert ed.method == "css_heuristic"


def test_no_price_returns_low_confidence():
    html = "<html><body><h1>Just a title</h1></body></html>"
    ed = generic.extract(html, "https://example.com/x")
    assert ed.price is None
    assert ed.confidence < 0.5


def test_empty_html_safe():
    ed = generic.extract("", "https://example.com/x")
    assert ed.confidence == 0.0
    assert ed.price is None
