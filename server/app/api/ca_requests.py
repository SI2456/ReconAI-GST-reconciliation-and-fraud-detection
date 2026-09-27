import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, require_roles, scoped_client_ids
from app.db.models import CAChangeRequest, Client, User
from app.db.session import get_db


router = APIRouter()


class CreateRequest(BaseModel):
    clientId: str | int
    requestedCaId: str | int
    reason: str = ""


def serialize_request(db: Session, item: CAChangeRequest) -> dict:
    client = db.get(Client, item.client_id)
    current_ca = db.get(User, item.current_ca_id) if item.current_ca_id else None
    requested_ca = db.get(User, item.requested_ca_id)
    return {
        "id": item.id,
        "clientId": item.client_id,
        "clientName": client.name if client else "",
        "clientEmail": client.email if client else "",
        "currentCaId": item.current_ca_id,
        "currentCaName": current_ca.name if current_ca else "Unassigned",
        "requestedCaId": item.requested_ca_id,
        "requestedCaName": requested_ca.name if requested_ca else "",
        "reason": item.reason,
        "status": item.status,
        "createdAt": item.created_at,
    }


@router.get("")
def list_requests(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    query = db.query(CAChangeRequest)
    if user.role == "client":
        query = query.filter(CAChangeRequest.client_id.in_(scoped_client_ids(db, user)))
    elif user.role == "ca":
        query = query.filter(
            (CAChangeRequest.current_ca_id == user.id) | (CAChangeRequest.requested_ca_id == user.id)
        )
    elif user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    items = query.order_by(CAChangeRequest.created_at.desc()).all()
    return {"requests": [serialize_request(db, item) for item in items]}


@router.post("", status_code=201)
def create_request(payload: CreateRequest, db: Session = Depends(get_db), user: User = Depends(require_roles("client"))) -> dict:
    ensure_client_scope(db, user, payload.clientId)
    requested_ca = db.get(User, str(payload.requestedCaId))
    if not requested_ca or requested_ca.role != "ca" or requested_ca.status != "active" or not requested_ca.email_verified:
        raise HTTPException(status_code=404, detail="Verified tax officer not found.")
    client = db.get(Client, str(payload.clientId))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    existing = db.query(CAChangeRequest).filter(
        CAChangeRequest.client_id == str(payload.clientId),
        CAChangeRequest.status == "Pending",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A tax officer change request is already pending.")
    item = CAChangeRequest(
        id=f"car_{uuid.uuid4().hex[:16]}",
        client_id=client.id,
        requested_by=user.id,
        current_ca_id=client.ca_id,
        requested_ca_id=requested_ca.id,
        reason=payload.reason.strip(),
        status="Pending",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"request": serialize_request(db, item)}


@router.post("/{request_id}/approve")
def approve_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> dict:
    item = db.get(CAChangeRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found.")
    if item.status != "Pending":
        raise HTTPException(status_code=409, detail="Request has already been decided.")
    client = db.get(Client, item.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    client.ca_id = item.requested_ca_id
    item.status = "Approved"
    item.reviewed_by = user.id
    item.reviewed_at = datetime.utcnow()
    db.commit()
    return {"message": "Tax officer change request approved."}


@router.post("/{request_id}/reject")
def reject_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))) -> dict:
    item = db.get(CAChangeRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found.")
    if item.status != "Pending":
        raise HTTPException(status_code=409, detail="Request has already been decided.")
    item.status = "Rejected"
    item.reviewed_by = user.id
    item.reviewed_at = datetime.utcnow()
    db.commit()
    return {"message": "Tax officer change request rejected."}
