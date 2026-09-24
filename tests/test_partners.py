"""Partners (migration 014): store boundary, no seeded partners, no leak on
repeat applications, landlines accepted, and approval as one transaction."""
from __future__ import annotations

import ast
import re
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from tests.sqlscan import is_store_scoped, statements_touching

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "db" / "migrations" / "014_partners.sql"
ROUTES = REPO / "api" / "routes" / "partners.py"


def _sql() -> str:
    return " ".join(MIGRATION.read_text(encoding="utf-8").split())


def _dep_names(func: str) -> set[str]:
    tree = ast.parse(ROUTES.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == func:
            found = set()
            for d in node.args.defaults + node.args.kw_defaults:
                for sub in ast.walk(d) if d else []:
                    if isinstance(sub, ast.Name):
                        found.add(sub.id)
                    elif isinstance(sub, ast.Attribute):
                        found.add(sub.attr)
            return found
    raise AssertionError(func)


# ── Schema ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("table", ["partners", "partner_locations", "partner_applications"])
def test_every_partner_table_carries_a_non_null_store(table):
    block = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\);", _sql(), re.S).group(1)
    assert re.search(r"\bstore_id UUID NOT NULL\b", block)


def test_locations_and_applications_are_pinned_to_their_partners_brand():
    sql = _sql()
    assert "FOREIGN KEY (store_id, partner_id) REFERENCES partners (store_id, id) ON DELETE CASCADE" in sql
    assert "FOREIGN KEY (store_id, partner_id) REFERENCES partners (store_id, id) ON DELETE RESTRICT" in sql
    assert "partners_store_id_id_key UNIQUE (store_id, id)" in sql


def test_an_application_names_its_partner_exactly_when_approved():
    assert "CHECK ((status = 'APPROVED') = (partner_id IS NOT NULL))" in _sql()


def test_nothing_refuses_a_repeat_application():
    """A unique phone would answer "already applied" and leak who applied."""
    code = re.sub(r"--[^\n]*", "", MIGRATION.read_text(encoding="utf-8"))
    sql = " ".join(code.split())
    assert not re.search(r"UNIQUE[^;]*phone", sql, re.I)
    assert "CREATE UNIQUE INDEX" not in sql


def test_no_partner_ships_with_the_platform():
    raw = MIGRATION.read_text(encoding="utf-8")
    assert "INSERT INTO partner" not in raw


def test_wilaya_codes_are_the_58():
    assert "'^(0[1-9]|[1-4][0-9]|5[0-8])$'" in _sql()


# ── Routes ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("table", ["partners", "partner_locations", "partner_applications"])
def test_every_partner_query_is_scoped_to_the_store(table):
    stmts = statements_touching(ROUTES, table)
    assert stmts
    for sql in stmts:
        assert is_store_scoped(sql), sql[:200]


def test_the_public_form_resolves_the_store_from_the_host():
    deps = _dep_names("apply_as_partner")
    assert "require_store" in deps and "require_admin_store_for" not in deps


@pytest.mark.parametrize("func", ["partner_applications", "start_partner_review", "approve_partner",
                                  "reject_partner", "list_partners", "update_partner"])
def test_admin_routes_use_the_authenticated_store(func):
    deps = _dep_names(func)
    assert "require_admin_store_for" in deps and "require_store" not in deps


@pytest.mark.parametrize("func", ["start_partner_review", "approve_partner", "reject_partner", "update_partner"])
def test_decisions_need_write_roles(func):
    assert "WRITE_ROLES" in _dep_names(func)


def test_the_router_is_mounted():
    assert re.search(r"include_router\(\s*partners\.router", (REPO / "api" / "main.py").read_text(encoding="utf-8"))


# ── Input ─────────────────────────────────────────────────────────────────

pytest.importorskip("pydantic")

from api.routes.partners import PartnerApplicationIn  # noqa: E402

_VALID = dict(business_name="Électro Hydra", activity="ELECTROMENAGER", contact_name="Karim",
              phone="021 23 45 67", wilaya_code="16", commune="Hydra", address="12 rue X")


def test_a_landline_is_accepted():
    assert PartnerApplicationIn(**_VALID).phone == "021 23 45 67"


@pytest.mark.parametrize("phone", ["1234567", "abc defg hij"])
def test_an_incomplete_number_is_refused(phone):
    with pytest.raises(ValueError):
        PartnerApplicationIn(**{**_VALID, "phone": phone})


@pytest.mark.parametrize("code", ["00", "59", "7", "AB"])
def test_a_wilaya_outside_the_58_is_refused(code):
    with pytest.raises(ValueError):
        PartnerApplicationIn(**{**_VALID, "wilaya_code": code})


# ── Behaviour over HTTP ───────────────────────────────────────────────────

pytest.importorskip("sqlalchemy")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402

import tests.test_store_context  # noqa: E402,F401  (owns the api.core.db stub)

from api.core import store_context as sc  # noqa: E402
from api.core.security import create_access_token  # noqa: E402
from api.routes import partners as pr  # noqa: E402
from tests.fakedb import FakeSession, Result, Row  # noqa: E402

_A = sc.Store(id=UUID("11111111-1111-4111-8111-111111111111"), slug="brand-a", name="Brand A",
              status="ACTIVE", theme={}, order_prefix="AA", currency="DZD")
_B_ID = UUID("22222222-2222-4222-8222-222222222222")
APP_ID, PARTNER_ID, ADMIN_ID = uuid4(), uuid4(), uuid4()


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


def _token(role="ADMIN"):
    return create_access_token(subject=str(ADMIN_ID), role=role, extra={"store_id": str(_A.id)})


async def _call(db, method, path, *, json_body=None, token=None):
    app = FastAPI()
    app.include_router(pr.router)

    async def _fake_db():
        yield db

    app.dependency_overrides[pr.get_db] = _fake_db
    app.dependency_overrides[sc.get_db] = _fake_db
    sc.bind_store(None)
    headers = {"authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://brand-a.dz") as c:
        return await c.request(method, path, json=json_body, headers=headers)


async def test_an_application_lands_in_the_hosts_store_with_one_stable_answer():
    db = FakeSession()
    first = await _call(db, "POST", "/partners/apply", json_body=_VALID)
    second = await _call(db, "POST", "/partners/apply", json_body=_VALID)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json(), "a repeat application must look exactly like a first one"
    inserts = db.statements(r"INSERT INTO partner_applications")
    assert len(inserts) == 2 and all(p["sid"] == _A.id for p in inserts)
    assert inserts[0]["phone_norm"] == "021234567"


def _app_db(app_status="UNDER_REVIEW", cas_ok=True):
    app_row = Row(id=APP_ID, business_name="Électro Hydra", activity="ELECTROMENAGER", contact_name="Karim",
                  owner_name=None, phone="021234567", email=None, wilaya_code="16", commune="Hydra",
                  address="12 rue X", reason=None, status=app_status, review_note=None, reviewed_at=None,
                  partner_id=None, created_at=None, prior_applications=0)
    return (
        FakeSession()
        .on(r"FROM partner_applications a WHERE a.id = :aid AND a.store_id = :sid",
            lambda p: Result([app_row]) if p["aid"] == APP_ID and p["sid"] == _A.id else Result([]))
        .on(r"INSERT INTO partners", Result([Row(id=PARTNER_ID)]))
        .on(r"UPDATE partner_applications", Result([Row(id=APP_ID)] if cas_ok else []))
    )


async def test_approval_creates_partner_location_and_link_in_one_store_and_transaction():
    db = _app_db()
    r = await _call(db, "POST", f"/partner-applications/{APP_ID}/approve", json_body={}, token=_token())
    assert r.status_code == 200, r.text
    [partner] = db.statements(r"INSERT INTO partners")
    [location] = db.statements(r"INSERT INTO partner_locations")
    [move] = db.statements(r"UPDATE partner_applications")
    assert partner["sid"] == location["sid"] == move["sid"] == _A.id
    assert location["pid"] == move["pid"] == PARTNER_ID
    assert move["to"] == "APPROVED" and set(move["allowed"]) == {"NEW", "UNDER_REVIEW"}
    assert db.commits == 1


async def test_a_lost_race_rolls_the_new_partner_back():
    db = _app_db(cas_ok=False)
    r = await _call(db, "POST", f"/partner-applications/{APP_ID}/approve", json_body={}, token=_token())
    assert r.status_code == 409
    assert db.rollbacks >= 1 and db.commits == 0


async def test_a_decided_application_cannot_be_approved_again():
    r = await _call(_app_db(app_status="REJECTED"), "POST",
                    f"/partner-applications/{APP_ID}/approve", json_body={}, token=_token())
    assert r.status_code == 409


async def test_a_refusal_needs_a_note():
    assert (await _call(_app_db(), "POST", f"/partner-applications/{APP_ID}/reject",
                        json_body={}, token=_token())).status_code == 422


async def test_another_stores_application_is_a_404():
    r = await _call(_app_db(), "POST", f"/partner-applications/{uuid4()}/approve", json_body={}, token=_token())
    assert r.status_code == 404


async def test_a_viewer_cannot_decide():
    r = await _call(_app_db(), "POST", f"/partner-applications/{APP_ID}/approve",
                    json_body={}, token=_token("VIEWER"))
    assert r.status_code == 403
