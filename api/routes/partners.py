"""
Partners — points of sale that apply to work with the store.

  POST  /partners/apply                                  public, store from Host
  GET   /partner-applications?status=                    admin queue
  POST  /partner-applications/{id}/start-review          NEW → UNDER_REVIEW
  POST  /partner-applications/{id}/approve               → APPROVED; creates the partner + first location
  POST  /partner-applications/{id}/reject                → REJECTED (note required)
  GET   /partners                                        admin: approved partners and their locations
  PATCH /partners/{id}                                   admin: activate / deactivate

Same shape as contact.py: the public route stores the application and answers
with one stable message; admin routes resolve the store from the
authenticated x-store-id. The admin paths are /partner-applications, not
/partners/..., so nothing collides with the public POST.

No uniqueness on phone: a "you already applied" answer would tell anyone who
types a number whether that shop has applied. Duplicates land and the queue
shows `prior_applications` for the same phone instead.

Status moves are compare-and-swap in SQL (`WHERE status IN (...)`): a
partner application is not a credit record, so no trigger — but two admins
approving at once still produce one partner, not two.

POST is covered by the global rate limiter in api/main.py.

SECURITY NOTE FOR ANY UI RENDERING THESE: every text field is anonymous free
text. Render as plain text only — never dangerouslySetInnerHTML, never in a
URL or href.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.phone import normalize_phone
from api.core.security import CurrentAdmin, get_current_admin, require_role
from api.core.store_context import Store, require_admin_store_for, require_store

router = APIRouter(tags=["partners"])

READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER")
WRITE_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")

Activity = Literal["ELECTROMENAGER", "MULTIMEDIA", "MEUBLE", "GENERALISTE", "AUTRE"]
ApplicationStatus = Literal["NEW", "UNDER_REVIEW", "APPROVED", "REJECTED"]

_NOT_FOUND = HTTPException(http.HTTP_404_NOT_FOUND, "Demande introuvable.")
_ALREADY_DECIDED = HTTPException(http.HTTP_409_CONFLICT, "Cette demande a déjà été traitée.")


class PartnerApplicationIn(BaseModel):
    business_name: str = Field(min_length=1, max_length=160)
    activity: Activity
    contact_name: str = Field(min_length=1, max_length=120)
    owner_name: str | None = Field(default=None, max_length=120)
    phone: str = Field(min_length=6, max_length=30)
    email: EmailStr | None = None
    wilaya_code: str = Field(pattern=r"^(0[1-9]|[1-4][0-9]|5[0-8])$")
    commune: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=300)
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("phone")
    @classmethod
    def _a_reachable_number(cls, v: str) -> str:
        # Landlines welcome: a point of sale answers on a fixed line. Only the
        # customer OTP flow needs a mobile.
        if len(normalize_phone(v)) < 8:
            raise ValueError("numéro de téléphone incomplet")
        return v.strip()


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class RejectIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class PartnerPatch(BaseModel):
    is_active: bool


def _clean(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


# ── Public ────────────────────────────────────────────────────────────────

@router.post("/partners/apply", status_code=http.HTTP_201_CREATED)
async def apply_as_partner(
    dto: PartnerApplicationIn,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_store),
) -> dict[str, Any]:
    await db.execute(
        text("""
            INSERT INTO partner_applications (
                store_id, business_name, activity, contact_name, owner_name,
                phone, phone_normalized, email, wilaya_code, commune, address, reason
            ) VALUES (
                :sid, :business, CAST(:activity AS partner_activity_enum), :contact, :owner,
                :phone, :phone_norm, :email, :wilaya, :commune, :address, :reason
            )
        """),
        {
            "sid": store.id,
            "business": dto.business_name.strip(),
            "activity": dto.activity,
            "contact": dto.contact_name.strip(),
            "owner": _clean(dto.owner_name),
            "phone": dto.phone,
            "phone_norm": normalize_phone(dto.phone),
            "email": str(dto.email) if dto.email else None,
            "wilaya": dto.wilaya_code,
            "commune": dto.commune.strip(),
            "address": dto.address.strip(),
            "reason": _clean(dto.reason),
        },
    )
    await db.commit()
    # Identical for a first application and a repeat one.
    return {"message": "Merci — votre demande de partenariat a été enregistrée."}


# ── Admin: the queue ──────────────────────────────────────────────────────

_APPLICATION_COLUMNS = """
    a.id, a.business_name, a.activity::text AS activity, a.contact_name, a.owner_name,
    a.phone, a.email, a.wilaya_code, a.commune, a.address, a.reason,
    a.status::text AS status, a.review_note, a.reviewed_at, a.partner_id, a.created_at
"""


def _application_out(r: Any) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "business_name": r.business_name,
        "activity": r.activity,
        "contact_name": r.contact_name,
        "owner_name": r.owner_name,
        "phone": r.phone,
        "email": r.email,
        "wilaya_code": r.wilaya_code,
        "commune": r.commune,
        "address": r.address,
        "reason": r.reason,
        "status": r.status,
        "review_note": r.review_note,
        "reviewed_at": r.reviewed_at,
        "partner_id": None if r.partner_id is None else str(r.partner_id),
        "created_at": r.created_at,
        "prior_applications": r.prior_applications,
    }


@router.get("/partner-applications")
async def partner_applications(
    status_filter: ApplicationStatus = Query("NEW", alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    counts = {
        r.status: r.n for r in (await db.execute(
            text("""
                SELECT status::text AS status, COUNT(*) AS n
                  FROM partner_applications WHERE store_id = :sid GROUP BY status
            """),
            {"sid": store.id},
        )).all()
    }
    rows = (await db.execute(
        text(f"""
            SELECT {_APPLICATION_COLUMNS},
                   (SELECT COUNT(*) FROM partner_applications p
                     WHERE p.store_id = a.store_id AND p.phone_normalized = a.phone_normalized
                       AND p.created_at < a.created_at) AS prior_applications
              FROM partner_applications a
             WHERE a.store_id = :sid AND a.status = CAST(:st AS partner_application_status_enum)
             ORDER BY a.created_at ASC
             LIMIT :limit OFFSET :offset
        """),
        {"sid": store.id, "st": status_filter, "limit": page_size, "offset": (page - 1) * page_size},
    )).all()
    return {
        "status": status_filter,
        "counts": counts,
        "page": page,
        "page_size": page_size,
        "items": [_application_out(r) for r in rows],
    }


async def _move(
    db: AsyncSession, store_id: UUID, application_id: UUID, *,
    to: str, allowed_from: tuple[str, ...], admin_id: UUID, note: str | None,
    partner_id: UUID | None = None,
) -> None:
    moved = (await db.execute(
        text("""
            UPDATE partner_applications
               SET status = CAST(:to AS partner_application_status_enum),
                   review_note = COALESCE(:note, review_note),
                   reviewed_by = :by, reviewed_at = NOW(), updated_at = NOW(),
                   partner_id = COALESCE(:pid, partner_id)
             WHERE id = :aid AND store_id = :sid
               AND status::text = ANY(:allowed)
            RETURNING id
        """),
        {"to": to, "note": note, "by": admin_id, "pid": partner_id,
         "aid": application_id, "sid": store_id, "allowed": list(allowed_from)},
    )).first()
    if moved is None:
        raise _ALREADY_DECIDED


async def _application_row(db: AsyncSession, store_id: UUID, application_id: UUID) -> Any:
    row = (await db.execute(
        text(f"""
            SELECT {_APPLICATION_COLUMNS}, 0 AS prior_applications
              FROM partner_applications a
             WHERE a.id = :aid AND a.store_id = :sid
        """),
        {"aid": application_id, "sid": store_id},
    )).first()
    if row is None:
        raise _NOT_FOUND
    return row


@router.post("/partner-applications/{application_id}/start-review")
async def start_partner_review(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
) -> dict[str, Any]:
    await _application_row(db, store.id, application_id)
    await _move(db, store.id, application_id, to="UNDER_REVIEW", allowed_from=("NEW",),
                admin_id=admin.id, note=None)
    await db.commit()
    return {"id": str(application_id), "status": "UNDER_REVIEW"}


@router.post("/partner-applications/{application_id}/approve")
async def approve_partner(
    application_id: UUID,
    body: NoteIn,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
) -> dict[str, Any]:
    """One transaction: the partner, its first location, and the application
    pointing at it. If another admin decided first, the CAS finds nothing and
    everything written here rolls back with the 409."""
    app = await _application_row(db, store.id, application_id)
    if app.status not in ("NEW", "UNDER_REVIEW"):
        raise _ALREADY_DECIDED

    partner = (await db.execute(
        text("""
            INSERT INTO partners (store_id, name, activity, contact_name, phone, email)
            VALUES (:sid, :name, CAST(:activity AS partner_activity_enum), :contact, :phone, :email)
            RETURNING id
        """),
        {"sid": store.id, "name": app.business_name, "activity": app.activity,
         "contact": app.contact_name, "phone": app.phone, "email": app.email},
    )).first()
    await db.execute(
        text("""
            INSERT INTO partner_locations (store_id, partner_id, wilaya_code, commune, address)
            VALUES (:sid, :pid, :wilaya, :commune, :address)
        """),
        {"sid": store.id, "pid": partner.id, "wilaya": app.wilaya_code,
         "commune": app.commune, "address": app.address},
    )
    try:
        await _move(db, store.id, application_id, to="APPROVED", allowed_from=("NEW", "UNDER_REVIEW"),
                    admin_id=admin.id, note=body.note, partner_id=partner.id)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return {"id": str(application_id), "status": "APPROVED", "partner_id": str(partner.id)}


@router.post("/partner-applications/{application_id}/reject")
async def reject_partner(
    application_id: UUID,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
    admin: CurrentAdmin = Depends(get_current_admin),
) -> dict[str, Any]:
    await _application_row(db, store.id, application_id)
    await _move(db, store.id, application_id, to="REJECTED", allowed_from=("NEW", "UNDER_REVIEW"),
                admin_id=admin.id, note=body.note)
    await db.commit()
    return {"id": str(application_id), "status": "REJECTED"}


# ── Admin: approved partners ──────────────────────────────────────────────

@router.get("/partners")
async def list_partners(
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*READ_ROLES))),
) -> dict[str, Any]:
    partners = (await db.execute(
        text("""
            SELECT id, name, activity::text AS activity, contact_name, phone, email, is_active, created_at
              FROM partners WHERE store_id = :sid
             ORDER BY created_at DESC
        """),
        {"sid": store.id},
    )).all()
    locations = (await db.execute(
        text("""
            SELECT id, partner_id, wilaya_code, commune, address, is_active
              FROM partner_locations WHERE store_id = :sid
             ORDER BY created_at
        """),
        {"sid": store.id},
    )).all()
    by_partner: dict[UUID, list[dict[str, Any]]] = {}
    for loc in locations:
        by_partner.setdefault(loc.partner_id, []).append({
            "id": str(loc.id), "wilaya_code": loc.wilaya_code, "commune": loc.commune,
            "address": loc.address, "is_active": loc.is_active,
        })
    return {
        "items": [
            {
                "id": str(p.id), "name": p.name, "activity": p.activity,
                "contact_name": p.contact_name, "phone": p.phone, "email": p.email,
                "is_active": p.is_active, "created_at": p.created_at,
                "locations": by_partner.get(p.id, []),
            }
            for p in partners
        ],
    }


@router.patch("/partners/{partner_id}")
async def update_partner(
    partner_id: UUID,
    body: PartnerPatch,
    db: AsyncSession = Depends(get_db),
    store: Store = Depends(require_admin_store_for(require_role(*WRITE_ROLES))),
) -> dict[str, Any]:
    row = (await db.execute(
        text("""
            UPDATE partners SET is_active = :active, updated_at = NOW()
             WHERE id = :pid AND store_id = :sid
            RETURNING id, is_active
        """),
        {"active": body.is_active, "pid": partner_id, "sid": store.id},
    )).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Partenaire introuvable.")
    await db.commit()
    return {"id": str(row.id), "is_active": row.is_active}
