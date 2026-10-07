"""The document viewer shows the uploaded file's real contents (rows / JSON), not placeholders."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTER_CSV = next((ROOT / "reconai_dummy_data").rglob("Krunal_PVT_LTD/purchase_register.csv"))
GSTR2B_JSON = next((ROOT / "reconai_dummy_data").rglob("Krunal_PVT_LTD/gstr2b_04_2026.json"))
INVOICE_PDF = next((ROOT / "reconai_dummy_data").rglob("invoices/*/KRN-26-27-0001.pdf"))


def _upload(api, ws, path: Path, doc_type: str, content_type: str) -> str:
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        files={"file": (path.name, path.read_bytes(), content_type)},
        data={"clientId": ws.client_id, "document_type": doc_type, "gstin": ws.gstin, "tax_periods": "04-2026"},
    )
    assert r.status_code == 201, r.text
    return r.json()["upload"]["id"]


def _details(api, ws, upload_id):
    r = api.get(f"/api/extract/details/{upload_id}", headers=ws.headers)
    assert r.status_code == 200, r.text
    return r.json()["details"]


def test_purchase_register_shows_its_rows(api, new_client_workspace):
    ws = new_client_workspace("ViewRegister", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, REGISTER_CSV, "PURCHASE_REGISTER", "text/csv")
    with REGISTER_CSV.open(encoding="utf-8-sig", newline="") as fh:
        expected = [row for row in csv.reader(fh) if any(cell.strip() for cell in row)]

    details = _details(api, ws, upload_id)
    assert details["isCsv"] is True
    assert details["csvColumns"] == expected[0]
    assert details["csvRows"] == expected[1:]  # every row, including the duplicate test row
    assert details["rawCsvText"].splitlines()[0].startswith("invoice_number")
    assert details["csvTruncated"] is False


def test_gstr2b_json_shows_the_file(api, new_client_workspace):
    ws = new_client_workspace("ViewGstr", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, GSTR2B_JSON, "GSTR2B", "application/json")
    details = _details(api, ws, upload_id)
    assert details["rawJson"] == json.loads(GSTR2B_JSON.read_text(encoding="utf-8"))
    assert "isCsv" not in details


def test_pdf_documents_have_no_csv_fields(api, new_client_workspace):
    ws = new_client_workspace("ViewPdf", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, INVOICE_PDF, "TAX_INVOICE", "application/pdf")
    details = _details(api, ws, upload_id)
    assert not any(key in details for key in ("isCsv", "csvRows", "rawCsvText"))


def test_open_raw_csv_is_served_as_text(api, new_client_workspace):
    """Browsers show text/plain in a new tab; an Excel content type makes them download it."""
    ws = new_client_workspace("RawCsv", "27TNLBH1793I1ZX")
    upload_id = _upload(api, ws, REGISTER_CSV, "PURCHASE_REGISTER", "text/csv")
    from app.db.models import User, Upload
    from app.db.session import SessionLocal
    from app.core.security import create_access_token

    with SessionLocal() as db:  # clients only see files the CA shared, so fetch as an admin
        db.get(Upload, upload_id)
        admin = db.query(User).filter(User.role == "admin").first()
        if admin is None:
            admin = User(id="usr_viewer_admin", name="Viewer Admin", email="viewer-admin@example.test",
                         password_hash="x", role="admin", email_verified=True, status="active")
            db.add(admin)
            db.commit()
        admin_id = admin.id
    r = api.get(f"/api/uploads/file/{upload_id}",
                headers={"Authorization": f"Bearer {create_access_token(admin_id, 'admin')}"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text.startswith("invoice_number")
