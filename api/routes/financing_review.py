"""
Financing review — admin. Store from the authenticated x-store-id.

GET    /financing/review/applications                      queue, ?status= (default SUBMITTED)
GET    /financing/review/applications/{id}                 the whole file
POST   /financing/review/applications/{id}/start-review    SUBMITTED → UNDER_REVIEW
POST   /financing/review/applications/{id}/approve         UNDER_REVIEW → APPROVED
POST   /financing/review/applications/{id}/reject          UNDER_REVIEW → REJECTED (reason required)
POST   /financing/review/applications/{id}/mark-signed     APPROVED → SIGNED
POST   /financing/review/applications/{id}/documents/{doc}/accept|reject
GET    /financing/review/applications/{id}/documents/{doc}/file
GET    /financing/review/required-documents
POST   /financing/review/required-documents
PATCH  /financing/review/required-documents/{id}

Under /financing/review/ and not /financing/applications/: the customer's
`/financing/applications/{application_id}` would otherwise swallow admin
paths and 422 on the non-UUID segment.

Roles — a policy choice, stated here so it is easy to change:
  read the queue           SUPER_ADMIN, ADMIN, OPERATOR, VIEWER
  open files, review docs  SUPER_ADMIN, ADMIN, OPERATOR   (not VIEWER: documents are identity data)
  approve / reject / sign  SUPER_ADMIN, ADMIN              (credit decisions)
  required documents       SUPER_ADMIN, ADMIN              (lending policy)

Documents are streamed through this API as attachments. No presigned URL is
ever issued, so there is no bearer link to leak; every read is logged with
the admin's id — and never with the filename.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.core.db import get_db
from api.core.security import CurrentAdmin, get_current_admin, require_role
from api.core.store_context import Store, require_admin_store_for
from api.routes.financing import status_label
from api.routes.financing_workflow import DOCUMENT_STATUS_LABELS
from api.services.documents import DocumentsUnavailable, get_document_store
from api.services.financing.repo import jsonb_value, transition

router = APIRouter(tags=["financing-review"])
log = logging.getLogger("glstore.financing")
_settings = get_settings()

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")
REVIEW_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")
DECISION_ROLES = ("SUPER_ADMIN", "ADMIN")

AppStatus = Literal["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SIGNED"]

_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable.")


class DecisionNoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class SignIn(BaseModel):
    signature_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    note: str | None = Field(default=None, max_length=2000)


class DocumentRejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class RequiredDocumentIn(BaseModel):
    code: str = Field(min_length=1, max_length=60, pattern=r"^[a-z0-9]+(_[a-z0-9]+)*$")
    label: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    sort_order: int = Field(default=0, ge=-1000, le=1000)


class RequiredDocumentPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=-1000, le=1000)


def _ts(v: Any) -> str | None:
    return v.isoformat() if v else None


def _money(v: Any) -> str | None:
    return None if v is None else str(v)


async def _application(db: AsyncSession, store_id: UUID, application_id: UUID) -> Any:
    row = (await db.execute(
        text("""
            SELECT id, reference, status::text AS status, customer_id, rule_id,
                   cash_total, down_payment, financed_amount, markup_amount, total_repayable,
                   duration_months, monthly_instalment, decision, submission_decision,
                   created_at, submitted_at, review_started_at, decided_at, decided_by,
                   rejection_reason, signed_at, signature_sha256
              FROM applications
             WHERE id = :aid AND store_id = :sid
        """),
        {"aid": application_id, "sid": store_id},
    )).first()
    if row is None:
        raise _NOT_FOUND
    return row


# ── Queue ─────────────────────────────────────────────────────────────────

@router.get("/financing/review/applications")
async def review_queue(
    app_status: AppStatus = Query("SUBMITTED", alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    counts = {
        r.status: r.n for r in (await db.execute(
            text("""
                SELECT status::text AS status, COUNT(*) AS n
                  FROM applications WHERE store_id = :sid GROUP BY status
            """),
            {"sid": store.id},
        )).all()
    }
    rows = (await db.execute(
        text("""
            SELECT a.id, a.reference, a.status::text AS status, a.financed_amount,
                   a.monthly_instalment, a.duration_months, a.created_at, a.submitted_at,
                   c.phone, c.full_name
              FROM applications a
              JOIN customers c ON c.id = a.customer_id AND c.store_id = a.store_id
             WHERE a.store_id = :sid AND a.status = CAST(:st AS application_status_enum)
             ORDER BY COALESCE(a.submitted_at, a.created_at) ASC
             LIMIT :lim OFFSET :off
        """),
        {"sid": store.id, "st": app_status, "lim": page_size, "off": (page - 1) * page_size},
    )).all()
    return {
        "status": app_status,
        "counts": counts,
        "page": page,
        "items": [
            {
                "id": str(r.id),
                "reference": r.reference,
                "status": r.status,
                "status_label": status_label(r.status, _settings.financing_terms_public),
                "financed_amount": _money(r.financed_amount),
                "monthly_instalment": _money(r.monthly_instalment),
                "duration_months": r.duration_months,
                "created_at": _ts(r.created_at),
                "submitted_at": _ts(r.submitted_at),
                "customer_phone": r.phone,
                "customer_name": r.full_name,
            }
            for r in rows
        ],
    }


# ── The whole file ────────────────────────────────────────────────────────

@router.get("/financing/review/applications/{application_id}")
async def review_detail(
    application_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    a = await _application(db, store.id, application_id)
    sid, aid = store.id, application_id

    customer = (await db.execute(
        text("""
            SELECT phone, full_name, email, phone_verified_at
              FROM customers WHERE id = :cid AND store_id = :sid
        """),
        {"cid": a.customer_id, "sid": sid},
    )).first()
    # Live availability beside the snapshot: approval is the moment to notice
    # that an item sold out after the customer applied.
    items = (await db.execute(
        text("""
            SELECT ai.product_name, ai.variant_sku, ai.unit_price, ai.quantity, ai.line_total,
                   o.stock_quantity - o.reserved_quantity AS available, o.is_active
              FROM application_items ai
              LEFT JOIN offers o ON o.id = ai.offer_id AND o.store_id = ai.store_id
             WHERE ai.store_id = :sid AND ai.application_id = :aid
             ORDER BY ai.product_name
        """),
        {"sid": sid, "aid": aid},
    )).all()
    fin = (await db.execute(
        text("""
            SELECT monthly_income, monthly_obligations, dependents
              FROM financial_profiles WHERE store_id = :sid AND application_id = :aid
        """),
        {"sid": sid, "aid": aid},
    )).first()
    emp = (await db.execute(
        text("""
            SELECT employment_type::text AS employment_type, employer_name, job_title, employed_since
              FROM employment_profiles WHERE store_id = :sid AND application_id = :aid
        """),
        {"sid": sid, "aid": aid},
    )).first()
    documents = (await db.execute(
        text("""
            SELECT ud.id, rd.code, rd.label, ud.original_filename, ud.content_type, ud.byte_size,
                   ud.sha256, ud.status::text AS status, ud.rejection_reason, ud.reviewed_at, ud.uploaded_at
              FROM uploaded_documents ud
              JOIN required_documents rd ON rd.id = ud.required_document_id AND rd.store_id = ud.store_id
             WHERE ud.store_id = :sid AND ud.application_id = :aid
             ORDER BY rd.sort_order, rd.label, ud.uploaded_at
        """),
        {"sid": sid, "aid": aid},
    )).all()
    history = (await db.execute(
        text("""
            SELECT from_status::text AS from_status, to_status::text AS to_status,
                   actor_type::text AS actor_type, actor_id, note, created_at
              FROM application_status_events
             WHERE store_id = :sid AND application_id = :aid
             ORDER BY created_at
        """),
        {"sid": sid, "aid": aid},
    )).all()

    return {
        "id": str(a.id),
        "reference": a.reference,
        "status": a.status,
        "status_label": status_label(a.status, _settings.financing_terms_public),
        "figures": {
            "cash_total": _money(a.cash_total),
            "down_payment": _money(a.down_payment),
            "financed_amount": _money(a.financed_amount),
            "markup_amount": _money(a.markup_amount),
            "total_repayable": _money(a.total_repayable),
            "duration_months": a.duration_months,
            "monthly_instalment": _money(a.monthly_instalment),
        },
        "decision": jsonb_value(a.decision),
        "submission_decision": jsonb_value(a.submission_decision),
        "dates": {
            "created_at": _ts(a.created_at),
            "submitted_at": _ts(a.submitted_at),
            "review_started_at": _ts(a.review_started_at),
            "decided_at": _ts(a.decided_at),
            "signed_at": _ts(a.signed_at),
        },
        "decided_by": None if a.decided_by is None else str(a.decided_by),
        "rejection_reason": a.rejection_reason,
        "signature_sha256": a.signature_sha256,
        "customer": None if customer is None else {
            "phone": customer.phone,
            "full_name": customer.full_name,
            "email": customer.email,
            "phone_verified_at": _ts(customer.phone_verified_at),
        },
        "items": [
            {
                "product_name": i.product_name,
                "variant_sku": i.variant_sku,
                "unit_price": _money(i.unit_price),
                "quantity": i.quantity,
                "line_total": _money(i.line_total),
                "available_now": i.available,
                "offer_active": i.is_active,
            }
            for i in items
        ],
        "profile": {
            "financial": None if fin is None else {
                "monthly_income": _money(fin.monthly_income),
                "monthly_obligations": _money(fin.monthly_obligations),
                "dependents": fin.dependents,
            },
            "employment": None if emp is None else {
                "employment_type": emp.employment_type,
                "employer_name": emp.employer_name,
                "job_title": emp.job_title,
                "employed_since": _ts(emp.employed_since),
            },
        },
        "documents": [
            {
                "id": str(d.id),
                "code": d.code,
                "label": d.label,
                "original_filename": d.original_filename,
                "content_type": d.content_type,
                "byte_size": d.byte_size,
                "sha256": d.sha256,
                "status": d.status,
                "status_label": DOCUMENT_STATUS_LABELS[d.status],
                "rejection_reason": d.rejection_reason,
                "reviewed_at": _ts(d.reviewed_at),
                "uploaded_at": _ts(d.uploaded_at),
            }
            for d in documents
        ],
        "history": [
            {
                "from_status": h.from_status,
                "to_status": h.to_status,
                "actor_type": h.actor_type,
                "actor_id": None if h.actor_id is None else str(h.actor_id),
                "note": h.note,
                "at": _ts(h.created_at),
            }
            for h in history
        ],
    }


# ── Transitions ───────────────────────────────────────────────────────────

@router.post("/financing/review/applications/{application_id}/start-review")
async def start_review(
    application_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*REVIEW_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _application(db, store.id, application_id)
    await transition(
        db, store_id=store.id, application_id=application_id,
        from_status="SUBMITTED", to_status="UNDER_REVIEW",
        actor_type="ADMIN", actor_id=admin.id,
        extra_set=", review_started_at = NOW()",
    )
    await db.commit()
    return {"id": str(application_id), "status": "UNDER_REVIEW"}


async def _documents_block_approval(db: AsyncSession, store_id: UUID, application_id: UUID) -> list[str]:
    """A credit decision on unverified documents is the failure this exists
    to prevent: every file must have been looked at, and every active
    required type must have at least one accepted file."""
    problems: list[str] = []
    unreviewed = (await db.execute(
        text("""
            SELECT COUNT(*) FROM uploaded_documents
             WHERE store_id = :sid AND application_id = :aid AND status = 'UPLOADED'
        """),
        {"sid": store_id, "aid": application_id},
    )).scalar_one()
    if unreviewed:
        problems.append(f"{unreviewed} document(s) pas encore examiné(s)")
    unaccepted = (await db.execute(
        text("""
            SELECT rd.label FROM required_documents rd
             WHERE rd.store_id = :sid AND rd.is_active
               AND NOT EXISTS (
                   SELECT 1 FROM uploaded_documents ud
                    WHERE ud.store_id = rd.store_id AND ud.application_id = :aid
                      AND ud.required_document_id = rd.id AND ud.status = 'ACCEPTED'
               )
             ORDER BY rd.sort_order, rd.label
        """),
        {"sid": store_id, "aid": application_id},
    )).all()
    problems.extend(f"aucun document validé pour « {r.label} »" for r in unaccepted)
    return problems


@router.post("/financing/review/applications/{application_id}/approve")
async def approve(
    application_id: UUID,
    body: DecisionNoteIn,
    store: Store = Depends(require_admin_store_for(require_role(*DECISION_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    a = await _application(db, store.id, application_id)
    if a.status != "UNDER_REVIEW":
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule une demande en cours d'étude peut être acceptée.")
    problems = await _documents_block_approval(db, store.id, application_id)
    if problems:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": "Les documents ne permettent pas encore de décider.", "problems": problems},
        )
    await transition(
        db, store_id=store.id, application_id=application_id,
        from_status="UNDER_REVIEW", to_status="APPROVED",
        actor_type="ADMIN", actor_id=admin.id, note=body.note,
        extra_set=", decided_at = NOW(), decided_by = :by",
        extra_params={"by": admin.id},
    )
    await db.commit()
    return {"id": str(application_id), "status": "APPROVED"}


@router.post("/financing/review/applications/{application_id}/reject")
async def reject(
    application_id: UUID,
    body: RejectIn,
    store: Store = Depends(require_admin_store_for(require_role(*DECISION_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _application(db, store.id, application_id)
    await transition(
        db, store_id=store.id, application_id=application_id,
        from_status="UNDER_REVIEW", to_status="REJECTED",
        actor_type="ADMIN", actor_id=admin.id, note=body.reason,
        extra_set=", decided_at = NOW(), decided_by = :by, rejection_reason = :reason",
        extra_params={"by": admin.id, "reason": body.reason},
    )
    await db.commit()
    return {"id": str(application_id), "status": "REJECTED"}


@router.post("/financing/review/applications/{application_id}/mark-signed")
async def mark_signed(
    application_id: UUID,
    body: SignIn,
    store: Store = Depends(require_admin_store_for(require_role(*DECISION_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _application(db, store.id, application_id)
    await transition(
        db, store_id=store.id, application_id=application_id,
        from_status="APPROVED", to_status="SIGNED",
        actor_type="ADMIN", actor_id=admin.id, note=body.note,
        extra_set=", signed_at = NOW(), signature_sha256 = :sig",
        extra_params={"sig": body.signature_sha256},
    )
    await db.commit()
    return {"id": str(application_id), "status": "SIGNED"}


# ── Documents ─────────────────────────────────────────────────────────────

async def _review_document(
    db: AsyncSession, store_id: UUID, application_id: UUID, document_id: UUID,
    admin_id: UUID, verdict: str, reason: str | None,
) -> dict[str, Any]:
    a = await _application(db, store_id, application_id)
    if a.status != "UNDER_REVIEW":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ouvrez l'étude de la demande avant d'examiner ses documents.")
    row = (await db.execute(
        text("""
            UPDATE uploaded_documents
               SET status = CAST(:verdict AS document_review_status_enum),
                   reviewed_by = :by, reviewed_at = NOW(), rejection_reason = :reason
             WHERE id = :did AND store_id = :sid AND application_id = :aid
            RETURNING id, status::text AS status
        """),
        {"verdict": verdict, "by": admin_id, "reason": reason,
         "did": document_id, "sid": store_id, "aid": application_id},
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document introuvable.")
    await db.commit()
    return {"id": str(row.id), "status": row.status, "status_label": DOCUMENT_STATUS_LABELS[row.status]}


@router.post("/financing/review/applications/{application_id}/documents/{document_id}/accept")
async def accept_document(
    application_id: UUID,
    document_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*REVIEW_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _review_document(db, store.id, application_id, document_id, admin.id, "ACCEPTED", None)


@router.post("/financing/review/applications/{application_id}/documents/{document_id}/reject")
async def reject_document(
    application_id: UUID,
    document_id: UUID,
    body: DocumentRejectIn,
    store: Store = Depends(require_admin_store_for(require_role(*REVIEW_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _review_document(db, store.id, application_id, document_id, admin.id, "REJECTED", body.reason)


_ASCII_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]")


def content_disposition(filename: str) -> str:
    """Always an attachment — never rendered inline in the admin's origin."""
    fallback = _ASCII_UNSAFE.sub("_", filename) or "document"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.get("/financing/review/applications/{application_id}/documents/{document_id}/file")
async def document_file(
    application_id: UUID,
    document_id: UUID,
    store: Store = Depends(require_admin_store_for(require_role(*REVIEW_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        storage = get_document_store()
    except DocumentsUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Le stockage des documents n'est pas configuré.")

    doc = (await db.execute(
        text("""
            SELECT object_key, original_filename, content_type
              FROM uploaded_documents
             WHERE id = :did AND store_id = :sid AND application_id = :aid
        """),
        {"did": document_id, "sid": store.id, "aid": application_id},
    )).first()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document introuvable.")

    data = await storage.get(doc.object_key)
    log.info(
        "applicant document read",
        extra={"admin_id": str(admin.id), "application_id": str(application_id), "document_id": str(document_id)},
    )
    return Response(
        content=data,
        media_type=doc.content_type,
        headers={
            "Content-Disposition": content_disposition(doc.original_filename),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Required documents (lending policy) ───────────────────────────────────

def _required_out(r: Any) -> dict[str, Any]:
    return {
        "id": str(r.id), "code": r.code, "label": r.label, "description": r.description,
        "is_active": r.is_active, "sort_order": r.sort_order,
    }


_REQUIRED_COLUMNS = "id, code, label, description, is_active, sort_order"


@router.get("/financing/review/required-documents")
async def list_required_documents(
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        text(f"SELECT {_REQUIRED_COLUMNS} FROM required_documents WHERE store_id = :sid ORDER BY sort_order, label"),
        {"sid": store.id},
    )).all()
    return {"items": [_required_out(r) for r in rows]}


@router.post("/financing/review/required-documents", status_code=status.HTTP_201_CREATED)
async def create_required_document(
    body: RequiredDocumentIn,
    store: Store = Depends(require_admin_store_for(require_role(*DECISION_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        text(f"""
            INSERT INTO required_documents (store_id, code, label, description, sort_order)
            VALUES (:sid, :code, :label, :description, :sort)
            ON CONFLICT (store_id, code) DO NOTHING
            RETURNING {_REQUIRED_COLUMNS}
        """),
        {"sid": store.id, "code": body.code, "label": body.label,
         "description": body.description, "sort": body.sort_order},
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce code de document existe déjà.")
    await db.commit()
    return _required_out(row)


@router.patch("/financing/review/required-documents/{required_id}")
async def update_required_document(
    required_id: UUID,
    body: RequiredDocumentPatch,
    store: Store = Depends(require_admin_store_for(require_role(*DECISION_ROLES))),
    db: AsyncSession = Depends(get_db),
):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rien à modifier.")
    # Column names come from the model's own fields, never from the client.
    assignments = ", ".join(f"{col} = :{col}" for col in changes)
    row = (await db.execute(
        text(f"""
            UPDATE required_documents SET {assignments}, updated_at = NOW()
             WHERE id = :rid AND store_id = :sid
            RETURNING {_REQUIRED_COLUMNS}
        """),
        {**changes, "rid": required_id, "sid": store.id},
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document requis introuvable.")
    await db.commit()
    return _required_out(row)
