"""The customer-identity layer's brand boundary (migration 010), two ways.

1. STATIC guards, same method as test_merchandising_scope.py: every SQL string
   touching the new tables carries store_id, the schema pins sessions to their
   customer's brand, and every route resolves the store from Host. Seven
   `store_id` bugs have shipped here past green suites; this is the net for an
   eighth.

2. BEHAVIOURAL tests: the real routes, the real store resolution, the real
   bcrypt and token hashing, driven over HTTP — against a scripted fake session
   instead of Postgres. They prove what the routes DO with what the database
   answers (which store id they filter by, what they store, what they refuse).
   They cannot prove the SQL itself is right; only Postgres can, and migration
   010 has never been applied anywhere.
"""
from __future__ import annotations

import ast
import hashlib
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest

REPO = Path(__file__).resolve().parents[1]
ROUTES = REPO / "api" / "routes" / "customer_auth.py"
MIGRATION = REPO / "db" / "migrations" / "010_customer_identity.sql"
MAIN = REPO / "api" / "main.py"


def _sql(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").split())


def _sql_literals_for(path: Path, table: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = " ".join(node.value.split())
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


# ══ 1. Static guards ══════════════════════════════════════════════════════

def test_migration_010_exists():
    assert MIGRATION.is_file()


def test_otp_challenges_store_id_is_not_nullable():
    assert re.search(r"store_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+stores", _sql(MIGRATION), re.I)


def test_sessions_are_pinned_to_their_customers_brand_by_the_schema():
    """A session carrying brand B's store_id for brand A's customer cannot be
    inserted by any code path — including ones written after this."""
    sql = _sql(MIGRATION)
    assert re.search(
        r"FOREIGN KEY\s*\(\s*store_id\s*,\s*customer_id\s*\)\s*REFERENCES\s+customers\s*\(\s*store_id\s*,\s*id\s*\)",
        sql, re.I,
    )
    assert re.search(r"customers\s+ADD\s+CONSTRAINT\s+\w+\s+UNIQUE\s*\(\s*store_id\s*,\s*id\s*\)", sql, re.I), \
        "the composite FK needs customers UNIQUE (store_id, id) to point at"


def test_a_verified_customer_may_exist_without_a_name():
    assert re.search(r"ALTER\s+COLUMN\s+full_name\s+DROP\s+NOT\s+NULL", _sql(MIGRATION), re.I)


def test_codes_are_stored_hashed_never_plain():
    sql = _sql(MIGRATION)
    assert re.search(r"code_hash\s+TEXT\s+NOT\s+NULL", sql, re.I)
    assert not re.search(r"\bcode\s+(TEXT|VARCHAR|CHAR|INT)", sql, re.I), "a plaintext code column exists"


@pytest.mark.parametrize("table", ["otp_challenges", "customer_sessions", "customers"])
def test_every_identity_query_is_scoped_to_the_store(table):
    stmts = _sql_literals_for(ROUTES, table)
    assert stmts, f"no {table} SQL found in customer_auth.py — did the file move?"
    for sql in stmts:
        ok = re.search(r"store_id\s*=\s*:", sql, re.I) or re.search(r"\(\s*store_id\s*,", sql, re.I)
        assert ok, f"{table} SQL without a store_id filter:\n  {sql[:200]}"


@pytest.mark.parametrize("func", ["request_otp", "verify_otp", "get_current_customer"])
def test_identity_routes_resolve_the_store_from_the_host(func):
    deps = _dep_names(ROUTES, func)
    assert "require_store" in deps, f"{func} must use require_store"
    assert not deps & {"require_admin_store_for", "resolve_store"}, \
        f"{func} is a shopper route and must not honour an admin store header"


@pytest.mark.parametrize("func", ["me", "logout"])
def test_signed_in_routes_go_through_the_session_check(func):
    assert "get_current_customer" in _dep_names(ROUTES, func)


def test_the_router_is_mounted():
    src = MAIN.read_text(encoding="utf-8")
    assert re.search(r"include_router\(\s*customer_auth\.router", src)


# ══ 2. Behaviour over HTTP, against a scripted session ════════════════════

pytest.importorskip("sqlalchemy")
pytest.importorskip("bcrypt")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402


# `api.core.db` builds an engine at import, so it must be stubbed before any
# route module loads. test_store_context owns that stub and asserts on its own
# sentinel by identity; a second stub installed here first (this file sorts
# earlier) would silently replace it and break those tests. So: let the owner
# install it. Importing the module binds no fixtures or tests into this one.
import tests.test_store_context  # noqa: E402,F401

from api.core import store_context as sc  # noqa: E402
from api.core.config import get_settings  # noqa: E402
from api.core.security import create_access_token, verify_password  # noqa: E402
from api.routes import customer_auth as ca  # noqa: E402

_SETTINGS = get_settings()


class _Row(tuple):
    """What SQLAlchemy hands back: index access AND attribute access."""

    def __new__(cls, **cols):
        row = super().__new__(cls, cols.values())
        row.__dict__.update(cols)
        return row


class _Result:
    def __init__(self, rows=(), scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class FakeSession:
    """Answers SQL by pattern. Records every statement and its parameters."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.commits = 0
        self.rollbacks = 0
        self._handlers: list[tuple[re.Pattern, object]] = []

    def on(self, pattern: str, answer) -> "FakeSession":
        self._handlers.append((re.compile(pattern, re.I | re.S), answer))
        return self

    async def execute(self, clause, params=None):
        sql = " ".join(str(clause).split())
        params = dict(params or {})
        self.calls.append((sql, params))
        for pat, answer in self._handlers:
            if pat.search(sql):
                return answer(params) if callable(answer) else answer
        return _Result()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    def statements(self, pattern: str) -> list[dict]:
        rx = re.compile(pattern, re.I | re.S)
        return [p for s, p in self.calls if rx.search(s)]


def _store(uuid_str, slug):
    return sc.Store(id=UUID(uuid_str), slug=slug, name=slug.replace("-", " ").title(),
                    status="ACTIVE", theme={}, order_prefix="XX", currency="DZD")


_A = _store("11111111-1111-4111-8111-111111111111", "brand-a")
_B = _store("22222222-2222-4222-8222-222222222222", "brand-b")
_DOMAINS = {"brand-a.dz": _A, "brand-b.dz": _B}


class _RecordingSender:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send(self, to_e164, body):
        self.sent.append((to_e164, body))


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    async def by_host(db, host):
        return _DOMAINS.get(host)

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    # bcrypt at 12 rounds is ~250ms a call; the property under test is
    # "hashed and verifiable", not the cost factor.
    monkeypatch.setattr(_SETTINGS, "bcrypt_rounds", 4)
    monkeypatch.setattr(_SETTINGS, "environment", "development")
    monkeypatch.setattr(_SETTINGS, "db_serverless", False)
    monkeypatch.setattr(_SETTINGS, "sms_provider", "console")
    sc.clear_domain_cache()
    sc.bind_store(None)
    yield
    sc.bind_store(None)


@pytest.fixture
def sender(monkeypatch):
    s = _RecordingSender()
    monkeypatch.setattr(ca, "get_sms_sender", lambda: s)
    return s


@pytest.fixture
def allow_sends(monkeypatch):
    """The send policy is its own unit; these tests are about the plumbing."""
    monkeypatch.setattr(ca, "send_throttle", lambda **kw: None)


async def _call(db: FakeSession, method: str, path: str, *, host="brand-a.dz", json=None, token=None):
    app = FastAPI()
    app.include_router(ca.router)

    async def _fake_db():
        yield db

    app.dependency_overrides[ca.get_db] = _fake_db
    app.dependency_overrides[sc.get_db] = _fake_db
    headers = {"authorization": f"Bearer {token}"} if token else {}
    sc.bind_store(None)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://{host}") as client:
        return await client.request(method, path, json=json, headers=headers)


# ── request-otp ───────────────────────────────────────────────────────────

async def test_request_otp_with_no_usable_sender_is_503_before_touching_the_db(monkeypatch):
    monkeypatch.setattr(_SETTINGS, "environment", "production")
    db = FakeSession()
    r = await _call(db, "POST", "/auth/customer/request-otp", json={"phone": "0555123456"})
    assert r.status_code == 503
    assert db.calls == []


async def test_request_otp_refuses_a_landline(sender):
    r = await _call(FakeSession(), "POST", "/auth/customer/request-otp", json={"phone": "021123456"})
    assert r.status_code == 422
    assert sender.sent == []


async def test_request_otp_sends_a_code_it_stores_only_as_a_hash(sender, allow_sends, caplog):
    db = FakeSession()
    r = await _call(db, "POST", "/auth/customer/request-otp", json={"phone": "+213 555 12 34 56"})
    assert r.status_code == 202, r.text
    assert r.json()["sent"] is True

    [(to, body)] = sender.sent
    assert to == "+213555123456"
    code = re.search(r"\b(\d{6})\b", body).group(1)

    [insert] = db.statements(r"INSERT INTO otp_challenges")
    assert insert["sid"] == _A.id, "the challenge must belong to the Host's store"
    assert insert["p"] == "0555123456", "challenges are keyed by the canonical phone"
    assert code not in str(insert.values()), "the plaintext code reached the database"
    assert verify_password(code, insert["h"])
    assert code not in caplog.text
    assert db.commits == 1


async def test_request_otp_serialises_per_phone_per_store(sender, allow_sends):
    db = FakeSession()
    await _call(db, "POST", "/auth/customer/request-otp", json={"phone": "0555123456"})
    [lock] = db.statements(r"pg_advisory_xact_lock")
    assert str(_A.id) in lock["k"] and "0555123456" in lock["k"]


async def test_request_otp_when_throttled_is_429_and_sends_nothing(sender, monkeypatch):
    monkeypatch.setattr(ca, "send_throttle", lambda **kw: 42)
    db = FakeSession()
    r = await _call(db, "POST", "/auth/customer/request-otp", json={"phone": "0555123456"})
    assert r.status_code == 429
    assert r.headers["retry-after"] == "42"
    assert sender.sent == []
    assert db.statements(r"INSERT INTO otp_challenges") == []


async def test_a_failed_send_leaves_no_challenge_behind(monkeypatch, allow_sends):
    class Broken:
        async def send(self, to, body):
            raise RuntimeError("provider down")

    monkeypatch.setattr(ca, "get_sms_sender", lambda: Broken())
    db = FakeSession()
    r = await _call(db, "POST", "/auth/customer/request-otp", json={"phone": "0555123456"})
    assert r.status_code == 503
    assert db.rollbacks >= 1 and db.commits == 0


# ── verify ────────────────────────────────────────────────────────────────

_CHALLENGE_ID = uuid4()
_CUSTOMER_ID = uuid4()


def _challenge_db(code="123450", attempts=1, expires_in=timedelta(minutes=5), consumed=False, claim=True):
    from api.core.security import hash_password

    now = datetime.now(timezone.utc)
    challenge = _Row(
        id=_CHALLENGE_ID,
        code_hash=hash_password(code),
        attempts=attempts,
        expires_at=now + expires_in,
        consumed_at=now if consumed else None,
    )
    customer = _Row(id=_CUSTOMER_ID, phone="+213555123456", full_name=None,
                    email=None, phone_verified_at=now)
    return (
        FakeSession()
        .on(r"SET attempts = attempts \+ 1", _Result([challenge]))
        .on(r"SET consumed_at = NOW\(\)", _Result([_Row(id=_CHALLENGE_ID)] if claim else []))
        .on(r"FROM customers WHERE store_id = :sid AND phone_normalized = ANY", _Result([]))
        .on(r"INSERT INTO customers", _Result([_Row(id=_CUSTOMER_ID)]))
        .on(r"SELECT id, phone, full_name", _Result([customer]))
    )


async def test_the_right_code_mints_a_session_stored_only_as_its_hash():
    db = _challenge_db(code="123450")
    r = await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "123450"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    [session] = db.statements(r"INSERT INTO customer_sessions")
    assert session["th"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in str(session.values())
    assert session["sid"] == _A.id and session["cid"] == _CUSTOMER_ID


async def test_verify_looks_for_the_customer_under_every_checkout_format():
    db = _challenge_db(code="123450")
    await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "123450"})
    [lookup] = db.statements(r"phone_normalized = ANY")
    assert set(lookup["keys"]) >= {"0555123456", "213555123456", "555123456"}


async def test_a_wrong_code_says_how_many_tries_remain_and_mints_nothing():
    db = _challenge_db(code="123450", attempts=2)
    r = await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "999999"})
    assert r.status_code == 400
    assert "3 tentative" in r.json()["detail"]
    assert db.statements(r"INSERT INTO customer_sessions") == []


async def test_the_attempt_is_committed_before_the_code_is_compared():
    db = _challenge_db(code="123450")
    await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "999999"})
    assert db.commits >= 1, "a wrong guess must count even if nothing after it runs"


async def test_past_the_attempt_cap_even_the_right_code_is_refused():
    db = _challenge_db(code="123450", attempts=_SETTINGS.otp_max_attempts + 1)
    r = await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "123450"})
    assert r.status_code == 429
    assert db.statements(r"INSERT INTO customer_sessions") == []


@pytest.mark.parametrize("kind", ["expired", "consumed", "lost-the-race", "no-challenge"])
async def test_a_dead_code_mints_nothing(kind):
    if kind == "expired":
        db = _challenge_db(code="123450", expires_in=-timedelta(seconds=1))
    elif kind == "consumed":
        db = _challenge_db(code="123450", consumed=True)
    elif kind == "lost-the-race":
        db = _challenge_db(code="123450", claim=False)
    else:
        db = FakeSession()
    r = await _call(db, "POST", "/auth/customer/verify", json={"phone": "0555123456", "code": "123450"})
    assert r.status_code == 400
    assert db.statements(r"INSERT INTO customer_sessions") == []


# ── me / logout ───────────────────────────────────────────────────────────

_SESSION_ID = uuid4()


def _session_db(valid_token: str, store: "sc.Store"):
    """A session table holding ONE session, for `store`. Answers the lookup
    only when both the token hash and the store id match — i.e. it behaves
    the way the SQL's WHERE clause says it should."""
    def lookup(params):
        if params["th"] == hashlib.sha256(valid_token.encode()).hexdigest() and params["sid"] == store.id:
            return _Result([_Row(session_id=_SESSION_ID, id=_CUSTOMER_ID, phone="+213555123456",
                                 full_name="Amina", email=None, phone_verified_at=None)])
        return _Result([])

    return FakeSession().on(r"FROM customer_sessions s", lookup)


async def test_me_without_a_token_is_401_and_touches_nothing():
    db = FakeSession()
    r = await _call(db, "GET", "/auth/customer/me")
    assert r.status_code == 401
    assert db.calls == []


async def test_me_with_a_valid_session_returns_the_customer():
    db = _session_db("tok-a", _A)
    r = await _call(db, "GET", "/auth/customer/me", token="tok-a")
    assert r.status_code == 200
    assert r.json()["full_name"] == "Amina"


async def test_a_session_from_one_brand_is_not_a_session_on_another():
    db = _session_db("tok-a", _A)
    r = await _call(db, "GET", "/auth/customer/me", host="brand-b.dz", token="tok-a")
    assert r.status_code == 401
    [lookup] = db.statements(r"FROM customer_sessions s")
    assert lookup["sid"] == _B.id, "the lookup must be filtered by the Host's store"


async def test_an_admin_jwt_is_not_a_customer_session():
    admin = create_access_token(subject=str(uuid4()), role="SUPER_ADMIN", extra={"store_id": None})
    r = await _call(_session_db("tok-a", _A), "GET", "/auth/customer/me", token=admin)
    assert r.status_code == 401


async def test_logout_revokes_exactly_this_session_in_this_store():
    db = _session_db("tok-a", _A)
    r = await _call(db, "POST", "/auth/customer/logout", token="tok-a")
    assert r.status_code == 204
    [revoke] = db.statements(r"SET revoked_at = NOW\(\)")
    assert revoke == {"id": _SESSION_ID, "sid": _A.id}
    assert db.commits == 1
