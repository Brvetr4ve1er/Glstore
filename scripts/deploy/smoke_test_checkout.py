#!/usr/bin/env python3
"""
End-to-end checkout smoke test — the real proof store-scoped checkout works.

The 365-test unit suite under tests/ never opens a socket: every DB call is
mocked or run against an in-memory fixture, so it cannot catch a route that
crashes the instant it touches a real Postgres connection (the exact shape of
bug this plan found four times over — events, sync_queue, product_media and
observations all missing a NOT NULL store_id). This script is the missing
end-to-end check: it drives four real HTTP requests against a live API and a
live database, ending in an actual order insert.

    1. GET  /healthz                                    — process is up
    2. GET  /api/v1/products?page=1&page_size=1          — catalog resolves
    3. GET  /api/v1/products/{id}                        — offer resolves
    4. POST /api/v1/orders/create                        — order is placed

*** THIS SCRIPT CREATES A REAL ORDER IN WHATEVER DATABASE THE TARGET API IS
*** WIRED TO. Every successful run inserts one row into `orders`, `customers`
*** and `order_items`, and consumes real stock via an inventory reservation.
*** Point it at a test/staging deployment — never at production — unless you
*** are deliberately willing to leave a "Smoke Test" order in the ledger.

Usage:
    python scripts/deploy/smoke_test_checkout.py [base_url]
    python scripts/deploy/smoke_test_checkout.py [base_url] --store-host HOST

Base URL resolution order: the positional argument, then the GLSTORE_BASE_URL
environment variable, then http://localhost:8000.

`--store-host` sets the `Host` header on all four requests WITHOUT changing
where the TCP connection goes. That is how this proves ONE SPECIFIC BRAND on
a multi-brand deployment: the public API resolves the store from `Host` via
`store_domains` (api/core/store_context.py), so

    python scripts/deploy/smoke_test_checkout.py https://api.example.dz \\
        --store-host appliances.example.dz

drives checkout for the appliances brand — its catalog, its offers, and an
order numbered with its own prefix — against the same deployment. Without the
flag nothing changes: the Host header stays whatever the URL implies, exactly
as before.

Two things to know when using it: the hostname must exist in `store_domains`
for that store (add it with scripts/deploy/add_store.py), and in production
`ALLOWED_HOSTS` must admit it or TrustedHostMiddleware answers 400 before any
route runs.

Standard library only (argparse + urllib.request + json) — no pip install
required, so this runs unmodified on any box that has Python 3.

Exit code: 0 only if all four steps passed. 1 if any step failed (the
response body received is printed alongside the failing step) or if the
target could not be reached at all (connection refused, DNS failure, etc.).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

TIMEOUT_SECONDS = 15

# Host header override for every request, or None for urllib's default (the
# hostname in the URL). Set once by main() from --store-host; kept module-level
# so the four call sites below stay exactly as they were.
_STORE_HOST: str | None = None


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="End-to-end checkout smoke test against a live GLstore API.",
    )
    ap.add_argument("base_url", nargs="?", default="",
                    help="API base URL (default: $GLSTORE_BASE_URL, "
                         "then http://localhost:8000).")
    ap.add_argument("--store-host", default=None, metavar="HOST",
                    help="Send this as the Host header on every request so the "
                         "API resolves a specific brand's store. The connection "
                         "still goes to base_url.")
    return ap.parse_args()


def _base_url(cli_value: str = "") -> str:
    if cli_value.strip():
        return cli_value.rstrip("/")
    env = os.environ.get("GLSTORE_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    return "http://localhost:8000"


def _request(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any, str]:
    """Perform an HTTP request and return (status_code, parsed_json_or_None, raw_text).

    Never raises — connection failures, timeouts and non-2xx responses are all
    normalized into a return value so callers can print a clean FAIL line
    instead of an unhandled traceback."""
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if _STORE_HOST:
        # urllib only adds its own Host header when the request has none, so
        # this overrides routing at the application layer while the socket
        # still connects to the host in `url`.
        headers["Host"] = _STORE_HOST

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.getcode()
    except urllib.error.HTTPError as e:
        # A non-2xx response — the server responded, so we still have a body.
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        status = e.code
    except urllib.error.URLError as e:
        # Connection refused, DNS failure, timeout before any response, etc.
        return -1, None, f"connection error: {e.reason}"
    except OSError as e:
        # Belt-and-braces for platform-specific socket errors urllib doesn't wrap.
        return -1, None, f"connection error: {e}"

    parsed: Any = None
    try:
        parsed = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed = None
    return status, parsed, raw


def _fail(step: str, detail: str, body: str) -> None:
    print(f"FAIL [{step}] {detail}")
    print(f"     response body: {body[:2000]}")


def main() -> int:
    global _STORE_HOST
    args = _parse_args()
    if args.store_host and args.store_host.strip():
        _STORE_HOST = args.store_host.strip()

    base = _base_url(args.base_url)
    print(f"Checkout smoke test against: {base}")
    if _STORE_HOST:
        print(f"Host header (brand under test): {_STORE_HOST}")
    print("This will create a REAL order if all steps succeed. Ctrl+C now to abort.\n")

    # ── Step 1: liveness ────────────────────────────────────────────────
    status, _parsed, raw = _request("GET", f"{base}/healthz")
    if status != 200:
        _fail("1/4 healthz", f"expected HTTP 200, got {status}", raw)
        return 1
    print("PASS [1/4] GET /healthz -> 200")

    # ── Step 2: list products ───────────────────────────────────────────
    status, parsed, raw = _request(
        "GET", f"{base}/api/v1/products?page=1&page_size=1"
    )
    if status != 200:
        _fail("2/4 list products", f"expected HTTP 200, got {status}", raw)
        return 1
    items = (parsed or {}).get("items") if isinstance(parsed, dict) else None
    if not items:
        _fail("2/4 list products", "HTTP 200 but no items in response", raw)
        return 1
    product_id = items[0].get("id")
    if not product_id:
        _fail("2/4 list products", "first item has no 'id' field", raw)
        return 1
    print(f"PASS [2/4] GET /api/v1/products -> 200, first product id={product_id}")

    # ── Step 3: product detail -> first offer id ────────────────────────
    status, parsed, raw = _request("GET", f"{base}/api/v1/products/{product_id}")
    if status != 200:
        _fail("3/4 product detail", f"expected HTTP 200, got {status}", raw)
        return 1
    offers = (parsed or {}).get("offers") if isinstance(parsed, dict) else None
    if not offers:
        _fail("3/4 product detail", "HTTP 200 but no offers in response", raw)
        return 1
    offer_id = offers[0].get("id")
    if not offer_id:
        _fail("3/4 product detail", "first offer has no 'id' field", raw)
        return 1
    print(f"PASS [3/4] GET /api/v1/products/{product_id} -> 200, first offer id={offer_id}")

    # ── Step 4: place a real COD test order ─────────────────────────────
    order_payload = {
        "customer_name": "Smoke Test",
        "customer_phone": "0555000111",
        "items": [{"offer_id": offer_id, "quantity": 1}],
        "shipping_address": {
            "wilaya": "Alger",
            "commune": "Centre",
            "street": "1 rue test",
        },
        "payment_method": "COD",
    }
    status, parsed, raw = _request(
        "POST", f"{base}/api/v1/orders/create", body=order_payload
    )
    if status != 201:
        _fail("4/4 create order", f"expected HTTP 201, got {status}", raw)
        return 1
    order_number = (parsed or {}).get("order_number") if isinstance(parsed, dict) else None
    order_status = (parsed or {}).get("status") if isinstance(parsed, dict) else None
    if not order_number:
        _fail("4/4 create order", "HTTP 201 but no 'order_number' in response", raw)
        return 1
    print(f"PASS [4/4] POST /api/v1/orders/create -> 201, order_number={order_number}")

    print("\nAll steps passed. Store-scoped checkout works end to end.")
    if _STORE_HOST:
        # The prefix in order_number is the store's own `order_prefix`, so it
        # is the proof that the Host header selected the brand we asked for.
        print(f"brand:        {_STORE_HOST}")
    print(f"order_number: {order_number}")
    print(f"status:       {order_status}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nAborted by user.")
        sys.exit(1)
