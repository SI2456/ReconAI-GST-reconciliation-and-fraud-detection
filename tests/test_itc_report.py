"""Monthly ITC report: the tax officer generates a PDF for a client and month, then sends it."""
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

DATA = next(p.parent for p in (Path(__file__).resolve().parents[1] / "reconai_dummy_data").rglob("answer_key.csv")
            if p.parent.name == "Krunal_PVT_LTD")
CLIENT_GSTIN = "27TNLBH1793I1ZX"


def _upload(api, ws, path: Path, doc_type: str):
    ctype = {"csv": "text/csv", "json": "application/json"}[path.suffix[1:]]
    r = api.post("/api/ingestion/upload", headers=ws.headers,
                 files={"file": (path.name, path.read_bytes(), ctype)},
                 data={"clientId": ws.client_id, "document_type": doc_type, "gstin": CLIENT_GSTIN, "tax_periods": "04-2026"})
    assert r.status_code == 201, r.text


def _officer(name: str):
    from app.core.security import create_access_token, hash_password
    from app.db.models import User
    from app.db.session import SessionLocal

    officer_id = f"usr_{name.lower()}_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        db.add(User(id=officer_id, name=name, email=f"{officer_id}@example.test", role="ca", firm_name="Test & Co",
                    password_hash=hash_password("x" * 12), email_verified=True, status="active"))
        db.commit()
    return officer_id, {"Authorization": f"Bearer {create_access_token(officer_id, 'ca')}"}


def _books(client_id: str, status: str) -> list:
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        return [(i.id, i.invoice_no) for i in db.query(Invoice).filter(
            Invoice.client_id == client_id, Invoice.source == "books", Invoice.status == status)]


@pytest.fixture(scope="module")
def setup(api, new_client_workspace):
    """Krunal's April 2026 data reconciled; the officer approved one invoice and rejected another."""
    from app.db.models import Client
    from app.db.session import SessionLocal

    ws = new_client_workspace(f"ReportClient-{uuid.uuid4().hex[:4]}", CLIENT_GSTIN)
    _upload(api, ws, DATA / "purchase_register.csv", "PURCHASE_REGISTER")
    _upload(api, ws, DATA / "gstr2b_04_2026.json", "GSTR2B")
    r = api.post("/api/reconciliation/run", headers=ws.headers, json={"clientId": ws.client_id, "taxPeriod": "04-2026"})
    assert r.status_code == 200, r.text

    officer_id, officer = _officer("ReportOfficer")
    with SessionLocal() as db:
        client = db.get(Client, ws.client_id)
        client.ca_id, client.name = officer_id, "Krunal PVT LTD"
        db.commit()
    matched = _books(ws.client_id, "Matched")
    mismatched = _books(ws.client_id, "Mismatched")
    approve_id, approve_no = matched[0]
    reject_id, reject_no = mismatched[0]
    assert api.post(f"/api/invoices/{approve_id}/itc-decision", headers=officer,
                    json={"decision": "approve"}).status_code == 200
    assert api.post(f"/api/invoices/{reject_id}/itc-decision", headers=officer,
                    json={"decision": "reject", "reason": "Supplier under-reported the value in GSTR-1"}).status_code == 200
    _, other_officer = _officer("OtherOfficer")
    with SessionLocal() as db:
        gstin = db.get(Client, ws.client_id).gstin
    return SimpleNamespace(ws=ws, officer=officer, other=other_officer, approved=approve_no, rejected=reject_no,
                           gstin=gstin, report_id=None)


def _pdf_text(content: bytes) -> str:
    import unicodedata

    import pymupdf

    with pymupdf.open("pdf", content) as doc:
        # NFKC turns typographic ligatures ("ﬃ" in "Officer") back into plain letters, and
        # joining with spaces keeps headings that wrap onto two lines searchable.
        text = "\n".join(page.get_text() for page in doc)
    return " ".join(unicodedata.normalize("NFKC", text).split())


def test_report_has_every_decision_and_both_sides(api, setup):
    r = api.post("/api/reports", headers=setup.officer, json={"clientId": setup.ws.client_id, "period": "04-2026"})
    assert r.status_code == 201, r.text
    report = r.json()["report"]
    assert report["period"] == "April 2026" and report["hasFile"] and report["sentAt"] is None
    summary = report["summary"]
    assert summary["approved"]["invoices"] == 1 and summary["rejected"]["invoices"] == 1
    assert summary["booksInvoices"] == 5 and summary["gstr2bRecords"] >= 1
    assert summary["pending"]["invoices"] == 3

    pdf = api.get(f"/api/reports/{report['id']}/file", headers=setup.officer)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    text = _pdf_text(pdf.content)
    for expected in ("Input Tax Credit (ITC) Report: April 2026", "Krunal PVT LTD", setup.gstin,
                     "ITC approved", "ITC rejected", "Awaiting the tax officer", setup.approved, setup.rejected,
                     "Supplier under-reported the value in GSTR-1", "Purchase register vs GSTR-2B",
                     "ReportOfficer", "Test & Co", "Page 1 of"):
        assert expected in text, expected
    # KRN/26-27/0001: books GST 78,017.26 vs GSTR-2B 58,586.03 -> 19,431.23 (Indian digit grouping)
    assert "78,017.26" in text and "58,586.03" in text and "19,431.23" in text
    setup.report_id = report["id"]


def test_client_only_sees_the_report_after_it_is_sent(api, setup):
    report_id = setup.report_id
    client_view = api.get("/api/reports", headers=setup.ws.headers).json()["reports"]
    assert report_id not in [r["id"] for r in client_view]
    assert api.get(f"/api/reports/{report_id}/file", headers=setup.ws.headers).status_code == 404

    r = api.post(f"/api/reports/{report_id}/send", headers=setup.officer, json={"note": "Please check the rejected invoice."})
    assert r.status_code == 200, r.text
    assert r.json()["report"]["sentAt"] and "dashboard" in r.json()["message"]

    client_view = api.get("/api/reports", headers=setup.ws.headers).json()["reports"]
    assert [r["id"] for r in client_view] == [report_id]
    pdf = api.get(f"/api/reports/{report_id}/file", headers=setup.ws.headers)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    chat = api.get(f"/api/messages?clientId={setup.ws.client_id}", headers=setup.ws.headers).json()["messages"]
    assert any("ITC report for April 2026" in m["text"] and "Please check the rejected invoice." in m["text"] for m in chat)
    # A report the client already received can't be deleted.
    assert api.delete(f"/api/reports/{report_id}", headers=setup.officer).status_code == 409


def test_only_the_clients_own_officer_can_generate_or_send(api, setup):
    body = {"clientId": setup.ws.client_id, "period": "04-2026"}
    assert api.post("/api/reports", headers=setup.ws.headers, json=body).status_code == 403  # clients can't
    assert api.post("/api/reports", headers=setup.other, json=body).status_code == 403       # other officers can't
    assert api.post(f"/api/reports/{setup.report_id}/send", headers=setup.other, json={}).status_code == 404
    assert api.get(f"/api/reports/{setup.report_id}/file", headers=setup.other).status_code == 404


def test_month_without_data_and_bad_month(api, setup):
    r = api.post("/api/reports", headers=setup.officer, json={"clientId": setup.ws.client_id, "period": "01-2025"})
    assert r.status_code == 422 and "No purchase register or GSTR-2B data" in r.json()["detail"]
    r = api.post("/api/reports", headers=setup.officer, json={"clientId": setup.ws.client_id, "period": "someday"})
    assert r.status_code == 422


def test_unsent_report_can_be_deleted(api, setup):
    r = api.post("/api/reports", headers=setup.officer, json={"clientId": setup.ws.client_id, "period": "2026-04"})
    assert r.status_code == 201
    report_id = r.json()["report"]["id"]
    from app.services.storage import _uploads_root

    stored = _uploads_root() / f"clients/{setup.ws.client_id}/reports/{report_id}.pdf"
    assert stored.exists()
    assert api.delete(f"/api/reports/{report_id}", headers=setup.officer).status_code == 200
    assert api.get(f"/api/reports/{report_id}/file", headers=setup.officer).status_code == 404
    assert not stored.exists()  # the PDF is removed too, not just the database row


def test_send_emails_the_pdf_when_email_is_configured(api, setup, monkeypatch):
    sent = []
    monkeypatch.setattr("app.api.reports.email_enabled", lambda: True)
    monkeypatch.setattr("app.api.reports.send_email", lambda to, subject, body, attachments=None: sent.append((to, subject, attachments)))
    r = api.post(f"/api/reports/{setup.report_id}/send", headers=setup.officer, json={})
    assert r.status_code == 200 and r.json()["report"]["emailed"] is True
    to, subject, attachments = sent[0]
    assert subject == "Your ITC report for April 2026"
    name, content, mime = attachments[0]
    assert name.endswith("_04-2026.pdf") and mime == "application/pdf" and content.startswith(b"%PDF")


def test_indian_number_format():
    from app.services.itc_report import inr

    assert inr(433429.2) == "4,33,429.20"
    assert inr(12345678.5) == "1,23,45,678.50"
    assert inr(999) == "999.00"
    assert inr(-19431.23) == "-19,431.23"
    assert inr(None) == "-"
