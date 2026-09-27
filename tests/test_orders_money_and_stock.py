"""Two ways a COD order could go wrong with money or stock (audit 2026-09-27,
§2.1 and §2.2), driven over HTTP against a scripted session.

  · The client never sets a price component. Discount and shipping are the
    server's: a shopper who posts `discount_amount == subtotal` must still owe
    the subtotal.
  · Confirming an order re-checks the hold. A reservation expires after
    RESERVATION_TTL_MINUTES; the operator confirms by phone hours later. The
    confirm must re-reserve what was released and consume it — or refuse
    with 409 when the stock is gone — never mark the order CONFIRMED with
    nothing taken from the shelf.
  · The order detail says what happened to the hold, so the operator can see
    "released" before they ring the customer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal as D
from uuid import UUID, uuid4

import pytest

pytest.importorskip("sqlalchemy")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402
from sqlalchemy.exc import DBAPIError  # noqa: E402

import tests.test_store_context  # noqa: E402,F401  (owns the api.core.db stub)

from api.core import store_context as sc  # noqa: E402
from api.core.security import create_access_token  # noqa: E402
from api.routes import orders as orders_route  # noqa: E402
from tests.fakedb import FakeSession, Result, Row  # noqa: E402

_A = sc.Store(id=UUID("11111111-1111-4111-8111-111111111111"), slug="brand-a", name="Brand A",
              status="ACTIVE", theme={}, order_prefix="AA", currency="DZD")
NOW = datetime(2026, 9, 27, 10, 0, tzinfo=timezone.utc)
ORDER_ID, ITEM_ID, OFFER_ID, PRODUCT_ID, OLD_RES, NEW_RES, ADMIN_ID = (uuid4() for _ in range(7))


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    async def by_host(db, host):
        return _A if host == "brand-a.dz" else None

    async def by_id(db, store_id):
        return _A if store_id == _A.id else None

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    monkeypatch.setattr(sc, "resolve_store_by_id", by_id)
    sc.bind_store(None)
    yield
    sc.bind_store(None)


def _admin(role="ADMIN"):
    return create_access_token(subject=str(ADMIN_ID), role=role,
                               extra={"email": "op@amantcom.dz", "store_id": str(_A.id)})


async def _call(db, method, path, *, json_body=None, token=None):
    app = FastAPI()
    app.include_router(orders_route.router)

    async def _fake_db():
        yield db

    for dep in {sc.get_db, orders_route.get_db}:
        app.dependency_overrides[dep] = _fake_db
    headers = {"authorization": f"Bearer {token}"} if token else {}
    sc.bind_store(None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://brand-a.dz") as c:
        return await c.request(method, path, json=json_body, headers=headers)


def _order_row(status="RESERVED", total="45000.00"):
    return Row(id=ORDER_ID, order_number="AA-2026-000001", status=status, payment_status="UNPAID",
               payment_method="COD", subtotal=D("45000.00"), shipping_cost=D("0"), discount_amount=D("0"),
               tax_amount=D("0"), total=D(total), currency="DZD", created_at=NOW)


def _item_row():
    return Row(id=ITEM_ID, offer_id=OFFER_ID, product_id=PRODUCT_ID, product_name="Lave-linge 8 kg",
               variant_sku="LL-8", unit_price=D("45000.00"), quantity=1, line_total=D("45000.00"))


# ── §2.1 The client never sets a price component ──────────────────────────

def _checkout_db():
    db = FakeSession()
    db.on(r"FROM offers o JOIN products p", Result([Row(
        id=OFFER_ID, product_id=PRODUCT_ID, variant_sku="LL-8", unit_price=D("45000.00"),
        currency="DZD", is_active=True, product_name="Lave-linge 8 kg")]))
    db.on(r"FROM orders WHERE id = :id", Result([_order_row()]))
    db.on(r"FROM order_items WHERE order_id", Result([_item_row()]))
    return db


def _checkout_body(**extra):
    body = {
        "customer_phone": "0555123456", "customer_name": "Amina B.",
        "items": [{"offer_id": str(OFFER_ID), "quantity": 1}],
        "shipping_address": {"wilaya": "Alger", "commune": "Bab Ezzouar", "street": "Cité 5 Juillet"},
    }
    body.update(extra)
    return body


async def test_a_client_supplied_discount_never_reaches_the_order():
    db = _checkout_db()
    r = await _call(db, "POST", "/orders/create", json_body=_checkout_body(discount_amount="45000.00"))
    assert r.status_code == 201, r.text
    [ins] = db.statements(r"INSERT INTO orders")
    assert ins["disc"] == D("0")
    assert ins["tot"] == D("45000.00")


async def test_a_client_supplied_shipping_cost_never_reaches_the_order():
    db = _checkout_db()
    r = await _call(db, "POST", "/orders/create", json_body=_checkout_body(shipping_cost="999.00"))
    assert r.status_code == 201, r.text
    [ins] = db.statements(r"INSERT INTO orders")
    assert ins["ship"] == D("0")
    assert ins["tot"] == D("45000.00")


# ── §2.2 Confirming re-checks the hold ────────────────────────────────────

def _confirm_db(hold_active: bool, reserve=None):
    """A RESERVED order with one line of 2; its hold is still ACTIVE or has
    expired (no ACTIVE row left to lock)."""
    db = FakeSession()
    db.on(r"SELECT status FROM orders WHERE id = :id AND store_id = :sid FOR UPDATE",
          Result([Row(status="RESERVED")]))
    db.on(r"FROM inventory_reservations WHERE order_id = :o AND status = 'ACTIVE' FOR UPDATE",
          Result([Row(id=OLD_RES, order_item_id=ITEM_ID)] if hold_active else []))
    db.on(r"SELECT id, offer_id, quantity FROM order_items WHERE order_id = :o AND store_id = :sid",
          Result([Row(id=ITEM_ID, offer_id=OFFER_ID, quantity=2)]))
    db.on(r"fn_reserve_stock", reserve or Result(scalar=NEW_RES))
    db.on(r"FROM orders WHERE id = :id", Result([_order_row(status="CONFIRMED")]))
    db.on(r"FROM order_items WHERE order_id", Result([_item_row()]))
    return db


async def test_confirm_re_reserves_an_expired_hold_and_consumes_the_new_one():
    db = _confirm_db(hold_active=False)
    r = await _call(db, "POST", f"/orders/{ORDER_ID}/confirm", token=_admin())
    assert r.status_code == 200, r.text
    [reserve] = db.statements(r"fn_reserve_stock")
    assert (reserve["offer"], reserve["order"], reserve["item"], reserve["qty"]) == (OFFER_ID, ORDER_ID, ITEM_ID, 2)
    [consume] = db.statements(r"fn_consume_reservation")
    assert consume["r"] == NEW_RES
    assert db.sql(r"UPDATE orders SET status = 'CONFIRMED'")


async def test_confirm_consumes_an_active_hold_without_re_reserving():
    db = _confirm_db(hold_active=True)
    r = await _call(db, "POST", f"/orders/{ORDER_ID}/confirm", token=_admin())
    assert r.status_code == 200, r.text
    assert db.statements(r"fn_reserve_stock") == []
    [consume] = db.statements(r"fn_consume_reservation")
    assert consume["r"] == OLD_RES


async def test_confirm_refuses_when_the_released_stock_is_gone():
    def sold_out(params):
        raise DBAPIError("SELECT fn_reserve_stock", params,
                         Exception("reserve_stock: insufficient stock (have 0, need 2)"))

    db = _confirm_db(hold_active=False, reserve=sold_out)
    r = await _call(db, "POST", f"/orders/{ORDER_ID}/confirm", token=_admin())
    assert r.status_code == 409, r.text
    assert "stock" in r.json()["detail"].lower()
    assert db.sql(r"UPDATE orders SET status = 'CONFIRMED'") == []
    assert db.statements(r"fn_consume_reservation") == []


# ── The detail says what happened to the hold ─────────────────────────────

@pytest.mark.parametrize("holds,expected", [
    ([("ACTIVE", 1)], "held"),
    ([("CONSUMED", 2)], "consumed"),
    ([("EXPIRED", 1)], "released"),
    ([("ACTIVE", 1), ("EXPIRED", 1)], "released"),
    ([("CONSUMED", 1), ("EXPIRED", 1)], "consumed"),   # re-reserved at confirm; the expiry is history
    ([], None),
])
async def test_order_detail_reports_the_stock_hold(holds, expected):
    db = FakeSession()
    db.on(r"FROM orders WHERE id = :id", Result([_order_row()]))
    db.on(r"FROM order_items WHERE order_id", Result([_item_row()]))
    db.on(r"FROM inventory_reservations WHERE order_id = :id GROUP BY status",
          Result([Row(status=s, n=n) for s, n in holds]))
    r = await _call(db, "GET", f"/orders/{ORDER_ID}", token=_admin("VIEWER"))
    assert r.status_code == 200, r.text
    assert r.json()["stock_hold"] == expected
