"""Clicking an entity in the network graph: GET /api/graph/node returns its details."""
import json
import re
from pathlib import Path

import pytest

DATASET = next(p.parent for p in (Path(__file__).resolve().parents[1] / "reconai_dummy_data").rglob("answer_key.csv")
               if p.parent.name == "Vantage_Retail_Solutions")


def _upload(api, ws, path: Path, doc_type: str, period: str) -> None:
    content_type = "text/csv" if path.suffix == ".csv" else "application/json"
    r = api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        data={"clientId": ws.client_id, "document_type": doc_type, "gstin": ws.gstin, "tax_periods": period},
        files={"file": (path.name, path.read_bytes(), content_type)},
    )
    assert r.status_code == 201, r.text[:300]


def _books(client_id: str):
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        return [(inv.supplier_gstin, inv.status, float(inv.total or 0))
                for inv in db.query(Invoice).filter(Invoice.client_id == client_id, Invoice.source == "books")]


@pytest.fixture(scope="module")
def ws(api, new_client_workspace):
    """A client with the Vantage dataset uploaded and reconciled."""
    gstr_files = sorted(DATASET.glob("gstr2b_*.json"))
    gstin = json.loads(gstr_files[0].read_text(encoding="utf-8"))["gstin_of_recipient"]
    ws = new_client_workspace("GraphClient", gstin)
    _upload(api, ws, DATASET / "purchase_register.csv", "PURCHASE_REGISTER", "04-2026")
    for path in gstr_files:
        month, year = re.search(r"(\d{2})_(\d{4})", path.name).groups()
        _upload(api, ws, path, "GSTR2B", f"{month}-{year}")
    assert api.post("/api/reconciliation/run", headers=ws.headers, json={"clientId": ws.client_id}).status_code == 200
    ws.graph = api.get(f"/api/graph?clientId={ws.client_id}", headers=ws.headers).json()
    ws.client_node = next(n for n in ws.graph["nodes"] if n["type"] == "client")
    return ws


def _details(api, ws, gstin: str):
    return api.get("/api/graph/node", headers=ws.headers, params={"clientId": ws.client_id, "gstin": gstin})


def test_client_nodes_carry_their_client_id(ws):
    assert ws.client_node["clientId"] == ws.client_id


def test_client_details(api, ws):
    r = _details(api, ws, ws.client_node["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    books = _books(ws.client_id)

    assert body["kind"] == "client"
    assert body["client"]["id"] == ws.client_id and body["client"]["name"] == "GraphClient"
    for status in ("Matched", "Mismatched", "Missing", "Duplicate"):
        assert body["reconciliation"][status] == sum(1 for _, s, _ in books if s == status)
    assert body["purchaseValue"] == pytest.approx(sum(t for _, _, t in books), abs=0.05)
    assert body["supplierCount"] == len({g for g, _, _ in books})
    assert 0 < len(body["topSuppliers"]) <= 5
    totals = [s["total"] for s in body["topSuppliers"]]
    assert totals == sorted(totals, reverse=True)


def test_supplier_details(api, ws):
    supplier = next(n for n in ws.graph["nodes"] if n["type"] == "supplier")
    r = _details(api, ws, supplier["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    from_supplier = [b for b in _books(ws.client_id) if b[0] == supplier["id"]]

    assert body["kind"] == "supplier"
    assert body["supplier"]["gstin"] == supplier["id"]
    assert body["supplier"]["invoiceCount"] == len(from_supplier)
    assert body["supplier"]["totalValue"] == pytest.approx(sum(t for _, _, t in from_supplier), abs=0.05)
    assert [c["clientId"] for c in body["billedClients"]] == [ws.client_id]
    assert 0 < len(body["recentInvoices"]) <= 5


def test_unknown_gstin_is_404(api, ws):
    assert _details(api, ws, "29ZZZZZ9999Z9Z9").status_code == 404


def test_another_clients_entities_are_not_visible(api, ws, new_client_workspace):
    other = new_client_workspace("OtherClient")
    supplier = next(n for n in ws.graph["nodes"] if n["type"] == "supplier")
    for gstin in (ws.client_node["id"], supplier["id"]):
        r = api.get("/api/graph/node", headers=other.headers, params={"clientId": other.client_id, "gstin": gstin})
        assert r.status_code == 404, f"{gstin}: {r.status_code}"
    # And they can't ask on behalf of a workspace that isn't theirs.
    r = api.get("/api/graph/node", headers=other.headers, params={"clientId": ws.client_id, "gstin": supplier["id"]})
    assert r.status_code == 403


def test_edges_count_each_invoice_once(ws):
    """A purchase in both the purchase register and GSTR-2B is one transaction, not two."""
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        rows = db.query(Invoice).filter(Invoice.client_id == ws.client_id, Invoice.source.in_(("books", "gstr"))).all()
    documents: dict[str, float] = {}
    for inv in sorted(rows, key=lambda i: i.source != "books"):  # books copy wins
        documents.setdefault(inv.normalized_key, float(inv.total or 0))

    edges = ws.graph["edges"]
    assert sum(e["count"] for e in edges) == len(documents)
    assert sum(e["amountValue"] for e in edges) == pytest.approx(sum(documents.values()), abs=1)


def test_purchase_register_gst_is_derived(ws):
    """Registers without a GST amount column: GST = total - taxable, so the total check passes."""
    from app.db.models import Invoice
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        books = db.query(Invoice).filter(Invoice.client_id == ws.client_id, Invoice.source == "books").all()
        flags = [json.loads(inv.validation_flags or "{}") for inv in books]
        assert all(inv.gst == pytest.approx(inv.total - inv.taxable, abs=0.01) for inv in books)
    assert not [f for f in flags if f.get("total_ok") is False]


def test_rings_report_itc_at_risk(ws, api, new_client_workspace):
    """Build the mock data's cross-company ring and check it carries real ITC."""
    import re as _re
    from app.db.models import Client, User
    from app.db.session import SessionLocal
    from app.core.security import create_access_token, hash_password

    data = DATASET.parents[0]
    companies = [p.parent for p in data.rglob("answer_key.csv")]
    officer_id = "usr_ring_officer"
    with SessionLocal() as db:
        db.add(User(id=officer_id, name="Ring Officer", email="ring-officer@example.test", role="ca",
                    password_hash=hash_password("x" * 12), email_verified=True, status="active"))
        db.commit()
    for ds in companies:
        gstr = sorted(ds.glob("gstr2b_*.json"))
        gstin = json.loads(gstr[0].read_text(encoding="utf-8"))["gstin_of_recipient"]
        other = new_client_workspace(f"Ring-{ds.name}", gstin)
        _upload(api, other, ds / "purchase_register.csv", "PURCHASE_REGISTER", "04-2026")
        with SessionLocal() as db:
            client = db.get(Client, other.client_id)
            client.gstin, client.ca_id = gstin, officer_id
            db.commit()
    headers = {"Authorization": f"Bearer {create_access_token(officer_id, 'ca')}"}
    first = api.get("/api/clients", headers=headers).json()["clients"][0]["id"]
    graph = api.get(f"/api/graph?clientId={first}", headers=headers).json()

    assert graph["metrics"]["cyclesDetected"] >= 1
    assert all(c["itc"] > 0 for c in graph["cycles"])
