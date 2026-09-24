"""
Financing — the signed-in customer's side of the Phase C workflow.

GET    /financing/required-documents                     what this store asks for
GET    /financing/applications/{id}/profile              declared income and employment
PUT    /financing/applications/{id}/profile              declare them (DRAFT only)
GET    /financing/applications/{id}/documents            checklist: required × uploaded
POST   /financing/applications/{id}/documents/{code}     upload one file (DRAFT only)
DELETE /financing/applications/{id}/documents/{doc_id}   remove one (DRAFT only)
POST   /financing/applications/{id}/submit               DRAFT → SUBMITTED

Everything is scoped to the Host's store AND the session's customer: another
customer's application — or another brand's — is the same 404 as one that
does not exist. "DRAFT only" is enforced here for a clean 409 and again by
migration 013's triggers for every other code path.

Submission never re-prices. The figures were snapshotted at DRAFT under the
application's own rule; submission only judges them against the declared
profile, with that same rule — which must still be ACTIVE. A rule the
operator retired is not used to originate new credit.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db
from api.core.store_context import Store, require_store
from api.routes.customer_auth import CurrentCustomer, get_current_customer
from api.routes.financing import REASON_LABELS, status_label
from api.services.documents import (
    DocumentsUnavailable,
    get_document_store,
    object_key,
    safe_filename,
    sniff_content_type,
)
from api.services.financing import rules as engine
from api.services.financing.repo import RULE_COLUMNS, rule_from_row, transition

router = APIRouter(tags=["financing"])
log = logging.getLogger("glstore.financing")
_settings = get_settings()

EmploymentType = Literal["CDI", "CDD", "FONCTIONNAIRE", "INDEPENDANT", "RETRAITE", "AUTRE"]

DOCUMENT_STATUS_LABELS = {"UPLOADED": "Reçu", "ACCEPTED": "Validé", "REJECTED": "Non conforme"}

_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable.")
_NOT_DRAFT = HTTPException(
    status.HTTP_409_CONFLICT,
    "Cette demande a déjà été envoyée ; elle ne peut plus être modifiée.",
)
_DOCS_UNAVAILABLE = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE,
    "Le dépôt de documents n'est pas encore disponible.",
)
_TERMS_CHANGED = HTTPException(
    status.HTTP_409_CONFLICT,
    "Les conditions de cette demande ne sont plus proposées. Ouvrez une nouvelle demande.",
)


# ── Input ─────────────────────────────────────────────────────────────────

class FinancialIn(BaseModel):
    monthly_income: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    monthly_obligations: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    dependents: int | None = Field(default=None, ge=0, le=30)


class EmploymentIn(BaseModel):
    employment_type: EmploymentType
    employer_name: str | None = Field(default=None, min_length=1, max_length=200)
    job_title: str | None = Field(default=None, min_length=1, max_length=120)
    employed_since: date | None = None

    @field_validator("employed_since")
    @classmethod
    def _not_in_the_future(cls, v: date | None) -> date | None:
        if v is not None and v > date.today():
            raise ValueError("la date d'embauche ne peut pas être dans le futur")
        return v


class ProfileIn(BaseModel):
    financial: FinancialIn
    employment: EmploymentIn


# ── Helpers ───────────────────────────────────────────────────────────────

async def _own_application(
    db: AsyncSession, store_id: UUID, customer_id: UUID, application_id: UUID, *, lock: bool = False,
) -> Any:
    row = (await db.execute(
        text(f"""
            SELECT id, reference, status::text AS status, rule_id, monthly_instalment
              FROM applications
             WHERE id = :aid AND store_id = :sid AND customer_id = :cid
             {"FOR UPDATE" if lock else ""}
        """),
        {"aid": application_id, "sid": store_id, "cid": customer_id},
    )).first()
    if row is None:
        raise _NOT_FOUND
    return row


def _profile_out(fin: Any, emp: Any) -> dict[str, Any]:
    return {
        "financial": None if fin is None else {
            "monthly_income": str(fin.monthly_income),
            "monthly_obligations": str(fin.monthly_obligations),
            "dependents": fin.dependents,
        },
        "employment": None if emp is None else {
            "employment_type": emp.employment_type,
            "employer_name": emp.employer_name,
            "job_title": emp.job_title,
            "employed_since": emp.employed_since.isoformat() if emp.employed_since else None,
        },
    }


async def _load_profile(db: AsyncSession, store_id: UUID, application_id: UUID) -> tuple[Any, Any]:
    fin = (await db.execute(
        text("""
            SELECT monthly_income, monthly_obligations, dependents
              FROM financial_profiles WHERE store_id = :sid AND application_id = :aid
        """),
        {"sid": store_id, "aid": application_id},
    )).first()
    emp = (await db.execute(
        text("""
            SELECT employment_type::text AS employment_type, employer_name, job_title, employed_since
              FROM employment_profiles WHERE store_id = :sid AND application_id = :aid
        """),
        {"sid": store_id, "aid": application_id},
    )).first()
    return fin, emp


async def _missing_documents(db: AsyncSession, store_id: UUID, application_id: UUID) -> list[dict[str, str]]:
    rows = (await db.execute(
        text("""
            SELECT rd.code, rd.label
              FROM required_documents rd
             WHERE rd.store_id = :sid AND rd.is_active
               AND NOT EXISTS (
                   SELECT 1 FROM uploaded_documents ud
                    WHERE ud.store_id = rd.store_id
                      AND ud.application_id = :aid
                      AND ud.required_document_id = rd.id
               )
             ORDER BY rd.sort_order, rd.label
        """),
        {"sid": store_id, "aid": application_id},
    )).all()
    return [{"code": r.code, "label": r.label} for r in rows]


# ── Required documents (public) ───────────────────────────────────────────

@router.get("/financing/required-documents")
async def required_documents(
    store: Store = Depends(require_store),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        text("""
            SELECT code, label, description FROM required_documents
             WHERE store_id = :sid AND is_active
             ORDER BY sort_order, label
        """),
        {"sid": store.id},
    )).all()
    return {"items": [{"code": r.code, "label": r.label, "description": r.description} for r in rows]}


# ── Profile ───────────────────────────────────────────────────────────────

@router.get("/financing/applications/{application_id}/profile")
async def get_profile(
    application_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    await _own_application(db, store.id, customer.profile.id, application_id)
    return _profile_out(*await _load_profile(db, store.id, application_id))


@router.put("/financing/applications/{application_id}/profile")
async def put_profile(
    application_id: UUID,
    body: ProfileIn,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    app = await _own_application(db, store.id, customer.profile.id, application_id, lock=True)
    if app.status != "DRAFT":
        raise _NOT_DRAFT

    f, e = body.financial, body.employment
    await db.execute(
        text("""
            INSERT INTO financial_profiles
                (store_id, application_id, monthly_income, monthly_obligations, dependents)
            VALUES (:sid, :aid, :income, :obligations, :dependents)
            ON CONFLICT (store_id, application_id) DO UPDATE SET
                monthly_income = EXCLUDED.monthly_income,
                monthly_obligations = EXCLUDED.monthly_obligations,
                dependents = EXCLUDED.dependents,
                updated_at = NOW()
        """),
        {"sid": store.id, "aid": application_id, "income": f.monthly_income,
         "obligations": f.monthly_obligations, "dependents": f.dependents},
    )
    await db.execute(
        text("""
            INSERT INTO employment_profiles
                (store_id, application_id, employment_type, employer_name, job_title, employed_since)
            VALUES (:sid, :aid, CAST(:etype AS employment_type_enum), :employer, :title, :since)
            ON CONFLICT (store_id, application_id) DO UPDATE SET
                employment_type = EXCLUDED.employment_type,
                employer_name = EXCLUDED.employer_name,
                job_title = EXCLUDED.job_title,
                employed_since = EXCLUDED.employed_since,
                updated_at = NOW()
        """),
        {"sid": store.id, "aid": application_id, "etype": e.employment_type,
         "employer": e.employer_name, "title": e.job_title, "since": e.employed_since},
    )
    await db.commit()
    return _profile_out(*await _load_profile(db, store.id, application_id))


# ── Documents ─────────────────────────────────────────────────────────────

def _document_out(r: Any) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "original_filename": r.original_filename,
        "content_type": r.content_type,
        "byte_size": r.byte_size,
        "status": r.status,
        "status_label": DOCUMENT_STATUS_LABELS[r.status],
        "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else None,
    }


@router.get("/financing/applications/{application_id}/documents")
async def list_documents(
    application_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    await _own_application(db, store.id, customer.profile.id, application_id)
    kinds = (await db.execute(
        text("""
            SELECT id, code, label, description FROM required_documents
             WHERE store_id = :sid AND is_active
             ORDER BY sort_order, label
        """),
        {"sid": store.id},
    )).all()
    uploaded = (await db.execute(
        text("""
            SELECT id, required_document_id, original_filename, content_type, byte_size,
                   status::text AS status, uploaded_at
              FROM uploaded_documents
             WHERE store_id = :sid AND application_id = :aid
             ORDER BY uploaded_at
        """),
        {"sid": store.id, "aid": application_id},
    )).all()
    by_kind: dict[UUID, list[dict[str, Any]]] = {}
    for u in uploaded:
        by_kind.setdefault(u.required_document_id, []).append(_document_out(u))
    items = [
        {"code": k.code, "label": k.label, "description": k.description, "uploaded": by_kind.get(k.id, [])}
        for k in kinds
    ]
    return {"items": items, "complete": all(i["uploaded"] for i in items)}


@router.post("/financing/applications/{application_id}/documents/{code}", status_code=status.HTTP_201_CREATED)
async def upload_document(
    application_id: UUID,
    code: str,
    file: UploadFile = File(...),
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    try:
        storage = get_document_store()
    except DocumentsUnavailable as exc:
        log.error("document upload attempted but no document store is usable", extra={"reason": str(exc)})
        raise _DOCS_UNAVAILABLE

    app = await _own_application(db, store.id, customer.profile.id, application_id, lock=True)
    if app.status != "DRAFT":
        raise _NOT_DRAFT

    kind = (await db.execute(
        text("SELECT id FROM required_documents WHERE store_id = :sid AND code = :code AND is_active"),
        {"sid": store.id, "code": code},
    )).first()
    if kind is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Type de document inconnu.")

    count = (await db.execute(
        text("SELECT COUNT(*) FROM uploaded_documents WHERE store_id = :sid AND application_id = :aid"),
        {"sid": store.id, "aid": application_id},
    )).scalar_one()
    if count >= _settings.max_documents_per_application:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nombre maximal de documents atteint pour cette demande.")

    data = await file.read(_settings.document_max_bytes + 1)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Le fichier est vide.")
    if len(data) > _settings.document_max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Fichier trop volumineux (maximum {_settings.document_max_bytes // (1024 * 1024)} Mo).",
        )
    content_type = sniff_content_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Format non accepté. Envoyez un PDF, une photo JPEG, PNG ou WebP.",
        )

    document_id = uuid4()
    key = object_key(store.id, application_id, document_id, content_type)
    await storage.put(key, data, content_type)
    try:
        row = (await db.execute(
            text("""
                INSERT INTO uploaded_documents (
                    id, store_id, application_id, required_document_id, object_key,
                    original_filename, content_type, byte_size, sha256
                ) VALUES (:id, :sid, :aid, :kind, :key, :name, :ctype, :size, :sha)
                RETURNING id, original_filename, content_type, byte_size, status::text AS status, uploaded_at
            """),
            {
                "id": document_id, "sid": store.id, "aid": application_id, "kind": kind.id,
                "key": key, "name": safe_filename(file.filename), "ctype": content_type,
                "size": len(data), "sha": hashlib.sha256(data).hexdigest(),
            },
        )).first()
        await db.commit()
    except Exception:
        # No orphan bytes for a row that does not exist.
        await storage.delete(key)
        raise
    return _document_out(row)


@router.delete("/financing/applications/{application_id}/documents/{document_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    application_id: UUID,
    document_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    try:
        storage = get_document_store()
    except DocumentsUnavailable:
        raise _DOCS_UNAVAILABLE

    app = await _own_application(db, store.id, customer.profile.id, application_id, lock=True)
    if app.status != "DRAFT":
        raise _NOT_DRAFT

    gone = (await db.execute(
        text("""
            DELETE FROM uploaded_documents
             WHERE id = :id AND store_id = :sid AND application_id = :aid
            RETURNING object_key
        """),
        {"id": document_id, "sid": store.id, "aid": application_id},
    )).first()
    if gone is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document introuvable.")
    await db.commit()

    try:
        await storage.delete(gone.object_key)
    except Exception:
        # The row is gone, so nothing can reach the bytes; an orphan object
        # is a storage cost, not a leak. Ids only in the log — never a name.
        log.warning("document row deleted but its object was not", extra={"document_id": str(document_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Submit ────────────────────────────────────────────────────────────────

@router.post("/financing/applications/{application_id}/submit")
async def submit_application(
    application_id: UUID,
    store: Store = Depends(require_store),
    customer: CurrentCustomer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
):
    app = await _own_application(db, store.id, customer.profile.id, application_id, lock=True)
    if app.status != "DRAFT":
        raise _NOT_DRAFT

    rule_row = (await db.execute(
        text(f"SELECT {RULE_COLUMNS} FROM financing_rules WHERE id = :rid AND store_id = :sid"),
        {"rid": app.rule_id, "sid": store.id},
    )).first()
    if rule_row is None or rule_row.status != "ACTIVE":
        raise _TERMS_CHANGED
    rule = rule_from_row(rule_row)

    # Report everything that is missing at once, like the engine does.
    fin, emp = await _load_profile(db, store.id, application_id)
    missing_documents = await _missing_documents(db, store.id, application_id)
    problems: dict[str, Any] = {}
    if fin is None or emp is None:
        problems["missing_profile"] = True
    if missing_documents:
        problems["missing_documents"] = missing_documents

    assessed, refusals, ratio = False, (), None
    if fin is not None:
        profile = engine.Profile(
            monthly_income=Decimal(fin.monthly_income),
            monthly_obligations=Decimal(fin.monthly_obligations),
        )
        instalment = Decimal(app.monthly_instalment)
        assessed, refusals = engine.assess_affordability(instalment, profile, rule)
        ratio = engine.debt_ratio_pct(instalment, profile)
        if refusals:
            problems["reasons"] = [{"code": c, "label": REASON_LABELS[c]} for c in refusals]

    if problems:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": "La demande ne peut pas encore être envoyée.", **problems},
        )

    submission_decision = {
        "rule_version": rule.version,
        "monthly_instalment": str(app.monthly_instalment),
        "monthly_income": str(fin.monthly_income),
        "monthly_obligations": str(fin.monthly_obligations),
        "debt_ratio_pct": None if ratio is None else str(ratio),
        "max_debt_ratio_pct": None if rule.max_debt_ratio_pct is None else str(rule.max_debt_ratio_pct),
        "debt_ratio_assessed": assessed,
    }
    await transition(
        db,
        store_id=store.id,
        application_id=application_id,
        from_status="DRAFT",
        to_status="SUBMITTED",
        actor_type="CUSTOMER",
        actor_id=customer.profile.id,
        extra_set=", submitted_at = NOW(), submission_decision = CAST(:sd AS JSONB)",
        extra_params={"sd": json.dumps(submission_decision)},
    )
    await db.commit()

    return {
        "id": str(application_id),
        "reference": app.reference,
        "status": "SUBMITTED",
        "status_label": status_label("SUBMITTED", _settings.financing_terms_public),
    }
