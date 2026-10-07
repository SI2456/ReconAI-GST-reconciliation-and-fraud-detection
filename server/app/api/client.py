import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.models import CAProfile, Client, ClientProfile, User
from app.db.session import get_db
from app.core.timeutil import iso_utc, utcnow
from app.services.gstverify import fetch_gstin_captcha, normalize_gstin, verify_gstin_details, verify_gstin_profile


router = APIRouter()


class SelectCARequest(BaseModel):
    caId: str | int


class VerifyGstinRequest(BaseModel):
    gstin: str
    sessionId: str = ""
    captcha: str = ""


class UpdateClientProfileRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    firmName: str | None = None
    gstin: str | None = None


def get_or_create_profile(db: Session, user: User) -> ClientProfile:
    profile = db.query(ClientProfile).filter(ClientProfile.user_id == user.id).first()
    if not profile:
        profile = ClientProfile(
            id=f"cp_{uuid.uuid4().hex[:16]}",
            user_id=user.id,
            selected_ca_id=None,
        )
        db.add(profile)
        db.flush()
    return profile


def serialize_profile(db: Session, user: User) -> dict:
    profile = get_or_create_profile(db, user)
    client = db.query(Client).filter((Client.email == user.email) | (Client.gstin == user.gstin)).first()
    effective_ca_id = (client.ca_id if client and client.ca_id else profile.selected_ca_id)
    public_gstin = "" if client and client.gstin.startswith("PENDING") else (client.gstin if client else user.gstin)
    ca = db.get(User, str(effective_ca_id)) if effective_ca_id else None
    ca_profile = db.query(CAProfile).filter(CAProfile.user_id == ca.id).first() if ca else None
    return {
        "id": profile.id,
        "userId": user.id,
        "clientId": client.id if client else None,
        "selectedCaId": effective_ca_id,
        "needsCaSelection": effective_ca_id is None,
        "client": {
            "name": client.name if client else user.name,
            "gstin": public_gstin,
            "email": client.email if (client and client.email) else user.email,
            "phone": user.phone or "",
            "firmName": user.firm_name or "",
            "city": client.city if client else "",
            "gstLegalName": client.gst_legal_name if client else "",
            "gstTradeName": client.gst_trade_name if client else "",
            "gstStatus": client.gst_status if client else "",
            "gstVerifiedAt": iso_utc(client.gst_verified_at) if client else None,
            "gstDetails": json.loads(client.gst_details_json) if client and client.gst_details_json else {},
        },
        "ca": {
            "id": ca.id,
            "name": ca.name,
            "email": ca.email,
            "firmName": ca.firm_name,
            "specialization": ca_profile.specialization if ca_profile else "GST",
            "experience": ca_profile.experience if ca_profile else "0 Years",
            "city": ca_profile.city if ca_profile else "",
            "rating": ca_profile.rating if ca_profile else 4.5,
        }
        if ca
        else None,
    }


def assign_ca(db: Session, user: User, ca_id: str | int) -> dict:
    ca = db.get(User, str(ca_id))
    if not ca or ca.role != "ca" or ca.status != "active" or not ca.email_verified:
        raise HTTPException(status_code=404, detail="Verified CA not found.")

    profile = get_or_create_profile(db, user)
    profile.selected_ca_id = ca.id

    clients = db.query(Client).filter((Client.email == user.email) | (Client.gstin == user.gstin)).all()
    for client in clients:
        client.ca_id = ca.id

    db.commit()
    return {"message": "CA selected successfully.", "profile": serialize_profile(db, user)}


@router.get("/profile")
def client_profile(db: Session = Depends(get_db), user: User = Depends(require_roles("client"))) -> dict:
    return {"profile": serialize_profile(db, user)}


@router.put("/profile")
def update_client_profile(
    payload: UpdateClientProfileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("client")),
) -> dict:
    # Update user fields
    if payload.name is not None and payload.name.strip():
        user.name = payload.name.strip()
    if payload.phone is not None:
        user.phone = payload.phone.strip()
    if payload.firmName is not None:
        user.firm_name = payload.firmName.strip()
    if payload.gstin is not None:
        user.gstin = payload.gstin.strip().upper()
    if payload.email is not None and payload.email.strip() and payload.email.strip().lower() != user.email.lower():
        new_email = payload.email.strip().lower()
        existing = db.query(User).filter(User.email == new_email, User.id != user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="This email address is already in use.")
        user.email = new_email

    # Update associated Client row
    client = db.query(Client).filter((Client.email == user.email) | (Client.gstin == user.gstin)).first()
    if not client:
        client = Client(
            id=f"cli_{uuid.uuid4().hex[:12]}",
            name=user.name,
            gstin=user.gstin or f"PENDING_{uuid.uuid4().hex[:8].upper()}",
            email=user.email,
            city=payload.city.strip() if payload.city else "",
        )
        db.add(client)
    else:
        if payload.name is not None and payload.name.strip():
            client.name = payload.name.strip()
        if payload.city is not None:
            client.city = payload.city.strip()
        if payload.email is not None and payload.email.strip():
            client.email = payload.email.strip()
        if payload.gstin is not None:
            client.gstin = payload.gstin.strip().upper()

    db.commit()
    return {
        "message": "Client profile updated successfully.",
        "profile": serialize_profile(db, user),
    }


@router.post("/select-ca")
def select_ca(payload: SelectCARequest, db: Session = Depends(get_db), user: User = Depends(require_roles("client"))) -> dict:
    return assign_ca(db, user, payload.caId)


@router.put("/change-ca")
def change_ca(payload: SelectCARequest, db: Session = Depends(get_db), user: User = Depends(require_roles("client"))) -> dict:
    return assign_ca(db, user, payload.caId)


@router.get("/gstin-captcha")
async def gstin_captcha(user: User = Depends(require_roles("client"))) -> dict:
    return await fetch_gstin_captcha()


@router.post("/verify-gstin")
async def verify_client_gstin(payload: VerifyGstinRequest, db: Session = Depends(get_db), user: User = Depends(require_roles("client"))) -> dict:
    gstin = normalize_gstin(payload.gstin)
    if payload.sessionId and payload.captcha:
        data = await verify_gstin_details(gstin, payload.sessionId, payload.captcha)
    else:
        data = await verify_gstin_profile(gstin)

    client = db.query(Client).filter((Client.email == user.email) | (Client.gstin == user.gstin) | (Client.gstin == gstin)).first()
    if not client:
        client = Client(id=f"cli_{uuid.uuid4().hex[:12]}", name=user.name, gstin=gstin, email=user.email, ca_id=None)
        db.add(client)
        db.flush()

    legal_name = data.get("legalName") or data.get("tradeName") or ""
    client.gstin = gstin
    client.gst_legal_name = data.get("legalName") or ""
    client.gst_trade_name = data.get("tradeName") or ""
    client.gst_status = data.get("status") or "Active"
    client.gst_details_json = json.dumps(data, default=str)
    client.gst_verified_at = utcnow()
    if legal_name and (not client.name or client.name == "Client Workspace" or client.name.startswith("User ")):
        client.name = legal_name

    user.gstin = gstin
    if legal_name and (not user.name or user.name == "Client Workspace" or user.name.startswith("User ")):
        user.name = legal_name

    db.commit()
    return {
        "message": f"GSTIN {gstin} verified successfully.",
        "client": serialize_profile(db, user)["client"],
    }


@router.get("/reupload-requests")
def get_reupload_requests(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("client", "ca", "admin")),
) -> dict:
    """Returns all active document re-upload requests for this client."""
    from app.db.models import Invoice, FraudAlert, Upload

    clients = db.query(Client).filter((Client.email == user.email) | (Client.gstin == user.gstin)).all()
    client_ids = [c.id for c in clients]
    if not client_ids and user.role != "client":
        from app.api.deps import scoped_client_ids
        client_ids = scoped_client_ids(db, user)

    if not client_ids:
        return {"requests": []}

    invoices = db.query(Invoice).filter(
        Invoice.client_id.in_(client_ids),
        Invoice.reupload_status == "requested",
    ).all()

    alerts = db.query(FraudAlert).filter(
        FraudAlert.client_id.in_(client_ids),
        FraudAlert.reupload_status == "requested",
    ).all()

    requests_list = []
    seen_inv_ids = set()

    for inv in invoices:
        seen_inv_ids.add(inv.id)
        # Find upload if any
        up = db.get(Upload, inv.upload_id) if inv.upload_id else None
        requests_list.append({
            "id": f"req_{inv.id}",
            "invoiceId": inv.id,
            "invoiceNo": inv.invoice_no,
            "supplier": inv.supplier,
            "supplierGstin": inv.supplier_gstin,
            "taxPeriod": inv.tax_period,
            "category": inv.source_document_type or "TAX_INVOICE",
            "documentType": inv.source_document_type or "TAX_INVOICE",
            "amount": inv.total,
            "reason": inv.reupload_note or "Tax officer requested document re-upload for verification.",
            "note": inv.reupload_note or "Tax officer requested document re-upload for verification.",
            "sourceBatchFile": up.file_name if up else "",
            "createdAt": iso_utc(inv.created_at),
            "status": "requested",
        })

    for alt in alerts:
        if alt.invoice_id and alt.invoice_id in seen_inv_ids:
            continue
        inv = db.get(Invoice, alt.invoice_id) if alt.invoice_id else None
        requests_list.append({
            "id": f"req_alt_{alt.id}",
            "alertId": alt.id,
            "invoiceId": alt.invoice_id or "",
            "invoiceNo": inv.invoice_no if inv else alt.entity,
            "supplier": inv.supplier if inv else alt.entity,
            "supplierGstin": inv.supplier_gstin if inv else "",
            "taxPeriod": inv.tax_period if inv else "",
            "category": inv.source_document_type if inv else "TAX_INVOICE",
            "documentType": inv.source_document_type if inv else "TAX_INVOICE",
            "amount": alt.amount,
            "reason": alt.reupload_note or alt.reason or "Tax officer requested document re-upload.",
            "note": alt.reupload_note or alt.reason or "Tax officer requested document re-upload.",
            "sourceBatchFile": "",
            "createdAt": iso_utc(alt.created_at),
            "status": "requested",
        })

    return {"requests": requests_list}
