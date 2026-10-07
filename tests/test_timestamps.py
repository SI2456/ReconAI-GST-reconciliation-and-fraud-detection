"""Times are sent as UTC ('...Z') so every screen can show them in IST; processing is stamped."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REGISTER_CSV = next((ROOT / "reconai_dummy_data").rglob("Krunal_PVT_LTD/purchase_register.csv"))


def _parse(value: str) -> datetime:
    assert value.endswith("Z"), value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_iso_utc_converts_a_database_time_to_utc():
    from app.core.timeutil import iso_utc

    ist = datetime(2026, 9, 28, 14, 47, 15, tzinfo=ZoneInfo("Asia/Kolkata"))
    assert iso_utc(ist) == "2026-09-28T09:17:15Z"           # 14:47 IST = 09:17 UTC
    assert iso_utc(datetime(2026, 9, 28, 9, 17, 15)) == "2026-09-28T09:17:15Z"  # SQLite: naive = UTC
    assert iso_utc(None) is None and iso_utc("") is None


def test_upload_shows_uploaded_and_processed_times(api, new_client_workspace):
    ws = new_client_workspace("Timestamps", "27TNLBH1793I1ZX")
    before = datetime.now(timezone.utc) - timedelta(seconds=5)
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        files={"file": (REGISTER_CSV.name, REGISTER_CSV.read_bytes(), "text/csv")},
        data={"clientId": ws.client_id, "document_type": "PURCHASE_REGISTER", "gstin": ws.gstin, "tax_periods": "04-2026"},
    )
    assert r.status_code == 201, r.text
    upload = r.json()["upload"]
    after = datetime.now(timezone.utc) + timedelta(seconds=5)

    uploaded, processed = _parse(upload["createdAt"]), _parse(upload["processedAt"])
    assert before <= uploaded <= after
    assert uploaded <= processed + timedelta(seconds=1) <= after + timedelta(seconds=1)

    details = api.get(f"/api/extract/details/{upload['id']}", headers=ws.headers).json()["details"]
    assert details["uploadedAt"] == upload["createdAt"]
    assert details["processedAt"] == upload["processedAt"]


def test_reconciliation_reports_when_it_ran(api, new_client_workspace):
    ws = new_client_workspace("ReconTime")
    r = api.post("/api/reconciliation/run", headers=ws.headers, json={"clientId": ws.client_id})
    assert r.status_code == 200, r.text
    ran = _parse(r.json()["ranAt"])
    assert abs(datetime.now(timezone.utc) - ran) < timedelta(minutes=1)


def test_admin_activity_log_shows_who_did_what_and_when(api, new_client_workspace):
    from app.core.security import create_access_token
    from app.db.models import User
    from app.db.session import SessionLocal

    ws = new_client_workspace("AuditedClient", "27TNLBH1793I1ZX")
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        files={"file": (REGISTER_CSV.name, REGISTER_CSV.read_bytes(), "text/csv")},
        data={"clientId": ws.client_id, "document_type": "PURCHASE_REGISTER", "gstin": ws.gstin, "tax_periods": "04-2026"},
    )
    assert r.status_code == 201
    assert api.post("/api/reconciliation/run", headers=ws.headers, json={"clientId": ws.client_id}).status_code == 200

    with SessionLocal() as db:
        admin = db.query(User).filter(User.role == "admin").first()
        if admin is None:
            admin = User(id="usr_audit_admin", name="Audit Admin", email="audit-admin@example.test",
                         password_hash="x", role="admin", email_verified=True, status="active")
            db.add(admin)
            db.commit()
        admin_id = admin.id
    logs = api.get("/api/admin/audit-logs", headers={"Authorization": f"Bearer {create_access_token(admin_id, 'admin')}"}).json()["logs"]

    mine = [log for log in logs if log["actorName"] == "AuditedClient"]
    actions = {log["action"] for log in mine}
    assert {"UPLOAD", "RECONCILIATION"} <= actions, actions
    for log in mine:
        assert log["actorRole"] == "Client"
        assert abs(datetime.now(timezone.utc) - _parse(log["createdAt"])) < timedelta(minutes=1)
    upload_log = next(log for log in mine if log["action"] == "UPLOAD")
    assert upload_log["target"] == REGISTER_CSV.name and "rows" in upload_log["details"]
