"""Supplier–buyer network graph with circular-trading (ITC fraud ring) detection.

Builds a directed graph across the caller's clients where an edge means
"supplier billed buyer", then enumerates elementary cycles with DFS. A cycle
(A -> B -> C -> A) is the classic circular-trading pattern used to inflate
input tax credit, so every edge inside a cycle is flagged suspicious and the
GST riding on those invoices is reported as ITC at risk.
"""

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.clients import serialize_client
from app.api.deps import ensure_client_scope, get_current_user, scoped_client_ids
from app.db.models import Client, FraudAlert, Invoice, User
from app.db.session import get_db


router = APIRouter()

MAX_CYCLE_LENGTH = 6
MAX_CYCLES = 50


def _find_cycles(adjacency: dict[str, set[str]]) -> list[list[str]]:
    """Enumerate elementary directed cycles (length >= 2) via DFS.

    Each cycle is emitted once, anchored at its lowest-ordered node, so
    rotations of the same ring are not double counted.
    """
    order = {node: i for i, node in enumerate(adjacency)}
    cycles: list[list[str]] = []

    def dfs(start: str, current: str, path: list[str], on_path: set[str]) -> None:
        if len(cycles) >= MAX_CYCLES:
            return
        for nxt in adjacency.get(current, ()):  # neighbours of current
            if nxt == start and len(path) >= 2:
                cycles.append(path[:])
            elif (
                nxt not in on_path
                and order.get(nxt, -1) > order[start]  # anchor at lowest node
                and len(path) < MAX_CYCLE_LENGTH
            ):
                on_path.add(nxt)
                path.append(nxt)
                dfs(start, nxt, path, on_path)
                path.pop()
                on_path.discard(nxt)

    for node in adjacency:
        dfs(node, node, [node], {node})
        if len(cycles) >= MAX_CYCLES:
            break
    return cycles


def _format_amount(value: float) -> str:
    if value >= 10_000_000:
        return f"₹{value / 10_000_000:.2f}Cr"
    if value >= 100_000:
        return f"₹{value / 100_000:.2f}L"
    if value >= 1_000:
        return f"₹{value / 1_000:.1f}K"
    return f"₹{value:.0f}"


@router.get("")
def graph(clientId: str = Query(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    ensure_client_scope(db, user, clientId)

    # Build the network across the caller's whole portfolio so cross-client
    # rings are visible, not just the star around one client.
    client_ids = scoped_client_ids(db, user)
    clients = db.query(Client).filter(Client.id.in_(client_ids)).all() if client_ids else []
    buyer_gstin = {c.id: c.gstin for c in clients if c.gstin}

    nodes: dict[str, dict] = {}
    for client in clients:
        if client.gstin:
            nodes[client.gstin] = {"id": client.gstin, "label": client.name, "type": "client", "risk": "low", "clientId": client.id}

    # Aggregate invoices into directed edges: supplier -> buyer.
    edge_map: dict[tuple[str, str], dict] = {}
    # Each purchase usually exists twice (purchase register + GSTR-2B), so count every
    # invoice once: the books copy when there is one, else the GSTR-2B record. Purchase
    # orders aren't supplies and are left out.
    invoices = (
        db.query(Invoice).filter(Invoice.client_id.in_(client_ids), Invoice.source.in_(("books", "gstr"))).all()
        if client_ids else []
    )
    invoices.sort(key=lambda inv: inv.source != "books")
    seen_documents: set[tuple[str, str]] = set()
    for inv in invoices:
        document = (inv.client_id, inv.normalized_key)
        if document in seen_documents:
            continue
        seen_documents.add(document)
        supplier = inv.supplier_gstin
        buyer = buyer_gstin.get(inv.client_id)
        if not supplier or not buyer or supplier == buyer:
            continue
        if supplier not in nodes:
            nodes[supplier] = {"id": supplier, "label": inv.supplier or supplier, "type": "supplier", "risk": "low"}
        key = (supplier, buyer)
        edge = edge_map.setdefault(key, {"from": supplier, "to": buyer, "amountValue": 0.0, "gst": 0.0, "count": 0})
        edge["amountValue"] += float(inv.total or 0)
        edge["gst"] += float(inv.gst or 0)
        edge["count"] += 1

    # Detect circular-trading rings.
    adjacency: dict[str, set[str]] = {node: set() for node in nodes}
    for supplier, buyer in edge_map:
        adjacency[supplier].add(buyer)
    raw_cycles = _find_cycles(adjacency)

    # Flag edges that lie on any cycle and tally ITC at risk per ring.
    suspicious_edges: set[tuple[str, str]] = set()
    cycles: list[dict] = []
    for ring in raw_cycles:
        pairs = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
        itc = 0.0
        for pair in pairs:
            suspicious_edges.add(pair)
            edge = edge_map.get(pair)
            if edge:
                itc += edge["gst"]
        for gstin in ring:
            if gstin in nodes:
                nodes[gstin]["risk"] = "critical"
        cycles.append({
            "gstins": ring,
            "labels": [nodes[g]["label"] for g in ring],
            "length": len(ring),
            "itc": round(itc, 2),
            "itcDisplay": _format_amount(itc),
        })

    edges = []
    for key, edge in edge_map.items():
        is_suspicious = key in suspicious_edges
        edges.append({
            "from": edge["from"],
            "to": edge["to"],
            "amount": _format_amount(edge["amountValue"]),
            "amountValue": round(edge["amountValue"], 2),
            "gst": round(edge["gst"], 2),
            "count": edge["count"],
            "suspicious": is_suspicious,
        })

    itc_at_risk = round(sum(c["itc"] for c in cycles), 2)
    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "cycles": cycles,
        "metrics": {
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "cyclesDetected": len(cycles),
            "suspiciousEdges": len(suspicious_edges),
            "itcAtRisk": itc_at_risk,
            "itcAtRiskDisplay": _format_amount(itc_at_risk),
        },
    }


RECON_STATUSES = ("Matched", "Mismatched", "Missing", "Duplicate")
OPEN_ALERT_EXCLUDED = ("Resolved", "Dismissed", "false_positive")


def _status_breakdown(invoices: list[Invoice]) -> dict:
    counts = Counter(inv.status or "Pending" for inv in invoices)
    breakdown = {status: counts.get(status, 0) for status in RECON_STATUSES}
    breakdown["Pending"] = sum(v for k, v in counts.items() if k not in RECON_STATUSES)
    return breakdown


@router.get("/node")
def node_details(
    clientId: str = Query(...),
    gstin: str = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Details for one graph entity: a client workspace or an external supplier.

    Figures come from purchase-register (books) invoices only, so a purchase that also
    appears in GSTR-2B is counted once. Only the caller's own clients are searched.
    """
    ensure_client_scope(db, user, clientId)
    client_ids = scoped_client_ids(db, user)
    target = gstin.strip().upper()
    clients = db.query(Client).filter(Client.id.in_(client_ids)).all() if client_ids else []
    client_names = {c.id: c.name for c in clients}

    client = next((c for c in clients if (c.gstin or "").upper() == target), None)
    if client:
        books = db.query(Invoice).filter(Invoice.client_id == client.id, Invoice.source == "books").all()
        by_supplier: dict[str, dict] = {}
        for inv in books:
            key = inv.supplier_gstin or inv.supplier or "Unknown"
            row = by_supplier.setdefault(key, {"gstin": inv.supplier_gstin or "", "name": inv.supplier or key, "count": 0, "total": 0.0})
            row["count"] += 1
            row["total"] += float(inv.total or 0)
        top_suppliers = sorted(by_supplier.values(), key=lambda r: r["total"], reverse=True)[:5]
        for row in top_suppliers:
            row["total"] = round(row["total"], 2)
            row["totalDisplay"] = _format_amount(row["total"])

        open_alerts = (
            db.query(FraudAlert)
            .filter(FraudAlert.client_id == client.id, ~FraudAlert.status.in_(OPEN_ALERT_EXCLUDED))
            .order_by(FraudAlert.risk.desc())
            .all()
        )
        purchase_value = sum(float(inv.total or 0) for inv in books)
        return {
            "kind": "client",
            "client": serialize_client(db, client),
            "purchaseValue": round(purchase_value, 2),
            "purchaseValueDisplay": _format_amount(purchase_value),
            "reconciliation": _status_breakdown(books),
            "supplierCount": len(by_supplier),
            "topSuppliers": top_suppliers,
            "openAlertCount": len(open_alerts),
            "openAlerts": [
                {"id": a.id, "type": a.type, "entity": a.entity, "risk": a.risk,
                 "amount": round(float(a.amount or 0), 2), "status": a.status}
                for a in open_alerts[:5]
            ],
        }

    supplied = (
        db.query(Invoice)
        .filter(Invoice.client_id.in_(client_ids), Invoice.source == "books", Invoice.supplier_gstin == target)
        .all()
        if client_ids else []
    )
    if not supplied:
        raise HTTPException(status_code=404, detail="No entity with this GSTIN in your clients' data.")

    per_client: dict[str, dict] = defaultdict(lambda: {"count": 0, "total": 0.0})
    for inv in supplied:
        per_client[inv.client_id]["count"] += 1
        per_client[inv.client_id]["total"] += float(inv.total or 0)
    client_gstins = {c.id: c.gstin for c in clients}
    billed_clients = sorted(
        (
            {"clientId": cid, "name": client_names.get(cid, ""), "gstin": client_gstins.get(cid, ""),
             "count": row["count"], "total": round(row["total"], 2), "totalDisplay": _format_amount(row["total"])}
            for cid, row in per_client.items()
        ),
        key=lambda r: r["total"], reverse=True,
    )
    total_value = sum(float(inv.total or 0) for inv in supplied)
    total_gst = sum(float(inv.gst or 0) for inv in supplied)
    recent = sorted(supplied, key=lambda inv: str(inv.invoice_date or ""), reverse=True)[:5]
    return {
        "kind": "supplier",
        "supplier": {
            "gstin": target,
            "name": next((inv.supplier for inv in supplied if inv.supplier), target),
            "invoiceCount": len(supplied),
            "totalValue": round(total_value, 2),
            "totalValueDisplay": _format_amount(total_value),
            "gst": round(total_gst, 2),
            "gstDisplay": _format_amount(total_gst),
        },
        "billedClients": billed_clients,
        "reconciliation": _status_breakdown(supplied),
        "recentInvoices": [
            {"id": inv.id, "invoiceNo": inv.invoice_no, "date": inv.invoice_date,
             "total": round(float(inv.total or 0), 2), "status": inv.status or "Pending",
             "clientName": client_names.get(inv.client_id, "")}
            for inv in recent
        ],
    }
