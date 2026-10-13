"""Level 7: the tax officer approves or rejects ITC; an approved invoice can't be claimed again."""
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

DATA = next(p.parent for p in (Path(__file__).resolve().parents[1] / "reconai_dummy_data").rglob("answer_key.csv")
            if p.parent.name == "Krunal_PVT_LTD")
CLIENT_GSTIN = "27TNLBH1793I1ZX"
MATCHED_PDF = DATA / "invoices" / "2026-04" / "KRN-26-27-0011.pdf"   # answer key: MATCHED
EXTRACTED_0011 = {  # what the AI engine reads from that PDF
    "invoice_number": "KRN/26-27/0011",
    "invoice_date": "2026-04-20",
    "supplier": {"name": "Blue Ridge Chemicals Pvt Ltd", "gstin": "27TVOCM6298S1ZD"},
    "buyer": {"name": "Krunal PVT LTD", "gstin": CLIENT_GSTIN},
    "tax_summary": {"taxable_amount": "307,355.60", "total_tax": "39,974.09"},
    "amount_summary": {"grand_total": "347,329.69"},
}


def _upload(api, ws, path: Path, doc_type: str, content: bytes | None = None, period: str = "04-2026"):
    ctype = {"csv": "text/csv", "json": "application/json"}.get(path.suffix[1:], "application/pdf")
    return api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        files={"file": (path.name, content if content is not None else path.read_bytes(), ctype)},
        data={"clientId": ws.client_id, "document_type": doc_type, "gstin": CLIENT_GSTIN, "tax_periods": period},
    )


def _invoice_id(ws, invoice_no: str) -> str:
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        return db.query(Invoice).filter(Invoice.client_id == ws.client_id, Invoice.source == "books",
                                        Invoice.invoice_no == invoice_no).one().id


def _decide(api, headers, invoice_id, decision, reason=""):
    return api.post(f"/api/invoices/{invoice_id}/itc-decision", headers=headers,
                    json={"decision": decision, "reason": reason})


@pytest.fixture
def setup(api, new_client_workspace):
    """A Krunal client with register + April GSTR-2B reconciled, and a tax officer assigned."""
    from app.core.security import create_access_token, hash_password
    from app.db.models import Client, User
    from app.db.session import SessionLocal

    ws = new_client_workspace(f"ItcClient-{uuid.uuid4().hex[:4]}", CLIENT_GSTIN)
    assert _upload(api, ws, DATA / "purchase_register.csv", "PURCHASE_REGISTER").status_code == 201
    assert _upload(api, ws, DATA / "gstr2b_04_2026.json", "GSTR2B").status_code == 201
    assert api.post("/api/reconciliation/run", headers=ws.headers,
                    json={"clientId": ws.client_id, "taxPeriod": "04-2026"}).status_code == 200

    officer_id = f"usr_officer_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        db.add(User(id=officer_id, name="Test Officer", email=f"{officer_id}@example.test", role="ca",
                    password_hash=hash_password("x" * 12), email_verified=True, status="active"))
        db.flush()
        db.get(Client, ws.client_id).ca_id = officer_id
        db.commit()
    officer = {"Authorization": f"Bearer {create_access_token(officer_id, 'ca')}"}
    return SimpleNamespace(ws=ws, officer=officer, officer_id=officer_id)


def _attach_pdf(api, ws, monkeypatch, content: bytes | None = None):
    """Client uploads the 0011 PDF; AI extraction links it to the register invoice."""
    r = _upload(api, ws, MATCHED_PDF, "TAX_INVOICE", content)
    assert r.status_code == 201, r.text
    upload_id = r.json()["upload"]["id"]
    monkeypatch.setattr("app.api.compat.run_ai_extraction", lambda *a: dict(EXTRACTED_0011))
    return upload_id, api.post(f"/api/extract/rerun/{upload_id}?engine=ollama", headers=ws.headers)


def test_approve_shows_on_both_sides_and_blocks_a_second_claim(api, setup, monkeypatch):
    ws, officer = setup.ws, setup.officer
    upload_id, rerun = _attach_pdf(api, ws, monkeypatch)
    assert rerun.status_code == 200, rerun.text
    invoice_id = _invoice_id(ws, "KRN/26-27/0011")

    r = _decide(api, officer, invoice_id, "approve")
    assert r.status_code == 200, r.text
    itc = r.json()["itc"]
    assert itc["status"] == "approved" and itc["decidedByName"] == "Test Officer"
    decided_at = datetime.fromisoformat(itc["decidedAt"].replace("Z", "+00:00"))
    assert abs(datetime.now(timezone.utc) - decided_at) < timedelta(minutes=1)

    # Client side: the invoice list and a message show the approval.
    invoices = api.get("/api/invoices", headers=ws.headers).json()["invoices"]
    assert next(i for i in invoices if i["id"] == invoice_id)["itc"]["status"] == "approved"
    messages = api.get(f"/api/messages?clientId={ws.client_id}", headers=ws.headers).json()["messages"]
    assert any("ITC approved for invoice KRN/26-27/0011" in m["text"] for m in messages)
    # Officer side: the document viewer and the uploads list show it too.
    assert api.get(f"/api/extract/details/{upload_id}", headers=officer).json()["details"]["itcDecision"]["status"] == "approved"
    uploads = api.get("/api/ingestion/uploads", headers=officer).json()["uploads"]
    assert next(u for u in uploads if u["id"] == upload_id)["itc"]["status"] == "approved"

    # Approval is final.
    assert _decide(api, officer, invoice_id, "approve").status_code == 409
    assert _decide(api, officer, invoice_id, "reject", "changed my mind").status_code == 409

    # The client can't claim it again: the same file...
    again = _upload(api, ws, MATCHED_PDF, "TAX_INVOICE")
    assert again.status_code == 409 and "already been claimed for ITC" in again.json()["detail"]
    # ...or a different copy of it, once its invoice number is read.
    _, rerun2 = _attach_pdf(api, ws, monkeypatch, MATCHED_PDF.read_bytes() + b"\n% another copy\n")
    assert rerun2.status_code == 409 and "already been claimed for ITC" in rerun2.json()["detail"]

    # And its values are locked.
    r = api.patch(f"/api/extract/details/{upload_id}", headers=officer,
                  json={"productInfo": {"grandTotal": "1"}})
    assert r.status_code == 409


def test_reject_needs_a_reason_and_shows_it_to_the_client(api, setup, monkeypatch):
    ws, officer = setup.ws, setup.officer
    _attach_pdf(api, ws, monkeypatch)
    invoice_id = _invoice_id(ws, "KRN/26-27/0011")

    assert _decide(api, officer, invoice_id, "reject", "").status_code == 422
    r = _decide(api, officer, invoice_id, "reject", "Supplier GSTIN suspended on the portal")
    assert r.status_code == 200, r.text
    assert r.json()["itc"]["status"] == "rejected"

    client_view = next(i for i in api.get("/api/invoices", headers=ws.headers).json()["invoices"] if i["id"] == invoice_id)
    assert client_view["itc"]["status"] == "rejected"
    assert client_view["itc"]["reason"] == "Supplier GSTIN suspended on the portal"
    assert client_view["itc"]["decidedAt"].endswith("Z")

    # A rejected claim can be approved later (e.g. after the client fixes it).
    assert _decide(api, officer, invoice_id, "approve").status_code == 200


def test_only_matched_invoices_can_be_approved(api, setup):
    mismatched = _invoice_id(setup.ws, "KRN/26-27/0001")  # answer key: MISMATCH
    r = _decide(api, setup.officer, mismatched, "approve")
    assert r.status_code == 409 and "matched with GSTR-2B" in r.json()["detail"]


def test_clients_cannot_decide(api, setup):
    invoice_id = _invoice_id(setup.ws, "KRN/26-27/0011")
    assert _decide(api, setup.ws.headers, invoice_id, "approve").status_code == 403
