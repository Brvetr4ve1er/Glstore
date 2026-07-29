"""
Per-retailer adapter framework — Phase 9 Push 9-A.

Public surface for the rest of the codebase:

    from api.services.scraper.retailers import (
        AdapterResult, RetailerAdapter,
        get_adapter_for_url, registered_adapters,
        extract_images,
    )

The ENGINE calls `get_adapter_for_url(url)` BEFORE invoking the generic
extractor cascade. If the classifier returns an adapter, the engine
uses its `extract()` method on the fetched HTML; if the result
`is_empty()`, the engine falls back to the generic cascade. If no
adapter matches, the engine goes straight to the generic cascade.
"""
from __future__ import annotations

from api.services.scraper.retailers.base import (
    AdapterResult,
    RetailerAdapter,
)
from api.services.scraper.retailers.classifier import (
    clear_registry,
    get_adapter_for_url,
    register_adapter,
    register_default_adapters,
    registered_adapters,
)
from api.services.scraper.retailers.images import (
    extract_images,
    is_likely_product_image,
)

# Register every default adapter at import time. Idempotent.
register_default_adapters()

__all__ = [
    "AdapterResult",
    "RetailerAdapter",
    "clear_registry",
    "extract_images",
    "get_adapter_for_url",
    "is_likely_product_image",
    "register_adapter",
    "register_default_adapters",
    "registered_adapters",
]
