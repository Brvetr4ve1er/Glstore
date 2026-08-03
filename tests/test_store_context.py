"""Tests for the multi-brand store-resolution boundary (api/core/store_context.py).

This is the seam that decides WHICH BRAND a request belongs to. Everything
downstream — the `WHERE store_id = :store_id` on the 12 tables migration 005
touched — trusts that answer. Four `NOT NULL store_id` crashes have already
shipped past a green suite because nothing in `tests/` imported a route, so
these tests deliberately drive REAL HTTP through the REAL dependencies over
`httpx.ASGITransport` instead of calling helpers in isolation.

Real, not mocked:
    · `api.core.store_context` — require_store, require_admin_store_for,
      resolve_store, store_for_admin, _optional_admin
    · `api.core.security` — token minting and `get_current_admin`, so
      "expired / forged / wrong-type token degrades to anonymous" is proved
      against real PyJWT rather than a stub that always answers None
    · FastAPI dependency resolution and the resulting HTTP status codes

Stubbed (no Postgres in CI):
    · `api.core.db` — swapped into `sys.modules` BEFORE anything imports it,
      because importing it for real calls `create_async_engine` at module
      scope. The session handed to the dependencies is a sentinel that
      raises on any attribute access, so a test that reaches the database
      fails loudly instead of silently.
    · the three SQL lookups — `resolve_store_by_host`, `resolve_store_by_id`,
      `resolve_default_store` — monkeypatched to dicts. Their SQL is not what
      is under test; the authorization logic wrapped around them is.

SKIPPING: `sqlalchemy` and `pyjwt` are both pinned in `requirements.txt` but
are routinely absent from the bare interpreter this suite runs in — that
absence is precisely why no other test here imports a route. When they are
missing this whole module skips with a reason rather than pretending to
pass. Run `pip install -r requirements.txt` to actually execute it.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

# ── Hard requirements ─────────────────────────────────────────────────────
# Imported before anything else so a bare interpreter skips the module with
# an explanation instead of erroring on collection.

pytest.importorskip(
    "sqlalchemy",
    reason="api.core.store_context imports sqlalchemy; "
           "run `pip install -r requirements.txt` to execute these tests",
)
jwt = pytest.importorskip(
    "jwt",
    reason="token degradation is proved against real PyJWT; "
           "run `pip install -r requirements.txt` to execute these tests",
)
httpx = pytest.importorskip(
    "httpx",
    reason="these tests drive real HTTP through the ASGI app",
)

from fastapi import Depends, FastAPI, Request  # noqa: E402  (deliberately after the skips)


# ── DB stub, installed before api.core.store_context is imported ──────────

class _NoDatabase:
    """The session the dependencies receive. Nothing should touch it."""

    def __getattr__(self, name: str):
        raise AssertionError(
            f"a test reached the database (session.{name}); the three SQL "
            f"helpers are supposed to be monkeypatched"
        )


_NO_DB = _NoDatabase()


def _install_db_stub() -> None:
    """`api.core.db` builds an async engine at import time. Replace it."""
    if "api.core.db" in sys.modules:
        return
    import api.core  # inert: empty __init__

    stub = types.ModuleType("api.core.db")

    async def get_db():
        yield _NO_DB

    stub.get_db = get_db
    sys.modules["api.core.db"] = stub
    api.core.db = stub  # type: ignore[attr-defined]


_install_db_stub()

from api.core import store_context as sc                      # noqa: E402
from api.core.config import get_settings                      # noqa: E402
from api.core.security import create_access_token, get_current_admin  # noqa: E402

_SETTINGS = get_settings()


# ── Fixture data: two brands owned by one person, plus the dev default ────

def _store(uuid_str: str, slug: str) -> "sc.Store":
    return sc.Store(
        id=UUID(uuid_str),
        slug=slug,
        name=slug.replace("-", " ").title(),
        status="ACTIVE",
        theme={},
        order_prefix=slug[:2].upper(),
        currency="DZD",
    )


_STORE_A = _store("11111111-1111-4111-8111-111111111111", "brand-a")
_STORE_B = _store("22222222-2222-4222-8222-222222222222", "brand-b")
_DEFAULT = _store("33333333-3333-4333-8333-333333333333", "default")

_UNKNOWN_STORE_ID = UUID("99999999-9999-4999-8999-999999999999")

_DOMAINS = {"brand-a.dz": _STORE_A, "brand-b.dz": _STORE_B}
_BY_ID = {s.id: s for s in (_STORE_A, _STORE_B, _DEFAULT)}


@pytest.fixture(autouse=True)
def _stub_store_lookups(monkeypatch):
    """Replace the three SQL helpers and reset the per-request state that
    `store_context` keeps in module globals (the domain cache) and in a
    ContextVar (the bound store, which survives between in-process ASGI
    calls and would otherwise short-circuit `require_store`)."""

    async def by_host(db, host):
        assert db is _NO_DB
        return _DOMAINS.get(host)

    async def by_id(db, store_id):
        assert db is _NO_DB
        return _BY_ID.get(store_id)

    async def default_store(db):
        assert db is _NO_DB
        return _DEFAULT

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    monkeypatch.setattr(sc, "resolve_store_by_id", by_id)
    monkeypatch.setattr(sc, "resolve_default_store", default_store)

    sc.clear_domain_cache()
    sc.bind_store(None)
    yield
    sc.bind_store(None)
    sc.clear_domain_cache()


# ── A minimal app exposing one route per dependency ───────────────────────

def _build_app() -> FastAPI:
    app = FastAPI()
    admin_store = sc.require_admin_store_for(get_current_admin)

    @app.get("/dual")
    async def _dual(store=Depends(sc.resolve_store)):
        """A catalog read: storefront AND admin console both call it."""
        return {"slug": store.slug, "id": str(store.id)}

    @app.get("/public")
    async def _public(store=Depends(sc.require_store)):
        """A customer-only route — checkout, cart re-validation, tracking."""
        return {"slug": store.slug, "id": str(store.id)}

    @app.get("/admin")
    async def _admin(store=Depends(admin_store)):
        """An admin write."""
        bound = sc.bound_store()
        return {
            "slug": store.slug,
            "id": str(store.id),
            "bound": bound.slug if bound else None,
        }

    return app


_APP = _build_app()


async def _get(path, *, host="brand-a.dz", token=None, store_id=None, authorization=None):
    headers = {}
    if authorization is not None:
        headers["authorization"] = authorization
    elif token is not None:
        headers["authorization"] = f"Bearer {token}"
    if store_id is not None:
        headers[sc.STORE_HEADER] = str(store_id)

    # The ContextVar is process-wide; unbind so every request starts cold.
    sc.bind_store(None)
    transport = httpx.ASGITransport(app=_APP)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://{host}") as client:
        return await client.get(path, headers=headers)


# ── Tokens ────────────────────────────────────────────────────────────────

_ADMIN_ID = uuid4()


def _token_for(store_id: UUID | None = None, role: str = "ADMIN") -> str:
    """A genuine token from the genuine minting path. `store_id=None` is a
    platform operator (admin_users.store_id IS NULL)."""
    extra = {"email": "op@glstore.dz"}
    if store_id is not None:
        extra["store_id"] = str(store_id)
    return create_access_token(subject=str(_ADMIN_ID), role=role, extra=extra)


def _raw_token(*, secret: str | None = None, **claims) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(_ADMIN_ID),
        "role": "ADMIN",
        "email": "op@glstore.dz",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=60)).timestamp()),
        "type": "access",
    }
    payload.update(claims)
    return jwt.encode(
        payload,
        secret if secret is not None else _SETTINGS.jwt_secret,
        algorithm=_SETTINGS.jwt_algorithm,
    )


def _expired_token() -> str:
    now = datetime.now(timezone.utc)
    return _raw_token(
        iat=int((now - timedelta(hours=2)).timestamp()),
        exp=int((now - timedelta(hours=1)).timestamp()),
    )


# label -> full Authorization header value. Every one of these is a token the
# server must refuse to believe.
_UNUSABLE_AUTH = [
    ("expired",         f"Bearer {_expired_token()}"),
    ("wrong-signature", f"Bearer {_raw_token(secret='not-the-servers-secret-' + 'x' * 32)}"),
    ("wrong-type",      f"Bearer {_raw_token(type='refresh')}"),
    ("malformed",       "Bearer not.a.jwt"),
    ("empty-bearer",    "Bearer "),
    ("wrong-scheme",    "Basic aGk6dGhlcmU="),
]
_UNUSABLE_IDS = [label for label, _ in _UNUSABLE_AUTH]


# ── normalize_host ────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("GLAIVE.Example.dz:8000", "glaive.example.dz"),
    ("brand-a.dz",             "brand-a.dz"),
    ("  Brand-A.DZ  ",         "brand-a.dz"),
    ("[::1]:8000",             "::1"),
    ("[::1]",                  "::1"),
    ("",                       ""),
    (None,                     ""),
])
def test_normalize_host(raw, expected):
    """Host is matched against `store_domains.domain` verbatim, so a port or
    a capital letter deciding which brand you get would be a real outage."""
    assert sc.normalize_host(raw) == expected


# ── Public path: Host, and only Host ──────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("host,expected_slug", [
    ("brand-a.dz", "brand-a"),
    ("brand-b.dz", "brand-b"),
])
async def test_anonymous_request_resolves_by_host(host, expected_slug):
    r = await _get("/dual", host=host)
    assert r.status_code == 200
    assert r.json()["slug"] == expected_slug


@pytest.mark.asyncio
async def test_anonymous_request_forging_the_store_header_gains_nothing():
    """A header is not proof of anything. Without a usable admin token,
    `resolve_store` must fall straight through to Host resolution — otherwise
    any customer could read any brand's catalog by typing a UUID."""
    r = await _get("/dual", host="brand-a.dz", store_id=_STORE_B.id)
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-a"


@pytest.mark.asyncio
async def test_customer_routes_ignore_the_store_header_even_with_a_valid_token():
    """`require_store` backs checkout, `/offers/availability` and order
    tracking. It is Host-only by design: an admin token in the browser must
    not silently move a customer's order into another brand."""
    r = await _get("/public", host="brand-a.dz", token=_token_for(), store_id=_STORE_B.id)
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-a"


@pytest.mark.asyncio
async def test_unknown_host_is_404_in_multi_brand_production(monkeypatch):
    """Serving another brand's catalog because of a DNS typo is worse than
    a 404."""
    monkeypatch.setattr(sc._settings, "environment", "production")
    monkeypatch.setattr(sc._settings, "single_store_mode", False)
    r = await _get("/dual", host="not-a-brand.dz")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unknown_host_falls_back_to_the_default_store_outside_production(monkeypatch):
    """So `curl localhost:8000` works with no DNS setup."""
    monkeypatch.setattr(sc._settings, "environment", "development")
    monkeypatch.setattr(sc._settings, "single_store_mode", False)
    r = await _get("/dual", host="not-a-brand.dz")
    assert r.status_code == 200
    assert r.json()["slug"] == "default"


@pytest.mark.asyncio
async def test_single_store_mode_serves_the_default_store_on_any_host(monkeypatch):
    """One brand on a *.vercel.app subdomain that changes every deploy."""
    monkeypatch.setattr(sc._settings, "environment", "production")
    monkeypatch.setattr(sc._settings, "single_store_mode", True)
    r = await _get("/dual", host="some-preview-deploy.vercel.app")
    assert r.status_code == 200
    assert r.json()["slug"] == "default"


# ── Admin path: x-store-id beats Host ─────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_store_header_wins_over_host_on_a_dual_purpose_read():
    """The bug this dependency exists to fix: before `resolve_store`, an
    admin sitting on brand-a.dz read brand A while every write it issued
    went to the store named in `x-store-id`."""
    r = await _get("/dual", host="brand-a.dz", token=_token_for(), store_id=_STORE_B.id)
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-b"


@pytest.mark.asyncio
async def test_scoped_operator_reads_their_own_store_regardless_of_host():
    r = await _get(
        "/dual", host="brand-b.dz",
        token=_token_for(_STORE_A.id), store_id=_STORE_A.id,
    )
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-a"


@pytest.mark.asyncio
async def test_admin_resolved_store_is_the_one_bound_to_the_context():
    """Downstream queries read the ContextVar, not the return value."""
    r = await _get("/admin", host="brand-a.dz", token=_token_for(), store_id=_STORE_B.id)
    assert r.status_code == 200
    assert r.json()["bound"] == "brand-b"


# ── Authorization rules — identical for a read and a write ────────────────
#
# `resolve_store` and `require_admin_store_for` both delegate to
# `store_for_admin`. Parametrising over both routes is what keeps that true:
# a read that allows what a write refuses is a cross-brand leak.

@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/dual", "/admin"])
async def test_scoped_operator_naming_a_different_store_is_403(path):
    r = await _get(
        path, host="brand-a.dz",
        token=_token_for(_STORE_A.id), store_id=_STORE_B.id,
    )
    assert r.status_code == 403
    # Terminal — it must not quietly fall back to Host resolution.
    assert "access" in r.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/dual", "/admin"])
async def test_unknown_store_id_is_404(path):
    r = await _get(path, host="brand-a.dz", token=_token_for(), store_id=_UNKNOWN_STORE_ID)
    assert r.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/dual", "/admin"])
async def test_malformed_store_header_is_400(path):
    r = await _get(path, host="brand-a.dz", token=_token_for(), store_id="not-a-uuid")
    assert r.status_code == 400
    assert sc.STORE_HEADER in r.json()["detail"]


@pytest.mark.asyncio
async def test_platform_operator_without_a_store_header_is_400_on_an_admin_route():
    """No implicit default: writing to the wrong brand's catalog because a
    header was missing is worse than an error."""
    r = await _get("/admin", host="brand-a.dz", token=_token_for())
    assert r.status_code == 400
    assert sc.STORE_HEADER in r.json()["detail"]


@pytest.mark.asyncio
async def test_platform_operator_without_a_store_header_still_reads_by_host():
    """`resolve_store` only enters the admin path when the header is present,
    so an operator browsing the public storefront is not met with a 400."""
    r = await _get("/dual", host="brand-b.dz", token=_token_for())
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-b"


@pytest.mark.asyncio
async def test_scoped_operator_without_a_store_header_is_not_403_on_a_write():
    """Their account already names the store; the header is redundant."""
    r = await _get("/admin", host="brand-b.dz", token=_token_for(_STORE_A.id))
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-a"


# ── Unusable tokens ───────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("label,authorization", _UNUSABLE_AUTH, ids=_UNUSABLE_IDS)
async def test_unusable_token_is_treated_as_anonymous_never_401(label, authorization):
    """A customer with a stale admin token in localStorage must still be able
    to shop. `_optional_admin` answers every failure mode with None, and the
    request then resolves by Host like any other anonymous one — which also
    means the `x-store-id` it carries buys it nothing."""
    r = await _get(
        "/dual", host="brand-a.dz",
        authorization=authorization, store_id=_STORE_B.id,
    )
    assert r.status_code == 200, f"{label}: expected Host fallback, got {r.status_code}"
    assert r.json()["slug"] == "brand-a", f"{label}: must not honour the forged header"


@pytest.mark.asyncio
@pytest.mark.parametrize("label,authorization", _UNUSABLE_AUTH, ids=_UNUSABLE_IDS)
async def test_unusable_token_is_still_401_on_an_admin_route(label, authorization):
    """The permissive read path must not have loosened the write path."""
    r = await _get(
        "/admin", host="brand-a.dz",
        authorization=authorization, store_id=_STORE_B.id,
    )
    assert r.status_code == 401, f"{label}: admin routes must still reject it"


@pytest.mark.asyncio
async def test_admin_route_without_any_token_is_401():
    r = await _get("/admin", host="brand-a.dz", store_id=_STORE_B.id)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_anonymous_request_never_pays_for_token_decoding(monkeypatch):
    """`resolve_store` checks the store header first, so public traffic never
    enters `_optional_admin` at all. Guards the hot path for the storefront,
    which sends no `x-store-id`."""
    called = False

    async def tripwire(request):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(sc, "_optional_admin", tripwire)
    r = await _get("/dual", host="brand-a.dz")
    assert r.status_code == 200
    assert called is False


# ── Store visibility: the `x-store` response header ───────────────────────
#
# The header answers "which brand served this request?" from the response
# alone. It shipped broken: `api/main.py` read `bound_store()` after
# `call_next`, and Starlette's BaseHTTPMiddleware runs the endpoint via
# `task_group.start_soon(coro)` — spawning a task COPIES the context, so a
# ContextVar set inside a dependency lands in a child context the middleware
# never sees. The header therefore never fired, for any route, ever.
#
# `bind_store()` now also stashes the store on `request.state`, which is
# backed by `scope["state"]` — one dict shared with the middleware's own
# Request. These tests pin BOTH halves: that the new read works for all
# three dependencies, and that the old one still would not, so nobody
# "simplifies" it back.


def _build_stamped_app() -> FastAPI:
    """`_build_app()` behind the same header stamp `api/main.py` applies."""
    app = _build_app()

    @app.get("/unscoped")
    async def _unscoped():
        """No store dependency — the /healthz case."""
        return {"ok": True}

    @app.middleware("http")
    async def _stamp(request: Request, call_next):
        response = await call_next(request)
        # Verbatim from api/main.py.
        served_by = getattr(request.state, "store", None)
        if served_by is not None:
            response.headers["x-store"] = served_by.slug
        # The read that used to be there, kept as a live counter-example.
        via_contextvar = sc.bound_store()
        if via_contextvar is not None:
            response.headers["x-store-via-contextvar"] = via_contextvar.slug
        return response

    return app


_STAMPED_APP = _build_stamped_app()


async def _get_stamped(path, *, host="brand-a.dz", token=None, store_id=None):
    headers = {}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    if store_id is not None:
        headers[sc.STORE_HEADER] = str(store_id)

    sc.bind_store(None)
    transport = httpx.ASGITransport(app=_STAMPED_APP)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://{host}") as client:
        return await client.get(path, headers=headers)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "dependency,path,kwargs,expected",
    [
        ("require_store", "/public", {"host": "brand-a.dz"}, "brand-a"),
        ("resolve_store (anonymous)", "/dual", {"host": "brand-b.dz"}, "brand-b"),
        (
            "resolve_store (admin)",
            "/dual",
            {"host": "brand-a.dz", "store_id": _STORE_B.id},
            "brand-b",
        ),
        (
            "require_admin_store_for",
            "/admin",
            {"host": "brand-a.dz", "store_id": _STORE_B.id},
            "brand-b",
        ),
    ],
    ids=["require_store", "resolve_store_anon", "resolve_store_admin", "admin_store"],
)
async def test_x_store_header_fires_for_every_store_dependency(
    dependency, path, kwargs, expected
):
    """All three dependencies must stamp the header — a fix that only covered
    the public path would leave the admin console just as blind as before."""
    if "store_id" in kwargs:
        kwargs["token"] = _token_for(_STORE_B.id)
    r = await _get_stamped(path, **kwargs)
    assert r.status_code == 200, dependency
    assert r.headers.get("x-store") == expected, (
        f"{dependency}: expected x-store={expected!r}, "
        f"got {r.headers.get('x-store')!r}"
    )


@pytest.mark.asyncio
async def test_x_store_header_reports_the_serving_store_not_the_host():
    """The admin console reaches brand-a's hostname while acting on brand-b.
    The header must name the store whose data came back, or it is worse than
    useless — it would confirm the wrong brand."""
    r = await _get_stamped(
        "/admin", host="brand-a.dz",
        token=_token_for(_STORE_B.id), store_id=_STORE_B.id,
    )
    assert r.status_code == 200
    assert r.json()["slug"] == "brand-b"
    assert r.headers.get("x-store") == "brand-b"


@pytest.mark.asyncio
async def test_x_store_header_is_absent_on_an_unscoped_route():
    """/healthz, /docs and friends belong to no brand; claiming one would be
    a lie the operator then debugs against."""
    r = await _get_stamped("/unscoped")
    assert r.status_code == 200
    assert "x-store" not in r.headers


@pytest.mark.asyncio
async def test_x_store_header_exposes_the_default_store_fallback():
    """Outside production an unrecognised host quietly falls back to the
    `default` store. That fallback is exactly the "why am I seeing the wrong
    catalog?" case the header exists to answer, so it must name `default`
    rather than the brand the operator thought they were on."""
    r = await _get_stamped("/public", host="nobody.dz")
    assert r.status_code == 200
    assert r.json()["slug"] == "default"
    assert r.headers.get("x-store") == "default"


@pytest.mark.asyncio
async def test_context_var_alone_never_reaches_the_middleware():
    """Why `request.state` and not `bound_store()`. If this ever starts
    passing, Starlette changed how `call_next` spawns the endpoint and the
    simpler read becomes available again — until then it is dead code."""
    r = await _get_stamped("/public", host="brand-a.dz")
    assert r.status_code == 200
    assert r.headers.get("x-store") == "brand-a"
    assert "x-store-via-contextvar" not in r.headers, (
        "a ContextVar set in a dependency now propagates back to the "
        "middleware; api/main.py could read bound_store() again"
    )


@pytest.mark.asyncio
async def test_bind_store_without_a_request_still_binds_the_context_var():
    """Workers and CLI paths call `bind_store(store)` with no request. That
    must keep working — `emit_event()` reads `bound_store()` as a fallback."""
    sc.bind_store(_STORE_A)
    assert sc.bound_store() is _STORE_A
    sc.bind_store(None)
    assert sc.bound_store() is None
