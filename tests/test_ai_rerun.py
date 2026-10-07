"""POST /api/extract/rerun/{id}: re-read a tax invoice with an AI engine.

The real engines (Gemini / local Ollama) are slow and external, so run_ai_extraction is
replaced with a stand-in that returns the extractor's schema.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INVOICE_PDF = next((ROOT / "reconai_dummy_data").rglob("invoices/*/KRN-26-27-0001.pdf"))
REGISTER_CSV = next((ROOT / "reconai_dummy_data").rglob("Krunal_PVT_LTD/purchase_register.csv"))

EXTRACTED = {  # shape returned by reference_data/extract.py
    "invoice_number": "KRN/26-27/0001",
    "invoice_date": "16/04/2026",
    "due_date": "16/05/2026",
    "currency": "INR",
    "place_of_supply": "Maharashtra (27)",
    "supplier": {"name": "Vishal Electricals & Co", "gstin": "07LXDHH5971Z1ZH",
                 "address": "456, Industrial Estate, Delhi", "city": "Delhi", "state": "Delhi",
                 "pin": "110020", "phone": "+91-9531200031", "email": None},
    "buyer": {"name": "Krunal PVT LTD", "gstin": "27TNLBH1793I1ZX", "state": "Maharashtra",
              "billing_address": "12, Corporate Plaza, Mumbai", "shipping_address": None},
    "order_info": {"po_number": "PO-KRN-26-27-0001"},
    "table_headers": ["#", "Description", "HSN/SAC", "Qty", "Rate", "IGST %", "Amount"],
    "line_items": [["1", "Insulated Wires and Cables", "8544", "10", "18370.44", "18", "183704.40"]],
    "tax_summary": {"taxable_amount": "₹4,33,429.20", "igst_rate": "18%", "igst_amount": "78,017.26"},
    "amount_summary": {"grand_total": "Rs. 5,11,446.46", "total_in_words": "Five Lakh Eleven Thousand ..."},
    "engine": "Stand-in engine",
}


@pytest.fixture
def fake_engine(monkeypatch):
    calls = []

    def fake(content, filename, engine):
        calls.append(engine)
        return dict(EXTRACTED)

    monkeypatch.setattr("app.api.compat.run_ai_extraction", fake)
    return calls


def _upload(api, ws, path: Path, doc_type: str, content_type: str):
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        files={"file": (path.name, path.read_bytes(), content_type)},
        data={"clientId": ws.client_id, "document_type": doc_type, "gstin": ws.gstin, "tax_periods": "04-2026"},
    )
    assert r.status_code == 201, r.text
    return r.json()["upload"]["id"]


def test_extractor_output_is_mapped_to_an_invoice_row():
    from app.services.ai_extraction import to_parsed_invoice

    row = to_parsed_invoice(EXTRACTED)
    assert row.invoice_no == "KRN/26-27/0001"
    assert row.supplier_gstin == "07LXDHH5971Z1ZH" and row.recipient_gstin == "27TNLBH1793I1ZX"
    assert row.invoice_date == "2026-04-16" and row.tax_period
    assert row.taxable == pytest.approx(433429.20)
    assert row.gst == pytest.approx(78017.26)
    assert row.total == pytest.approx(511446.46)


def test_rerun_updates_the_invoice(api, new_client_workspace, fake_engine):
    ws = new_client_workspace("RerunClient", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")

    r = api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=ws.headers, json={"engine": "ollama"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True and "KRN/26-27/0001" in r.json()["message"]
    assert fake_engine == ["ollama"]

    details = api.get(f"/api/extract/details/{upload_id}", headers=ws.headers).json()["details"]
    assert details["invoiceInfo"]["invoiceNumber"] == "KRN/26-27/0001"
    assert details["supplierInfo"]["supplierGstin"] == "07LXDHH5971Z1ZH"
    assert float(details["productInfo"]["grandTotal"]) == pytest.approx(511446.46)
    # Everything else the engine read is shown too, not just the invoice-row fields.
    assert details["invoiceInfo"]["dueDate"] == "16/05/2026"
    assert details["invoiceInfo"]["poNumber"] == "PO-KRN-26-27-0001"
    assert details["supplierInfo"]["supplierAddress"] == "456, Industrial Estate, Delhi"
    assert details["supplierInfo"]["supplierPin"] == "110020"
    assert details["supplierInfo"]["supplierEmail"] == ""  # null from the engine stays empty
    assert details["buyerInfo"]["buyerName"] == "Krunal PVT LTD"
    assert details["buyerInfo"]["billingAddress"] == "12, Corporate Plaza, Mumbai"
    assert details["buyerInfo"]["placeOfSupply"] == "Maharashtra (27)"
    assert details["productInfo"]["lineItems"] == EXTRACTED["line_items"]
    assert details["productInfo"]["tableHeaders"] == EXTRACTED["table_headers"]
    assert details["productInfo"]["totalInWords"].startswith("Five Lakh")
    assert details["taxInfo"]["igstRate"] == "18%"
    assert details["extractionEngine"] == "Stand-in engine"

    # Running it again replaces the row instead of adding another.
    assert api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=ws.headers).status_code == 200
    from app.db.models import Invoice
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        assert db.query(Invoice).filter(Invoice.client_id == ws.client_id).count() == 1


def test_gemini_without_a_key_explains_how_to_enable_it(api, new_client_workspace):
    ws = new_client_workspace("NoGeminiKey")
    upload_id = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    r = api.post(f"/api/extract/rerun/{upload_id}?engine=gemini", headers=ws.headers)
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]


def test_only_tax_invoices_can_be_rerun(api, new_client_workspace, fake_engine):
    ws = new_client_workspace("RegisterRerun")
    upload_id = _upload(api, ws, REGISTER_CSV, "PURCHASE_REGISTER", "text/csv")
    r = api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=ws.headers)
    assert r.status_code == 400 and fake_engine == []


def test_unreadable_result_is_422(api, new_client_workspace, monkeypatch):
    ws = new_client_workspace("UnreadableRerun")
    upload_id = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    monkeypatch.setattr("app.api.compat.run_ai_extraction", lambda *a: {"invoice_number": None})
    r = api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=ws.headers)
    assert r.status_code == 422 and "re-upload" in r.json()["detail"]


def test_other_workspaces_cannot_rerun(api, new_client_workspace, fake_engine):
    owner = new_client_workspace("RerunOwner")
    upload_id = _upload(api, owner, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    other = new_client_workspace("RerunIntruder")
    r = api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=other.headers)
    assert r.status_code == 403 and fake_engine == []


def test_unknown_document_is_404(api, new_client_workspace):
    ws = new_client_workspace("RerunMissing")
    assert api.post("/api/extract/rerun/upl_does_not_exist?engine=ollama", headers=ws.headers).status_code == 404


def test_invoice_pdf_for_an_invoice_already_in_the_register(api, new_client_workspace, fake_engine):
    """Register uploaded first, then the invoice PDF: the PDF's details must show that invoice."""
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    ws = new_client_workspace("RegisterThenPdf", "27TNLBH1793I1ZX")
    _upload(api, ws, REGISTER_CSV, "PURCHASE_REGISTER", "text/csv")
    with SessionLocal() as db:
        rows_before = db.query(Invoice).filter(Invoice.client_id == ws.client_id).count()

    pdf_upload = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    r = api.post(f"/api/extract/rerun/{pdf_upload}?engine=ollama", headers=ws.headers)
    assert r.status_code == 200, r.text

    details = api.get(f"/api/extract/details/{pdf_upload}", headers=ws.headers).json()["details"]
    assert details["invoiceInfo"]["invoiceNumber"] == "KRN/26-27/0001"
    assert details["supplierInfo"]["supplierName"] == "Vishal Electricals & Co"
    assert float(details["productInfo"]["grandTotal"]) == pytest.approx(511446.46)
    with SessionLocal() as db:
        assert db.query(Invoice).filter(Invoice.client_id == ws.client_id).count() == rows_before  # merged, not duplicated
        inv = db.query(Invoice).filter(Invoice.client_id == ws.client_id, Invoice.invoice_no == "KRN/26-27/0001").one()
        assert inv.preview_upload_id == pdf_upload  # opening the invoice shows the PDF


def test_supplier_gstin_is_never_the_clients_own(api, new_client_workspace):
    """A document with no readable supplier GSTIN must not show the uploading client's GSTIN."""
    ws = new_client_workspace("NoSupplierGstin", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    details = api.get(f"/api/extract/details/{upload_id}", headers=ws.headers).json()["details"]
    assert details["supplierInfo"]["supplierGstin"] != ws.gstin


@pytest.mark.parametrize("stated, amount, taxable, expected", [
    ("18%", 358.94, 7178.86, "5%"),      # "Interest @18% p.a." read as the IGST rate
    ("5%", 358.94, 7178.86, "5%"),       # correct rate is kept as written
    ("", 3979.29, 44214.36, "9%"),       # missing CGST rate is filled from the amounts
    ("18%", 0, 7178.86, "18%"),          # nothing to check against
    ("6%", 19987.05, 307355.60, ""),     # lines at 6% and 9% CGST: no single rate applies
])
def test_tax_rate_must_match_the_amounts(stated, amount, taxable, expected):
    from app.api.compat import _consistent_rate

    assert _consistent_rate(stated, amount, taxable) == expected


def test_engine_placeholders_count_as_empty():
    from app.api.compat import _first

    assert _first("N/A", None, "Delhi") == "Delhi"
    assert _first("n/a", "-", "") == ""


def _with_tax(tax: dict, amounts: dict, supplier_gstin="07LXDHH5971Z1ZH", buyer_gstin="27TNLBH1793I1ZX") -> dict:
    return {**EXTRACTED, "supplier": {"gstin": supplier_gstin}, "buyer": {"gstin": buyer_gstin},
            "tax_summary": {"taxable_amount": "433,429.20", **tax}, "amount_summary": amounts}


@pytest.mark.parametrize("case, tax, amounts", [
    # The reading behind the "GST rate 54%" alert: the same IGST figure in all three fields,
    # and no grand total. Delhi (07) -> Maharashtra (27) is inter-state, so it's IGST only.
    ("tripled, no total", {"cgst_amount": "78,017.26", "sgst_amount": "78,017.26", "igst_amount": "78,017.26"}, {}),
    ("tripled, with total", {"cgst_amount": "78,017.26", "sgst_amount": "78,017.26", "igst_amount": "78,017.26"},
     {"grand_total": "511,446.46"}),
    ("total_tax doubled", {"igst_amount": "78,017.26", "total_tax": "156,034.52"}, {"grand_total": "511,446.46"}),
    ("correct", {"igst_amount": "78,017.26", "total_tax": "78,017.26"}, {"grand_total": "511,446.46"}),
])
def test_tax_is_never_counted_twice(case, tax, amounts):
    from app.services.ai_extraction import to_parsed_invoice

    row = to_parsed_invoice(_with_tax(tax, amounts))
    assert (row.cgst, row.sgst) == (0.0, 0.0), case
    assert row.igst == pytest.approx(78017.26), case
    assert row.gst == pytest.approx(78017.26), case
    assert row.total == pytest.approx(511446.46), case


def test_intra_state_tax_is_cgst_plus_sgst():
    from app.services.ai_extraction import to_parsed_invoice

    row = to_parsed_invoice(_with_tax({"igst_amount": "78,017.26"}, {"grand_total": "511,446.46"},
                                      supplier_gstin="27KYEHP2940D1ZR", buyer_gstin="27TNLBH1793I1ZX"))
    assert row.igst == 0.0
    assert row.cgst + row.sgst == pytest.approx(78017.26)
    assert row.total == pytest.approx(511446.46)


def test_rerun_refreshes_stale_fraud_alerts(api, new_client_workspace, monkeypatch):
    """A wrong first reading must not leave its fraud alert behind after a correct re-run."""
    from app.db.models import FraudAlert, Invoice
    from app.db.session import SessionLocal

    def alert_amounts():
        with SessionLocal() as db:
            return [a.amount for a in db.query(FraudAlert).join(Invoice, FraudAlert.invoice_id == Invoice.id)
                    .filter(FraudAlert.client_id == ws.client_id, Invoice.invoice_no == "KRN/26-27/0001")]

    ws = new_client_workspace("StaleAlert", "27TNLBH1793I1ZX")
    _upload(api, ws, REGISTER_CSV, "PURCHASE_REGISTER", "text/csv")
    pdf_upload = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")

    # 1. A bad reading: the IGST figure in all three tax fields, no grand total, and no buyer
    #    GSTIN (so inter/intra-state is unknown): the invoice is saved at taxable + 3x tax.
    wrong = _with_tax({"cgst_amount": "78,017.26", "sgst_amount": "78,017.26", "igst_amount": "78,017.26"}, {},
                      buyer_gstin="")
    monkeypatch.setattr("app.api.compat.run_ai_extraction", lambda *a: wrong)
    assert api.post(f"/api/extract/rerun/{pdf_upload}?engine=ollama", headers=ws.headers).status_code == 200
    # 2. The officer runs reconciliation: the alert is built from the bad numbers.
    assert api.post("/api/reconciliation/run", headers=ws.headers, json={"clientId": ws.client_id}).status_code == 200
    stale = alert_amounts()
    assert stale and all(abs(amount - 667480.98) < 0.01 for amount in stale), stale

    # 3. A correct re-run must replace that alert, without another manual reconciliation.
    monkeypatch.setattr("app.api.compat.run_ai_extraction", lambda *a: dict(EXTRACTED))
    assert api.post(f"/api/extract/rerun/{pdf_upload}?engine=ollama", headers=ws.headers).status_code == 200
    fresh = alert_amounts()
    assert fresh and all(abs(amount - 511446.46) < 0.01 for amount in fresh), fresh
