"""
Scraper package.

The package is intentionally **light at import time**. The DB-coupled
`ScraperEngine` lives in `api.services.scraper.engine` and must be imported
explicitly by the caller. This keeps pure-function tests on
`types`, `validators`, `extractors`, `utils` independent of SQLAlchemy.

    from api.services.scraper.engine import ScraperEngine        # full engine
    from api.services.scraper.types  import ExtractedData         # pure types
    from api.services.scraper.validators.normalization import parse_price
"""
from api.services.scraper.types import ExtractedData, ScrapeOutcome, SourceTier

__all__ = ["ExtractedData", "ScrapeOutcome", "SourceTier"]
