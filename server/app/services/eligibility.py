"""Transaction eligibility gate for statutory reconciliation and fraud case generation.

Ensures that only genuine, structurally-valid invoice transaction rows can become
fraud cases. Filters out non-transactional master records, container summaries,
and structural placeholders without filtering on reconciliation outcome.
"""

from __future__ import annotations
import re
from typing import Any

# Standard 15-character Indian GSTIN structure (2-digit state + 5-char PAN + 4 digits + 1 char + 1 entity + Z + 1 checksum)
_GSTIN_REGEX = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

# Known non-transactional placeholder indicators
_INVALID_GSTINS = {
    "MULTI-PARTY DATASET",
    "27AAAAA0000A1Z5",
    "27AAAAA0000A1Z0",
    "UNKNOWN",
    "N/A",
    "NA",
    "NONE",
    "",
}

_INVALID_INVOICE_NUMBERS = {
    "PURCHASE_REGISTER",
    "GSTR2B",
    "GSTR-2B",
    "SUPPLIERS_MASTER",
    "SUPPLIER_MASTER",
    "MONTHLY_TRANSACTIONS",
    "N/A",
    "NA",
    "NONE",
    "",
}

_NON_TRANSACTION_DOC_TYPES = {
    "SUPPLIER_MASTER",
    "SUPPLIERS_MASTER",
    "VENDOR_MASTER",
    "MASTER_DATASET",
}


def is_eligible_for_fraud_case(invoice: Any) -> bool:
    """Return True if an invoice record represents a genuine, structurally valid transaction.
    
    Accepts an ORM Invoice model or a dictionary row.
    
    Eligibility Criteria:
    1. Document / source type must be a genuine transaction type (TAX_INVOICE, PURCHASE_REGISTER row,
       GSTR2B row, sales/purchase/po transaction) — NEVER Supplier Master or reference dataset.
    2. GSTIN must be a valid 15-character GSTIN format (not empty, blank, or container string).
    3. Invoice number must be non-empty and not a container placeholder.
    4. Total transaction amount must be > 0.
    
    CRITICAL: Does NOT filter on reconciliation status (e.g. MISSING_IN_GSTR2B, MISMATCH,
    DUPLICATE, or rule flags). A structurally valid invoice with discrepancies is the
    exact target for fraud analysis and MUST return True.
    """
    if invoice is None:
        return False

    # Extract fields from dict or SQLAlchemy model
    if isinstance(invoice, dict):
        inv_no = str(invoice.get("invoice_no") or "").strip().upper()
        supplier_gstin = str(invoice.get("supplier_gstin") or "").strip().upper()
        total_val = float(invoice.get("total") or 0.0)
        source = str(invoice.get("source") or "").strip().lower()
        doc_type = str(invoice.get("source_document_type") or invoice.get("document_type") or "").strip().upper()
        supplier_name = str(invoice.get("supplier") or "").strip().upper()
    else:
        inv_no = str(getattr(invoice, "invoice_no", "") or "").strip().upper()
        supplier_gstin = str(getattr(invoice, "supplier_gstin", "") or "").strip().upper()
        total_val = float(getattr(invoice, "total", 0.0) or 0.0)
        source = str(getattr(invoice, "source", "") or "").strip().lower()
        doc_type = str(getattr(invoice, "source_document_type", "") or getattr(invoice, "document_type", "") or "").strip().upper()
        supplier_name = str(getattr(invoice, "supplier", "") or "").strip().upper()

    # Check 1: Exclude non-transactional document types
    if doc_type in _NON_TRANSACTION_DOC_TYPES or source in ("supplier_master", "suppliers_master"):
        return False

    # Check 2: Exclude container supplier placeholders
    if "MULTI-PARTY DATASET" in supplier_gstin or "RECORDS)" in supplier_name:
        return False

    # Check 3: Exclude container or placeholder invoice numbers
    if not inv_no or inv_no in _INVALID_INVOICE_NUMBERS:
        return False

    # Check 4: Validate GSTIN structure (15-character alphanumeric format)
    if supplier_gstin in _INVALID_GSTINS or not _GSTIN_REGEX.match(supplier_gstin):
        return False

    # Check 5: Transaction amount must be strictly greater than 0
    if total_val <= 0:
        return False

    return True
