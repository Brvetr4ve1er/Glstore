"""A signed-in customer's own orders (api/routes/customer_account.py).

The point of the endpoint is the Phase A follow-up: COD checkout filed one
phone under several customer rows depending on how it was typed. "My orders"
must cover all of them — and nothing from anyone else or another brand.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from tests.sqlscan import is_store_scoped, statements_touching

ROUTES = Path(__file__).resolve().parents[1] / "api" / "routes" / "customer_account.py"


@pytest.mark.parametrize("table", ["orders", "order_items", "customers"])
def test_every_account_query_is_scoped_to_the_store(table):
    stmts = statements_touching(ROUTES, table)
    assert stmts, f"no {table} SQL found"
    for sql in stmts:
        assert is_store_scoped(sql), sql[:200]


pytest.importorskip("sqlalchemy")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402

import tests.test_store_context  # noqa: E402,F401  (owns the api.core.db stub)

from api.core import store_context as sc  # noqa: E402
from api.routes import customer_account as acct  # noqa: E402
from api.routes import customer_auth as ca  # noqa: E402
from tests.fakedb import FakeSession, Result, Row  # noqa: E402

_A = sc.Store(id=UUID("11111111-1111-4111-8111-111111111111"), slug="brand-a", name="Brand A",
              status="ACTIVE", theme={}, order_prefix="AA", currency="DZD")
NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)
CUSTOMER_ID = uuid4()


@pytest.mark.parametrize("typed,expected", [
    ("+213555123456", {"0555123456", "213555123456", "555123456", "00213555123456"}),
    ("0555123456", {"0555123456", "213555123456", "555123456", "00213555123456"}),
    ("+33612345678", {"33612345678"}),
])
def test_my_phone_covers_every_way_checkout_could_have_filed_it(typed, expected):
    assert set(acct.phone_keys(typed)) == expected


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    async def by_host(db, host):
        return _A if host == "brand-a.dz" else None

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    sc.bind_store(None)
    yield
    sc.bind_store(None)


def _session_db(phone="+213555123456"):
    def lookup(params):
        if params["th"] == hashlib.sha256(b"tok").hexdigest() and params["sid"] == _A.id:
            return Result([Row(session_id=uuid4(), id=CUSTOMER_ID, phone=phone,
                               full_name="Amina", email=None, phone_verified_at=NOW)])
        return Result([])

    return FakeSession().on(r"FROM customer_sessions s", lookup)


async def _get(db, path, token="tok"):
    app = FastAPI()
    app.include_router(ca.router)
    app.include_router(acct.router)

    async def _fake_db():
        yield db

    for dep in {sc.get_db, ca.get_db, acct.get_db}:
        app.dependency_overrides[dep] = _fake_db
    sc.bind_store(None)
    headers = {"authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://brand-a.dz") as c:
        return await c.get(path, headers=headers)


async def test_orders_need_a_session():
    assert (await _get(FakeSession(), "/account/orders", token=None)).status_code == 401


async def test_my_orders_are_looked_up_under_every_legacy_key_in_this_store():
    db = _session_db()
    db.on(r"FROM orders o WHERE", Result([Row(id=uuid4(), order_number="AA-2026-000007", status="PENDING",
                                              total=D("45000.00"), currency="DZD", created_at=NOW, item_count=2)]))
    r = await _get(db, "/account/orders")
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["order_number"] == "AA-2026-000007"
    [q] = db.statements(r"FROM orders o WHERE")
    assert q["sid"] == _A.id
    assert set(q["keys"]) >= {"0555123456", "213555123456", "555123456"}


async def test_an_order_that_is_not_mine_is_a_404():
    db = _session_db()
    r = await _get(db, f"/account/orders/{uuid4()}")
    assert r.status_code == 404
