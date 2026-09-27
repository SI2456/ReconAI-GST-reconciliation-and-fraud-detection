import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, require_roles, scoped_client_ids
from app.core.periods import normalize_period, period_to_mm_yyyy, periods_match, expand_period_range
from app.db.models import Client, FraudAlert, Invoice, Message, Supplier, Upload, User
from app.db.session import get_db
from app.services.parsing import derive_tax_period, parse_by_document_type, validate_gstin_format
from app.services.reconciliation import normalize_key
from app.services.storage import read_bytes, upload_bytes


router = APIRouter()


class VisibilityRequest(BaseModel):
    visible: bool


_DOC_TYPE_MAP = {
    "purchase_register": "PURCHASE_REGISTER",
    "purchase-register": "PURCHASE_REGISTER",
    "purchaseregister": "PURCHASE_REGISTER",
    "gstr_2b": "GSTR2B",
    "gstr-2b": "GSTR2B",
    "gstr2b": "GSTR2B",
    "gstr_2a": "GSTR2B",
    "gstr-2a": "GSTR2B",
    "gstr2a": "GSTR2B",
    "gstr": "GSTR2B",
    "tax_invoice": "TAX_INVOICE",
    "tax-invoice": "TAX_INVOICE",
    "taxinvoice": "TAX_INVOICE",
    "invoice": "TAX_INVOICE",
    "purchase_order": "PURCHASE_ORDER",
    "purchase-order": "PURCHASE_ORDER",
    "purchaseorder": "PURCHASE_ORDER",
    "po": "PURCHASE_ORDER",
    "supplier_master": "SUPPLIER_MASTER",
    "supplier-master": "SUPPLIER_MASTER",
    "suppliermaster": "SUPPLIER_MASTER",
    "credit_note": "CREDIT_NOTE",
    "debit_note": "DEBIT_NOTE",
}

_VALID_DOC_TYPES = {
    "PURCHASE_REGISTER", "GSTR2B", "TAX_INVOICE", "PURCHASE_ORDER",
    "SUPPLIER_MASTER", "CREDIT_NOTE", "DEBIT_NOTE"
}


def _normalize_doc_type(raw_type: str | None) -> str:
    if not raw_type:
        return ""
    clean = raw_type.strip()
    if clean.upper() in _VALID_DOC_TYPES:
        return clean.upper()
    return _DOC_TYPE_MAP.get(clean.lower(), "")


def _parse_tax_periods(raw_periods: str | None) -> list[str]:
    if not raw_periods:
        return []
    raw = raw_periods.strip()
    result = []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                for p in parsed:
                    s = str(p).strip()
                    if s:
                        result.append(period_to_mm_yyyy(s) or s)
                return result
        except Exception:
            pass
    for p in raw.split(","):
        s = p.strip()
        if s:
            result.append(period_to_mm_yyyy(s) or s)
    return result


def ingest_invoices(db: Session, upload: Upload, source: str, rows) -> int:
    """Persist parsed rows as Invoice records tied to this upload."""
    created = 0
    now = datetime.now(timezone.utc)
    periods = _parse_tax_periods(upload.tax_periods)
    default_period = periods[0] if periods else ""
    seen_in_file: dict[str, Invoice] = {}

    for row in rows:
        row_date = str(getattr(row, "invoice_date", "") or "").strip()
        row_period = getattr(row, "tax_period", "") or derive_tax_period(row_date) or default_period
        row_norm_key = normalize_key(row.invoice_no, row.supplier_gstin)

        # The same invoice repeated within this file: keep one row (the unique index allows
        # only one) and count the repeat so reconciliation can report it as a duplicate.
        if row_norm_key in seen_in_file:
            first = seen_in_file[row_norm_key]
            first.duplicate_count = (first.duplicate_count or 0) + 1
            continue

        existing = db.query(Invoice).filter(
            Invoice.client_id == upload.client_id,
            Invoice.normalized_key == row_norm_key,
            Invoice.tax_period == row_period,
            Invoice.source == source,
        ).first()

        if not existing:
            existing = db.query(Invoice).filter(
                Invoice.client_id == upload.client_id,
                Invoice.normalized_key == row_norm_key,
                Invoice.source == source,
            ).first()

        if existing:
            existing.supplier = row.supplier
            existing.supplier_gstin = row.supplier_gstin
            existing.recipient_gstin = getattr(row, "recipient_gstin", "") or upload.gstin or existing.recipient_gstin
            existing.invoice_date = row.invoice_date
            existing.taxable = row.taxable
            existing.cgst = getattr(row, "cgst", 0.0)
            existing.sgst = getattr(row, "sgst", 0.0)
            existing.igst = getattr(row, "igst", 0.0)
            existing.gst = row.gst
            existing.total = row.total
            existing.source_document_type = getattr(row, "source_document_type", upload.document_type)
            existing.period_warning = getattr(row, "period_warning", "")
            if upload.is_reupload:
                existing.reupload_status = "reuploaded"
                existing.reuploaded_file_name = upload.file_name
                existing.reuploaded_at = datetime.now(timezone.utc)
            existing.duplicate_count = 0
            seen_in_file[row_norm_key] = existing
            # NOTE: do NOT touch existing.upload_id or existing.preview_upload_id here —
            # same-source updates don't change document lineage.
            continue  # skip to next row, do not insert a new Invoice

        inv_id = f"inv_{uuid.uuid4().hex[:16]}"
        new_invoice = Invoice(
            id=inv_id,
            created_at=now,
            client_id=upload.client_id,
            upload_id=upload.id,
            preview_upload_id=upload.id,
            invoice_no=row.invoice_no,
            supplier=row.supplier,
            supplier_gstin=row.supplier_gstin,
            recipient_gstin=getattr(row, "recipient_gstin", "") or upload.gstin or "",
            invoice_date=row.invoice_date,
            taxable=row.taxable,
            cgst=getattr(row, "cgst", 0.0),
            sgst=getattr(row, "sgst", 0.0),
            igst=getattr(row, "igst", 0.0),
            gst=row.gst,
            total=row.total,
            source=source,
            source_document_type=getattr(row, "source_document_type", upload.document_type),
            tax_period=row_period,
            period_warning=getattr(row, "period_warning", ""),
            normalized_key=row_norm_key,
            reupload_status="reuploaded" if upload.is_reupload else "",
            reuploaded_file_name=upload.file_name if upload.is_reupload else "",
            reuploaded_at=datetime.now(timezone.utc) if upload.is_reupload else None,
            duplicate_count=0,
        )
        db.add(new_invoice)
        seen_in_file[row_norm_key] = new_invoice
        created += 1
    return created


def ingest_suppliers(db: Session, upload: Upload, suppliers) -> int:
    """Persist parsed suppliers as Supplier records tied to this upload."""
    created = 0
    now = datetime.now(timezone.utc)
    for s in suppliers:
        sup_id = f"sup_{uuid.uuid4().hex[:16]}"
        db.add(
            Supplier(
                id=sup_id,
                created_at=now,
                client_id=upload.client_id,
                upload_id=upload.id,
                name=s.name,
                gstin=s.gstin,
                state_code=s.state_code,
                state_name=s.state_name,
                address=s.address,
                city=s.city,
                hsn_sac=s.hsn_sac,
                gst_rate=s.gst_rate,
                email=s.email,
                phone=s.phone,
                status=s.status or "Active",
            )
        )
        created += 1
    return created


@router.post("/upload", status_code=201)
async def upload_document(
    clientId: str | None = Form(None),
    document_type: str | None = Form(None),
    category: str | None = Form(None),
    fileType: str | None = Form(None),
    docType: str | None = Form(None),
    source: str = Form("books"),
    gstin: str | None = Form(None),
    financial_year: str | None = Form(None),
    tax_periods: str | None = Form(None),
    tax_period: str | None = Form(None),
    isReupload: str | bool | None = Form(None),
    reuploadInvoiceId: str | None = Form(None),
    reuploadAlertId: str | None = Form(None),
    reuploadNote: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    # RBAC Enforcement: Only business users (clients) or system admin are permitted to upload reconciliation documents.
    if user.role in ("ca", "reviewer", "tax_officer"):
        raise HTTPException(
            status_code=403,
            detail="Tax Officers and Reviewers are not permitted to upload reconciliation documents. Uploads must be submitted directly by the client."
        )

    if clientId is None:
        client_ids = scoped_client_ids(db, user)
        if not client_ids:
            raise HTTPException(status_code=404, detail="No client workspace is linked to this account.")
        clientId = client_ids[0]

    ensure_client_scope(db, user, clientId)

    is_reup = False
    if isReupload is True or str(isReupload).lower() in ("true", "1", "yes"):
        is_reup = True
    elif reuploadInvoiceId or reuploadAlertId:
        is_reup = True

    # 1. Enforce document_type
    raw_doc_type = document_type or category or fileType or docType
    if not raw_doc_type or not raw_doc_type.strip():
        raise HTTPException(
            status_code=422,
            detail="document_type is required. Must be one of PURCHASE_REGISTER, GSTR2B, TAX_INVOICE, PURCHASE_ORDER, SUPPLIER_MASTER."
        )

    norm_doc_type = _normalize_doc_type(raw_doc_type)
    if not norm_doc_type or norm_doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid document_type '{raw_doc_type}'. Must be one of PURCHASE_REGISTER, GSTR2B, TAX_INVOICE, PURCHASE_ORDER, SUPPLIER_MASTER."
        )

    # 2. Enforce GSTIN and run 15-character structure check
    clean_gstin = re.sub(r"[^A-Z0-9]", "", (gstin or "").upper())
    if not clean_gstin:
        client_obj = db.get(Client, clientId)
        clean_gstin = client_obj.gstin if client_obj else ""
    if not clean_gstin:
        raise HTTPException(status_code=422, detail="GSTIN is a required field.")
    if not validate_gstin_format(clean_gstin):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid GSTIN format '{gstin}'. Must be a valid 15-character Indian GSTIN (e.g. 27AAACA1234F1Z5)."
        )

    # 3. Enforce financial_year
    clean_fy = (financial_year or "").strip()
    if not clean_fy:
        clean_fy = "2026-27"

    # 4. Enforce tax_periods (array or list)
    parsed_periods = _parse_tax_periods(tax_periods or tax_period)
    if not parsed_periods:
        parsed_periods = ["06-2026"]

    # Save file bytes under a sanitized, per-upload key so client-supplied names
    # can't escape the storage root or overwrite an earlier upload.
    upload_id = f"upl_{uuid.uuid4().hex[:16]}"
    content = await file.read()
    safe_filename = re.sub(r"[^A-Za-z0-9_.-]", "_", file.filename or "").lstrip(".") or "upload"
    object_key = f"clients/{clientId}/uploads/{upload_id}_{safe_filename}"
    upload_bytes(object_key, content, file.content_type or "application/octet-stream")

    # Store upload record with exact selected metadata
    now_dt = datetime.now(timezone.utc)
    upload = Upload(
        id=upload_id,
        created_at=now_dt,
        client_id=clientId,
        uploaded_by=user.id,
        file_name=file.filename or "upload",
        file_type=norm_doc_type,
        document_type=norm_doc_type,
        category=norm_doc_type.lower(),
        gstin=clean_gstin,
        financial_year=clean_fy,
        tax_periods=json.dumps(parsed_periods),
        period_warnings="[]",
        gstin_verification_status="valid",
        object_key=object_key,
        status="uploaded",
        visible_to_client=False,
        is_reupload=is_reup,
        reupload_invoice_id=str(reuploadInvoiceId or ""),
        reupload_note=str(reuploadNote or ""),
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    # Immediate parse of upload using dedicated parser
    rows_or_suppliers, errors = parse_by_document_type(
        norm_doc_type,
        upload.file_name,
        file.content_type or "",
        content,
        parsed_periods,
    )

    if norm_doc_type == "SUPPLIER_MASTER":
        count = ingest_suppliers(db, upload, rows_or_suppliers)
        upload.parsed_rows = count
        upload.validation_errors = json.dumps(errors)
        upload.status = "processed" if count > 0 else ("failed" if errors else "processed")
    else:
        invoice_source = "gstr" if norm_doc_type == "GSTR2B" else ("po" if norm_doc_type == "PURCHASE_ORDER" else "books")
        count = ingest_invoices(db, upload, invoice_source, rows_or_suppliers)
        upload.parsed_rows = count
        upload.validation_errors = json.dumps(errors)

        period_warnings = list(dict.fromkeys([r.period_warning for r in rows_or_suppliers if getattr(r, "period_warning", "")]))
        upload.period_warnings = json.dumps(period_warnings)

        if count > 0:
            upload.status = "parsed_with_warnings" if (errors or period_warnings) else "parsed"
        else:
            upload.status = "failed" if errors else "processed"

    # Handle Re-upload state updates on target invoices and fraud alerts
    if is_reup:
        target_inv = None
        target_alert = None
        if reuploadInvoiceId:
            target_inv = db.query(Invoice).filter(Invoice.id == str(reuploadInvoiceId)).first()
        if not target_inv and reuploadAlertId:
            target_alert = db.query(FraudAlert).filter(FraudAlert.id == str(reuploadAlertId)).first()
            if target_alert and target_alert.invoice_id:
                target_inv = db.query(Invoice).filter(Invoice.id == target_alert.invoice_id).first()

        # If still not found by direct ID, search matching invoice in client's requested list
        if not target_inv:
            target_inv = db.query(Invoice).filter(Invoice.client_id == clientId, Invoice.reupload_status == "requested").first()

        if target_inv:
            target_inv.reupload_status = "reuploaded"
            target_inv.reuploaded_file_name = file.filename
            target_inv.reuploaded_at = now_dt

            if not target_alert:
                target_alert = db.query(FraudAlert).filter(FraudAlert.invoice_id == target_inv.id).first()

        if target_alert:
            target_alert.reupload_status = "reuploaded"

        # Notify the Tax Officer in messages table
        inv_title = target_inv.invoice_no if target_inv else "Document"
        client_name = user.name or "Client"
        notif_msg = Message(
            id=f"msg_{uuid.uuid4().hex[:16]}",
            client_id=clientId,
            sender_id=user.id,
            text=f"✨ [Document Re-uploaded] {client_name} has re-uploaded the document for Invoice {inv_title} ({file.filename}).",
        )
        db.add(notif_msg)

    db.commit()
    db.refresh(upload)

    return {"upload": serialize_upload(db, upload)}


@router.post("/process/{upload_id}")
async def process_upload(
    upload_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ca", "admin")),
) -> dict:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")
    ensure_client_scope(db, user, upload.client_id)

    try:
        content = read_bytes(upload.object_key)
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="Stored file is no longer available.")

    norm_doc_type = upload.document_type or _normalize_doc_type(upload.file_type) or "TAX_INVOICE"
    periods = _parse_tax_periods(upload.tax_periods)

    # Re-processing is idempotent
    db.query(Invoice).filter(Invoice.upload_id == upload.id).delete(synchronize_session=False)
    db.query(Supplier).filter(Supplier.upload_id == upload.id).delete(synchronize_session=False)

    rows_or_suppliers, errors = parse_by_document_type(
        norm_doc_type,
        upload.file_name or "",
        "",
        content,
        periods,
    )

    if norm_doc_type == "SUPPLIER_MASTER":
        count = ingest_suppliers(db, upload, rows_or_suppliers)
        upload.parsed_rows = count
        upload.validation_errors = json.dumps(errors)
        upload.status = "processed" if count > 0 else ("failed" if errors else "processed")
    else:
        invoice_source = "gstr" if norm_doc_type == "GSTR2B" else ("po" if norm_doc_type == "PURCHASE_ORDER" else "books")
        count = ingest_invoices(db, upload, invoice_source, rows_or_suppliers)
        upload.parsed_rows = count
        upload.validation_errors = json.dumps(errors)

        period_warnings = list(dict.fromkeys([r.period_warning for r in rows_or_suppliers if getattr(r, "period_warning", "")]))
        upload.period_warnings = json.dumps(period_warnings)

        if count > 0:
            upload.status = "parsed_with_warnings" if (errors or period_warnings) else "parsed"
        else:
            upload.status = "failed" if errors else "processed"

    db.commit()
    db.refresh(upload)
    return {"upload": serialize_upload(db, upload)}


@router.patch("/uploads/{upload_id}/visibility")
def set_visibility(
    upload_id: str,
    payload: VisibilityRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ca", "admin")),
) -> dict:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")
    ensure_client_scope(db, user, upload.client_id)
    upload.visible_to_client = payload.visible
    db.commit()
    db.refresh(upload)
    return {"upload": serialize_upload(db, upload)}


@router.delete("/uploads/{upload_id}")
def delete_upload(
    upload_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ca", "admin")),
) -> dict:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")
    ensure_client_scope(db, user, upload.client_id)
    db.query(Invoice).filter(Invoice.upload_id == upload.id).delete(synchronize_session=False)
    db.query(Supplier).filter(Supplier.upload_id == upload.id).delete(synchronize_session=False)
    db.delete(upload)
    db.commit()
    return {"message": "Upload deleted successfully."}


@router.get("/uploads")
def list_uploads(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    client_ids = scoped_client_ids(db, user)
    if not client_ids:
        return {"uploads": []}

    query = db.query(Upload).filter(
        Upload.client_id.in_(client_ids),
        Upload.document_type != "REVIEWER_ATTACHMENT",
    )
    # Clients only see documents the CA has shared with them.
    if user.role == "client":
        query = query.filter(Upload.visible_to_client.is_(True))

    uploads = query.order_by(Upload.created_at.desc()).all()
    return {"uploads": [serialize_upload(db, upload) for upload in uploads]}


def serialize_upload(db: Session, upload: Upload) -> dict:
    client = db.get(Client, upload.client_id)
    uploader = db.get(User, upload.uploaded_by)

    raw_type = upload.document_type or upload.category or upload.file_type or "TAX_INVOICE"
    doc_type = _normalize_doc_type(raw_type)
    if doc_type == "TAX_INVOICE":
        fname = (upload.file_name or "").lower()
        if "gstr" in fname:
            doc_type = "GSTR2B"
        elif "purchase_register" in fname:
            doc_type = "PURCHASE_REGISTER"
        elif "suppliers_master" in fname or "supplier" in fname:
            doc_type = "SUPPLIER_MASTER"
        elif "po" in fname or "purchase_order" in fname:
            doc_type = "PURCHASE_ORDER"

    periods = _parse_tax_periods(upload.tax_periods)
    if not periods and upload.financial_year:
        periods = [upload.financial_year]
    period_warns = []
    if upload.period_warnings:
        try:
            period_warns = json.loads(upload.period_warnings)
        except Exception:
            period_warns = [upload.period_warnings]

    return {
        "id": upload.id,
        "clientId": upload.client_id,
        "clientName": client.name if client else "",
        "uploadedBy": upload.uploaded_by,
        "uploadedByName": uploader.name if uploader else "",
        "uploadedByRole": uploader.role if uploader else "",
        "fileName": upload.file_name,
        "fileType": upload.file_type,
        "documentType": doc_type,
        "category": doc_type.lower(),
        "gstin": upload.gstin or (client.gstin if client else ""),
        "financialYear": upload.financial_year or "",
        "taxPeriods": periods,
        "taxPeriod": ", ".join(periods) if periods else "",
        "periodWarnings": period_warns,
        "gstinVerificationStatus": upload.gstin_verification_status or "valid",
        "status": upload.status,
        "parsedRows": upload.parsed_rows,
        "validationErrors": json.loads(upload.validation_errors or "[]"),
        "isReupload": bool(upload.is_reupload),
        "reuploadInvoiceId": upload.reupload_invoice_id or "",
        "reuploadNote": upload.reupload_note or "",
        "createdAt": upload.created_at,
    }
