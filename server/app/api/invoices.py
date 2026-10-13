import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, require_roles, scoped_client_ids
from app.db.models import Invoice, Message, User
from app.db.session import get_db
from app.core.timeutil import format_ist, iso_utc, utcnow
from app.services.audit import record_activity
from app.services.itc import ITC_APPROVED, ITC_REJECTED, itc_decision


router = APIRouter()


@router.get("")
def list_invoices(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    client_ids = scoped_client_ids(db, user)
    invoices = (
        db.query(Invoice)
        .filter(Invoice.client_id.in_(client_ids))
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .all()
        if client_ids
        else []
    )
    return {
        "invoices": [
            {
                "id": invoice.id,
                "client_id": invoice.client_id,
                "clientId": invoice.client_id,
                "invoice_no": invoice.invoice_no,
                "invoiceNo": invoice.invoice_no,
                "supplier": invoice.supplier,
                "supplier_gstin": invoice.supplier_gstin,
                "supplierGstin": invoice.supplier_gstin,
                "invoice_date": invoice.invoice_date,
                "invoiceDate": invoice.invoice_date,
                "tax_period": invoice.tax_period,
                "taxPeriod": invoice.tax_period,
                "taxable": invoice.taxable,
                "gst": invoice.gst,
                "total": invoice.total,
                "source": invoice.source,
                "status": invoice.status,
                "risk": invoice.risk,
                "reupload_status": invoice.reupload_status or "",
                "reuploadStatus": invoice.reupload_status or "",
                "reupload_note": invoice.reupload_note or "",
                "reuploadNote": invoice.reupload_note or "",
                "reuploaded_file_name": invoice.reuploaded_file_name or "",
                "reuploadedFileName": invoice.reuploaded_file_name or "",
                "reuploaded_at": invoice.reuploaded_at.isoformat() if invoice.reuploaded_at else "",
                "reuploadedAt": iso_utc(invoice.reuploaded_at) or "",
                "is_reupload": invoice.reupload_status == "reuploaded",
                "isReupload": invoice.reupload_status == "reuploaded",
                "itc": itc_decision(db, invoice),
            }
            for invoice in invoices
        ]
    }


class ItcDecisionRequest(BaseModel):
    decision: str  # "approve" or "reject"
    reason: str = ""


@router.post("/{invoice_id}/itc-decision")
def decide_itc(
    invoice_id: str,
    payload: ItcDecisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ca", "admin")),
) -> dict:
    """Level 7: the tax officer approves or rejects the ITC claim on a tax invoice."""
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    ensure_client_scope(db, user, invoice.client_id)

    decision = payload.decision.strip().lower()
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="Decision must be 'approve' or 'reject'.")
    if invoice.itc_status == ITC_APPROVED:
        raise HTTPException(
            status_code=409,
            detail=f"ITC for invoice {invoice.invoice_no} was already approved on {format_ist(invoice.itc_decided_at)}.",
        )

    reason = payload.reason.strip()
    if decision == "approve":
        # ITC can only be claimed for an invoice the supplier has reported in GSTR-2B.
        if invoice.source != "books" or invoice.status != "Matched":
            raise HTTPException(
                status_code=409,
                detail=f"ITC can only be approved for an invoice matched with GSTR-2B "
                       f"(this invoice is '{invoice.status or 'not reconciled'}'). Run reconciliation first.",
            )
        invoice.itc_status, invoice.itc_reject_reason = ITC_APPROVED, ""
    else:
        if len(reason) < 5:
            raise HTTPException(status_code=422, detail="Please give a reason for rejecting this ITC claim.")
        invoice.itc_status, invoice.itc_reject_reason = ITC_REJECTED, reason
    invoice.itc_decided_at = utcnow()
    invoice.itc_decided_by = user.id

    when = format_ist(invoice.itc_decided_at)
    text = (
        f"✅ ITC approved for invoice {invoice.invoice_no} (₹{invoice.total:,.2f}) by {user.name} on {when}."
        if decision == "approve"
        else f"❌ ITC rejected for invoice {invoice.invoice_no} by {user.name} on {when}. Reason: {reason}"
    )
    db.add(Message(id=f"msg_{uuid.uuid4().hex[:16]}", client_id=invoice.client_id, sender_id=user.id,
                   text=text, created_at=invoice.itc_decided_at))
    record_activity(db, user, "ITC_APPROVED" if decision == "approve" else "ITC_REJECTED",
                    invoice.invoice_no, text, invoice_id=invoice.id, client_id=invoice.client_id)
    db.commit()
    return {"itc": itc_decision(db, invoice)}
