"""The financing layer's boundaries (migration 011), statically and over HTTP.

1. STATIC: every financing table is store-scoped with composite FKs, rules are
   frozen by the schema, the audit trail is append-only, no rule ships with the
   platform, every SQL string carries its store, and FINANCING_TERMS_PUBLIC
   defaults to false with nothing in code able to flip it.

2. BEHAVIOURAL: the real routes over HTTP against a scripted session — prices
   come from the catalogue not the client, lookups filter by the Host's (or the
   authenticated admin's) store, figures are labelled estimates, and rule
   activation retires the old version before activating the new one.

The rule values here are test fixtures, not business terms.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
from uuid import UUID, uuid4

import pytest

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "db" / "migrations" / "011_financing_core.sql"
PUBLIC = REPO / "api" / "routes" / "financing.py"
ADMIN = REPO / "api" / "routes" / "financing_admin.py"
REPO_SQL = REPO / "api" / "services" / "financing" / "repo.py"
CONFIG = REPO / "api" / "core" / "config.py"
MAIN = REPO / "api" / "main.py"

NEW_TABLES = [
    "financing_rules",
    "financing_simulations",
    "applications",
    "application_items",
    "application_status_events",
]


def _norm(s: str) -> str:
    return " ".join(s.split())


def _migration() -> str:
    return _norm(MIGRATION.read_text(encoding="utf-8"))


def _table_block(table: str) -> str:
    m = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\);", _migration(), re.S)
    assert m, f"{table} is not created by migration 011"
    return m.group(1)


def _sql_literals_for(path: Path, table: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = _norm(node.value)
            if re.search(rf"\b(FROM|INTO|UPDATE|JOIN)\s+{table}\b", v, re.I):
                out.append(v)
    return out


def _dep_names(path: Path, func: str) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == func:
            found = set()
            for d in node.args.defaults + node.args.kw_defaults:
                for sub in ast.walk(d) if d else []:
                    if isinstance(sub, ast.Name):
                        found.add(sub.id)
                    elif isinstance(sub, ast.Attribute):
                        found.add(sub.attr)
            return found
    raise AssertionError(f"{func} not found in {path.name}")


# ══ 1. Schema ═════════════════════════════════════════════════════════════

@pytest.mark.parametrize("table", NEW_TABLES)
def test_every_financing_table_carries_a_non_null_store(table):
    assert re.search(r"\bstore_id UUID NOT NULL\b", _table_block(table)), f"{table}.store_id must be NOT NULL"


@pytest.mark.parametrize("child,cols,parent,parent_cols", [
    ("financing_simulations", "store_id, rule_id", "financing_rules", "store_id, id"),
    ("applications", "store_id, customer_id", "customers", "store_id, id"),
    ("applications", "store_id, rule_id", "financing_rules", "store_id, id"),
    ("application_items", "store_id, application_id", "applications", "store_id, id"),
    ("application_items", "store_id, product_id", "products", "store_id, id"),
    ("application_items", "store_id, product_id, offer_id", "offers", "store_id, product_id, id"),
    ("application_status_events", "store_id, application_id", "applications", "store_id, id"),
])
def test_cross_brand_links_are_unrepresentable(child, cols, parent, parent_cols):
    """store_id NOT NULL stops a NULL. Only a composite FK stops brand B's
    store_id riding on brand A's customer, rule, product or offer."""
    def spaced(c):
        return r"\s*,\s*".join(map(re.escape, c.split(", ")))

    pattern = rf"FOREIGN KEY \(\s*{spaced(cols)}\s*\) REFERENCES {parent} \(\s*{spaced(parent_cols)}\s*\)"
    assert re.search(pattern, _table_block(child)), f"{child} needs FOREIGN KEY ({cols}) -> {parent} ({parent_cols})"


@pytest.mark.parametrize("target", [
    r"financing_rules_store_id_id_key UNIQUE \(store_id, id\)",
    r"applications_store_id_id_key UNIQUE \(store_id, id\)",
    r"offers ADD CONSTRAINT offers_store_product_id_key UNIQUE \(store_id, product_id, id\)",
])
def test_every_composite_fk_has_a_target(target):
    assert re.search(target, _migration())


def test_at_most_one_rule_is_active_per_store():
    assert re.search(
        r"CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON financing_rules \(store_id\) WHERE status = 'ACTIVE'",
        _migration(),
    )


def test_rule_terms_are_frozen_by_the_schema_not_just_the_api():
    sql = _migration()
    assert "BEFORE UPDATE OR DELETE ON financing_rules" in sql
    assert "financing rule terms are immutable" in sql


def test_the_status_audit_trail_is_append_only():
    assert "BEFORE UPDATE OR DELETE ON application_status_events" in _migration()


def test_an_application_whose_numbers_do_not_add_up_cannot_be_stored():
    block = _table_block("applications")
    assert "financed_amount = cash_total - down_payment" in block
    assert "total_repayable = financed_amount + markup_amount" in block


def test_the_platform_ships_no_financing_rule():
    """Durations, markups and bounds are the operator's business terms."""
    assert "INSERT INTO financing_rules" not in MIGRATION.read_text(encoding="utf-8")


# ══ 2. SQL scoping and wiring ═════════════════════════════════════════════

@pytest.mark.parametrize("path", [PUBLIC, ADMIN, REPO_SQL], ids=lambda p: p.name)
@pytest.mark.parametrize("table", NEW_TABLES + ["offers"])
def test_every_financing_query_is_scoped_to_the_store(path, table):
    for sql in _sql_literals_for(path, table):
        ok = re.search(r"store_id\s*=\s*:", sql, re.I) or re.search(r"\(\s*store_id\s*,", sql, re.I)
        assert ok, f"{path.name}: {table} SQL without a store_id filter:\n  {sql[:200]}"


def test_the_guard_above_actually_sees_the_queries():
    assert _sql_literals_for(PUBLIC, "applications")
    assert _sql_literals_for(ADMIN, "financing_rules")
    assert _sql_literals_for(REPO_SQL, "offers")


@pytest.mark.parametrize("func", ["financing_terms", "simulate"])
def test_public_financing_routes_resolve_the_store_from_the_host(func):
    deps = _dep_names(PUBLIC, func)
    assert "require_store" in deps
    assert not deps & {"require_admin_store_for", "resolve_store"}


@pytest.mark.parametrize("func", ["create_application", "my_applications", "my_application"])
def test_application_routes_need_a_signed_in_customer_on_this_host(func):
    deps = _dep_names(PUBLIC, func)
    assert {"require_store", "get_current_customer"} <= deps


@pytest.mark.parametrize("func", ["list_rules", "get_rule", "create_rule", "delete_draft_rule", "activate_rule", "retire_rule"])
def test_rule_routes_are_admin_scoped(func):
    deps = _dep_names(ADMIN, func)
    assert "require_admin_store_for" in deps and "require_store" not in deps


@pytest.mark.parametrize("func", ["create_rule", "delete_draft_rule", "activate_rule", "retire_rule"])
def test_only_policy_roles_can_change_credit_rules(func):
    deps = _dep_names(ADMIN, func)
    assert "POLICY_ROLES" in deps and "READ_ROLES" not in deps


def test_both_routers_are_mounted():
    src = MAIN.read_text(encoding="utf-8")
    assert re.search(r"include_router\(\s*financing\.router", src)
    assert re.search(r"include_router\(\s*financing_admin\.router", src)


# ══ 3. FINANCING_TERMS_PUBLIC ═════════════════════════════════════════════

def test_terms_public_defaults_to_false():
    assert re.search(r"financing_terms_public:\s*bool\s*=\s*False", CONFIG.read_text(encoding="utf-8"))
    assert "FINANCING_TERMS_PUBLIC=false" in (REPO / ".env.example").read_text(encoding="utf-8")


def test_no_code_turns_terms_public_on():
    """The operator flips it, after the legal conversation. Never code."""
    offenders = []
    for py in (REPO / "api").rglob("*.py"):
        src = py.read_text(encoding="utf-8")
        if re.search(r"financing_terms_public\s*(:\s*bool\s*)?=\s*True", src) or \
           re.search(r"setattr\([^)]*financing_terms_public[^)]*True", src):
            offenders.append(py.name)
    assert not offenders


def test_no_marketing_credit_copy_is_hardcoded_in_the_api():
    """A public "à partir de X DA/mois" is a credit offer. Figures are computed
    and labelled, never written as copy."""
    tree = ast.parse(PUBLIC.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            assert not re.search(r"DA\s*/\s*mois|par mois|mensualit|à partir de", node.value, re.I), node.value


# ══ 4. Behaviour over HTTP ════════════════════════════════════════════════

pytest.importorskip("sqlalchemy")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402

import tests.test_store_context  # noqa: E402,F401  (owns the api.core.db stub)

from api.core import store_context as sc  # noqa: E402
from api.core.config import get_settings  # noqa: E402
from api.core.security import create_access_token  # noqa: E402
from api.routes import customer_auth as ca  # noqa: E402
from api.routes import financing as fin  # noqa: E402
from api.routes import financing_admin as fadmin  # noqa: E402
from tests.fakedb import FakeSession, Result, Row  # noqa: E402

_SETTINGS = get_settings()
NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


def _store(uuid_str, slug, prefix):
    return sc.Store(id=UUID(uuid_str), slug=slug, name=slug.title(), status="ACTIVE",
                    theme={}, order_prefix=prefix, currency="DZD")


_A = _store("11111111-1111-4111-8111-111111111111", "brand-a", "AA")
_B = _store("22222222-2222-4222-8222-222222222222", "brand-b", "BB")
_BY_HOST = {"brand-a.dz": _A, "brand-b.dz": _B}
_BY_ID = {s.id: s for s in (_A, _B)}

RULE_ID = uuid4()
OFFER_ID = uuid4()
PRODUCT_ID = uuid4()
CUSTOMER_ID = uuid4()
ADMIN_ID = uuid4()
APP_ID = uuid4()


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    async def by_host(db, host):
        return _BY_HOST.get(host)

    async def by_id(db, store_id):
        return _BY_ID.get(store_id)

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    monkeypatch.setattr(sc, "resolve_store_by_id", by_id)
    monkeypatch.setattr(_SETTINGS, "financing_terms_public", False)
    sc.clear_domain_cache()
    sc.bind_store(None)
    yield
    sc.bind_store(None)


def _rule_row(status="ACTIVE", store=_A, **over):
    cols = dict(
        id=RULE_ID, version=2, status=status,
        min_financed=D("10000.00"), max_financed=D("500000.00"),
        min_down_payment_pct=D("10.00"), max_debt_ratio_pct=D("30.00"),
        terms=json.dumps([{"months": 6, "markup_pct": "0.00"}, {"months": 12, "markup_pct": "5.00"}]),
        notes=None, created_at=NOW, activated_at=NOW, retired_at=None,
    )
    cols.update(over)
    return Row(**cols)


def _offers(params):
    if OFFER_ID in params["ids"]:
        return Result([Row(id=OFFER_ID, product_id=PRODUCT_ID, variant_sku="GN-SFP502M-G",
                           unit_price=D("120000.00"), product_name="Réfrigérateur")])
    return Result([])


def _catalogue(rule=True):
    db = FakeSession()
    if rule:
        db.on(r"FROM financing_rules WHERE store_id = :sid AND status = 'ACTIVE'", Result([_rule_row()]))
    return db.on(r"FROM offers o", _offers).on(r"INSERT INTO financing_simulations", Result(scalar=uuid4()))


def _signed_in(db: FakeSession, token="tok-a", store=_A):
    def lookup(params):
        if params["th"] == hashlib.sha256(token.encode()).hexdigest() and params["sid"] == store.id:
            return Result([Row(session_id=uuid4(), id=CUSTOMER_ID, phone="+213555123456",
                               full_name="Amina", email=None, phone_verified_at=NOW)])
        return Result([])

    return db.on(r"FROM customer_sessions s", lookup)


def _admin_token(role="ADMIN", store=_A):
    return create_access_token(subject=str(ADMIN_ID), role=role,
                               extra={"email": "op@amantcom.dz", "store_id": str(store.id)})


async def _call(db, method, path, *, host="brand-a.dz", json_body=None, token=None, store_header=None):
    app = FastAPI()
    for r in (ca.router, fin.router, fadmin.router):
        app.include_router(r)

    async def _fake_db():
        yield db

    for dep in {sc.get_db, ca.get_db, fin.get_db, fadmin.get_db}:
        app.dependency_overrides[dep] = _fake_db
    headers = {}
    if token:
        headers["authorization"] = f"Bearer {token}"
    if store_header:
        headers[sc.STORE_HEADER] = str(store_header)
    sc.bind_store(None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=f"http://{host}") as c:
        return await c.request(method, path, json=json_body, headers=headers)


def _cart(down="12000.00", months=12, **extra_line):
    return {"lines": [{"offer_id": str(OFFER_ID), "quantity": 1, **extra_line}],
            "down_payment": down, "duration_months": months}


# ── Terms and simulation ──────────────────────────────────────────────────

async def test_with_no_active_rule_financing_is_simply_unavailable():
    r = await _call(_catalogue(rule=False), "GET", "/financing/terms")
    assert r.status_code == 200 and r.json()["available"] is False


async def test_terms_describe_the_rule_without_exposing_markups():
    body = (await _call(_catalogue(), "GET", "/financing/terms")).json()
    assert body["available"] and body["durations"] == [6, 12]
    assert "markup" not in json.dumps(body)


async def test_a_simulation_is_priced_from_the_catalogue_and_labelled_an_estimate():
    db = _catalogue()
    r = await _call(db, "POST", "/financing/simulate", json_body=_cart())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "ESTIMATE" and "Estimation" in body["label"]
    assert body["decision"]["monthly_instalment"] == "9450.00"
    [saved] = db.statements(r"INSERT INTO financing_simulations")
    assert saved["sid"] == _A.id and saved["rid"] == RULE_ID
    assert json.loads(saved["request"])["lines"][0]["unit_price"] == "120000.00"


async def test_a_price_sent_by_the_client_is_ignored():
    r = await _call(_catalogue(), "POST", "/financing/simulate", json_body=_cart(unit_price="1.00"))
    assert r.json()["decision"]["cash_total"] == "120000.00"


@pytest.mark.parametrize("host,store", [("brand-a.dz", _A), ("brand-b.dz", _B)])
async def test_offers_and_rules_are_looked_up_in_the_hosts_store(host, store):
    db = _catalogue()
    await _call(db, "POST", "/financing/simulate", host=host, json_body=_cart())
    assert all(p["sid"] == store.id for p in db.statements(r"FROM financing_rules|FROM offers o"))


async def test_an_offer_outside_the_catalogue_is_404_and_nothing_is_saved():
    db = _catalogue()
    body = _cart()
    body["lines"][0]["offer_id"] = str(uuid4())
    r = await _call(db, "POST", "/financing/simulate", json_body=body)
    assert r.status_code == 404
    assert db.statements(r"INSERT INTO financing_simulations") == []


async def test_simulating_with_no_active_rule_is_404():
    r = await _call(_catalogue(rule=False), "POST", "/financing/simulate", json_body=_cart())
    assert r.status_code == 404


async def test_the_same_offer_twice_is_refused():
    body = _cart()
    body["lines"].append(dict(body["lines"][0]))
    r = await _call(_catalogue(), "POST", "/financing/simulate", json_body=body)
    assert r.status_code == 422


async def test_an_ineligible_simulation_still_answers_with_labelled_reasons():
    r = await _call(_catalogue(), "POST", "/financing/simulate", json_body=_cart(down="0", months=18))
    d = r.json()["decision"]
    assert d["eligible"] is False
    codes = {x["code"] for x in d["reasons"]}
    assert {"DOWN_PAYMENT_BELOW_MINIMUM", "DURATION_NOT_OFFERED"} <= codes
    assert all(x["label"] for x in d["reasons"])


async def test_once_the_operator_publishes_terms_the_label_changes(monkeypatch):
    monkeypatch.setattr(_SETTINGS, "financing_terms_public", True)
    r = await _call(_catalogue(), "POST", "/financing/simulate", json_body=_cart())
    assert r.json()["kind"] == "TERMS"


# ── Status wording ────────────────────────────────────────────────────────

@pytest.mark.parametrize("app_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SIGNED"])
def test_while_terms_are_not_public_nothing_reads_as_approved(app_status):
    label = fin.status_label(app_status, terms_public=False)
    assert "approuv" not in label.lower()
    if app_status == "APPROVED":
        assert "sous réserve" in label


# ── Applications ──────────────────────────────────────────────────────────

def _application_db():
    app_row = Row(id=APP_ID, reference=f"AA-F-{datetime.now(timezone.utc).year}-000001", status="DRAFT",
                  cash_total=D("120000.00"), down_payment=D("12000.00"), financed_amount=D("108000.00"),
                  markup_amount=D("5400.00"), total_repayable=D("113400.00"), duration_months=12,
                  monthly_instalment=D("9450.00"), created_at=NOW, submitted_at=None)
    db = _signed_in(_catalogue())
    db.on(r"COALESCE\(MAX\(CAST\(RIGHT\(reference", Result(scalar=1))
    db.on(r"INSERT INTO applications", Result([app_row]))
    return db


async def test_opening_an_application_needs_a_session():
    r = await _call(_application_db(), "POST", "/financing/applications", json_body=_cart())
    assert r.status_code == 401


async def test_an_eligible_cart_opens_a_draft_owned_by_the_session_customer():
    db = _application_db()
    r = await _call(db, "POST", "/financing/applications", json_body=_cart(), token="tok-a")
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "DRAFT" and r.json()["reference"].startswith("AA-F-")

    [app] = db.statements(r"INSERT INTO applications")
    assert app["sid"] == _A.id and app["cid"] == CUSTOMER_ID and app["rid"] == RULE_ID
    assert (app["financed"], app["monthly"]) == (D("108000.00"), D("9450.00"))
    assert app["ref"].startswith(f"AA-F-{datetime.now(timezone.utc).year}-")

    [item] = db.statements(r"INSERT INTO application_items")
    assert item["price"] == D("120000.00") and item["pid"] == PRODUCT_ID and item["sid"] == _A.id

    [event] = db.statements(r"INSERT INTO application_status_events")
    assert event == {"sid": _A.id, "aid": APP_ID, "cid": CUSTOMER_ID}
    assert db.commits == 1


async def test_reference_numbering_is_serialised_per_store():
    db = _application_db()
    await _call(db, "POST", "/financing/applications", json_body=_cart(), token="tok-a")
    [lock] = db.statements(r"pg_advisory_xact_lock")
    assert lock["k"] == f"application-ref:{_A.id}"


async def test_an_ineligible_cart_opens_nothing():
    db = _application_db()
    r = await _call(db, "POST", "/financing/applications", json_body=_cart(down="0"), token="tok-a")
    assert r.status_code == 422
    assert db.statements(r"INSERT INTO applications") == []


async def test_someone_elses_application_is_a_404_filtered_by_owner_and_store():
    db = _application_db()
    r = await _call(db, "GET", f"/financing/applications/{uuid4()}", token="tok-a")
    assert r.status_code == 404
    [q] = db.statements(r"FROM applications WHERE id = :id")
    assert q["sid"] == _A.id and q["cid"] == CUSTOMER_ID


# ── Admin rules ───────────────────────────────────────────────────────────

_RULE_BODY = {
    "min_financed": "10000.00", "max_financed": "500000.00", "min_down_payment_pct": "10.00",
    "max_debt_ratio_pct": "30.00",
    "terms": [{"months": 12, "markup_pct": "5.000"}, {"months": 6, "markup_pct": "0"}],
}


def _rules_db(existing_status=None, store=_A):
    db = FakeSession()
    db.on(r"SELECT COALESCE\(MAX\(version\)", Result(scalar=3))
    db.on(r"INSERT INTO financing_rules", Result([_rule_row(status="DRAFT", version=3)]))

    def get_one(params):
        if existing_status and params["sid"] == store.id and params["id"] == RULE_ID:
            return Result([_rule_row(status=existing_status)])
        return Result([])

    db.on(r"FROM financing_rules WHERE id = :id AND store_id = :sid", get_one)
    db.on(r"SET status = 'ACTIVE'", Result([_rule_row(status="ACTIVE")]))
    db.on(r"SET status = 'RETIRED', retired_at = NOW\(\) WHERE id", Result([_rule_row(status="RETIRED")]))
    return db


async def test_an_admin_creates_the_next_draft_version_for_their_own_store():
    db = _rules_db()
    r = await _call(db, "POST", "/financing/rules", json_body=_RULE_BODY, token=_admin_token())
    assert r.status_code == 201, r.text
    [ins] = db.statements(r"INSERT INTO financing_rules")
    assert ins["sid"] == _A.id and ins["version"] == 3 and ins["by"] == ADMIN_ID
    assert [t["months"] for t in json.loads(ins["terms"])] == [6, 12]


async def test_a_rule_that_does_not_validate_is_never_written():
    db = _rules_db()
    body = {**_RULE_BODY, "max_financed": "5000.00"}
    r = await _call(db, "POST", "/financing/rules", json_body=body, token=_admin_token())
    assert r.status_code == 422
    assert db.statements(r"INSERT INTO financing_rules") == []


async def test_an_operator_cannot_set_credit_policy():
    r = await _call(_rules_db(), "POST", "/financing/rules", json_body=_RULE_BODY, token=_admin_token("OPERATOR"))
    assert r.status_code == 403


async def test_activation_retires_the_old_version_before_activating_the_new_one():
    db = _rules_db(existing_status="DRAFT")
    r = await _call(db, "POST", f"/financing/rules/{RULE_ID}/activate", token=_admin_token())
    assert r.status_code == 200, r.text
    updates = db.sql(r"UPDATE financing_rules")
    assert "RETIRED" in updates[0] and "'ACTIVE', activated_at" in updates[1]
    assert db.commits == 1


async def test_only_a_draft_can_be_activated():
    r = await _call(_rules_db(existing_status="ACTIVE"), "POST",
                    f"/financing/rules/{RULE_ID}/activate", token=_admin_token())
    assert r.status_code == 409


async def test_another_brands_rule_is_a_404():
    db = _rules_db(existing_status="DRAFT", store=_A)
    r = await _call(db, "POST", f"/financing/rules/{RULE_ID}/activate",
                    token=_admin_token(store=_B))
    assert r.status_code == 404


async def test_a_rule_that_has_been_live_cannot_be_deleted():
    r = await _call(_rules_db(existing_status="RETIRED"), "DELETE",
                    f"/financing/rules/{RULE_ID}", token=_admin_token())
    assert r.status_code == 409


async def test_only_the_active_rule_can_be_retired():
    r = await _call(_rules_db(existing_status="DRAFT"), "POST",
                    f"/financing/rules/{RULE_ID}/retire", token=_admin_token())
    assert r.status_code == 409
