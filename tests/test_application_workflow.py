"""Phase C — the application workflow (migration 013), statically and over HTTP.

Static: every new table is store-scoped with composite FKs; the status machine
and the frozen figures live in triggers; no required document ships; every
SQL string carries its store; roles gate credit decisions; status changes only
go through repo.transition(); no applicant data reaches a logger.

Behavioural: the real routes against a scripted session and an in-memory
document store — what is written, where, for whom, and what is refused.
"""
from __future__ import annotations

import ast
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from tests.sqlscan import is_store_scoped, statements_touching

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "db" / "migrations" / "013_application_workflow.sql"
WORKFLOW = REPO / "api" / "routes" / "financing_workflow.py"
REVIEW = REPO / "api" / "routes" / "financing_review.py"
REPO_SQL = REPO / "api" / "services" / "financing" / "repo.py"


def _migration() -> str:
    return " ".join(MIGRATION.read_text(encoding="utf-8").split())


def _table_block(table: str) -> str:
    m = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\);", _migration(), re.S)
    assert m, f"{table} is not created by migration 013"
    return m.group(1)


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

@pytest.mark.parametrize("table", ["financial_profiles", "employment_profiles", "required_documents", "uploaded_documents"])
def test_every_new_table_carries_a_non_null_store(table):
    assert re.search(r"\bstore_id UUID NOT NULL\b", _table_block(table))


@pytest.mark.parametrize("child,cols,parent", [
    ("financial_profiles", "store_id, application_id", "applications"),
    ("employment_profiles", "store_id, application_id", "applications"),
    ("uploaded_documents", "store_id, application_id", "applications"),
    ("uploaded_documents", "store_id, required_document_id", "required_documents"),
])
def test_workflow_rows_are_pinned_to_their_applications_brand(child, cols, parent):
    a, b = cols.split(", ")
    assert re.search(
        rf"FOREIGN KEY \(\s*{a}\s*,\s*{b}\s*\) REFERENCES {parent} \(\s*store_id\s*,\s*id\s*\)",
        _table_block(child),
    )


def test_the_status_machine_is_exactly_the_plans():
    sql = _migration()
    for pair in [
        "(OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')",
        "(OLD.status = 'SUBMITTED' AND NEW.status = 'UNDER_REVIEW')",
        "(OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED','REJECTED'))",
        "(OLD.status = 'APPROVED' AND NEW.status = 'SIGNED')",
    ]:
        assert pair in sql, f"missing transition {pair}"
    assert "BEFORE UPDATE OR DELETE ON applications" in sql


def test_application_figures_are_frozen_and_never_deleted():
    sql = _migration()
    assert "application figures are immutable" in sql
    assert "never deleted" in sql


def test_a_submitted_file_cannot_be_edited_by_any_code_path():
    sql = _migration()
    for table in ("financial_profiles", "employment_profiles", "uploaded_documents"):
        assert f"BEFORE INSERT OR UPDATE OR DELETE ON {table}" in sql


def test_only_sniffable_formats_can_be_recorded():
    assert "content_type IN ('application/pdf','image/jpeg','image/png','image/webp')" in _table_block("uploaded_documents")


def test_no_required_document_ships_with_the_platform():
    """Which documents a lender asks for is the operator's regulatory call."""
    assert "INSERT INTO required_documents" not in MIGRATION.read_text(encoding="utf-8")


# ══ 2. SQL, wiring, roles ═════════════════════════════════════════════════

TABLES = ["applications", "financial_profiles", "employment_profiles", "required_documents",
          "uploaded_documents", "application_status_events", "customers", "application_items",
          "financing_rules"]


@pytest.mark.parametrize("path", [WORKFLOW, REVIEW, REPO_SQL], ids=lambda p: p.name)
@pytest.mark.parametrize("table", TABLES)
def test_every_workflow_query_is_scoped_to_the_store(path, table):
    for sql in statements_touching(path, table):
        assert is_store_scoped(sql), f"{path.name}: {table} SQL without a store_id filter:\n  {sql[:220]}"


def test_the_scoping_guard_sees_reassembled_fstrings():
    assert any("UPDATE applications SET status" in s for s in statements_touching(REPO_SQL, "applications"))
    assert any("UPDATE required_documents SET {}" in s for s in statements_touching(REVIEW, "required_documents"))


def test_status_only_changes_through_the_audited_transition_helper():
    for path in (WORKFLOW, REVIEW, REPO.parent / "GLstore" / "api" / "routes" / "financing.py"):
        src = " ".join(path.read_text(encoding="utf-8").split())
        assert not re.search(r"UPDATE applications SET status", src, re.I), \
            f"{path.name} changes application status without repo.transition()"


CUSTOMER_ROUTES = ["get_profile", "put_profile", "list_documents", "upload_document", "delete_document", "submit_application"]


@pytest.mark.parametrize("func", CUSTOMER_ROUTES)
def test_customer_routes_need_a_session_on_this_host(func):
    deps = _dep_names(WORKFLOW, func)
    assert {"require_store", "get_current_customer"} <= deps
    assert not deps & {"require_admin_store_for", "resolve_store"}


REVIEW_ROUTES = ["review_queue", "review_detail", "start_review", "approve", "reject", "mark_signed",
                 "accept_document", "reject_document", "document_file", "list_required_documents",
                 "create_required_document", "update_required_document"]


@pytest.mark.parametrize("func", REVIEW_ROUTES)
def test_review_routes_are_admin_scoped(func):
    deps = _dep_names(REVIEW, func)
    assert "require_admin_store_for" in deps and "require_store" not in deps


@pytest.mark.parametrize("func", ["approve", "reject", "mark_signed", "create_required_document", "update_required_document"])
def test_credit_decisions_and_lending_policy_need_decision_roles(func):
    deps = _dep_names(REVIEW, func)
    assert "DECISION_ROLES" in deps and not deps & {"READ_ROLES", "REVIEW_ROLES"}


@pytest.mark.parametrize("func", ["start_review", "accept_document", "reject_document", "document_file"])
def test_opening_identity_documents_excludes_viewers(func):
    deps = _dep_names(REVIEW, func)
    assert "REVIEW_ROLES" in deps and "READ_ROLES" not in deps


def test_all_three_routers_are_mounted():
    src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    for name in ("financing_workflow", "financing_review"):
        assert re.search(rf"include_router\(\s*{name}\.router", src)


_PII = {"original_filename", "filename", "object_key", "key", "employer_name", "phone", "data", "fin", "emp"}


@pytest.mark.parametrize("path", [WORKFLOW, REVIEW], ids=lambda p: p.name)
def test_no_applicant_data_is_handed_to_a_logger(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for call in ast.walk(tree):
        if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name) and call.func.value.id == "log"):
            names = {n.id for n in ast.walk(call) if isinstance(n, ast.Name)}
            attrs = {n.attr for n in ast.walk(call) if isinstance(n, ast.Attribute)}
            leaked = (names | attrs) & _PII
            assert not leaked, f"{path.name}:{call.lineno} logs {leaked}"


# ══ 3. Behaviour over HTTP ════════════════════════════════════════════════

pytest.importorskip("sqlalchemy")
httpx = pytest.importorskip("httpx")

from fastapi import FastAPI  # noqa: E402

import tests.test_store_context  # noqa: E402,F401  (owns the api.core.db stub)

from api.core import store_context as sc  # noqa: E402
from api.core.config import get_settings  # noqa: E402
from api.core.security import create_access_token  # noqa: E402
from api.routes import customer_auth as ca  # noqa: E402
from api.routes import financing_review as rv  # noqa: E402
from api.routes import financing_workflow as wf  # noqa: E402
from tests.fakedb import FakeSession, Result, Row  # noqa: E402

_SETTINGS = get_settings()
NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)

_A = sc.Store(id=UUID("11111111-1111-4111-8111-111111111111"), slug="brand-a", name="Brand A",
              status="ACTIVE", theme={}, order_prefix="AA", currency="DZD")
APP_ID, RULE_ID, CUSTOMER_ID, ADMIN_ID, KIND_ID, DOC_ID = (uuid4() for _ in range(6))
PDF = b"%PDF-1.7\nfake but correctly headed"


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    async def by_host(db, host):
        return _A if host == "brand-a.dz" else None

    async def by_id(db, store_id):
        return _A if store_id == _A.id else None

    monkeypatch.setattr(sc, "resolve_store_by_host", by_host)
    monkeypatch.setattr(sc, "resolve_store_by_id", by_id)
    monkeypatch.setattr(_SETTINGS, "financing_terms_public", False)
    monkeypatch.setattr(_SETTINGS, "document_max_bytes", 10 * 1024 * 1024)
    sc.bind_store(None)
    yield
    sc.bind_store(None)


class MemoryStore:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def put(self, key, data, content_type):
        self.objects[key] = data

    async def get(self, key):
        return self.objects[key]

    async def delete(self, key):
        self.deleted.append(key)
        self.objects.pop(key, None)


@pytest.fixture
def storage(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(wf, "get_document_store", lambda: store)
    monkeypatch.setattr(rv, "get_document_store", lambda: store)
    return store


def _session(db: FakeSession, token="tok"):
    def lookup(params):
        if params["th"] == hashlib.sha256(token.encode()).hexdigest() and params["sid"] == _A.id:
            return Result([Row(session_id=uuid4(), id=CUSTOMER_ID, phone="+213555123456",
                               full_name="Amina", email=None, phone_verified_at=NOW)])
        return Result([])

    return db.on(r"FROM customer_sessions s", lookup)


def _own(app_status="DRAFT"):
    def answer(params):
        if params["aid"] == APP_ID and params["sid"] == _A.id and params["cid"] == CUSTOMER_ID:
            return Result([Row(id=APP_ID, reference="AA-F-2026-000001", status=app_status,
                               rule_id=RULE_ID, monthly_instalment=D("9450.00"))])
        return Result([])
    return answer


def _customer_db(app_status="DRAFT"):
    return _session(FakeSession()).on(r"FROM applications WHERE id = :aid AND store_id = :sid AND customer_id", _own(app_status))


def _admin(role="ADMIN"):
    return create_access_token(subject=str(ADMIN_ID), role=role,
                               extra={"email": "op@amantcom.dz", "store_id": str(_A.id)})


async def _call(db, method, path, *, json_body=None, files=None, token=None):
    app = FastAPI()
    for r in (ca.router, wf.router, rv.router):
        app.include_router(r)

    async def _fake_db():
        yield db

    for dep in {sc.get_db, ca.get_db, wf.get_db, rv.get_db}:
        app.dependency_overrides[dep] = _fake_db
    headers = {"authorization": f"Bearer {token}"} if token else {}
    sc.bind_store(None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://brand-a.dz") as c:
        return await c.request(method, path, json=json_body, files=files, headers=headers)


_PROFILE = {
    "financial": {"monthly_income": "60000.00", "monthly_obligations": "5000.00", "dependents": 2},
    "employment": {"employment_type": "CDI", "employer_name": "Sonelgaz", "employed_since": "2019-03-01"},
}


# ── Profile ───────────────────────────────────────────────────────────────

async def test_a_draft_profile_is_saved_for_this_application_in_this_store():
    db = _customer_db()
    r = await _call(db, "PUT", f"/financing/applications/{APP_ID}/profile", json_body=_PROFILE, token="tok")
    assert r.status_code == 200, r.text
    [fin] = db.statements(r"INSERT INTO financial_profiles")
    [emp] = db.statements(r"INSERT INTO employment_profiles")
    assert fin["sid"] == emp["sid"] == _A.id and fin["aid"] == emp["aid"] == APP_ID
    assert fin["income"] == D("60000.00") and emp["etype"] == "CDI"


async def test_a_submitted_profile_cannot_be_changed():
    db = _customer_db(app_status="SUBMITTED")
    r = await _call(db, "PUT", f"/financing/applications/{APP_ID}/profile", json_body=_PROFILE, token="tok")
    assert r.status_code == 409
    assert db.statements(r"INSERT INTO financial_profiles") == []


async def test_someone_elses_application_is_a_404():
    db = _customer_db()
    r = await _call(db, "PUT", f"/financing/applications/{uuid4()}/profile", json_body=_PROFILE, token="tok")
    assert r.status_code == 404


async def test_a_future_hiring_date_is_refused():
    body = json.loads(json.dumps(_PROFILE))
    body["employment"]["employed_since"] = "2999-01-01"
    r = await _call(_customer_db(), "PUT", f"/financing/applications/{APP_ID}/profile", json_body=body, token="tok")
    assert r.status_code == 422


# ── Upload ────────────────────────────────────────────────────────────────

def _upload_db(app_status="DRAFT", insert_fails=False):
    db = _customer_db(app_status)
    db.on(r"FROM required_documents WHERE store_id = :sid AND code = :code",
          lambda p: Result([Row(id=KIND_ID)]) if p["code"] == "cni" else Result([]))
    db.on(r"SELECT COUNT\(\*\) FROM uploaded_documents", Result(scalar=0))

    def insert(params):
        if insert_fails:
            raise RuntimeError("database went away")
        return Result([Row(id=params["id"], original_filename=params["name"], content_type=params["ctype"],
                           byte_size=params["size"], status="UPLOADED", uploaded_at=NOW)])

    return db.on(r"INSERT INTO uploaded_documents", insert)


async def test_with_no_usable_document_store_uploads_are_503_before_any_db_work(monkeypatch):
    monkeypatch.setattr(_SETTINGS, "environment", "production")
    db = _upload_db()
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("cni.pdf", PDF, "application/pdf")}, token="tok")
    assert r.status_code == 503
    assert db.statements(r"FROM applications|uploaded_documents") == []


async def test_a_real_pdf_is_stored_privately_under_an_id_key_and_hashed(storage):
    db = _upload_db()
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("../../Carte identité.pdf", PDF, "image/png")}, token="tok")
    assert r.status_code == 201, r.text
    [row] = db.statements(r"INSERT INTO uploaded_documents")
    assert row["key"] == f"{_A.id}/applications/{APP_ID}/{row['id']}.pdf"
    assert "Carte" not in row["key"]
    assert row["ctype"] == "application/pdf", "the type comes from the bytes, not the browser"
    assert row["sha"] == hashlib.sha256(PDF).hexdigest()
    assert row["name"] == "Carte identité.pdf"
    assert storage.objects[row["key"]] == PDF


async def test_html_dressed_as_a_pdf_is_refused_and_nothing_is_stored(storage):
    db = _upload_db()
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("cni.pdf", b"<html><script>alert(1)</script>", "application/pdf")}, token="tok")
    assert r.status_code == 415
    assert storage.objects == {} and db.statements(r"INSERT INTO uploaded_documents") == []


async def test_an_oversized_file_is_refused(storage, monkeypatch):
    monkeypatch.setattr(_SETTINGS, "document_max_bytes", 16)
    r = await _call(_upload_db(), "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("cni.pdf", PDF + b"x" * 64, "application/pdf")}, token="tok")
    assert r.status_code == 413 and storage.objects == {}


async def test_an_unknown_document_type_is_a_404(storage):
    r = await _call(_upload_db(), "POST", f"/financing/applications/{APP_ID}/documents/passport",
                    files={"file": ("p.pdf", PDF, "application/pdf")}, token="tok")
    assert r.status_code == 404


async def test_uploads_close_once_the_application_is_submitted(storage):
    r = await _call(_upload_db(app_status="SUBMITTED"), "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("cni.pdf", PDF, "application/pdf")}, token="tok")
    assert r.status_code == 409 and storage.objects == {}


async def test_if_the_row_cannot_be_written_the_bytes_are_removed(storage):
    with pytest.raises(RuntimeError):
        await _call(_upload_db(insert_fails=True), "POST", f"/financing/applications/{APP_ID}/documents/cni",
                    files={"file": ("cni.pdf", PDF, "application/pdf")}, token="tok")
    assert storage.objects == {} and len(storage.deleted) == 1


async def test_removing_a_draft_document_deletes_the_row_then_the_bytes(storage):
    key = f"{_A.id}/applications/{APP_ID}/{DOC_ID}.pdf"
    storage.objects[key] = PDF
    db = _customer_db().on(r"DELETE FROM uploaded_documents", Result([Row(object_key=key)]))
    r = await _call(db, "DELETE", f"/financing/applications/{APP_ID}/documents/{DOC_ID}", token="tok")
    assert r.status_code == 204
    assert storage.deleted == [key]


# ── Submit ────────────────────────────────────────────────────────────────

def _rule_row(status="ACTIVE", max_ratio=D("30.00")):
    return Row(id=RULE_ID, version=2, status=status, min_financed=D("10000.00"), max_financed=D("500000.00"),
               min_down_payment_pct=D("10.00"), max_debt_ratio_pct=max_ratio,
               terms=json.dumps([{"months": 12, "markup_pct": "5.00"}]), notes=None,
               created_at=NOW, activated_at=NOW, retired_at=None)


def _submit_db(*, rule_status="ACTIVE", income="60000.00", obligations="5000.00",
               profile=True, missing=(), cas_ok=True):
    db = _customer_db()
    db.on(r"FROM financing_rules WHERE id = :rid AND store_id = :sid", Result([_rule_row(rule_status)]))
    db.on(r"FROM financial_profiles WHERE",
          Result([Row(monthly_income=D(income), monthly_obligations=D(obligations), dependents=None)] if profile else []))
    db.on(r"FROM employment_profiles WHERE",
          Result([Row(employment_type="CDI", employer_name=None, job_title=None, employed_since=None)] if profile else []))
    db.on(r"FROM required_documents rd WHERE rd.store_id = :sid AND rd.is_active AND NOT EXISTS",
          Result([Row(code=c, label=c.upper()) for c in missing]))
    db.on(r"UPDATE applications SET status", Result([Row(id=APP_ID)] if cas_ok else []))
    return db


async def test_submission_reports_everything_missing_at_once():
    db = _submit_db(profile=False, missing=("cni", "fiche_paie"))
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/submit", token="tok")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["missing_profile"] is True
    assert [d["code"] for d in detail["missing_documents"]] == ["cni", "fiche_paie"]
    assert db.statements(r"UPDATE applications SET status") == []


async def test_a_retired_rule_cannot_originate_new_credit():
    r = await _call(_submit_db(rule_status="RETIRED"), "POST", f"/financing/applications/{APP_ID}/submit", token="tok")
    assert r.status_code == 409


async def test_an_unaffordable_instalment_blocks_submission_without_repricing():
    # 30% of 60 000 = 18 000 < 10 000 + 9 450
    db = _submit_db(obligations="10000.00")
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/submit", token="tok")
    assert r.status_code == 422
    assert r.json()["detail"]["reasons"][0]["code"] == "DEBT_RATIO_EXCEEDED"
    assert db.statements(r"FROM offers") == [], "submission must not re-read live prices"


async def test_a_complete_affordable_draft_is_submitted_with_its_audit_row():
    db = _submit_db()
    r = await _call(db, "POST", f"/financing/applications/{APP_ID}/submit", token="tok")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "SUBMITTED"

    [cas] = db.statements(r"UPDATE applications SET status")
    assert (cas["from_status"], cas["to_status"], cas["sid"]) == ("DRAFT", "SUBMITTED", _A.id)
    decided = json.loads(cas["sd"])
    assert decided["debt_ratio_pct"] == "24.08" and decided["debt_ratio_assessed"] is True

    [event] = db.statements(r"INSERT INTO application_status_events")
    assert event["actor_type"] == "CUSTOMER" and event["actor_id"] == CUSTOMER_ID
    assert db.commits == 1


async def test_a_lost_race_is_a_409_not_a_double_submission():
    r = await _call(_submit_db(cas_ok=False), "POST", f"/financing/applications/{APP_ID}/submit", token="tok")
    assert r.status_code == 409


# ── Review ────────────────────────────────────────────────────────────────

def _review_db(app_status="UNDER_REVIEW", *, unreviewed=0, unaccepted=(), cas_ok=True):
    db = FakeSession()
    db.on(r"signature_sha256 FROM applications WHERE id = :aid AND store_id = :sid",
          lambda p: Result([Row(id=APP_ID, reference="AA-F-2026-000001", status=app_status)])
          if p["aid"] == APP_ID and p["sid"] == _A.id else Result([]))
    db.on(r"FROM uploaded_documents WHERE store_id = :sid AND application_id = :aid AND status = 'UPLOADED'",
          Result(scalar=unreviewed))
    db.on(r"ud.status = 'ACCEPTED'", Result([Row(label=l) for l in unaccepted]))
    db.on(r"UPDATE applications SET status", Result([Row(id=APP_ID)] if cas_ok else []))
    return db


async def test_the_queue_defaults_to_submitted_files_in_the_admins_store():
    db = FakeSession()
    r = await _call(db, "GET", "/financing/review/applications", token=_admin("VIEWER"))
    assert r.status_code == 200
    [q] = db.statements(r"FROM applications a JOIN customers c")
    assert q["st"] == "SUBMITTED" and q["sid"] == _A.id


async def test_starting_a_review_is_an_audited_transition_by_that_admin():
    db = _review_db(app_status="SUBMITTED")
    r = await _call(db, "POST", f"/financing/review/applications/{APP_ID}/start-review", token=_admin("OPERATOR"))
    assert r.status_code == 200, r.text
    [cas] = db.statements(r"UPDATE applications SET status")
    assert (cas["from_status"], cas["to_status"]) == ("SUBMITTED", "UNDER_REVIEW")
    [event] = db.statements(r"INSERT INTO application_status_events")
    assert event["actor_type"] == "ADMIN" and event["actor_id"] == ADMIN_ID


async def test_nobody_approves_on_unexamined_documents():
    db = _review_db(unreviewed=1, unaccepted=("Carte d'identité",))
    r = await _call(db, "POST", f"/financing/review/applications/{APP_ID}/approve", json_body={}, token=_admin())
    assert r.status_code == 422
    assert len(r.json()["detail"]["problems"]) == 2
    assert db.statements(r"UPDATE applications SET status") == []


async def test_approval_records_who_decided():
    db = _review_db()
    r = await _call(db, "POST", f"/financing/review/applications/{APP_ID}/approve",
                    json_body={"note": "revenus vérifiés"}, token=_admin())
    assert r.status_code == 200, r.text
    [cas] = db.statements(r"UPDATE applications SET status")
    assert cas["to_status"] == "APPROVED" and cas["by"] == ADMIN_ID


async def test_an_operator_cannot_make_a_credit_decision():
    r = await _call(_review_db(), "POST", f"/financing/review/applications/{APP_ID}/approve",
                    json_body={}, token=_admin("OPERATOR"))
    assert r.status_code == 403


async def test_a_rejection_needs_a_reason():
    db = _review_db()
    assert (await _call(db, "POST", f"/financing/review/applications/{APP_ID}/reject",
                        json_body={}, token=_admin())).status_code == 422
    r = await _call(db, "POST", f"/financing/review/applications/{APP_ID}/reject",
                    json_body={"reason": "revenus non justifiés"}, token=_admin())
    assert r.status_code == 200
    [cas] = db.statements(r"UPDATE applications SET status")
    assert cas["reason"] == "revenus non justifiés"


async def test_documents_are_only_examined_during_a_review():
    r = await _call(_review_db(app_status="SUBMITTED"), "POST",
                    f"/financing/review/applications/{APP_ID}/documents/{DOC_ID}/accept", token=_admin())
    assert r.status_code == 409


async def test_a_viewer_cannot_open_an_identity_document(storage):
    r = await _call(FakeSession(), "GET",
                    f"/financing/review/applications/{APP_ID}/documents/{DOC_ID}/file", token=_admin("VIEWER"))
    assert r.status_code == 403


async def test_a_document_is_served_as_an_uncached_attachment_and_the_read_is_logged_without_its_name(storage, caplog):
    key = f"{_A.id}/applications/{APP_ID}/{DOC_ID}.pdf"
    storage.objects[key] = PDF
    db = FakeSession().on(r"SELECT object_key, original_filename, content_type",
                          Result([Row(object_key=key, original_filename="Carte identité.pdf",
                                      content_type="application/pdf")]))
    with caplog.at_level(logging.INFO, logger="glstore.financing"):
        r = await _call(db, "GET", f"/financing/review/applications/{APP_ID}/documents/{DOC_ID}/file",
                        token=_admin("OPERATOR"))
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-disposition"].startswith("attachment;")
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "Carte" not in caplog.text and key not in caplog.text


async def test_a_duplicate_required_document_code_is_a_409():
    db = FakeSession().on(r"INSERT INTO required_documents", Result([]))
    r = await _call(db, "POST", "/financing/review/required-documents",
                    json_body={"code": "cni", "label": "Carte d'identité"}, token=_admin())
    assert r.status_code == 409


async def test_a_required_document_code_must_be_a_slug():
    r = await _call(FakeSession(), "POST", "/financing/review/required-documents",
                    json_body={"code": "CNI; DROP", "label": "x"}, token=_admin())
    assert r.status_code == 422
