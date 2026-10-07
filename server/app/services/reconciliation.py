"""Reconcile a client's books (Tally) invoices against their GSTR-2A/2B data.

Two-phase approach:
1. **Rule engine** – five deterministic checks per invoice (format, GSTIN structure,
   HSN/SAC validity, total recalculation, document-matching outcome).
2. **Document matching** – two-pass exact + fuzzy key match against GSTR-2B records,
   with amount tolerance.

Results (including per-level `validation_flags`) are persisted on the Invoice row so
the Fraud Detection ML layer can consume them as input features.
"""

from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from app.core.periods import periods_match, normalize_period
from app.db.models import Invoice, ReconciliationJob, Supplier
from app.core.timeutil import iso_utc, utcnow
from app.services.parsing import derive_tax_period


# ---------------------------------------------------------------------------
# Matching thresholds
# ---------------------------------------------------------------------------
INVOICE_SIMILARITY_THRESHOLD = 82  # 0–100 fuzzy score on the invoice number
AMOUNT_ABS_TOLERANCE = 1.0         # rupees
AMOUNT_PCT_TOLERANCE = 0.01        # 1% of the invoice total

# GSTIN format: 2-digit state + 5-char PAN letters + 4 digits + 1 letter + 1 entity + Z + 1 checksum
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")

# Valid HSN lengths: 2, 4, 6, 8 digits (SAC also 4-6 digits)
_HSN_RE = re.compile(r"^\d{2,8}$")


# ---------------------------------------------------------------------------
# Similarity helpers
# ---------------------------------------------------------------------------

def _similarity(a: str, b: str) -> float:
    """Return a 0–100 similarity score, preferring RapidFuzz."""
    if not a or not b:
        return 0.0
    try:
        from rapidfuzz import fuzz
        return float(fuzz.ratio(a, b))
    except ImportError:
        from difflib import SequenceMatcher
        return SequenceMatcher(None, a, b).ratio() * 100


def _clean_invoice_no(invoice_no: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (invoice_no or "").upper())


def normalize_key(invoice_no: str, supplier_gstin: str) -> str:
    clean_invoice = re.sub(r"[^A-Z0-9]", "", invoice_no.upper())
    clean_gstin = re.sub(r"[^A-Z0-9]", "", supplier_gstin.upper())
    return f"{clean_gstin}:{clean_invoice}"


def _amounts_match(a: float, b: float) -> bool:
    return abs(a - b) <= max(AMOUNT_ABS_TOLERANCE, AMOUNT_PCT_TOLERANCE * max(abs(a), abs(b)))


def _best_fuzzy_partner(
    invoice: Invoice,
    candidates: list[Invoice],
    used: set[int],
) -> tuple[Invoice | None, float]:
    """Best same-GSTIN GSTR invoice by fuzzy invoice-number similarity."""
    target = _clean_invoice_no(invoice.invoice_no)
    best: Invoice | None = None
    best_score = 0.0
    for candidate in candidates:
        if candidate.id in used:
            continue
        score = _similarity(target, _clean_invoice_no(candidate.invoice_no))
        if _amounts_match(invoice.total or 0, candidate.total or 0):
            score += 0.5
        if score > best_score:
            best_score, best = score, candidate
    return best, best_score


# ---------------------------------------------------------------------------
# 5-level rule validation
# ---------------------------------------------------------------------------

def _validate_invoice(
    invoice: Invoice,
    known_gstins: set[str],
    known_hsns: set[str],
) -> dict[str, Any]:
    """Run the 5-level deterministic check and return a flags dict."""
    flags: dict[str, Any] = {}

    # Level 1 – Format / missing-field check
    missing: list[str] = []
    if not (invoice.invoice_no or "").strip():
        missing.append("invoice_no")
    if not (invoice.supplier_gstin or "").strip():
        missing.append("supplier_gstin")
    if not (invoice.invoice_date or "").strip():
        missing.append("invoice_date")
    if not invoice.total:
        missing.append("total")
    flags["format_ok"] = len(missing) == 0
    flags["format_missing"] = missing

    # Level 2 – GSTIN structure
    gstin = (invoice.supplier_gstin or "").strip().upper()
    flags["gstin_ok"] = bool(_GSTIN_RE.match(gstin))

    # Level 3 – HSN/SAC validity (check Supplier Master if available)
    # We use whatever the invoice carries in source_document_type / a placeholder field.
    # If we have a Supplier Master, the known_hsns set is populated; otherwise skip.
    # For now we validate format (numeric, 2–8 digits).
    hsn_raw = ""  # invoices don't currently carry HSN; mark n/a when empty
    if hsn_raw:
        flags["hsn_ok"] = bool(_HSN_RE.match(hsn_raw.strip()))
        if known_hsns:
            flags["hsn_ok"] = flags["hsn_ok"] and hsn_raw.strip() in known_hsns
    else:
        flags["hsn_ok"] = None  # not applicable – no HSN on this invoice

    # Level 4 – Total recalculation: taxable + gst ≈ total
    computed = (invoice.taxable or 0) + (invoice.gst or 0)
    total = invoice.total or 0
    flags["total_ok"] = _amounts_match(computed, total) if total else None
    flags["total_computed"] = round(computed, 2)
    flags["total_stored"] = round(total, 2)

    # Level 5 – Document matching outcome (filled in after matching pass)
    flags["doc_match"] = None  # placeholder; set after reconciliation

    return flags


# ---------------------------------------------------------------------------
# Main entry point
def run_reconciliation(db: Session, client_id: int, user_id: int, tax_period: str | None = None) -> dict:
    books_query = (
        db.query(Invoice)
        .filter(Invoice.client_id == client_id, Invoice.source == "books")
    )
    gstr_query = (
        db.query(Invoice)
        .filter(Invoice.client_id == client_id, Invoice.source == "gstr")
    )

    all_books = books_query.all()
    all_gstr = gstr_query.all()

    clean_period = (tax_period or "").strip()
    if clean_period and clean_period.upper() not in ("ALL", "ALL UPLOADED DATA"):
        period_books = [
            inv for inv in all_books
            if periods_match(inv.tax_period, clean_period)
            or periods_match(derive_tax_period(str(inv.invoice_date or "")), clean_period)
        ]
        period_gstr = [
            inv for inv in all_gstr
            if periods_match(inv.tax_period, clean_period)
            or periods_match(derive_tax_period(str(inv.invoice_date or "")), clean_period)
        ]

        if period_books or period_gstr:
            books = period_books
            gstr = period_gstr
        else:
            books = all_books
            gstr = all_gstr
    else:
        books = all_books
        gstr = all_gstr

    # Build lookup structures for matching
    gstr_by_key = {item.normalized_key: item for item in gstr}
    gstr_by_gstin: dict[str, list[Invoice]] = defaultdict(list)
    for item in gstr:
        gstr_by_gstin[item.supplier_gstin].append(item)

    # Known GSTINs from Supplier Master for GSTIN-level cross-check
    known_gstins: set[str] = {
        row.gstin for row in db.query(Supplier).filter(Supplier.client_id == client_id).all()
    }
    known_hsns: set[str] = set()  # future: populate from Supplier Master HSN field

    summary = {
        "total": len(books),
        "matched": 0,
        "fuzzyMatched": 0,
        "mismatched": 0,
        "missing": 0,
        "duplicates": 0,
        "rule_failures": 0,
        "taxPeriod": clean_period or "ALL",
    }
    seen_keys: set[str] = set()
    used_gstr: set[int] = set()
    flags_by_id: dict[str, dict[str, Any]] = {}

    def record_match(invoice: Invoice, partner: Invoice, fuzzy: bool) -> None:
        flags = flags_by_id[invoice.id]
        used_gstr.add(partner.id)
        # Saved so the details view shows the record this run actually paired, not a guess.
        flags["matched_gstr_id"] = partner.id
        if _amounts_match(invoice.total or 0, partner.total or 0):
            invoice.status = partner.status = "Matched"
            invoice.risk = "Low"
            summary["matched"] += 1
            if fuzzy:
                summary["fuzzyMatched"] += 1
            flags["doc_match"] = "MATCHED"
        else:
            invoice.status = partner.status = "Mismatched"
            invoice.risk = partner.risk = "Medium"
            summary["mismatched"] += 1
            flags["doc_match"] = "MISMATCH"

    # Pass 1: rule validation, duplicates, and exact-key matches for every invoice.
    # Exact matches must all be reserved before any fuzzy matching; otherwise an invoice
    # that is missing from GSTR-2B can fuzzy-grab the record of a neighbouring invoice
    # number (e.g. 0005 taking 0006's record), which then cascades down the series.
    needs_fuzzy: list[Invoice] = []
    for invoice in books:
        flags = _validate_invoice(invoice, known_gstins, known_hsns)
        flags_by_id[invoice.id] = flags

        rule_failed = (
            not flags["format_ok"]
            or not flags["gstin_ok"]
            or flags["total_ok"] is False
        )
        if rule_failed:
            summary["rule_failures"] += 1

        partner = gstr_by_key.get(invoice.normalized_key)
        if invoice.normalized_key in seen_keys or (invoice.duplicate_count or 0) > 0:
            invoice.status = "Duplicate"
            invoice.risk = "High"
            summary["duplicates"] += 1
            flags["doc_match"] = "DUPLICATE"
            flags["duplicate_count"] = invoice.duplicate_count or 0
            # Reserve its GSTR-2B record so no other invoice can fuzzy-match onto it.
            if partner:
                used_gstr.add(partner.id)
                flags["matched_gstr_id"] = partner.id
            seen_keys.add(invoice.normalized_key)
            continue
        seen_keys.add(invoice.normalized_key)

        if partner and partner.id not in used_gstr:
            record_match(invoice, partner, fuzzy=False)
        else:
            needs_fuzzy.append(invoice)

    # Pass 2: fuzzy invoice-number match against the GSTR-2B records still unclaimed.
    for invoice in needs_fuzzy:
        candidate, score = _best_fuzzy_partner(
            invoice, gstr_by_gstin.get(invoice.supplier_gstin, []), used_gstr
        )
        if candidate and score >= INVOICE_SIMILARITY_THRESHOLD:
            record_match(invoice, candidate, fuzzy=True)
        else:
            invoice.status = "Missing"
            invoice.risk = "Medium"
            summary["missing"] += 1
            flags_by_id[invoice.id]["doc_match"] = "MISSING_IN_GSTR2B"

    invoice_results: list[dict] = []
    for invoice in books:
        flags = flags_by_id[invoice.id]
        # Persist the validation flags on the invoice row
        invoice.validation_flags = json.dumps(flags)

        invoice_results.append({
            "id": invoice.id,
            "invoiceNo": invoice.invoice_no,
            "supplier": invoice.supplier,
            "supplierGstin": invoice.supplier_gstin,
            "date": invoice.invoice_date,
            "taxable": invoice.taxable,
            "gst": invoice.gst,
            "total": invoice.total,
            "status": invoice.status,
            "risk": invoice.risk,
            "taxPeriod": invoice.tax_period,
            "validationFlags": flags,
        })

    from datetime import datetime, timezone
    job = ReconciliationJob(
        id=f"rec_{uuid.uuid4().hex[:16]}",
        client_id=client_id,
        run_by=user_id,
        status="completed",
        summary_json=json.dumps(summary),
        created_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.commit()

    # Pre-generate fresh fraud detection alerts for this client & period
    try:
        from app.services.ml import run_fraud_detection
        run_fraud_detection(db, client_id, clean_period)
    except Exception:
        pass

    return {
        "jobId": job.id,
        "ranAt": iso_utc(job.created_at),
        "status": "completed",
        "summary": summary,
        "invoices": invoice_results,
    }
