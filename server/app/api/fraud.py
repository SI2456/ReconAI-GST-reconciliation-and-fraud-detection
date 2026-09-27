import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.periods import period_to_mm_yyyy, parse_month_year, periods_match
from app.api.deps import ensure_client_scope, get_current_user, scoped_client_ids
from app.db.models import FraudAlert, Invoice, ReconciliationJob, User, Upload
from app.db.session import get_db
from app.services.ml import run_fraud_detection
from app.services.parsing import derive_tax_period


router = APIRouter()


class RunRequest(BaseModel):
    clientId: str | int
    taxPeriod: str | None = None


class AlertStatusUpdate(BaseModel):
    status: str  # "false_positive" | "escalated" | "Open"


@router.get("/periods")
def fraud_periods(
    clientId: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    ensure_client_scope(db, user, clientId)

    periods_set = set()

    # 1. From completed reconciliation runs
    jobs = (
        db.query(ReconciliationJob)
        .filter(ReconciliationJob.client_id == clientId)
        .order_by(ReconciliationJob.created_at.desc())
        .all()
    )
    for job in jobs:
        try:
            summ = json.loads(job.summary_json or "{}")
            p = summ.get("taxPeriod")
            if p and p.upper() not in ("ALL", "ALL UPLOADED DATA"):
                canon = period_to_mm_yyyy(p)
                if canon:
                    periods_set.add(canon)
        except Exception:
            pass

    # 2. From client invoices with reconciliation / tax period tags
    invoices = db.query(Invoice).filter(Invoice.client_id == clientId).all()
    for inv in invoices:
        if inv.tax_period and inv.tax_period.strip() and inv.tax_period.upper() not in ("ALL", "ALL UPLOADED DATA"):
            canon = period_to_mm_yyyy(inv.tax_period.strip())
            if canon:
                periods_set.add(canon)
        elif inv.invoice_date:
            derived = derive_tax_period(str(inv.invoice_date))
            canon = period_to_mm_yyyy(derived)
            if canon:
                periods_set.add(canon)

    # 3. From client uploads (only if valid tax period or filename contains MM-YYYY)
    uploads = db.query(Upload).filter(Upload.client_id == clientId).all()
    for up in uploads:
        if up.tax_periods:
            for p in up.tax_periods.split(","):
                p_clean = p.strip()
                if p_clean and p_clean.upper() not in ("ALL", "ALL UPLOADED DATA"):
                    canon = period_to_mm_yyyy(p_clean)
                    if canon and re.match(r"^\d{2}-\d{4}$", canon):
                        periods_set.add(canon)
        fname = up.file_name or ""
        m = re.search(r"(\d{2})[-_](\d{4})", fname)
        if m:
            m_val = int(m.group(1))
            if 1 <= m_val <= 12:
                periods_set.add(f"{m.group(1)}-{m.group(2)}")

    # Strictly keep only valid MM-YYYY formats
    valid_periods = [p for p in periods_set if re.match(r"^\d{2}-\d{4}$", p)]

    # Sort periods chronologically
    def _sort_key(p: str):
        m = re.match(r"^(\d{2})-(\d{4})$", p)
        if m:
            return (int(m.group(2)), int(m.group(1)))
        return (0, 0)

    sorted_periods = sorted(valid_periods, key=_sort_key)
    return {"clientId": clientId, "periods": sorted_periods}


@router.get("/alerts")
def fraud_alerts(
    clientId: str | None = None,
    taxPeriod: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    client_ids = scoped_client_ids(db, user)
    if not client_ids:
        return {"alerts": []}

    target_clients = [clientId] if clientId and clientId in client_ids else client_ids

    query = db.query(FraudAlert).filter(FraudAlert.client_id.in_(target_clients))

    clean_period = (taxPeriod or "").strip()
    if clean_period and clean_period.upper() not in ("ALL", "ALL UPLOADED DATA"):
        raw_items = query.order_by(FraudAlert.risk.desc()).all()
        filtered = []
        for alert_obj in raw_items:
            inv = db.query(Invoice).filter(Invoice.id == alert_obj.invoice_id).first()
            inv_p = (inv.tax_period if inv else "") or ""
            if not inv_p and inv and inv.invoice_date:
                from app.services.parsing import derive_tax_period
                inv_p = derive_tax_period(str(inv.invoice_date))
            if periods_match(inv_p, clean_period):
                filtered.append(alert_obj)
        
        # If no alerts found in DB for this period yet, automatically score and generate them
        if not filtered and clientId:
            try:
                gen_alerts = run_fraud_detection(db, clientId, tax_period=clean_period)
                if gen_alerts:
                    return {"alerts": [serialize_alert(item, db=db) for item in gen_alerts]}
            except Exception:
                pass
        items = filtered
    else:
        items = query.order_by(FraudAlert.risk.desc()).all()

    return {"alerts": [serialize_alert(item, db=db) for item in items]}


@router.post("/run")
def run(payload: RunRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    ensure_client_scope(db, user, payload.clientId)
    alerts_result = run_fraud_detection(db, payload.clientId, tax_period=payload.taxPeriod)
    return {"alerts": [serialize_alert(item, db=db) for item in alerts_result]}


import uuid

from app.db.models import FraudAlert, Invoice, Message, ReconciliationJob, User, Upload


class ReuploadRequest(BaseModel):
    alertId: str | None = None
    invoiceId: str | None = None
    clientId: str | None = None
    note: str | None = ""


@router.post("/request-reupload")
def request_reupload(
    payload: ReuploadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Tax Officer requests a client to re-upload a document for an invoice/case."""
    # RBAC: Only CA/Tax Officers and Admins can request re-uploads
    if user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot issue re-upload requests.")

    alert = None
    invoice = None

    if payload.alertId:
        alert = db.query(FraudAlert).filter(FraudAlert.id == str(payload.alertId)).first()
    if not alert and payload.invoiceId:
        alert = db.query(FraudAlert).filter(FraudAlert.invoice_id == str(payload.invoiceId)).first()

    if payload.invoiceId:
        invoice = db.query(Invoice).filter(Invoice.id == str(payload.invoiceId)).first()
    if not invoice and alert and alert.invoice_id:
        invoice = db.query(Invoice).filter(Invoice.id == alert.invoice_id).first()

    client_id = payload.clientId or (alert.client_id if alert else (invoice.client_id if invoice else None))
    if not client_id:
        raise HTTPException(status_code=404, detail="Target client could not be determined.")

    ensure_client_scope(db, user, client_id)

    note_text = (payload.note or "").strip() or "Tax officer requested document re-upload for verification."

    if invoice:
        invoice.reupload_status = "requested"
        invoice.reupload_note = note_text

    if alert:
        alert.reupload_status = "requested"
        alert.reupload_note = note_text

    inv_display = invoice.invoice_no if invoice else (alert.entity if alert else "Document")
    msg_text = f"⚡ [Action Required] Tax Officer requested document re-upload for Invoice {inv_display}. Reason / Note: {note_text}"

    # Log in messages so it appears in client's communication center
    msg = Message(
        id=f"msg_{uuid.uuid4().hex[:16]}",
        client_id=client_id,
        sender_id=user.id,
        text=msg_text,
    )
    db.add(msg)
    db.commit()

    if alert:
        db.refresh(alert)
    if invoice:
        db.refresh(invoice)

    return {
        "ok": True,
        "message": f"Re-upload request sent to client for {inv_display}.",
        "alert": serialize_alert(alert, db=db) if alert else None,
    }


@router.patch("/alerts/{alert_id}")
def update_alert_status(
    alert_id: str,
    payload: AlertStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Update alert status for current period (false_positive / escalated / Open)."""
    VALID_STATUSES = {"Open", "false_positive", "escalated"}
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")

    alert = db.query(FraudAlert).filter(FraudAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # RBAC: ensure user can access this client's alerts
    ensure_client_scope(db, user, alert.client_id)

    alert.status = payload.status
    db.commit()
    return {"alert": serialize_alert(alert, db=db)}


def serialize_alert(alert: FraudAlert, db: Session | None = None) -> dict:
    shap_raw = json.loads(alert.shap_json or "[]")
    # Separate source tags from explanation chips
    source_tags = [t for t in shap_raw if t in ("rule_engine", "ml")]
    chips = [t for t in shap_raw if t not in ("rule_engine", "ml")]
    source = (
        "Both" if len(source_tags) == 2
        else "Rule Engine" if source_tags == ["rule_engine"]
        else "ML Model"
    )
    inv_no = None
    batch_file = None
    reup_status = alert.reupload_status or ""
    reup_note = alert.reupload_note or ""
    reup_file = ""
    reup_at = ""

    if db and alert.invoice_id:
        inv = db.query(Invoice).filter(Invoice.id == alert.invoice_id).first()
        if inv:
            inv_no = inv.invoice_no
            if not reup_status and inv.reupload_status:
                reup_status = inv.reupload_status
            if not reup_note and inv.reupload_note:
                reup_note = inv.reupload_note
            reup_file = inv.reuploaded_file_name or ""
            reup_at = inv.reuploaded_at.isoformat() if inv.reuploaded_at else ""
            if inv.upload_id:
                up = db.query(Upload).filter(Upload.id == inv.upload_id).first()
                if up:
                    batch_file = up.file_name

    risk_breakdown = json.loads(getattr(alert, "risk_breakdown", None) or "[]")
    return {
        "id": alert.id,
        "clientId": alert.client_id,
        "invoiceId": alert.invoice_id,
        "invoiceNo": inv_no,
        "sourceBatchFile": batch_file,
        "type": alert.type,
        "entity": alert.entity,
        "risk": alert.risk,
        "amount": alert.amount,
        "reason": alert.reason,
        "summary": alert.reason,
        "riskBreakdown": risk_breakdown,
        "shap": chips,
        "source": source,
        "status": alert.status,
        "reuploadStatus": reup_status,
        "reuploadNote": reup_note,
        "reuploadedFileName": reup_file,
        "reuploadedAt": reup_at,
        "isReupload": reup_status == "reuploaded",
    }
