import json
import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, scoped_client_ids
from app.api.fraud import serialize_alert
from app.core.security import decode_access_token
from app.db.models import CAProfile, Client, FraudAlert, Invoice, Upload, User
from app.db.session import get_db
from app.services.gstverify import verify_gstin_profile
from app.services.storage import inline_disposition, read_bytes


router = APIRouter()


class DetailsUpdate(BaseModel):
    invoiceInfo: dict = {}
    supplierInfo: dict = {}
    buyerInfo: dict = {}
    productInfo: dict = {}
    matchingPO: dict = {}


@router.get("/api/fraud-alerts")
@router.get("/api/fraud/alerts")
def fraud_alerts_alias(
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
    if clean_period and clean_period.upper() != "ALL":
        query = query.join(Invoice, FraudAlert.invoice_id == Invoice.id).filter(
            (Invoice.tax_period == clean_period) | (Invoice.tax_period.ilike(f"%{clean_period}%"))
        )
    alerts = query.order_by(FraudAlert.risk.desc()).all()
    return {"alerts": [serialize_alert(alert, db=db) for alert in alerts]}


@router.post("/api/gst/verify")
async def gst_verify_alias(payload: dict, _: User = Depends(get_current_user)) -> dict:
    data = await verify_gstin_profile(str(payload.get("gstin", "")))
    return {"ok": True, "gstin": data["gstin"], "data": data}


@router.get("/api/cas")
def ca_directory(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    cas = db.query(User).filter(User.role == "ca", User.status == "active", User.email_verified.is_(True)).order_by(User.name).all()
    clients = db.query(Client).order_by(Client.name).all()
    return {
        "cas": [
            {
                "id": ca.id,
                "name": ca.name,
                "email": ca.email,
                "firm_name": ca.firm_name,
                "icai_number": ca.icai_number,
                "clients": [
                    {"id": client.id, "name": client.name, "email": client.email, "gstin": client.gstin, "city": client.city, "compliance": client.compliance, "status": client.status}
                    for client in clients if client.ca_id == ca.id
                ],
            }
            for ca in cas
        ],
        "unassignedClients": [
            {"id": client.id, "name": client.name, "email": client.email, "gstin": client.gstin, "city": client.city}
            for client in clients if client.ca_id is None
        ],
    }


def _reconciled_partner(db: Session, invoice: Invoice, counter_source: str) -> Invoice | None:
    """The counterpart that the last reconciliation run paired with this invoice.

    Before reconciliation has run (or for results saved before pairings were recorded), only
    an exact invoice-key match is shown. Invoices that reconciliation marked Missing get no
    partner rather than a same-supplier guess.
    """
    def exact_key_match() -> Invoice | None:
        return (
            db.query(Invoice)
            .filter(
                Invoice.client_id == invoice.client_id,
                Invoice.source == counter_source,
                Invoice.normalized_key == invoice.normalized_key,
            )
            .first()
        )

    def recorded_pairing(books_invoice: Invoice) -> tuple[bool, str | None]:
        """(pairing recorded?, paired GSTR-2B id). Runs from before pairings were saved record none."""
        try:
            flags = json.loads(books_invoice.validation_flags or "{}")
        except (TypeError, ValueError):
            flags = {}
        recorded = "matched_gstr_id" in flags or flags.get("doc_match") == "MISSING_IN_GSTR2B"
        return recorded, flags.get("matched_gstr_id")

    if counter_source == "gstr":
        recorded, gstr_id = recorded_pairing(invoice)
        if not recorded:
            return exact_key_match()
        partner = db.get(Invoice, gstr_id) if gstr_id else None
        return partner if partner and partner.client_id == invoice.client_id else None

    # Viewing a GSTR-2B record: find the books invoice whose reconciliation claimed it.
    claimant = (
        db.query(Invoice)
        .filter(
            Invoice.client_id == invoice.client_id,
            Invoice.source == "books",
            Invoice.validation_flags.like(f'%"matched_gstr_id": "{invoice.id}"%'),
        )
        .first()
    )
    if claimant:
        return claimant
    books_invoice = exact_key_match()
    if books_invoice and recorded_pairing(books_invoice)[0]:
        return None  # reconciliation paired that invoice with a different record (or none)
    return books_invoice


def _details(upload: Upload, invoice: Invoice | None, db: Session | None = None) -> dict:
    cgst_val = invoice.cgst if invoice and invoice.cgst else (round(invoice.gst / 2.0, 2) if invoice and invoice.gst and not getattr(invoice, "igst", 0.0) else 0.0)
    sgst_val = invoice.sgst if invoice and invoice.sgst else (round(invoice.gst / 2.0, 2) if invoice and invoice.gst and not getattr(invoice, "igst", 0.0) else 0.0)
    igst_val = invoice.igst if invoice and invoice.igst else 0.0
    tot_tax = invoice.gst if invoice and invoice.gst else (cgst_val + sgst_val + igst_val)

    matching_invoices = []
    pr_record = None

    if invoice and db:
        # Determine counterparty source
        is_gstr_doc = (invoice.source or "").lower() == "gstr" or (invoice.source_document_type or "").upper() == "GSTR2B"
        counter_source = "books" if is_gstr_doc else "gstr"
        partner = _reconciled_partner(db, invoice, counter_source)

        if partner:
            amt_diff = abs((invoice.total or 0) - (partner.total or 0))
            is_matched = amt_diff <= max(1.0, 0.01 * max(abs(invoice.total or 0), abs(partner.total or 0)))
            score = 100 if is_matched else 75
            status_str = "Matched" if is_matched else "Mismatched"
            matching_invoices.append({
                "id": partner.id,
                "uploadId": partner.upload_id or "",
                "invoiceNumber": partner.invoice_no or invoice.invoice_no,
                "supplierName": partner.supplier or invoice.supplier,
                "supplierGstin": partner.supplier_gstin or invoice.supplier_gstin,
                "invoiceDate": partner.invoice_date or invoice.invoice_date,
                "taxable": partner.taxable or 0.0,
                "gst": partner.gst or 0.0,
                "total": partner.total or 0.0,
                "matchScore": score,
                "status": status_str,
                "matchType": "EXACT_KEY" if partner.normalized_key == invoice.normalized_key else "FUZZY_INVOICE_NO",
            })

        # Books/Purchase Register record
        books_inv = invoice if invoice.source != "gstr" else partner
        if books_inv:
            pr_record = {
                "invoiceNumber": books_inv.invoice_no,
                "invoiceDate": books_inv.invoice_date,
                "supplierName": books_inv.supplier,
                "supplierGstin": books_inv.supplier_gstin,
                "taxable": books_inv.taxable or 0.0,
                "gst": books_inv.gst or 0.0,
                "total": books_inv.total or 0.0,
            }

    # Determine dynamic documentTitle and invoiceType
    fn_l = (upload.file_name or "").lower()
    cat_l = ((invoice.source_document_type if invoice else upload.document_type) or upload.category or "").lower()
    if "gstr2" in cat_l or "2b" in cat_l or "gstr2" in fn_l or "2b" in fn_l:
        dyn_title = "GSTR-2B Portal Data"
        dyn_type = "GSTR2B"
    elif "purchase" in cat_l or "pr_" in cat_l or "purchase" in fn_l or "pr_" in fn_l:
        dyn_title = "Purchase Register"
        dyn_type = "PURCHASE_REGISTER"
    elif "supplier" in cat_l or "vendor" in cat_l or "supplier" in fn_l or "vendor" in fn_l:
        dyn_title = "Supplier Master"
        dyn_type = "SUPPLIER_MASTER"
    elif "sales" in cat_l or "gstr1" in cat_l or "sales" in fn_l or "gstr1" in fn_l:
        dyn_title = "Sales Register (GSTR-1)"
        dyn_type = "SALES_REGISTER"
    elif "po" in cat_l or "order" in cat_l or "po" in fn_l or "order" in fn_l:
        dyn_title = "Purchase Order"
        dyn_type = "PURCHASE_ORDER"
    else:
        dyn_title = "Tax Invoice"
        dyn_type = "TAX_INVOICE"

    case_info = None
    recon_status = ""
    if invoice and db:
        recon_status = (invoice.status or "").capitalize()
        alert = db.query(FraudAlert).filter(FraudAlert.invoice_id == invoice.id).first()
        if alert:
            case_info = {
                "hasCase": True,
                "caseId": alert.id,
                "risk": alert.risk,
                "type": alert.type,
                "reason": alert.reason,
                "shap": [t for t in json.loads(alert.shap_json or "[]") if t not in ("rule_engine", "ml")],
                "status": alert.status,
                "reconciliationStatus": recon_status or alert.type,
            }
        else:
            case_info = {
                "hasCase": False,
                "caseId": None,
                "risk": None,
                "type": "Not Flagged",
                "reason": "No fraud case flagged for this invoice.",
                "shap": [],
                "status": "Clean",
                "reconciliationStatus": recon_status or "Unreconciled",
            }

    return {
        "id": (invoice.id if invoice else upload.id),
        "uploadId": upload.id,
        "fileName": upload.file_name,
        "fileType": upload.file_type,
        "category": upload.category,
        "caseInfo": case_info,
        "reconciliationStatus": recon_status,
        "invoiceInfo": {
            "invoiceNumber": invoice.invoice_no if invoice else "",
            "invoiceDate": invoice.invoice_date if invoice else "",
            "documentTitle": dyn_title,
            "invoiceType": dyn_type,
            "poNumber": "",
            "dueDate": "",
            "currency": "INR",
        },
        "supplierInfo": {
            "supplierName": (invoice.supplier if invoice else "") or "Commercial Supplier",
            "supplierGstin": invoice.supplier_gstin if invoice else (upload.gstin or ""),
            "supplierState": "",
            "supplierAddress": "",
            "supplierCity": "",
            "supplierPin": "",
            "supplierPhone": "",
            "supplierEmail": "",
        },
        "buyerInfo": {
            "buyerName": "",
            "buyerGstin": (invoice.recipient_gstin if invoice else "") or upload.gstin or "",
            "buyerState": "",
            "billingAddress": "",
            "shippingAddress": "",
            "placeOfSupply": "",
        },
        "productInfo": {
            "subtotal": str(invoice.taxable if invoice else 0),
            "taxableAmount": str(invoice.taxable if invoice else 0),
            "gstAmount": str(tot_tax),
            "grandTotal": str(invoice.total if invoice else 0),
            "totalInWords": "",
            "lineItems": [],
            "tableHeaders": [],
        },
        "taxInfo": {
            "cgstRate": "",
            "sgstRate": "",
            "cgstAmount": str(cgst_val),
            "sgstAmount": str(sgst_val),
            "igstRate": "",
            "igstAmount": str(igst_val),
            "utgstRate": "",
            "utgstAmount": "0.00",
            "totalTaxAmount": str(tot_tax),
        },
        "matchingPO": {"hasMatch": False},
        "matchingInvoices": matching_invoices,
        "purchaseRegisterRecord": pr_record,
    }


@router.get("/api/extract/details/{upload_id}")
def extraction_details(upload_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    target_id = upload_id.strip()
    upload = db.get(Upload, target_id)
    invoice = None

    if upload:
        ensure_client_scope(db, user, upload.client_id)
        invoice = db.query(Invoice).filter(Invoice.upload_id == upload.id).order_by(Invoice.id).first()
    else:
        # Target ID might be an invoice ID or invoice number
        invoice = db.query(Invoice).filter((Invoice.id == target_id) | (Invoice.invoice_no == target_id)).first()
        if not invoice:
            # Defensive fallback: target_id might be a fraud alert (case) ID
            alert = db.get(FraudAlert, target_id)
            if alert and alert.invoice_id:
                invoice = db.get(Invoice, alert.invoice_id)

        if invoice:
            ensure_client_scope(db, user, invoice.client_id)
            resolved_upload_id = getattr(invoice, "preview_upload_id", None) or invoice.upload_id
            if resolved_upload_id:
                upload = db.get(Upload, resolved_upload_id)
            if not upload:
                # Create a virtual upload wrapper for standalone invoice record
                upload = Upload(
                    id=f"upl_inv_{invoice.id}",
                    client_id=invoice.client_id,
                    uploaded_by=user.id,
                    file_name=f"{invoice.invoice_no or 'Invoice'}.pdf",
                    file_type="TAX_INVOICE",
                    document_type="TAX_INVOICE",
                    category="tax_invoice",
                    gstin=invoice.supplier_gstin,
                )
        else:
            raise HTTPException(status_code=404, detail="Document or invoice not found.")

    return {"details": _details(upload, invoice, db)}


@router.patch("/api/extract/details/{upload_id}")
def update_extraction_details(upload_id: str, payload: DetailsUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    target_id = upload_id.strip()
    upload = db.get(Upload, target_id)
    invoice = None

    if upload:
        ensure_client_scope(db, user, upload.client_id)
        invoice = db.query(Invoice).filter(Invoice.upload_id == upload.id).order_by(Invoice.id).first()
    else:
        invoice = db.query(Invoice).filter((Invoice.id == target_id) | (Invoice.invoice_no == target_id)).first()
        if invoice:
            ensure_client_scope(db, user, invoice.client_id)
            if invoice.upload_id:
                upload = db.get(Upload, invoice.upload_id)

    if not upload and not invoice:
        raise HTTPException(status_code=404, detail="Upload or invoice not found.")

    if invoice:
        invoice.invoice_no = str(payload.invoiceInfo.get("invoiceNumber") or invoice.invoice_no).strip()
        invoice.invoice_date = str(payload.invoiceInfo.get("invoiceDate") or invoice.invoice_date).strip()
        invoice.supplier = str(payload.supplierInfo.get("supplierName") or invoice.supplier).strip()
        invoice.supplier_gstin = str(payload.supplierInfo.get("supplierGstin") or invoice.supplier_gstin).strip().upper()
        invoice.taxable = float(payload.productInfo.get("taxableAmount") or invoice.taxable or 0)
        invoice.gst = float(payload.productInfo.get("gstAmount") or invoice.gst or 0)
        invoice.total = float(payload.productInfo.get("grandTotal") or invoice.total or 0)
        db.commit()

    return {"details": _details(upload, invoice, db)}


@router.get("/api/uploads/file/{upload_id}")
def download_upload(upload_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")
    ensure_client_scope(db, user, upload.client_id)
    if user.role == "client" and not upload.visible_to_client:
        raise HTTPException(status_code=403, detail="Document has not been shared with the client.")
    try:
        content = read_bytes(upload.object_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="Stored file is no longer available.") from exc
    # upload.file_type holds the document category (e.g. TAX_INVOICE), not a MIME type.
    media_type = mimetypes.guess_type(upload.file_name or "")[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": inline_disposition(upload.file_name)})
