import csv
import io
import json
import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, scoped_client_ids
from app.api.fraud import serialize_alert
from app.core.security import decode_access_token
from app.db.models import CAProfile, Client, FraudAlert, Invoice, Upload, User
from app.db.session import get_db
from app.services.gstverify import verify_gstin_profile
from app.services.ai_extraction import ENGINE_LABELS, ExtractionUnavailable, run_ai_extraction, to_parsed_invoice
from app.services.parsing import _to_float
from app.services.storage import inline_disposition, read_bytes
from app.core.timeutil import iso_utc, utcnow
from app.services.audit import record_activity


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


def _extracted(upload: Upload) -> dict:
    try:
        data = json.loads(getattr(upload, "extracted_json", "") or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


_PLACEHOLDERS = {"null", "none", "n/a", "na", "nil", "-", "--", "not available", "not visible"}
# GST slabs (IGST) and their CGST/SGST halves.
_GST_RATE_SLABS = (0.1, 0.125, 0.25, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28)


def _first(*values) -> str:
    """First non-empty value as a string ('' if none). Engine placeholders like 'N/A' count as empty."""
    for value in values:
        if value in (None, "", 0, 0.0):
            continue
        text = str(value).strip()
        if text and text.lower() not in _PLACEHOLDERS:
            return text
    return ""


def _consistent_rate(stated: str, tax_amount: float, taxable: float) -> str:
    """The stated tax rate, unless the amounts contradict it.

    An engine can pick up the wrong percentage (e.g. "Interest @18% p.a." from the payment
    terms); tax = taxable x rate must hold, so fall back to the rate the amounts imply.
    When the amounts fit no GST slab, the lines are taxed at different rates (e.g. 12% and
    18%) and no single rate applies, so none is reported ('').
    """
    if not tax_amount or not taxable:
        return stated
    implied = tax_amount / taxable * 100
    stated_value = _to_float(stated) if stated else None
    if stated_value is not None and abs(stated_value - implied) <= 0.5:
        return stated
    nearest = min(_GST_RATE_SLABS, key=lambda slab: abs(slab - implied))
    return f"{nearest:g}%" if abs(nearest - implied) <= 0.25 else ""


_PREVIEW_MAX_BYTES = 2_000_000  # enough for large registers; bigger files show their first part


def _file_preview(upload: Upload) -> dict:
    """Contents of an uploaded CSV/JSON file for the document viewer.

    Registers and GSTR-2B files are data, not page images, so the viewer shows their rows or
    JSON; without this it had only the parsed invoice and showed an empty table.
    """
    name = (upload.file_name or "").lower()
    if not name.endswith((".csv", ".tsv", ".json")):
        return {}
    try:
        content = read_bytes(upload.object_key)
    except (FileNotFoundError, OSError):
        return {"fileMissing": True}
    truncated = len(content) > _PREVIEW_MAX_BYTES
    text = content[:_PREVIEW_MAX_BYTES].decode("utf-8-sig", errors="replace")

    if name.endswith(".json"):
        try:
            return {"fileJson": json.loads(text)}
        except ValueError:
            return {"rawJsonText": text}

    rows = [row for row in csv.reader(io.StringIO(text), delimiter="\t" if name.endswith(".tsv") else ",")
            if any(cell.strip() for cell in row)]
    if truncated and len(rows) > 1:
        rows = rows[:-1]  # the cut-off last line is incomplete
    preview = {"isCsv": True, "rawCsvText": text, "csvTruncated": truncated}
    if rows:
        preview["csvColumns"] = [cell.strip() for cell in rows[0]]
        preview["csvRows"] = rows[1:]
    return preview


def _details(upload: Upload, invoice: Invoice | None, db: Session | None = None) -> dict:
    ext = _extracted(upload)
    preview = _file_preview(upload)
    ext_supplier = ext.get("supplier") or {}
    ext_buyer = ext.get("buyer") or {}
    ext_tax = ext.get("tax_summary") or {}
    ext_amounts = ext.get("amount_summary") or {}
    ext_order = ext.get("order_info") or {}
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
            "invoiceNumber": _first(invoice.invoice_no if invoice else "", ext.get("invoice_number")),
            "invoiceDate": _first(invoice.invoice_date if invoice else "", ext.get("invoice_date")),
            "documentTitle": dyn_title,
            "invoiceType": dyn_type,
            "poNumber": _first(ext_order.get("po_number")),
            "dueDate": _first(ext.get("due_date")),
            "currency": _first(ext.get("currency"), "INR"),
        },
        "supplierInfo": {
            "supplierName": _first(invoice.supplier if invoice else "", ext_supplier.get("name"), "Commercial Supplier"),
            # upload.gstin is the uploading client's own GSTIN, never the supplier's.
            "supplierGstin": _first(invoice.supplier_gstin if invoice else "", ext_supplier.get("gstin")),
            "supplierState": _first(ext_supplier.get("state")),
            "supplierAddress": _first(ext_supplier.get("address")),
            "supplierCity": _first(ext_supplier.get("city")),
            "supplierPin": _first(ext_supplier.get("pin")),
            "supplierPhone": _first(ext_supplier.get("phone")),
            "supplierEmail": _first(ext_supplier.get("email")),
        },
        "buyerInfo": {
            "buyerName": _first(ext_buyer.get("name")),
            "buyerGstin": _first(invoice.recipient_gstin if invoice else "", ext_buyer.get("gstin"), upload.gstin),
            "buyerState": _first(ext_buyer.get("state")),
            "billingAddress": _first(ext_buyer.get("billing_address")),
            "shippingAddress": _first(ext_buyer.get("shipping_address")),
            "placeOfSupply": _first(ext.get("place_of_supply")),
        },
        "productInfo": {
            "subtotal": _first(ext_amounts.get("subtotal"), invoice.taxable if invoice else "", "0"),
            "taxableAmount": str(invoice.taxable if invoice else 0),
            "gstAmount": str(tot_tax),
            "grandTotal": str(invoice.total if invoice else 0),
            "totalInWords": _first(ext_amounts.get("total_in_words")),
            "lineItems": ext.get("line_items") or [],
            "tableHeaders": ext.get("table_headers") or [],
        },
        "taxInfo": {
            "cgstRate": _consistent_rate(_first(ext_tax.get("cgst_rate")), cgst_val, invoice.taxable if invoice else 0),
            "sgstRate": _consistent_rate(_first(ext_tax.get("sgst_rate")), sgst_val, invoice.taxable if invoice else 0),
            "cgstAmount": str(cgst_val),
            "sgstAmount": str(sgst_val),
            "igstRate": _consistent_rate(_first(ext_tax.get("igst_rate")), igst_val, invoice.taxable if invoice else 0),
            "igstAmount": str(igst_val),
            "utgstRate": _first(ext_tax.get("utgst_rate")),
            "utgstAmount": _first(ext_tax.get("utgst_amount"), "0.00"),
            "totalTaxAmount": str(tot_tax),
        },
        "uploadedAt": iso_utc(upload.created_at),
        "processedAt": iso_utc(getattr(upload, "processed_at", None)),
        "rawJson": ext or preview.get("fileJson") or None,
        "extractionEngine": ext.get("engine", ""),
        **{k: v for k, v in preview.items() if k != "fileJson"},
        "matchingPO": {"hasMatch": False},
        "matchingInvoices": matching_invoices,
        "purchaseRegisterRecord": pr_record,
    }


def _invoice_for_upload(db: Session, upload: Upload) -> Invoice | None:
    """The invoice a document shows: one created from it, else one it was linked to as its PDF."""
    return (
        db.query(Invoice)
        .filter(or_(Invoice.upload_id == upload.id, Invoice.preview_upload_id == upload.id))
        .order_by((Invoice.upload_id == upload.id).desc(), Invoice.id)
        .first()
    )


@router.get("/api/extract/details/{upload_id}")
def extraction_details(upload_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    target_id = upload_id.strip()
    upload = db.get(Upload, target_id)
    invoice = None

    if upload:
        ensure_client_scope(db, user, upload.client_id)
        invoice = _invoice_for_upload(db, upload)
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
        invoice = _invoice_for_upload(db, upload)
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


@router.post("/api/extract/rerun/{target_id}")
def rerun_ai_extraction(
    target_id: str,
    engine: str = "gemini",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Re-read a tax invoice document with an AI vision engine and update its invoice row.

    `target_id` may be an upload, invoice or fraud-alert id, like /api/extract/details.
    """
    from app.api.ingestion import _parse_tax_periods, ingest_invoices

    engine = (engine or "gemini").strip().lower()
    target_id = target_id.strip()
    upload = db.get(Upload, target_id)
    if not upload:
        invoice = db.get(Invoice, target_id)
        if not invoice:
            alert = db.get(FraudAlert, target_id)
            invoice = db.get(Invoice, alert.invoice_id) if alert and alert.invoice_id else None
        upload_id = invoice and (getattr(invoice, "preview_upload_id", None) or invoice.upload_id)
        upload = db.get(Upload, upload_id) if upload_id else None
    if not upload:
        raise HTTPException(status_code=404, detail="No uploaded document found for this item.")
    ensure_client_scope(db, user, upload.client_id)
    if (upload.document_type or "").upper() != "TAX_INVOICE":
        raise HTTPException(status_code=400, detail="AI re-extraction is available for tax invoice documents only.")

    try:
        content = read_bytes(upload.object_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="Stored file is no longer available.") from exc

    try:
        result = run_ai_extraction(content, upload.file_name, engine)
    except ExtractionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # engine/network failures inside the extractor
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {exc}") from exc

    row = to_parsed_invoice(result, _parse_tax_periods(upload.tax_periods))
    if not row.is_usable():
        raise HTTPException(
            status_code=422,
            detail=f"{ENGINE_LABELS[engine]} couldn't read an invoice number and total from this document. "
                   "Check the document or ask the client to re-upload a clearer copy.",
        )

    # Same path as uploading: replace this upload's invoice row with the new reading.
    db.query(Invoice).filter(Invoice.upload_id == upload.id).delete(synchronize_session=False)
    ingest_invoices(db, upload, "books", [row])
    upload.parsed_rows = 1
    upload.status = "parsed"
    upload.processed_at = utcnow()
    upload.validation_errors = "[]"
    upload.extracted_json = json.dumps(result, default=str, ensure_ascii=False)
    record_activity(
        db, user, "AI_EXTRACTION", upload.file_name,
        f"AI extraction ({ENGINE_LABELS[engine]}) on {upload.file_name}: invoice {row.invoice_no}, total ₹{row.total:,.2f}",
        upload_id=upload.id, client_id=upload.client_id, engine=engine,
    )
    db.commit()

    # The invoice's values changed, so refresh matching and fraud alerts for its period;
    # otherwise an alert built from an earlier reading (e.g. "GST rate 54%") would remain.
    from app.services.reconciliation import run_reconciliation

    run_reconciliation(db, upload.client_id, user.id, row.tax_period or None)
    return {
        "ok": True,
        "engine": result.get("engine") or ENGINE_LABELS[engine],
        "message": f"AI extraction complete with {ENGINE_LABELS[engine]}: invoice {row.invoice_no}, "
                   f"total ₹{row.total:,.2f}.",
    }


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
    if (upload.file_name or "").lower().endswith((".csv", ".tsv")):
        # Windows maps .csv to an Excel type, which browsers download instead of showing.
        media_type = "text/plain; charset=utf-8"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": inline_disposition(upload.file_name)})
