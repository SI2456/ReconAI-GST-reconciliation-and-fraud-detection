"""Re-run AI extraction on a stored invoice document.

Wraps the vision extractor in reference_data/extract.py: Google Gemini (needs GEMINI_API_KEY)
or the local Ollama vision model (qwen2.5vl). The extractor's structured output is mapped to
a ParsedInvoice so it can be saved through the normal ingestion path.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from app.core.config import settings
from app.services.parsing import (
    ParsedInvoice,
    _clean_gstin,
    _normalize_date,
    _to_float,
    check_period_warnings,
    derive_tax_period,
)

_REFERENCE_DIR = Path(__file__).resolve().parents[3] / "reference_data"
ENGINE_LABELS = {"gemini": "Google Gemini", "ollama": "local Ollama"}


class ExtractionUnavailable(Exception):
    """The requested engine can't be used on this server (not configured / not running)."""


def _extractor():
    if str(_REFERENCE_DIR) not in sys.path:
        sys.path.insert(0, str(_REFERENCE_DIR))
    import extract  # noqa: PLC0415 - optional, heavy, only needed for AI re-runs

    return extract


def run_ai_extraction(content: bytes, filename: str, engine: str) -> dict:
    """Run the vision extractor on the document bytes and return its structured result."""
    if engine not in ENGINE_LABELS:
        raise ValueError("Unknown engine. Use 'gemini' or 'ollama'.")
    extract = _extractor()
    suffix = Path(filename or "").suffix.lower()
    if suffix not in extract.ALL_SUPPORTED_EXT:
        raise ValueError("AI extraction works on PDF and image documents only.")
    if engine == "gemini" and not settings.gemini_api_key:
        raise ExtractionUnavailable(
            "Gemini isn't configured on this server. Add GEMINI_API_KEY to server/.env, "
            "or choose the local Ollama engine."
        )
    if engine == "ollama" and not extract.qwen_available():
        raise ExtractionUnavailable(
            "The local Ollama engine isn't reachable. Start Ollama and pull the vision model "
            "(ollama pull qwen2.5vl:3b), or choose Gemini."
        )

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"document{suffix}"
        path.write_bytes(content)
        return extract.extract_file(str(path), engine=engine, api_key=settings.gemini_api_key or None)


def _state_code(gstin: str) -> str:
    return gstin[:2] if len(gstin) >= 2 and gstin[:2].isdigit() else ""


def _is_inter_state(supplier_gstin: str, buyer_gstin: str) -> bool | None:
    """True/False when both GSTIN state codes are known, else None."""
    supplier_state, buyer_state = _state_code(supplier_gstin), _state_code(buyer_gstin)
    if not supplier_state or not buyer_state:
        return None
    return supplier_state != buyer_state


def _gst_components(cgst: float, sgst: float, igst: float, supplier_gstin: str, buyer_gstin: str):
    """GST is IGST (inter-state) or CGST + SGST (intra-state), never both.

    When the GSTINs show which applies, keep only that kind; an engine sometimes fills all
    three with the same figure, which would count the tax two or three times.
    """
    inter_state = _is_inter_state(supplier_gstin, buyer_gstin)
    if inter_state is True:
        return 0.0, 0.0, igst or round(cgst + sgst, 2)
    if inter_state is False:
        if not (cgst or sgst) and igst:
            half = round(igst / 2, 2)
            return half, round(igst - half, 2), 0.0
        return cgst, sgst, 0.0
    return cgst, sgst, igst


def _split_tax(gst: float, supplier_gstin: str, buyer_gstin: str, had_igst: bool):
    inter_state = _is_inter_state(supplier_gstin, buyer_gstin)
    if inter_state is True or (inter_state is None and had_igst):
        return 0.0, 0.0, gst
    half = round(gst / 2, 2)
    return half, round(gst - half, 2), 0.0


def to_parsed_invoice(result: dict, selected_periods: list[str] | None = None) -> ParsedInvoice:
    """Map the extractor's schema (supplier / buyer / tax_summary / amount_summary) to a row."""
    supplier = result.get("supplier") or {}
    buyer = result.get("buyer") or {}
    tax = result.get("tax_summary") or {}
    amounts = result.get("amount_summary") or {}

    supplier_gstin = _clean_gstin(supplier.get("gstin"))
    buyer_gstin = _clean_gstin(buyer.get("gstin"))
    cgst, sgst, igst = _gst_components(
        _to_float(tax.get("cgst_amount")),
        _to_float(tax.get("sgst_amount")),
        _to_float(tax.get("igst_amount")),
        supplier_gstin,
        buyer_gstin,
    )
    gst = round(cgst + sgst + igst, 2) or _to_float(tax.get("total_tax"))
    taxable = _to_float(tax.get("taxable_amount")) or _to_float(amounts.get("subtotal"))
    total = _to_float(amounts.get("grand_total"))
    if total == 0 and (taxable or gst):
        total = round(taxable + gst, 2)
    if taxable == 0 and total and gst:
        taxable = round(total - gst, 2)
    # The printed grand total is the most reliable figure, so tax must equal total - taxable.
    # Catches an engine counting the same tax twice or three times.
    if taxable and total > taxable and abs(taxable + gst - total) > 1.0:
        gst = round(total - taxable, 2)
        cgst, sgst, igst = _split_tax(gst, supplier_gstin, buyer_gstin, had_igst=bool(igst) and not (cgst or sgst))

    invoice_date = _normalize_date(result.get("invoice_date"))
    period = derive_tax_period(invoice_date)
    return ParsedInvoice(
        invoice_no=str(result.get("invoice_number") or "").strip(),
        supplier=str(supplier.get("name") or "").strip(),
        supplier_gstin=supplier_gstin,
        recipient_gstin=buyer_gstin,
        invoice_date=invoice_date,
        taxable=taxable,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        gst=gst,
        total=total,
        source_document_type="TAX_INVOICE",
        tax_period=period,
        period_warning=check_period_warnings(period, selected_periods),
    )
