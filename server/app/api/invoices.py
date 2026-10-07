from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, scoped_client_ids
from app.db.models import Invoice, User
from app.db.session import get_db
from app.core.timeutil import iso_utc, utcnow


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
            }
            for invoice in invoices
        ]
    }
