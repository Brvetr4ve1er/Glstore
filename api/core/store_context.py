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


def bind_store(store: Store | None) -> None:
    """Attach a store to the current async context."""
    _store_var.set(store)


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

    bind_store(store)
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


def require_admin_store_for(admin_dep: Any):
    """Build a dependency that yields the store an admin request acts on.

    Resolution:
      - Store-scoped operator  → their own store. An `x-store-id` naming a
        different store is a 403, not a silent override.
      - Platform operator      → must name the store via `x-store-id`. There
        is no implicit default: writing to the wrong brand's catalog because
        a header was missing is worse than an error.
    """

    async def _dep(
        request: Request,
        db: AsyncSession = Depends(get_db),
        admin=Depends(admin_dep),
    ) -> Store:
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

        bind_store(store)
        return store

    return _dep
