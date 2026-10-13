"""Data tools for the tax officer's assistant.

Each tool answers one kind of question from the live database, so answers always reflect the
data as it is right now (nothing is pre-loaded or cached). Every query is limited to the clients
in the caller's workspace (`scoped_client_ids`), whatever the model asks for, and all figures
are computed here, never by the model.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.api.deps import scoped_client_ids
from app.core.periods import MONTH_NAMES, parse_month_year
from app.core.timeutil import IST, format_ist
from app.db.models import CaseNote, Client, FraudAlert, Invoice, ReconciliationJob, Upload, User

LIST_LIMIT = 25
RECON_STATUSES = ("Matched", "Mismatched", "Missing", "Duplicate", "Pending")
CLOSED_ALERT_STATUSES = {"resolved", "dismissed", "false_positive", "closed"}


class ToolError(Exception):
    """A problem with the tool's arguments; the message is shown to the model."""


@dataclass
class AssistantContext:
    db: Session
    user: User
    today: date = field(default_factory=lambda: datetime.now(IST).date())

    def __post_init__(self) -> None:
        ids = scoped_client_ids(self.db, self.user)
        self.clients: dict[str, Client] = (
            {c.id: c for c in self.db.query(Client).filter(Client.id.in_(ids))} if ids else {}
        )

    # ── argument resolution ────────────────────────────────────────────────────

    def client_ids_for(self, client: str | None) -> list[str]:
        """All of the caller's clients, or the one named / GSTIN / id given."""
        if not client or str(client).strip().lower() in {"all", "*", "every", "all clients"}:
            return list(self.clients)
        needle = str(client).strip().lower()
        exact = [c.id for c in self.clients.values()
                 if needle in {c.id.lower(), (c.gstin or "").lower(), c.name.lower()}]
        if exact:
            return exact
        partial = [c.id for c in self.clients.values() if needle in c.name.lower()]
        if partial:
            return partial
        raise ToolError(
            f"No client matching '{client}' in your portfolio. "
            f"Your clients are: {', '.join(sorted(c.name for c in self.clients.values())) or 'none'}."
        )

    def period_for(self, period: str | None) -> tuple[int, int] | None:
        """(month, year) for a period like '09-2026', 'September 2026', 'last month'; None = all."""
        if not period or str(period).strip().lower() in {"all", "any", "all periods"}:
            return None
        text = str(period).strip().lower()
        first_of_month = self.today.replace(day=1)
        if text in {"this month", "current month", "current"}:
            return first_of_month.month, first_of_month.year
        if text in {"last month", "previous month", "past month"}:
            month, year = first_of_month.month - 1, first_of_month.year
            return (12, year - 1) if month == 0 else (month, year)
        parsed = parse_month_year(str(period))
        if not parsed:
            raise ToolError(f"Couldn't understand the period '{period}'. Use a month like '09-2026'.")
        return parsed

    def client_name(self, client_id: str) -> str:
        client = self.clients.get(client_id)
        return client.name if client else client_id


def _period_of(inv: Invoice) -> tuple[int, int] | None:
    return parse_month_year(inv.tax_period or "") or parse_month_year(inv.invoice_date or "")


def _period_label(period: tuple[int, int] | None) -> str:
    return f"{MONTH_NAMES[period[0] - 1]} {period[1]}" if period else "All periods"


def _money(value: float) -> float:
    return round(float(value or 0), 2)


def _invoices(ctx: AssistantContext, client_ids: list[str], period: tuple[int, int] | None,
              source: str | None = "books") -> list[Invoice]:
    if not client_ids:
        return []
    query = ctx.db.query(Invoice).filter(Invoice.client_id.in_(client_ids))
    if source:
        query = query.filter(Invoice.source == source)
    rows = query.all()
    return [inv for inv in rows if period is None or _period_of(inv) == period]


def _invoice_row(ctx: AssistantContext, inv: Invoice) -> dict:
    row = _invoice_fields(ctx, inv)
    partner = _matched_partner(ctx, inv) if inv.source == "books" else None
    if partner:
        # The GSTR-2B record reconciliation paired it with, and the gap, so nobody has to subtract.
        row["gstr2b"] = {"taxable": _money(partner.taxable), "gst": _money(partner.gst), "total": _money(partner.total)}
        row["differenceVsGstr2b"] = {
            "taxable": _money((inv.taxable or 0) - (partner.taxable or 0)),
            "gst": _money((inv.gst or 0) - (partner.gst or 0)),
            "total": _money((inv.total or 0) - (partner.total or 0)),
        }
    return row


def _invoice_fields(ctx: AssistantContext, inv: Invoice) -> dict:
    return {
        "client": ctx.client_name(inv.client_id),
        "invoiceNo": inv.invoice_no,
        "date": inv.invoice_date,
        "period": _period_label(_period_of(inv)),
        "supplier": inv.supplier,
        "supplierGstin": inv.supplier_gstin,
        "taxable": _money(inv.taxable),
        "gst": _money(inv.gst),
        "total": _money(inv.total),
        "reconciliationStatus": inv.status or "Pending",
        "itcDecision": inv.itc_status or "pending",
        "itcRejectReason": inv.itc_reject_reason or "",
    }


def _status_counts(invoices: list[Invoice]) -> dict[str, int]:
    counts = Counter(inv.status if inv.status in RECON_STATUSES else "Pending" for inv in invoices)
    return {status: counts.get(status, 0) for status in RECON_STATUSES}


def _matched_partner(ctx: AssistantContext, inv: Invoice) -> Invoice | None:
    """The GSTR-2B record reconciliation paired this invoice with, if any."""
    try:
        partner_id = json.loads(inv.validation_flags or "{}").get("matched_gstr_id")
    except (TypeError, ValueError, AttributeError):
        return None
    partner = ctx.db.get(Invoice, partner_id) if partner_id else None
    return partner if partner and partner.client_id == inv.client_id else None


def _matched_partner_gst(ctx: AssistantContext, inv: Invoice) -> float | None:
    partner = _matched_partner(ctx, inv)
    return float(partner.gst or 0) if partner else None


def _is_open(alert: FraudAlert) -> bool:
    return (alert.status or "").strip().lower() not in CLOSED_ALERT_STATUSES


# ── tools ──────────────────────────────────────────────────────────────────────

def list_clients(ctx: AssistantContext) -> dict:
    ids = list(ctx.clients)
    books = _invoices(ctx, ids, None)
    alerts = ctx.db.query(FraudAlert).filter(FraudAlert.client_id.in_(ids)).all() if ids else []
    per_client_books: dict[str, list[Invoice]] = defaultdict(list)
    for inv in books:
        per_client_books[inv.client_id].append(inv)
    open_alerts = Counter(a.client_id for a in alerts if _is_open(a))
    return {
        "clientCount": len(ids),
        "clients": [
            {
                "name": c.name,
                "gstin": c.gstin,
                "city": c.city,
                "status": c.status,
                "riskProfile": c.risk,
                "complianceScore": c.compliance,
                "purchaseInvoices": len(per_client_books[c.id]),
                "purchaseValue": _money(sum(i.total or 0 for i in per_client_books[c.id])),
                "openFraudAlerts": open_alerts.get(c.id, 0),
            }
            for c in sorted(ctx.clients.values(), key=lambda c: c.name.lower())
        ],
    }


def get_itc_summary(ctx: AssistantContext, client: str | None = None, period: str | None = None) -> dict:
    client_ids = ctx.client_ids_for(client)
    month = ctx.period_for(period)
    books = _invoices(ctx, client_ids, month)
    gstr = _invoices(ctx, client_ids, month, source="gstr")

    def summarise(invoices: list[Invoice], gstr_rows: list[Invoice]) -> dict:
        claimed = sum(i.gst or 0 for i in invoices)
        matched = sum(i.gst or 0 for i in invoices if i.status == "Matched")
        at_risk = {"mismatched": 0.0, "missingInGstr2b": 0.0, "duplicate": 0.0}
        for inv in invoices:
            if inv.status == "Mismatched":
                partner_gst = _matched_partner_gst(ctx, inv)
                at_risk["mismatched"] += max((inv.gst or 0) - (partner_gst or 0), 0)
            elif inv.status == "Missing":
                at_risk["missingInGstr2b"] += inv.gst or 0
            elif inv.status == "Duplicate":
                at_risk["duplicate"] += inv.gst or 0
        decisions = defaultdict(lambda: {"invoices": 0, "gst": 0.0})
        for inv in invoices:
            bucket = decisions[inv.itc_status or "pending"]
            bucket["invoices"] += 1
            bucket["gst"] += inv.gst or 0
        return {
            "invoices": len(invoices),
            "itcClaimedInBooks": _money(claimed),
            "itcMatchedWithGstr2b": _money(matched),
            "itcAvailableInGstr2b": _money(sum(g.gst or 0 for g in gstr_rows)),
            "itcAtRisk": {k: _money(v) for k, v in at_risk.items()} | {"total": _money(sum(at_risk.values()))},
            "itcSupportedByGstr2b": _money(claimed - sum(at_risk.values())),
            "officerDecisions": {
                k: {"invoices": v["invoices"], "gst": _money(v["gst"])}
                for k, v in sorted(decisions.items())
            },
            "notReconciledYet": sum(1 for i in invoices if (i.status or "Pending") == "Pending"),
        }

    per_client = []
    for cid in client_ids:
        rows = [i for i in books if i.client_id == cid]
        gstr_rows = [g for g in gstr if g.client_id == cid]
        if rows or gstr_rows:
            per_client.append({"client": ctx.client_name(cid)} | summarise(rows, gstr_rows))
    return {
        "period": _period_label(month),
        "totals": summarise(books, gstr),
        "byClient": per_client,
        "note": "ITC = GST on purchase-register (books) invoices. 'At risk' = GST not backed by a matching "
                "GSTR-2B record; 'supported' = claimed minus at risk. 'itcMatchedWithGstr2b' counts only "
                "invoices that match exactly. 'officerDecisions' are the tax officer's approve/reject decisions.",
    }


def search_invoices(ctx: AssistantContext, client: str | None = None, period: str | None = None,
                    status: str | None = None, supplier: str | None = None, invoice_no: str | None = None,
                    itc_decision: str | None = None, source: str = "books") -> dict:
    client_ids = ctx.client_ids_for(client)
    month = ctx.period_for(period)
    source_key = (source or "books").strip().lower()
    source_filter = {"books": "books", "gstr2b": "gstr", "gstr": "gstr", "all": None}.get(source_key, "books")
    rows = _invoices(ctx, client_ids, month, source=source_filter)
    if status:
        wanted = status.strip().lower()
        rows = [i for i in rows if (i.status or "Pending").lower() == wanted]
    if supplier:
        needle = supplier.strip().lower()
        rows = [i for i in rows if needle in (i.supplier or "").lower() or needle == (i.supplier_gstin or "").lower()]
    if invoice_no:
        needle = invoice_no.strip().lower()
        rows = [i for i in rows if needle in (i.invoice_no or "").lower()]
    if itc_decision:
        wanted = itc_decision.strip().lower()
        rows = [i for i in rows if (i.itc_status or "pending").lower() == wanted]
    rows.sort(key=lambda i: (str(i.invoice_date or ""), i.invoice_no or ""), reverse=True)
    return {
        "period": _period_label(month),
        "matchingInvoices": len(rows),
        "totalValue": _money(sum(i.total or 0 for i in rows)),
        "totalGst": _money(sum(i.gst or 0 for i in rows)),
        "invoices": [_invoice_row(ctx, i) for i in rows[:LIST_LIMIT]],
        "truncated": len(rows) > LIST_LIMIT,
    }


def get_reconciliation_status(ctx: AssistantContext, client: str | None = None, period: str | None = None) -> dict:
    client_ids = ctx.client_ids_for(client)
    month = ctx.period_for(period)
    books = _invoices(ctx, client_ids, month)
    by_client = []
    for cid in client_ids:
        rows = [i for i in books if i.client_id == cid]
        last_run = (
            ctx.db.query(ReconciliationJob).filter(ReconciliationJob.client_id == cid)
            .order_by(ReconciliationJob.created_at.desc()).first()
        )
        by_client.append({
            "client": ctx.client_name(cid),
            "invoices": len(rows),
            "statusCounts": _status_counts(rows),
            "lastReconciliationRun": format_ist(last_run.created_at) if last_run else "never",
        })
    return {"period": _period_label(month), "totals": _status_counts(books), "byClient": by_client}


def get_fraud_alerts(ctx: AssistantContext, client: str | None = None, include_closed: bool = False,
                     min_risk: int | None = None) -> dict:
    client_ids = ctx.client_ids_for(client)
    alerts = ctx.db.query(FraudAlert).filter(FraudAlert.client_id.in_(client_ids)).all() if client_ids else []
    if not include_closed:
        alerts = [a for a in alerts if _is_open(a)]
    if min_risk is not None:
        alerts = [a for a in alerts if (a.risk or 0) >= int(min_risk)]
    alerts.sort(key=lambda a: a.risk or 0, reverse=True)
    return {
        "alertCount": len(alerts),
        "totalAmount": _money(sum(a.amount or 0 for a in alerts)),
        "byType": dict(Counter(a.type for a in alerts)),
        "alerts": [
            {"client": ctx.client_name(a.client_id), "type": a.type, "entity": a.entity, "risk": a.risk,
             "amount": _money(a.amount), "status": a.status, "reason": a.reason,
             "raisedAt": format_ist(a.created_at)}
            for a in alerts[:LIST_LIMIT]
        ],
        "truncated": len(alerts) > LIST_LIMIT,
    }


def get_supplier_details(ctx: AssistantContext, supplier: str) -> dict:
    if not supplier or not supplier.strip():
        raise ToolError("Give a supplier name or GSTIN.")
    needle = supplier.strip().lower()
    rows = [i for i in _invoices(ctx, list(ctx.clients), None)
            if needle == (i.supplier_gstin or "").lower() or needle in (i.supplier or "").lower()]
    if not rows:
        return {"found": False, "message": f"No purchase invoices from a supplier matching '{supplier}'."}
    by_supplier: dict[str, list[Invoice]] = defaultdict(list)
    for inv in rows:
        by_supplier[inv.supplier_gstin or inv.supplier].append(inv)
    result = []
    for gstin, invs in by_supplier.items():
        result.append({
            "supplier": invs[0].supplier,
            "gstin": gstin,
            "invoices": len(invs),
            "totalValue": _money(sum(i.total or 0 for i in invs)),
            "gst": _money(sum(i.gst or 0 for i in invs)),
            "clientsBilled": sorted({ctx.client_name(i.client_id) for i in invs}),
            "reconciliation": _status_counts(invs),
        })
    return {"found": True, "suppliers": result}


def get_circular_trading(ctx: AssistantContext) -> dict:
    from app.api.graph import graph  # the same analysis the Graph Analytics page shows

    if not ctx.clients:
        return {"cyclesDetected": 0, "rings": []}
    data = graph(clientId=next(iter(ctx.clients)), db=ctx.db, user=ctx.user)
    return {
        "cyclesDetected": data["metrics"]["cyclesDetected"],
        "totalItcAtRisk": data["metrics"]["itcAtRisk"],
        "rings": [{"entities": c["labels"], "gstins": c["gstins"], "itcAtRisk": c["itc"]} for c in data["cycles"]],
    }


def get_documents(ctx: AssistantContext, client: str | None = None, document_type: str | None = None,
                  status: str | None = None) -> dict:
    client_ids = ctx.client_ids_for(client)
    uploads = ctx.db.query(Upload).filter(Upload.client_id.in_(client_ids)).all() if client_ids else []
    if document_type:
        wanted = document_type.strip().upper().replace(" ", "_").replace("-", "_")
        uploads = [u for u in uploads if (u.document_type or "").upper() == wanted]
    if status:
        uploads = [u for u in uploads if (u.status or "").lower() == status.strip().lower()]
    uploads.sort(key=lambda u: u.created_at or 0, reverse=True)
    return {
        "documentCount": len(uploads),
        "byType": dict(Counter(u.document_type for u in uploads)),
        "byStatus": dict(Counter(u.status for u in uploads)),
        "documents": [
            {"client": ctx.client_name(u.client_id), "fileName": u.file_name, "type": u.document_type,
             "status": u.status, "rowsParsed": u.parsed_rows, "taxPeriods": u.tax_periods,
             "uploadedAt": format_ist(u.created_at)}
            for u in uploads[:LIST_LIMIT]
        ],
        "truncated": len(uploads) > LIST_LIMIT,
    }


def get_case_notes(ctx: AssistantContext, client: str | None = None) -> dict:
    client_ids = ctx.client_ids_for(client)
    notes = (
        ctx.db.query(CaseNote).filter(CaseNote.client_id.in_(client_ids))
        .order_by(CaseNote.created_at.desc()).limit(LIST_LIMIT).all()
        if client_ids else []
    )
    return {
        "notes": [
            {"client": ctx.client_name(n.client_id), "case": n.exception_id, "note": n.note_text,
             "addedAt": format_ist(n.created_at)}
            for n in notes
        ],
    }


_CLIENT = {"type": "string", "description": "Client name, GSTIN, or 'all' (default: all of the officer's clients)."}
_PERIOD = {"type": "string", "description": "Tax period month, e.g. '09-2026', 'September 2026', 'last month', or 'all' (default)."}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_clients",
        "fn": list_clients,
        "description": "List all of the tax officer's clients with GSTIN, city, risk, compliance score, "
                       "purchase totals and open fraud alert counts.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_itc_summary",
        "fn": get_itc_summary,
        "description": "Input Tax Credit (ITC) for a period and/or client: ITC claimed in books, ITC matched with "
                       "GSTR-2B, ITC at risk (mismatched / missing in GSTR-2B / duplicate), and the officer's "
                       "approve/reject decisions. Use for any question about ITC or tax credit claims.",
        "parameters": {"type": "object", "properties": {"client": _CLIENT, "period": _PERIOD}},
    },
    {
        "name": "search_invoices",
        "fn": search_invoices,
        "description": "Find and list invoices with filters. Returns the count, totals and up to 25 invoices.",
        "parameters": {
            "type": "object",
            "properties": {
                "client": _CLIENT,
                "period": _PERIOD,
                "status": {"type": "string", "description": "Reconciliation status: Matched, Mismatched, Missing, Duplicate or Pending."},
                "supplier": {"type": "string", "description": "Supplier name (partial) or GSTIN."},
                "invoice_no": {"type": "string", "description": "Invoice number (partial match)."},
                "itc_decision": {"type": "string", "description": "Officer's ITC decision: approved, rejected or pending."},
                "source": {"type": "string", "description": "'books' (purchase register, default), 'gstr2b', or 'all'."},
            },
        },
    },
    {
        "name": "get_reconciliation_status",
        "fn": get_reconciliation_status,
        "description": "Books vs GSTR-2B reconciliation results: how many invoices are Matched, Mismatched, "
                       "Missing in GSTR-2B, Duplicate or not yet reconciled, per client, and the last run time.",
        "parameters": {"type": "object", "properties": {"client": _CLIENT, "period": _PERIOD}},
    },
    {
        "name": "get_fraud_alerts",
        "fn": get_fraud_alerts,
        "description": "Fraud / risk alerts raised for clients (open ones by default), highest risk first.",
        "parameters": {
            "type": "object",
            "properties": {
                "client": _CLIENT,
                "include_closed": {"type": "boolean", "description": "Also include resolved/dismissed alerts."},
                "min_risk": {"type": "integer", "description": "Only alerts with at least this risk score (0-100)."},
            },
        },
    },
    {
        "name": "get_supplier_details",
        "fn": get_supplier_details,
        "description": "Everything about one supplier across the officer's clients: invoices, value, GST, "
                       "which clients it bills, and reconciliation status.",
        "parameters": {
            "type": "object",
            "properties": {"supplier": {"type": "string", "description": "Supplier name (partial) or GSTIN."}},
            "required": ["supplier"],
        },
    },
    {
        "name": "get_circular_trading",
        "fn": get_circular_trading,
        "description": "Circular trading rings (A bills B bills C bills A) found in the supplier-buyer network, "
                       "with the ITC at risk in each ring.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_documents",
        "fn": get_documents,
        "description": "Uploaded documents (purchase registers, GSTR-2B files, tax invoices, purchase orders) "
                       "with their processing status.",
        "parameters": {
            "type": "object",
            "properties": {
                "client": _CLIENT,
                "document_type": {"type": "string", "description": "PURCHASE_REGISTER, GSTR2B, TAX_INVOICE or PURCHASE_ORDER."},
                "status": {"type": "string", "description": "Processing status, e.g. parsed, failed, received."},
            },
        },
    },
    {
        "name": "get_case_notes",
        "fn": get_case_notes,
        "description": "Recent notes the officer and clients added on investigation cases.",
        "parameters": {"type": "object", "properties": {"client": _CLIENT}},
    },
]

TOOLS_BY_NAME: dict[str, dict[str, Any]] = {tool["name"]: tool for tool in TOOLS}


def run_tool(ctx: AssistantContext, name: str, args: dict | None) -> dict:
    """Run a tool by name; argument problems come back as {'error': ...} for the model to read."""
    tool = TOOLS_BY_NAME.get(name)
    if not tool:
        return {"error": f"Unknown tool '{name}'."}
    allowed = set(tool["parameters"].get("properties", {}))
    clean = {k: v for k, v in (args or {}).items() if k in allowed and v not in (None, "")}
    fn: Callable[..., dict] = tool["fn"]
    try:
        return fn(ctx, **clean)
    except ToolError as exc:
        return {"error": str(exc)}
    except (TypeError, ValueError) as exc:
        return {"error": f"Invalid arguments for {name}: {exc}"}
