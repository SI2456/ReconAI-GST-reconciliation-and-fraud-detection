"""Turn uploaded files (Purchase Register, GSTR-2B, Tax Invoices, Purchase Orders, Supplier Master)
into canonical data rows that the reconciliation engine and database can consume.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field
from datetime import datetime

from app.core.periods import periods_match, normalize_period, parse_month_year
from app.services.vision_ocr import extract_text_from_image


# --- canonical row -----------------------------------------------------------


@dataclass
class ParsedInvoice:
    invoice_no: str
    supplier: str
    supplier_gstin: str
    recipient_gstin: str = ""
    invoice_date: str = ""
    taxable: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    gst: float = 0.0
    total: float = 0.0
    source_document_type: str = "TAX_INVOICE"
    tax_period: str = ""
    period_warning: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def invoice_number(self) -> str:
        return self.invoice_no

    @property
    def taxable_value(self) -> float:
        return self.taxable

    @property
    def total_value(self) -> float:
        return self.total

    def is_usable(self) -> bool:
        # A row needs at least an invoice number and a value to be reconcilable.
        return bool(self.invoice_no) and self.total > 0


@dataclass
class ParsedSupplier:
    name: str
    gstin: str
    state_code: str = ""
    state_name: str = ""
    address: str = ""
    city: str = ""
    hsn_sac: str = ""
    gst_rate: float = 0.0
    email: str = ""
    phone: str = ""
    status: str = "Active"
    warnings: list[str] = field(default_factory=list)

    def is_usable(self) -> bool:
        return bool(self.name) and bool(self.gstin)


# --- header synonyms ---------------------------------------------------------

_COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "invoice_no": (
        "invoice_no", "invoiceno", "invoicenumber", "invoice_number", "invoice", "invno", "inv",
        "billno", "billnumber", "bill_no", "voucherno", "voucher_no", "documentnumber", "docno", "doc_no", "inum"
    ),
    "supplier": (
        "supplier", "supplier_name", "suppliername", "party", "party_name", "partyname",
        "vendor", "vendor_name", "vendorname", "tradename", "trade_name", "trdnm", "legalname", "legal_name", "name", "sellername", "seller_name"
    ),
    "supplier_gstin": (
        "supplier_gstin", "suppliergstin", "gstin", "gstno", "gst_no", "gstinno", "gstin_no",
        "ctin", "gstinofsupplier", "partygstin", "party_gstin", "vendor_gstin"
    ),
    "recipient_gstin": (
        "recipient_gstin", "recipientgstin", "buyer_gstin", "buyergstin", "client_gstin", "clientgstin", "c_gstin"
    ),
    "invoice_date": (
        "invoice_date", "invoicedate", "date", "billdate", "bill_date", "documentdate", "docdate", "doc_date", "dt", "idt"
    ),
    "taxable": (
        "taxable", "taxablevalue", "taxable_value", "taxableamount", "taxable_amount", "txval", "assessablevalue", "assessable_value", "subtotal"
    ),
    "gst": (
        "gst", "gstamount", "gst_amount", "tax", "totaltax", "total_tax", "taxamount", "tax_amount"
    ),
    "igst": ("igst", "iamt", "igstamount", "igst_amount", "integrated_tax"),
    "cgst": ("cgst", "camt", "cgstamount", "cgst_amount", "central_tax"),
    "sgst": ("sgst", "samt", "sgstamount", "sgst_amount", "utgst", "utgstamount", "utgst_amount", "state_tax"),
    "cess": ("cess", "csamt", "cessamount", "cess_amount"),
    "total": (
        "total", "totalvalue", "total_value", "invoicevalue", "invoice_value", "val", "amount", "grandtotal", "grand_total", "netamount", "net_amount"
    ),
    "tax_period": ("tax_period", "taxperiod", "return_period", "returnperiod", "period", "month"),
}

_PO_COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "invoice_no": (
        "po_number", "ponumber", "po_no", "pono", "order_no", "orderno", "purchase_order_no",
        "purchase_order_number", "order_id", "orderid", "po_id", "poid"
    ),
    "supplier": ("vendor_name", "vendorname", "vendor", "supplier_name", "suppliername", "supplier", "party_name", "party"),
    "supplier_gstin": ("vendor_gstin", "supplier_gstin", "gstin", "gst_no", "ctin"),
    "recipient_gstin": ("buyer_gstin", "recipient_gstin", "client_gstin"),
    "invoice_date": ("order_date", "orderdate", "po_date", "podate", "delivery_date", "expected_delivery", "date"),
    "taxable": ("taxable_value", "taxable_amount", "order_value", "subtotal", "taxable"),
    "igst": ("igst", "iamt"),
    "cgst": ("cgst", "camt"),
    "sgst": ("sgst", "samt"),
    "gst": ("gst", "tax_amount", "tax"),
    "total": ("total_value", "total_amount", "order_total", "grand_total", "total"),
}

_SUPPLIER_COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "name": ("name", "supplier_name", "suppliername", "vendor_name", "vendorname", "party_name", "partyname", "company_name", "legal_name", "trade_name", "supplier", "vendor"),
    "gstin": ("gstin", "supplier_gstin", "gst_no", "gstno", "gstin_no", "party_gstin", "ctin", "tax_id"),
    "state_code": ("state_code", "statecode", "st_code", "stcode"),
    "state_name": ("state_name", "statename", "state", "province"),
    "address": ("address", "street", "billing_address", "registered_address", "location", "addr"),
    "city": ("city", "town", "district"),
    "hsn_sac": ("hsn_sac", "hsn", "sac", "hsn_code", "sac_code"),
    "gst_rate": ("gst_rate", "gstrate", "rate", "tax_rate"),
    "email": ("email", "email_id", "contact_email", "mail"),
    "phone": ("phone", "mobile", "contact_no", "contact", "telephone", "tel"),
    "status": ("status", "active_status"),
}

_GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_GSTIN_EXTRACT_PATTERN = re.compile(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")


def validate_gstin_format(gstin: str) -> bool:
    """Validate 15-character GSTIN structure locally."""
    clean = re.sub(r"[^A-Z0-9]", "", (gstin or "").upper())
    return bool(_GSTIN_PATTERN.match(clean))


def _canon(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (header or "").strip().lower())


def _build_header_map(headers: list[str], synonyms_dict: dict[str, tuple[str, ...]] | None = None) -> dict[str, str]:
    """Map each canonical field -> the actual header present in the file."""
    lookup = {_canon(h): h for h in headers if h}
    mapping: dict[str, str] = {}
    synonyms = synonyms_dict or _COLUMN_SYNONYMS
    for field_name, syn_list in synonyms.items():
        for syn in syn_list:
            if _canon(syn) in lookup:
                mapping[field_name] = lookup[_canon(syn)]
                break
    return mapping


def _to_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if cleaned in ("", "-", ".", "-."):
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _normalize_date(value) -> str:
    """Return an ISO ``yyyy-mm-dd`` string when possible, else the raw text."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    for fmt in (
        "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y", "%d.%m.%y",
        "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d", "%d-%B-%Y", "%d %B %Y"
    ):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _clean_gstin(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def derive_tax_period(date_str: str) -> str:
    """Convert an invoice date or string into canonical 'Month Year', e.g. 'August 2026'."""
    if not date_str:
        return ""
    normalized = _normalize_date(date_str)
    if normalized:
        try:
            dt = datetime.strptime(normalized, "%Y-%m-%d")
            return dt.strftime("%B %Y")
        except Exception:
            pass
    return normalize_period(date_str)


def check_period_warnings(derived_period: str, selected_periods: list[str] | None) -> str:
    """Return warning message if derived_period is not in selected_periods."""
    if not derived_period or not selected_periods:
        return ""
    if not any(periods_match(derived_period, p) for p in selected_periods if p):
        return f"Invoice dated {derived_period} found in a file uploaded for {', '.join(selected_periods)}"
    return ""


# --- 1. PURCHASE REGISTER (Books CSV / Excel) --------------------------------


def parse_purchase_register(
    content: bytes,
    filename: str = "",
    selected_periods: list[str] | None = None,
) -> tuple[list[ParsedInvoice], list[str]]:
    errors: list[str] = []
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["CSV file is empty or has no header row."]

    header_map = _build_header_map(list(reader.fieldnames))
    if "invoice_no" not in header_map:
        errors.append(f"Could not find an invoice number column. Headers seen: {', '.join(reader.fieldnames)}.")
        return [], errors

    rows: list[ParsedInvoice] = []
    for line_no, record in enumerate(reader, start=2):
        def get(k):
            h = header_map.get(k)
            return record.get(h) if h else None

        taxable = _to_float(get("taxable"))
        cgst = _to_float(get("cgst"))
        sgst = _to_float(get("sgst"))
        igst = _to_float(get("igst"))
        gst = _to_float(get("gst"))
        if gst == 0 and (cgst + sgst + igst) > 0:
            gst = round(cgst + sgst + igst, 2)

        total = _to_float(get("total"))
        if total == 0 and (taxable or gst):
            total = round(taxable + gst, 2)
        if taxable == 0 and total and gst:
            taxable = round(total - gst, 2)

        inv_date = _normalize_date(get("invoice_date"))
        derived_period = derive_tax_period(inv_date)
        period_warn = check_period_warnings(derived_period, selected_periods)

        row = ParsedInvoice(
            invoice_no=str(get("invoice_no") or "").strip(),
            supplier=str(get("supplier") or "").strip(),
            supplier_gstin=_clean_gstin(get("supplier_gstin")),
            recipient_gstin=_clean_gstin(get("recipient_gstin")),
            invoice_date=inv_date,
            taxable=taxable,
            cgst=cgst,
            sgst=sgst,
            igst=igst,
            gst=gst,
            total=total,
            source_document_type="PURCHASE_REGISTER",
            tax_period=derived_period,
            period_warning=period_warn,
        )

        if not row.invoice_no and row.total == 0:
            continue
        if not row.is_usable():
            errors.append(f"Row {line_no}: skipped (missing invoice number or amount).")
            continue
        rows.append(row)

    return rows, errors


# --- 2. GSTR-2B JSON ---------------------------------------------------------


def _iter_b2b_sections(data) -> list[dict]:
    """Find GSTR B2B supplier sections anywhere in the document tree."""
    found: list[dict] = []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.lower() == "b2b" and isinstance(value, list):
                    found.extend(item for item in value if isinstance(item, dict))
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return found


def parse_gstr2b_json(
    content: bytes,
    selected_periods: list[str] | None = None,
) -> tuple[list[ParsedInvoice], list[str]]:
    errors: list[str] = []
    try:
        data = json.loads(content.decode("utf-8-sig", errors="replace"))
    except json.JSONDecodeError as exc:
        return [], [f"Invalid JSON: {exc.msg} (line {exc.lineno})."]

    rows: list[ParsedInvoice] = []
    recipient_gstin = _clean_gstin(data.get("gstin_of_recipient") or data.get("gstin") or "")
    default_return_period = derive_tax_period(data.get("return_period") or "")

    # Format A: Simulated / Document Array Structure: {"documents": [...]}
    if isinstance(data, dict) and isinstance(data.get("documents"), list):
        for doc in data["documents"]:
            if not isinstance(doc, dict):
                continue
            taxable = _to_float(doc.get("taxable_value") or doc.get("txval"))
            igst = _to_float(doc.get("igst") or doc.get("iamt"))
            cgst = _to_float(doc.get("cgst") or doc.get("camt"))
            sgst = _to_float(doc.get("sgst") or doc.get("samt"))
            gst = round(igst + cgst + sgst, 2)
            total = _to_float(doc.get("total_value") or doc.get("val"))
            if total == 0:
                total = round(taxable + gst, 2)
            if taxable == 0 and total and gst:
                taxable = round(total - gst, 2)

            inv_date = _normalize_date(doc.get("invoice_date") or doc.get("dt"))
            derived_period = derive_tax_period(inv_date) or default_return_period
            period_warn = check_period_warnings(derived_period, selected_periods)

            row = ParsedInvoice(
                invoice_no=str(doc.get("invoice_number") or doc.get("inum") or "").strip(),
                supplier=str(doc.get("supplier_name") or doc.get("trdnm") or "").strip(),
                supplier_gstin=_clean_gstin(doc.get("supplier_gstin") or doc.get("ctin")),
                recipient_gstin=recipient_gstin or _clean_gstin(doc.get("recipient_gstin")),
                invoice_date=inv_date,
                taxable=taxable,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                gst=gst,
                total=total,
                source_document_type="GSTR2B",
                tax_period=derived_period,
                period_warning=period_warn,
            )
            if row.is_usable():
                rows.append(row)

    if rows:
        return rows, errors

    # Format B: Official GSTR-2A/2B structure: b2b -> [{ctin, trdnm, inv: [...]}]
    sections = _iter_b2b_sections(data)
    for section in sections:
        ctin = _clean_gstin(section.get("ctin"))
        trade_name = str(section.get("trdnm") or section.get("cfs") or "").strip()
        invoices = section.get("inv")
        if not isinstance(invoices, list):
            continue
        for inv in invoices:
            if not isinstance(inv, dict):
                continue
            items = inv.get("itms") if isinstance(inv.get("itms"), list) else []
            taxable = cgst = sgst = igst = 0.0
            for item in items:
                det = item.get("itm_det", item) if isinstance(item, dict) else {}
                taxable += _to_float(det.get("txval"))
                igst += _to_float(det.get("iamt"))
                cgst += _to_float(det.get("camt"))
                sgst += _to_float(det.get("samt")) + _to_float(det.get("csamt"))
            gst = round(igst + cgst + sgst, 2)
            total = _to_float(inv.get("val"))
            if taxable == 0 and total and gst:
                taxable = round(total - gst, 2)
            if total == 0:
                total = round(taxable + gst, 2)

            inv_date = _normalize_date(inv.get("dt") or inv.get("idt"))
            derived_period = derive_tax_period(inv_date) or default_return_period
            period_warn = check_period_warnings(derived_period, selected_periods)

            row = ParsedInvoice(
                invoice_no=str(inv.get("inum") or "").strip(),
                supplier=trade_name,
                supplier_gstin=ctin,
                recipient_gstin=recipient_gstin,
                invoice_date=inv_date,
                taxable=taxable,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                gst=gst,
                total=total,
                source_document_type="GSTR2B",
                tax_period=derived_period,
                period_warning=period_warn,
            )
            if row.is_usable():
                rows.append(row)

    if rows:
        return rows, errors

    # Format C: Flat list of invoice objects
    flat = data
    if isinstance(data, dict):
        for key in ("invoices", "data", "records", "rows"):
            if isinstance(data.get(key), list):
                flat = data[key]
                break
    if isinstance(flat, list) and flat and isinstance(flat[0], dict):
        header_map = _build_header_map(list(flat[0].keys()))
        for record in flat:
            if not isinstance(record, dict):
                continue
            taxable = _to_float(record.get(header_map.get("taxable", "")))
            cgst = _to_float(record.get(header_map.get("cgst", "")))
            sgst = _to_float(record.get(header_map.get("sgst", "")))
            igst = _to_float(record.get(header_map.get("igst", "")))
            gst = _to_float(record.get(header_map.get("gst", ""))) or (cgst + sgst + igst)
            total = _to_float(record.get(header_map.get("total", ""))) or (taxable + gst)
            inv_date = _normalize_date(record.get(header_map.get("invoice_date", "")))
            derived_period = derive_tax_period(inv_date) or default_return_period
            period_warn = check_period_warnings(derived_period, selected_periods)

            row = ParsedInvoice(
                invoice_no=str(record.get(header_map.get("invoice_no", "")) or "").strip(),
                supplier=str(record.get(header_map.get("supplier", "")) or "").strip(),
                supplier_gstin=_clean_gstin(record.get(header_map.get("supplier_gstin", ""))),
                recipient_gstin=recipient_gstin or _clean_gstin(record.get(header_map.get("recipient_gstin", ""))),
                invoice_date=inv_date,
                taxable=taxable,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                gst=gst,
                total=total,
                source_document_type="GSTR2B",
                tax_period=derived_period,
                period_warning=period_warn,
            )
            if row.is_usable():
                rows.append(row)

    if not rows and not errors:
        errors.append("No recognizable GSTR-2B invoice records found in the JSON.")
    return rows, errors


# --- 3. PURCHASE ORDER (PO Sheets / Contracts) -------------------------------


def parse_purchase_order(
    content: bytes,
    filename: str = "",
    content_type: str = "",
    selected_periods: list[str] | None = None,
) -> tuple[list[ParsedInvoice], list[str]]:
    errors: list[str] = []
    name = (filename or "").lower()

    if name.endswith(".json") or "json" in content_type:
        try:
            data = json.loads(content.decode("utf-8-sig", errors="replace"))
            items = data if isinstance(data, list) else data.get("orders", data.get("items", [data]))
            rows: list[ParsedInvoice] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                header_map = _build_header_map(list(item.keys()), _PO_COLUMN_SYNONYMS)
                taxable = _to_float(item.get(header_map.get("taxable", "")))
                total = _to_float(item.get(header_map.get("total", ""))) or taxable
                inv_date = _normalize_date(item.get(header_map.get("invoice_date", "")))
                derived_period = derive_tax_period(inv_date)
                row = ParsedInvoice(
                    invoice_no=str(item.get(header_map.get("invoice_no", "")) or item.get("po_number", "")).strip(),
                    supplier=str(item.get(header_map.get("supplier", "")) or item.get("vendor", "")).strip(),
                    supplier_gstin=_clean_gstin(item.get(header_map.get("supplier_gstin", ""))),
                    recipient_gstin=_clean_gstin(item.get(header_map.get("recipient_gstin", ""))),
                    invoice_date=inv_date,
                    taxable=taxable,
                    total=total,
                    source_document_type="PURCHASE_ORDER",
                    tax_period=derived_period,
                    period_warning=check_period_warnings(derived_period, selected_periods),
                )
                if row.is_usable():
                    rows.append(row)
            return rows, errors
        except Exception as exc:
            return [], [f"Could not parse JSON Purchase Order: {exc}"]

    # CSV / TSV fallback
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["Purchase Order file is empty or missing headers."]

    header_map = _build_header_map(list(reader.fieldnames), _PO_COLUMN_SYNONYMS)
    rows = []
    for line_no, record in enumerate(reader, start=2):
        def get(k):
            h = header_map.get(k)
            return record.get(h) if h else None

        taxable = _to_float(get("taxable"))
        total = _to_float(get("total")) or taxable
        inv_date = _normalize_date(get("invoice_date"))
        derived_period = derive_tax_period(inv_date)

        row = ParsedInvoice(
            invoice_no=str(get("invoice_no") or "").strip(),
            supplier=str(get("supplier") or "").strip(),
            supplier_gstin=_clean_gstin(get("supplier_gstin")),
            recipient_gstin=_clean_gstin(get("recipient_gstin")),
            invoice_date=inv_date,
            taxable=taxable,
            total=total,
            source_document_type="PURCHASE_ORDER",
            tax_period=derived_period,
            period_warning=check_period_warnings(derived_period, selected_periods),
        )
        if row.is_usable():
            rows.append(row)

    if not rows and not errors:
        errors.append("No purchase order rows could be extracted.")
    return rows, errors


# --- 4. SUPPLIER MASTER (Vendor Directory) -----------------------------------


def parse_supplier_master(
    content: bytes,
    filename: str = "",
) -> tuple[list[ParsedSupplier], list[str]]:
    errors: list[str] = []
    name = (filename or "").lower()

    if name.endswith(".json"):
        try:
            data = json.loads(content.decode("utf-8-sig", errors="replace"))
            items = data if isinstance(data, list) else data.get("suppliers", data.get("vendors", [data]))
            suppliers: list[ParsedSupplier] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                header_map = _build_header_map(list(item.keys()), _SUPPLIER_COLUMN_SYNONYMS)
                s = ParsedSupplier(
                    name=str(item.get(header_map.get("name", "")) or item.get("name", "")).strip(),
                    gstin=_clean_gstin(item.get(header_map.get("gstin", "")) or item.get("gstin", "")),
                    state_code=str(item.get(header_map.get("state_code", "")) or "").strip(),
                    state_name=str(item.get(header_map.get("state_name", "")) or "").strip(),
                    address=str(item.get(header_map.get("address", "")) or "").strip(),
                    city=str(item.get(header_map.get("city", "")) or "").strip(),
                    hsn_sac=str(item.get(header_map.get("hsn_sac", "")) or "").strip(),
                    gst_rate=_to_float(item.get(header_map.get("gst_rate", ""))),
                    email=str(item.get(header_map.get("email", "")) or "").strip(),
                    phone=str(item.get(header_map.get("phone", "")) or "").strip(),
                )
                if s.is_usable():
                    suppliers.append(s)
            return suppliers, errors
        except Exception as exc:
            return [], [f"Could not parse Supplier Master JSON: {exc}"]

    # CSV parser
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["Supplier Master CSV is empty or has no header row."]

    header_map = _build_header_map(list(reader.fieldnames), _SUPPLIER_COLUMN_SYNONYMS)
    if "gstin" not in header_map and "name" not in header_map:
        return [], [f"Supplier Master requires at least 'name' and 'gstin' columns. Seen: {', '.join(reader.fieldnames)}."]

    suppliers = []
    for line_no, record in enumerate(reader, start=2):
        def get(k):
            h = header_map.get(k)
            return record.get(h) if h else None

        s = ParsedSupplier(
            name=str(get("name") or "").strip(),
            gstin=_clean_gstin(get("gstin")),
            state_code=str(get("state_code") or "").strip(),
            state_name=str(get("state_name") or "").strip(),
            address=str(get("address") or "").strip(),
            city=str(get("city") or "").strip(),
            hsn_sac=str(get("hsn_sac") or "").strip(),
            gst_rate=_to_float(get("gst_rate")),
            email=str(get("email") or "").strip(),
            phone=str(get("phone") or "").strip(),
        )
        if s.is_usable():
            suppliers.append(s)
        else:
            errors.append(f"Row {line_no}: Skipped supplier missing name or GSTIN.")

    return suppliers, errors


# --- 5. TAX INVOICE (Individual PDF / Image / JSON / CSV) --------------------

_AMOUNT = r"(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*\.?[0-9]*)"
_DATE = r"([0-9]{1,4}[\-\/.][0-9]{1,2}[\-\/.][0-9]{1,4})"

_PDF_INVOICE_NO_PATTERNS = (
    re.compile(r"invoice\s*(?:number|no\.?|#)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,})", re.I),
    re.compile(r"(?:bill|voucher|document)\s*(?:number|no\.?|#)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,})", re.I),
)
_PDF_DATE_PATTERNS = (
    re.compile(r"invoice\s*date\s*[:\-]?\s*" + _DATE, re.I),
    re.compile(r"(?:bill|document)\s*date\s*[:\-]?\s*" + _DATE, re.I),
    re.compile(r"date\s*[:\-]?\s*" + _DATE, re.I),
)
_PDF_TOTAL_PATTERNS = (
    re.compile(r"invoice\s*value\s*[:\-]?\s*" + _AMOUNT, re.I),
    re.compile(r"grand\s*total\s*[:\-]?\s*" + _AMOUNT, re.I),
    re.compile(r"amount\s*payable\s*[:\-]?\s*" + _AMOUNT, re.I),
    re.compile(r"total\s*amount\s*[:\-]?\s*" + _AMOUNT, re.I),
)
_PDF_TAXABLE_PATTERNS = (
    re.compile(r"taxable\s*(?:value|amount)\s*[:\-]?\s*" + _AMOUNT, re.I),
    re.compile(r"net\s*amount\s*[:\-]?\s*" + _AMOUNT, re.I),
)
_PDF_TAX_LINE = re.compile(r"(?:CGST|SGST|UTGST|IGST|CESS)\s*" + _AMOUNT, re.I)
_PDF_CGST_LINE = re.compile(r"CGST\s*" + _AMOUNT, re.I)
_PDF_SGST_LINE = re.compile(r"(?:SGST|UTGST)\s*" + _AMOUNT, re.I)
_PDF_IGST_LINE = re.compile(r"IGST\s*" + _AMOUNT, re.I)


def _first_match(patterns, text: str) -> str:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            return match.group(1)
    return ""


def _extract_pdf_text(content: bytes) -> tuple[str, str | None]:
    try:
        from pypdf import PdfReader
    except ImportError:
        return "", "pypdf package is required for PDF parsing."
    try:
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return text, None
    except Exception as exc:
        return "", f"Could not read PDF: {exc}"


def parse_pdf(content: bytes, selected_periods: list[str] | None = None) -> tuple[list[ParsedInvoice], list[str]]:
    text, error = _extract_pdf_text(content)
    if error:
        return [], [error]
    if not text.strip():
        return [], ["No selectable text found in the PDF."]

    taxable = _to_float(_first_match(_PDF_TAXABLE_PATTERNS, text))
    total = _to_float(_first_match(_PDF_TOTAL_PATTERNS, text))
    cgst = sum(_to_float(m) for m in _PDF_CGST_LINE.findall(text))
    sgst = sum(_to_float(m) for m in _PDF_SGST_LINE.findall(text))
    igst = sum(_to_float(m) for m in _PDF_IGST_LINE.findall(text))
    gst = round(cgst + sgst + igst, 2)
    if gst == 0:
        gst = round(sum(_to_float(m) for m in _PDF_TAX_LINE.findall(text)), 2)

    if total == 0 and (taxable or gst):
        total = round(taxable + gst, 2)
    if taxable == 0 and total and gst:
        taxable = round(total - gst, 2)

    supplier_match = re.search(r"(?:sold\s*by|seller\s*name|supplier\s*name)\s*[:\-]\s*([A-Za-z0-9 .,&()'-]{3,80})", text, re.I)
    gstin_match = _GSTIN_EXTRACT_PATTERN.search(text.upper())
    inv_date = _normalize_date(_first_match(_PDF_DATE_PATTERNS, text))
    derived_period = derive_tax_period(inv_date)

    row = ParsedInvoice(
        invoice_no=_first_match(_PDF_INVOICE_NO_PATTERNS, text).strip(),
        supplier=supplier_match.group(1).strip() if supplier_match else "",
        supplier_gstin=gstin_match.group(0) if gstin_match else "",
        invoice_date=inv_date,
        taxable=taxable,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        gst=gst,
        total=total,
        source_document_type="TAX_INVOICE",
        tax_period=derived_period,
        period_warning=check_period_warnings(derived_period, selected_periods),
    )

    if not row.is_usable():
        return [], ["Could not extract an invoice number and amount from the PDF text."]
    return [row], []


def _row_from_ocr_text(text: str, selected_periods: list[str] | None = None) -> ParsedInvoice:
    taxable = _to_float(_first_match(_PDF_TAXABLE_PATTERNS, text))
    total = _to_float(_first_match(_PDF_TOTAL_PATTERNS, text))
    cgst = sum(_to_float(m) for m in _PDF_CGST_LINE.findall(text))
    sgst = sum(_to_float(m) for m in _PDF_SGST_LINE.findall(text))
    igst = sum(_to_float(m) for m in _PDF_IGST_LINE.findall(text))
    gst = round(cgst + sgst + igst, 2) or round(sum(_to_float(m) for m in _PDF_TAX_LINE.findall(text)), 2)

    if total == 0 and (taxable or gst):
        total = round(taxable + gst, 2)
    if taxable == 0 and total and gst:
        taxable = round(total - gst, 2)

    supplier_match = re.search(r"(?:sold\s*by|seller\s*name|supplier\s*name)\s*[:\-]\s*([A-Za-z0-9 .,&()'-]{3,80})", text, re.I)
    gstin_match = _GSTIN_EXTRACT_PATTERN.search(text.upper())
    inv_date = _normalize_date(_first_match(_PDF_DATE_PATTERNS, text))
    derived_period = derive_tax_period(inv_date)

    return ParsedInvoice(
        invoice_no=_first_match(_PDF_INVOICE_NO_PATTERNS, text).strip(),
        supplier=supplier_match.group(1).strip() if supplier_match else "",
        supplier_gstin=gstin_match.group(0) if gstin_match else "",
        invoice_date=inv_date,
        taxable=taxable,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        gst=gst,
        total=total,
        source_document_type="TAX_INVOICE",
        tax_period=derived_period,
        period_warning=check_period_warnings(derived_period, selected_periods),
    )


def parse_image_via_ocr(content: bytes, selected_periods: list[str] | None = None) -> tuple[list[ParsedInvoice], list[str]]:
    text, error = extract_text_from_image(content)
    if error:
        return [], [error]
    if not text.strip():
        return [], ["OCR produced no text from the image."]
    row = _row_from_ocr_text(text, selected_periods)
    if not row.is_usable():
        return [], ["Could not extract structured invoice fields from image."]
    return [row], []


def parse_pdf_hybrid(content: bytes, selected_periods: list[str] | None = None) -> tuple[list[ParsedInvoice], list[str]]:
    rows, errors = parse_pdf(content, selected_periods)
    if rows:
        return rows, errors
    return [], errors


def parse_tax_invoice(
    content: bytes,
    filename: str,
    content_type: str = "",
    selected_periods: list[str] | None = None,
) -> tuple[list[ParsedInvoice], list[str]]:
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if name.endswith(".pdf") or "pdf" in ctype:
        return parse_pdf_hybrid(content, selected_periods)
    if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")) or ctype.startswith("image"):
        return parse_image_via_ocr(content, selected_periods)
    if name.endswith(".json") or "json" in ctype:
        rows, errs = parse_gstr2b_json(content, selected_periods)
        for r in rows:
            r.source_document_type = "TAX_INVOICE"
        return rows, errs
    if name.endswith(".csv") or name.endswith(".tsv") or "csv" in ctype:
        rows, errs = parse_purchase_register(content, filename, selected_periods)
        for r in rows:
            r.source_document_type = "TAX_INVOICE"
        return rows, errs

    # Sniff fallback
    head = content[:64].lstrip()
    if head[:1] in (b"{", b"["):
        return parse_gstr2b_json(content, selected_periods)
    if content[:5] == b"%PDF-":
        return parse_pdf_hybrid(content, selected_periods)

    return [], [f"Unsupported format for Tax Invoice: '{filename}'."]


# --- 6. MAIN DOCUMENT DISPATCHER ---------------------------------------------


def parse_by_document_type(
    document_type: str,
    filename: str,
    content_type: str,
    content: bytes,
    selected_periods: list[str] | None = None,
) -> tuple[list[ParsedInvoice] | list[ParsedSupplier], list[str]]:
    """Parse document based strictly on the selected document_type."""
    doc_type = (document_type or "").upper().strip()

    if doc_type == "PURCHASE_REGISTER":
        return parse_purchase_register(content, filename, selected_periods)
    if doc_type in ("GSTR2B", "GSTR_2B", "GSTR"):
        return parse_gstr2b_json(content, selected_periods)
    if doc_type in ("TAX_INVOICE", "INVOICE"):
        return parse_tax_invoice(content, filename, content_type, selected_periods)
    if doc_type in ("PURCHASE_ORDER", "PO"):
        return parse_purchase_order(content, filename, content_type, selected_periods)
    if doc_type in ("SUPPLIER_MASTER", "SUPPLIERS"):
        return parse_supplier_master(content, filename)

    # Fallback to general parser
    return parse_upload(filename, content_type, content)


def parse_csv(content: bytes) -> tuple[list[ParsedInvoice], list[str]]:
    return parse_purchase_register(content)


def parse_gstr_json(content: bytes) -> tuple[list[ParsedInvoice], list[str]]:
    return parse_gstr2b_json(content)


def parse_upload(filename: str, content_type: str, content: bytes) -> tuple[list[ParsedInvoice], list[str]]:
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if name.endswith(".csv") or name.endswith(".tsv") or "csv" in ctype:
        return parse_purchase_register(content, filename)
    if name.endswith(".json") or "json" in ctype:
        return parse_gstr2b_json(content)
    if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")) or ctype.startswith("image"):
        return parse_image_via_ocr(content)
    if name.endswith(".pdf") or "pdf" in ctype:
        return parse_pdf_hybrid(content)

    head = content[:64].lstrip()
    if head[:1] in (b"{", b"["):
        return parse_gstr2b_json(content)
    if content[:5] == b"%PDF-":
        return parse_pdf_hybrid(content)
    if content[:8].startswith(b"\x89PNG") or content[:3] == b"\xff\xd8\xff":
        return parse_image_via_ocr(content)
    return [], [f"Unsupported file type '{filename}'."]
