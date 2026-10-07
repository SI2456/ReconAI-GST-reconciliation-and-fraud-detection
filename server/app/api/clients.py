import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles, scoped_client_ids
from app.db.models import Client, FraudAlert, Invoice, Upload, User
from app.db.session import get_db
from app.core.timeutil import iso_utc, utcnow


router = APIRouter()


class CreateClientRequest(BaseModel):
    name: str
    gstin: str
    email: str = ""
    city: str = ""
    caId: int | None = None


def serialize_client(db: Session, client: Client) -> dict:
    books_invoices = db.query(Invoice).filter(Invoice.client_id == client.id, Invoice.source == "books").all()
    total_books = len(books_invoices)
    matched_books = sum(1 for i in books_invoices if i.status == "Matched")
    compliance = round((matched_books / total_books) * 100) if total_books > 0 else 0

    open_alerts = db.query(FraudAlert).filter(
        FraudAlert.client_id == client.id,
        ~FraudAlert.status.in_(["Resolved", "Dismissed"])
    ).all()
    avg_alert_risk = sum(a.risk for a in open_alerts) / len(open_alerts) if open_alerts else 0.0
    max_risk = max((a.risk for a in open_alerts), default=0)

    comp_gap = 100 - compliance
    blended_risk = round((0.5 * comp_gap) + (0.5 * avg_alert_risk), 1)

    if blended_risk >= 75:
        risk_level = "Critical"
    elif blended_risk >= 50:
        risk_level = "High"
    elif blended_risk >= 25:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    ca = client.ca
    public_gstin = "" if client.gstin.startswith("PENDING") else client.gstin
    return {
        "id": client.id,
        "name": client.name,
        "gstin": public_gstin,
        "gstLegalName": client.gst_legal_name,
        "gstTradeName": client.gst_trade_name,
        "gstStatus": client.gst_status,
        "gstVerifiedAt": iso_utc(client.gst_verified_at),
        "gstDetails": json.loads(client.gst_details_json) if client.gst_details_json else {},
        "email": client.email,
        "city": client.city,
        "status": client.status,
        "risk": risk_level,
        "blended_risk": blended_risk,
        "avg_alert_risk": round(avg_alert_risk, 1),
        "compliance": compliance,
        "invoices": total_books,
        "invoices_count": total_books,
        "caId": client.ca_id,
        "caName": ca.name if ca else "",
        "caEmail": ca.email if ca else "",
        "firmName": ca.firm_name if ca else "",
    }


@router.get("")
def list_clients(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    client_ids = scoped_client_ids(db, user)
    clients = db.query(Client).filter(Client.id.in_(client_ids)).order_by(Client.name).all() if client_ids else []
    return {"clients": [serialize_client(db, client) for client in clients]}


@router.post("", status_code=201)
def create_client(
    payload: CreateClientRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "ca")),
) -> dict:
    if not payload.name.strip() or not payload.gstin.strip():
        raise HTTPException(status_code=400, detail="Client name and GSTIN are required.")
    if db.query(Client).filter(Client.gstin == payload.gstin.strip().upper()).first():
        raise HTTPException(status_code=409, detail="A client with this GSTIN already exists.")
    ca_id = user.id if user.role == "ca" else payload.caId
    if ca_id is not None:
        ca = db.get(User, ca_id)
        if not ca or ca.role != "ca" or ca.status != "active":
            raise HTTPException(status_code=400, detail="Invalid tax officer assignment.")
    client_id = f"cl_{uuid.uuid4().hex[:16]}"
    client = Client(
        id=client_id,
        name=payload.name.strip(),
        gstin=payload.gstin.strip().upper(),
        email=payload.email.strip().lower(),
        ca_id=ca_id,
        city=payload.city.strip(),
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return {"client": serialize_client(db, client)}


@router.delete("/{client_id}")
def delete_client(
    client_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "ca")),
) -> dict:
    ensure_ids = scoped_client_ids(db, user)
    if str(client_id) not in ensure_ids:
        raise HTTPException(status_code=403, detail="Client is outside your workspace.")
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    db.query(Invoice).filter(Invoice.client_id == client_id).delete(synchronize_session=False)
    db.query(Upload).filter(Upload.client_id == client_id).delete(synchronize_session=False)
    db.delete(client)
    db.commit()
    return {"message": "Client deleted successfully."}


@router.get("/me")
def my_client(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    client_ids = scoped_client_ids(db, user)
    client = db.get(Client, client_ids[0]) if client_ids else None
    return {"client": serialize_client(db, client) if client else None}
