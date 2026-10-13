"""Level 7: the tax officer's ITC decision on a tax invoice, and blocking repeat claims.

An approved invoice is final: its values are locked, and the same invoice (same file, or the
same supplier GSTIN + invoice number) can't be uploaded or extracted again for a new claim.
A rejected invoice can be approved later, e.g. after the client corrects it.
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.timeutil import format_ist, iso_utc
from app.db.models import Invoice, Upload, User

ITC_APPROVED = "approved"
ITC_REJECTED = "rejected"
ROLE_LABELS = {"client": "Client", "ca": "Tax Officer", "admin": "System Admin"}


def itc_decision(db: Session, invoice: Invoice | None) -> dict | None:
    """The officer's decision for the UI, or None when there is none yet."""
    if not invoice or invoice.itc_status not in (ITC_APPROVED, ITC_REJECTED):
        return None
    officer = db.get(User, invoice.itc_decided_by) if invoice.itc_decided_by else None
    return {
        "status": invoice.itc_status,
        "decidedAt": iso_utc(invoice.itc_decided_at),
        "decidedByName": officer.name if officer else "",
        "decidedByRole": ROLE_LABELS.get(officer.role, officer.role) if officer else "",
        "reason": invoice.itc_reject_reason or "",
        "invoiceNo": invoice.invoice_no,
    }


def approved_claim_by_key(db: Session, client_id: str, normalized_key: str) -> Invoice | None:
    if not normalized_key:
        return None
    return (
        db.query(Invoice)
        .filter(
            Invoice.client_id == client_id,
            Invoice.normalized_key == normalized_key,
            Invoice.itc_status == ITC_APPROVED,
        )
        .first()
    )


def approved_claim_by_file(db: Session, client_id: str, file_sha256: str) -> Invoice | None:
    """An approved invoice whose document is a byte-identical copy of this file."""
    if not file_sha256:
        return None
    upload_ids = [
        row[0]
        for row in db.query(Upload.id).filter(Upload.client_id == client_id, Upload.file_sha256 == file_sha256)
    ]
    if not upload_ids:
        return None
    return (
        db.query(Invoice)
        .filter(
            Invoice.client_id == client_id,
            Invoice.itc_status == ITC_APPROVED,
            or_(Invoice.upload_id.in_(upload_ids), Invoice.preview_upload_id.in_(upload_ids)),
        )
        .first()
    )


def already_claimed_message(invoice: Invoice) -> str:
    when = format_ist(invoice.itc_decided_at)
    return (
        f"This tax invoice ({invoice.invoice_no}) has already been claimed for ITC "
        f"(approved on {when}). It can't be uploaded or claimed again."
    )
