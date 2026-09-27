"""End-to-end reconciliation check against the mock datasets' answer keys.

For every company under reconai_dummy_data/ (any folder with an answer_key.csv), this
uploads the purchase register and GSTR-2B files through the API, runs reconciliation and
checks that:

* each invoice's status matches `expected_reconciliation_outcome` in answer_key.csv
* the details view shows exactly the GSTR-2B record reconciliation paired (none for Missing),
  and each GSTR-2B record shows the purchase-register invoice that claimed it
* uploading the same purchase register again doesn't add rows or lose the duplicate count

Run from the repo root:  server\\.venv\\Scripts\\python -m pytest tests
"""
import csv
import json
import re
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[1] / "reconai_dummy_data"
DATASETS = sorted(p.parent for p in DATA.rglob("answer_key.csv"))

# Answer-key outcomes that describe a purchase-register row. MISSING_IN_BOOKS has no books
# row and NOT_RUN rows aren't reconciled, so neither can be compared with an invoice status.
EXPECTED_STATUS = {
    "MATCHED": "Matched",
    "MISMATCH": "Mismatched",
    "MISSING_IN_GSTR2B": "Missing",
    "DUPLICATE": "Duplicate",
}


def canon(invoice_no: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(invoice_no or "").upper())


def _upload(api, ws, path: Path, doc_type: str, period: str) -> None:
    content_type = "text/csv" if path.suffix == ".csv" else "application/json"
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        data={"clientId": ws.client_id, "document_type": doc_type, "gstin": ws.gstin, "tax_periods": period},
        files={"file": (path.name, path.read_bytes(), content_type)},
    )
    assert r.status_code == 201, f"{path.name}: {r.status_code} {r.text[:300]}"


def _invoices(client_id: str, source: str) -> list[dict]:
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        rows = db.query(Invoice).filter(Invoice.client_id == client_id, Invoice.source == source).all()
        return [
            {
                "id": inv.id,
                "invoice_no": inv.invoice_no,
                "status": inv.status,
                "duplicate_count": inv.duplicate_count or 0,
                "flags": json.loads(inv.validation_flags or "{}"),
            }
            for inv in rows
        ]


def _shown_partner_id(api, headers, invoice_id: str) -> str | None:
    r = api.get(f"/api/extract/details/{invoice_id}", headers=headers)
    assert r.status_code == 200, r.text[:300]
    shown = (r.json()["details"].get("matchingInvoices") or [None])[0]
    return shown["id"] if shown else None


@pytest.fixture(scope="module", params=DATASETS, ids=lambda p: p.name)
def reconciled(request, api, new_client_workspace):
    """A client workspace with one dataset uploaded and reconciled."""
    ds: Path = request.param
    gstr_files = sorted(ds.glob("gstr2b_*.json"))
    assert gstr_files, f"no gstr2b_*.json files in {ds}"
    gstin = json.loads(gstr_files[0].read_text(encoding="utf-8"))["gstin_of_recipient"]
    ws = new_client_workspace(ds.name, gstin)
    ws.ds = ds
    headers, client_id = ws.headers, ws.client_id

    _upload(api, ws, ds / "purchase_register.csv", "PURCHASE_REGISTER", "04-2026")
    for path in gstr_files:
        month, year = re.search(r"(\d{2})_(\d{4})", path.name).groups()
        _upload(api, ws, path, "GSTR2B", f"{month}-{year}")

    r = api.post("/api/reconciliation/run", headers=headers, json={"clientId": client_id})
    assert r.status_code == 200, r.text[:300]

    with (ds / "answer_key.csv").open(encoding="utf-8") as fh:
        ws.answer = {canon(row["invoice_number"]): row for row in csv.DictReader(fh)}
    return ws


def test_status_matches_answer_key(reconciled):
    compared, wrong = 0, []
    for inv in _invoices(reconciled.client_id, "books"):
        expected = reconciled.answer.get(canon(inv["invoice_no"]), {}).get("expected_reconciliation_outcome")
        if expected not in EXPECTED_STATUS:
            continue
        compared += 1
        if inv["status"] != EXPECTED_STATUS[expected]:
            wrong.append(f"{inv['invoice_no']}: app={inv['status']} answer_key={expected}")

    assert compared > 0, "no purchase-register invoices could be compared with the answer key"
    assert not wrong, f"{len(wrong)}/{compared} statuses differ from answer_key.csv:\n" + "\n".join(wrong)


def test_details_show_the_reconciled_partner(api, reconciled):
    wrong = []
    claimed_by: dict[str, str] = {}
    for inv in _invoices(reconciled.client_id, "books"):
        paired = inv["flags"].get("matched_gstr_id")
        if paired:
            claimed_by[paired] = inv["id"]
        shown = _shown_partner_id(api, reconciled.headers, inv["id"])
        if shown != paired:
            wrong.append(f"books {inv['invoice_no']} ({inv['status']}): paired={paired} shown={shown}")

    for record in _invoices(reconciled.client_id, "gstr"):
        shown = _shown_partner_id(api, reconciled.headers, record["id"])
        if shown != claimed_by.get(record["id"]):
            wrong.append(f"gstr {record['invoice_no']}: claimed_by={claimed_by.get(record['id'])} shown={shown}")

    assert not wrong, "details view doesn't show the reconciled partner:\n" + "\n".join(wrong)


def test_reupload_keeps_rows_and_duplicate_count(api, reconciled):
    before = _invoices(reconciled.client_id, "books")
    _upload(api, reconciled, reconciled.ds / "purchase_register.csv", "PURCHASE_REGISTER", "04-2026")
    after = _invoices(reconciled.client_id, "books")

    assert len(after) == len(before)
    assert sum(i["duplicate_count"] for i in after) == sum(i["duplicate_count"] for i in before)
