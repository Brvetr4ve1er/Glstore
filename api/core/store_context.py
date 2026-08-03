"""
Store resolution — the multi-store (superstore) boundary.

Every request belongs to exactly one store. This module resolves which one
from the `Host` header, binds it to a ContextVar so it flows through every
coroutine spawned during the request, and exposes FastAPI dependencies that
routes use to scope their queries.

    Host: glaive.example.dz  ──►  store_domains  ──►  Store(slug='glaive')
                                                          │
                                     ContextVar ◄─────────┘
                                          │
                    every query adds  WHERE store_id = :store_id

Security boundary — read this before using it on an admin route:
    Host is CLIENT-CONTROLLED. It is a routing signal, not an authorization
    signal. That is fine for public traffic: catalog data is public, and the
    header only decides which public catalog you get.

    Admin routes MUST NOT scope by Host. An operator's reachable stores come
    from their `admin_users.store_id` (NULL = platform operator, sees all).
    Use `require_store` for public routes only.

Three dependencies, three audiences:
    require_store            public only          Host
    require_admin_store_for  admin only           x-store-id (authorized)
    resolve_store            both (catalog reads) x-store-id when the caller
                             proves they are an admin, Host otherwise
"""
from __future__ import annotations

import logging
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db
from api.core.security import CurrentAdmin, get_current_admin

log = logging.getLogger("glstore.store")

_settings = get_settings()

# Slug of the store that absorbs traffic from unrecognised hostnames in
# development. Created by migration 005.
DEFAULT_STORE_SLUG = "default"

# Domain lookups hit the DB. Domains change only when an operator edits them,
# so a short TTL keeps this at roughly one query per minute per hostname
# instead of one per request.
_CACHE_TTL_SECONDS = 60.0


@dataclass(frozen=True, slots=True)
class Store:
    id: UUID
    slug: str
    name: str
    status: str
    theme: dict[str, Any]
    order_prefix: str
    currency: str


_store_var: ContextVar[Store | None] = ContextVar("gl_store", default=None)

# domain (lowercased, no port) -> (Store, expires_at_monotonic)
_domain_cache: dict[str, tuple[Store, float]] = {}


def bind_store(store: Store | None, request: Request | None = None) -> None:
    """Attach a store to the current async context, and to the request if given.

    Two homes for one fact, because neither alone reaches every reader:

      · the ContextVar flows DOWN — every coroutine spawned while handling the
        request sees it, which is what `emit_event()` and the loggers want.
      · it does not flow back UP. Starlette's `BaseHTTPMiddleware.call_next`
        runs the endpoint via `task_group.start_soon(coro)`, and spawning a
        task COPIES the context, so a `.set()` inside a dependency lands in a
        child context the middleware never sees. `bound_store()` in an HTTP
        middleware therefore always answers None.
      · `request.state` is backed by `scope["state"]`, one dict shared by every
        Request built from that scope — including the middleware's. So the
        response-header stamp in `api/main.py` reads it from there.

    `request` stays optional: workers and CLI paths bind a store outside any
    request and pass nothing.
    """
    _store_var.set(store)
    if request is not None:
        request.state.store = store


def bound_store() -> Store | None:
    """Whatever store is bound for this context, or None outside a request."""
    return _store_var.get()


def clear_domain_cache() -> None:
    """Drop the domain→store cache. Call after mutating stores or domains so
    an operator's change is visible immediately instead of up to a TTL later."""
    _domain_cache.clear()


def normalize_host(raw: str | None) -> str:
    """`GLAIVE.Example.dz:8000` -> `glaive.example.dz`.

    IPv6 literals arrive bracketed (`[::1]:8000`); strip the port only after
    the closing bracket so the address itself survives intact.
    """
    if not raw:
        return ""
    host = raw.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        if end != -1:
            return host[1:end]
        return host
    return host.split(":", 1)[0]


_STORE_SELECT = """
    SELECT s.id, s.slug, s.name, s.status::text AS status,
           s.theme, s.order_prefix, s.currency
    FROM stores s
"""


def _row_to_store(row: Any) -> Store:
    return Store(
        id=row.id,
        slug=row.slug,
        name=row.name,
        status=row.status,
        theme=row.theme or {},
        order_prefix=row.order_prefix,
        currency=row.currency,
    )


async def resolve_store_by_host(db: AsyncSession, host: str) -> Store | None:
    """Look up the store serving `host`. Cached for _CACHE_TTL_SECONDS.

    Suspended and archived stores resolve to None — an operator disabling a
    store must take it off the internet, not just hide it from listings.
    """
    if not host:
        return None

    cached = _domain_cache.get(host)
    if cached is not None:
        store, expires_at = cached
        if expires_at > time.monotonic():
            return store
        _domain_cache.pop(host, None)

    result = await db.execute(
        text(
            _STORE_SELECT
            + """
            JOIN store_domains d ON d.store_id = s.id
            WHERE d.domain = :host AND s.status = 'ACTIVE'
            """
        ),
        {"host": host},
    )
    row = result.first()
    if row is None:
        return None

    store = _row_to_store(row)
    _domain_cache[host] = (store, time.monotonic() + _CACHE_TTL_SECONDS)
    return store


async def resolve_default_store(db: AsyncSession) -> Store | None:
    """The fallback store used for unrecognised hosts in development."""
    result = await db.execute(
        text(_STORE_SELECT + " WHERE s.slug = :slug AND s.status = 'ACTIVE'"),
        {"slug": DEFAULT_STORE_SLUG},
    )
    row = result.first()
    return _row_to_store(row) if row is not None else None


async def require_store(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Store:
    """FastAPI dependency for PUBLIC routes. Resolves the store from Host.

    Unknown host is fatal in production — serving another brand's catalog
    because of a DNS typo is worse than a 404. In development it falls back
    to the default store so `curl localhost:8000` works with no DNS setup.
    """
    # The middleware resolves first; this is the common path.
    already = bound_store()
    if already is not None:
        # Re-bind so `request.state` cannot lag the ContextVar when the store
        # was resolved by an earlier dependency in this same request.
        bind_store(already, request)
        return already

    host = normalize_host(request.headers.get("host"))
    store = await resolve_store_by_host(db, host)

    # Fall back to the single default store when:
    #   · single_store_mode is on — a one-store deployment serving any host
    #     (e.g. a *.vercel.app subdomain that changes every deploy), OR
    #   · we are not in production — so `curl localhost:8000` works with no DNS.
    # In a real multi-store production deployment (single_store_mode off) an
    # unknown host stays fatal: serving the wrong brand's catalog on a DNS
    # typo is worse than a 404.
    if store is None and (_settings.single_store_mode or _settings.environment != "production"):
        store = await resolve_default_store(db)
        if store is not None and not _settings.single_store_mode:
            log.warning(
                "unrecognised host fell back to default store",
                extra={"host": host, "store_slug": store.slug},
            )

    if store is None:
        log.warning("no store for host", extra={"host": host})
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No store is configured for this address.",
        )

    bind_store(store, request)
    return store


async def current_store_id(store: Store = Depends(require_store)) -> UUID:
    """Sugar for routes that only need the id to filter a query."""
    return store.id


# ── Admin side ────────────────────────────────────────────────────────────
#
# Deliberately ignores Host. An operator's reachable stores come from their
# account, so a forged Host header cannot widen what they can read or write.

# Header an admin UI sets to say "I am currently working on this store".
STORE_HEADER = "x-store-id"


async def resolve_store_by_id(db: AsyncSession, store_id: UUID) -> Store | None:
    result = await db.execute(
        text(_STORE_SELECT + " WHERE s.id = :sid"),
        {"sid": store_id},
    )
    row = result.first()
    return _row_to_store(row) if row is not None else None


async def store_for_admin(request: Request, db: AsyncSession, admin: Any) -> Store:
    """The store an authenticated admin request acts on. One implementation,
    shared by `require_admin_store_for` and `resolve_store`, so a read and a
    write from the same admin can never disagree about who may touch what.

    Resolution:
      - Store-scoped operator  → their own store. An `x-store-id` naming a
        different store is a 403, not a silent override.
      - Platform operator      → must name the store via `x-store-id`. There
        is no implicit default: writing to the wrong brand's catalog because
        a header was missing is worse than an error.
    """
    raw = request.headers.get(STORE_HEADER)
    requested: UUID | None = None
    if raw:
        try:
            requested = UUID(raw.strip())
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Malformed {STORE_HEADER} header.",
            )

    if admin.store_id is not None:
        if requested is not None and requested != admin.store_id:
            log.warning(
                "admin tried to act on a store they are not assigned to",
                extra={
                    "admin_id": str(admin.id),
                    "assigned_store": str(admin.store_id),
                    "requested_store": str(requested),
                },
            )
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You do not have access to that store.",
            )
        target = admin.store_id
    else:
        if requested is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Platform operators must select a store via the "
                f"{STORE_HEADER} header.",
            )
        target = requested

    store = await resolve_store_by_id(db, target)
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")

    bind_store(store, request)
    return store


# ── Cross-store row guards ────────────────────────────────────────────────
#
# Some platform-level tables carry no store_id by design (migration 005:
# scrape_jobs, scrape_sources, competitor_prices, intel_jobs — "the scraper
# researches the *market*, not one store's catalog"). Their owning store is
# derived through product_id, so any route that accepts a caller-supplied
# product id must first prove that product belongs to the acting store.
#
# Cross-store access answers 404, never 403: confirming that a row exists in
# another brand's catalog is itself a leak.


async def _assert_product_in_store(db: AsyncSession, product_id: UUID, store_id) -> None:
    row = await db.execute(
        text("SELECT 1 FROM products WHERE id = :id AND store_id = :sid"),
        {"id": product_id, "sid": store_id},
    )
    if not row.first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")


def require_admin_store_for(admin_dep: Any):
    """Build a dependency that yields the store an admin request acts on.

    Authentication is mandatory here — `admin_dep` rejects the request before
    we ever look at the store header.
    """

    async def _dep(
        request: Request,
        db: AsyncSession = Depends(get_db),
        admin=Depends(admin_dep),
    ) -> Store:
        return await store_for_admin(request, db, admin)

    return _dep


# ── Dual-purpose reads ────────────────────────────────────────────────────
#
# `GET /products`, `GET /categories` and friends serve two callers: the
# anonymous storefront and the logged-in admin console. Before `resolve_store`
# they resolved by Host alone, so the admin browsed whichever brand its Host
# mapped to while every write it issued went to the store named in
# `x-store-id`. Reads and writes could point at different brands.


async def _optional_admin(request: Request) -> CurrentAdmin | None:
    """The admin behind this request, or None if there isn't a usable one.

    NEVER raises. `get_current_admin` answers a missing/expired/forged token
    with a 401, which is right for an admin-only route and wrong here: on a
    dual-purpose read an unusable token just means "anonymous". A customer
    with a stale token in localStorage must still be able to shop.
    """
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    try:
        return await get_current_admin(token=token.strip())
    except Exception:
        # Expired, forged, wrong type, malformed claims — all the same answer.
        log.debug("unusable bearer token on a dual-purpose read; treating as anonymous")
        return None


async def resolve_store(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Store:
    """FastAPI dependency for reads that BOTH the storefront and the admin call.

    Authentication is optional. An admin that proves who it is and names a
    store gets that store under the same authorization rules its writes obey;
    everyone else gets today's Host resolution, unchanged.
    """
    if request.headers.get(STORE_HEADER):
        admin = await _optional_admin(request)
        if admin is not None:
            return await store_for_admin(request, db, admin)

    return await require_store(request, db)
