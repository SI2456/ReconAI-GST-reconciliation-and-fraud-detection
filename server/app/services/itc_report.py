"""Monthly ITC report for one client, as a PDF the tax officer can send to the client.

`build_report_data` gathers everything for the month from the database: every purchase-register
invoice with its GSTR-2B counterpart and the officer's ITC decision, GSTR-2B records missing from
the books, and the source documents. `render_pdf` lays that out as an A4 landscape PDF.
"""

from __future__ import annotations

import html
import io
import json
from collections import Counter
from datetime import datetime

import pymupdf
from sqlalchemy.orm import Session

from app.core.periods import MONTH_NAMES, parse_month_year
from app.core.timeutil import IST, format_ist
from app.db.models import Client, Invoice, Upload, User
from app.services.itc import ITC_APPROVED, ITC_REJECTED

RECON_STATUSES = ("Matched", "Mismatched", "Missing", "Duplicate")


# ── data ───────────────────────────────────────────────────────────────────────

def parse_period(value: str) -> tuple[int, int]:
    """(month, year) from '09-2026', '2026-09', 'September 2026'..."""
    parsed = parse_month_year(str(value or ""))
    if not parsed:
        raise ValueError(f"Couldn't understand the month '{value}'. Use a month like '09-2026'.")
    return parsed


def period_label(period: tuple[int, int]) -> str:
    return f"{MONTH_NAMES[period[0] - 1]} {period[1]}"


def _period_of(inv: Invoice) -> tuple[int, int] | None:
    return parse_month_year(inv.tax_period or "") or parse_month_year(inv.invoice_date or "")


def _upload_periods(upload: Upload) -> set[tuple[int, int]]:
    raw = (upload.tax_periods or "").strip()
    try:
        items = json.loads(raw) if raw.startswith("[") else raw.replace(";", ",").split(",")
    except ValueError:
        items = [raw]
    return {p for p in (parse_month_year(str(i).strip()) for i in items) if p}


def _money(value) -> float:
    return round(float(value or 0), 2)


def _amounts(inv: Invoice | None) -> dict:
    if not inv:
        return {}
    return {"taxable": _money(inv.taxable), "cgst": _money(inv.cgst), "sgst": _money(inv.sgst),
            "igst": _money(inv.igst), "gst": _money(inv.gst), "total": _money(inv.total)}


def _partner_id(inv: Invoice) -> str | None:
    try:
        return json.loads(inv.validation_flags or "{}").get("matched_gstr_id")
    except (TypeError, ValueError, AttributeError):
        return None


def build_report_data(db: Session, client: Client, period: tuple[int, int], officer: User) -> dict:
    in_month = lambda inv: _period_of(inv) == period  # noqa: E731
    rows = db.query(Invoice).filter(Invoice.client_id == client.id, Invoice.source.in_(("books", "gstr"))).all()
    books = sorted((i for i in rows if i.source == "books" and in_month(i)), key=lambda i: (i.invoice_date or "", i.invoice_no or ""))
    gstr_all = {i.id: i for i in rows if i.source == "gstr"}
    gstr = [i for i in gstr_all.values() if in_month(i)]

    officers = {u.id: u.name for u in db.query(User).filter(User.id.in_({i.itc_decided_by for i in books if i.itc_decided_by}))}
    invoices, paired = [], set()
    for inv in books:
        partner = gstr_all.get(_partner_id(inv) or "")
        if partner:
            paired.add(partner.id)
        books_amt, gstr_amt = _amounts(inv), _amounts(partner)
        decision = inv.itc_status if inv.itc_status in (ITC_APPROVED, ITC_REJECTED) else "pending"
        invoices.append({
            "invoiceNo": inv.invoice_no,
            "date": inv.invoice_date,
            "supplier": inv.supplier,
            "supplierGstin": inv.supplier_gstin,
            "books": books_amt,
            "gstr2b": gstr_amt,
            "gstDifference": _money(books_amt["gst"] - gstr_amt["gst"]) if partner else None,
            "status": inv.status or "Pending",
            "decision": decision,
            "decidedBy": officers.get(inv.itc_decided_by, "") if decision != "pending" else "",
            "decidedAt": format_ist(inv.itc_decided_at) if decision != "pending" and inv.itc_decided_at else "",
            "rejectReason": inv.itc_reject_reason or "",
        })

    gstr_only = [
        {"invoiceNo": g.invoice_no, "date": g.invoice_date, "supplier": g.supplier, "supplierGstin": g.supplier_gstin, **_amounts(g)}
        for g in sorted(gstr, key=lambda g: (g.invoice_date or "", g.invoice_no or "")) if g.id not in paired
    ]
    uploads = [
        {"fileName": u.file_name, "type": u.document_type, "status": u.status, "uploadedAt": format_ist(u.created_at)}
        for u in db.query(Upload).filter(Upload.client_id == client.id).order_by(Upload.created_at).all()
        if period in _upload_periods(u)
    ]

    def total(items, key):
        return _money(sum(i["books"][key] for i in items))

    by_decision = {d: [i for i in invoices if i["decision"] == d] for d in (ITC_APPROVED, ITC_REJECTED, "pending")}
    status_counts = Counter(i["status"] if i["status"] in RECON_STATUSES else "Pending" for i in invoices)
    at_risk = 0.0
    for i in invoices:
        if i["status"] == "Mismatched" and i["gstDifference"] is not None:
            at_risk += max(i["gstDifference"], 0)
        elif i["status"] in ("Missing", "Duplicate"):
            at_risk += i["books"]["gst"]

    return {
        "client": {"name": client.name, "gstin": client.gstin or "", "legalName": client.gst_legal_name or "",
                   "city": client.city or "", "email": client.email or ""},
        "officer": {"name": officer.name, "firm": officer.firm_name or "", "icai": officer.icai_number or "",
                    "email": officer.email},
        "period": period_label(period),
        "periodCode": f"{period[0]:02d}-{period[1]}",
        "generatedAt": datetime.now(IST).strftime("%d %b %Y, %I:%M %p IST"),
        "summary": {
            "booksInvoices": len(invoices),
            "booksTaxable": total(invoices, "taxable"),
            "booksGst": total(invoices, "gst"),
            "booksTotal": total(invoices, "total"),
            "gstr2bRecords": len(gstr),
            "gstr2bGst": _money(sum(g.gst or 0 for g in gstr)),
            "gstr2bNotInBooks": len(gstr_only),
            "reconciliation": {s: status_counts.get(s, 0) for s in (*RECON_STATUSES, "Pending")},
            "approved": {"invoices": len(by_decision[ITC_APPROVED]), "gst": total(by_decision[ITC_APPROVED], "gst")},
            "rejected": {"invoices": len(by_decision[ITC_REJECTED]), "gst": total(by_decision[ITC_REJECTED], "gst")},
            "pending": {"invoices": len(by_decision["pending"]), "gst": total(by_decision["pending"], "gst")},
            "itcAtRisk": _money(at_risk),
        },
        "invoices": invoices,
        "gstr2bNotInBooks": gstr_only,
        "documents": uploads,
    }


# ── PDF ────────────────────────────────────────────────────────────────────────

def inr(value) -> str:
    """Indian digit grouping, e.g. 433429.2 -> '4,33,429.20'."""
    if value is None or value == "":
        return "-"
    amount = float(value)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return sign + ",".join(groups + [tail]) + "." + frac


def _e(value) -> str:
    return html.escape(str(value if value not in (None, "") else "-"))


_CSS = """
body { font-family: sans-serif; font-size: 7.5pt; color: #1F2937; }
h1 { font-size: 17pt; color: #1F3A5F; margin: 0 0 2pt 0; }
h2 { font-size: 11pt; color: #1F3A5F; margin: 12pt 0 4pt 0; border-bottom: 1px solid #2E6DA4; }
p { margin: 0 0 3pt 0; }
.muted { color: #6B7280; }
.small { font-size: 6.5pt; }
table { border-collapse: collapse; width: 100%; margin-bottom: 4pt; }
td.h { background-color: #1F3A5F; color: #FFFFFF; font-weight: bold; padding: 2pt 3pt; font-size: 7pt; border: none; }
td { border-bottom: 1px solid #D9DEE5; padding: 2pt 3pt; vertical-align: top; }
td.n { text-align: right; }
.kv td { border: none; padding: 1pt 6pt 1pt 0; }
.box { background-color: #F3F6FA; padding: 4pt; }
.approved { color: #15803D; font-weight: bold; }
.rejected { color: #B91C1C; font-weight: bold; }
.pending { color: #B45309; font-weight: bold; }
.bad { color: #B91C1C; }
"""


_ROW = "<!--row-->"


def _table(headers: list[tuple[str, bool]], rows: list[list[str]], empty: str) -> str:
    if not rows:
        return f"<p class='muted'>{html.escape(empty)}</p>"
    # Header cells are plain <td>s: Story repeats real <th> rows on later pages, and draws them misplaced.
    head = "".join(f"<td class='h{' n' if num else ''}'>{html.escape(h)}</td>" for h, num in headers)
    # Rows are separated by _ROW markers so render_pdf can split a long table across pages itself.
    body = "".join(
        _ROW + "<tr>" + "".join(f"<td class='{'n' if headers[i][1] else ''}'>{cell}</td>" for i, cell in enumerate(r)) + "</tr>"
        for r in rows
    )
    return f"<table><tr>{head}</tr>{body}</table>"


def _decision_label(inv: dict) -> str:
    return {"approved": "<span class='approved'>Approved</span>", "rejected": "<span class='rejected'>Rejected</span>"}.get(
        inv["decision"], "<span class='pending'>Awaiting decision</span>")


def _split(amounts: dict, key: str) -> str:
    """CGST/SGST/IGST, or '-' when the source only gives the total GST (no split recorded)."""
    if not (amounts.get("cgst") or amounts.get("sgst") or amounts.get("igst")) and amounts.get("gst"):
        return "-"
    return inr(amounts.get(key))


def _count(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _supplier(inv: dict) -> str:
    return f"{_e(inv['supplier'])}<br/><span class='muted small'>{_e(inv['supplierGstin'])}</span>"


def _html(data: dict, report_no: str) -> str:
    s, c, o = data["summary"], data["client"], data["officer"]
    rec = s["reconciliation"]
    invoices = data["invoices"]

    def decision_rows(kind: str) -> list[list[str]]:
        out = []
        for inv in (i for i in invoices if i["decision"] == kind):
            b = inv["books"]
            row = [_e(inv["invoiceNo"]), _e(inv["date"]), _supplier(inv), inr(b["taxable"]), _split(b, "cgst"),
                   _split(b, "sgst"), _split(b, "igst"), f"<b>{inr(b['gst'])}</b>", inr(b["total"]), _e(inv["status"])]
            if kind != "pending":
                row += [_e(inv["decidedBy"]), _e(inv["decidedAt"])]
            if kind == ITC_REJECTED:
                row.append(_e(inv["rejectReason"]))
            out.append(row)
        return out

    money_cols = [("Taxable", True), ("CGST", True), ("SGST", True), ("IGST", True), ("ITC (GST)", True), ("Invoice total", True)]
    base_cols = [("Invoice no.", False), ("Date", False), ("Supplier / GSTIN", False)] + money_cols + [("Recon status", False)]
    decided_cols = base_cols + [("Decided by", False), ("Decided on", False)]

    comparison = []
    for inv in invoices:
        b, g = inv["books"], inv["gstr2b"]
        diff = inv["gstDifference"]
        comparison.append([
            _e(inv["invoiceNo"]), _supplier(inv),
            inr(b["taxable"]), inr(b["gst"]), inr(b["total"]),
            inr(g.get("taxable")) if g else "<span class='bad'>Not in GSTR-2B</span>",
            inr(g.get("gst")) if g else "-", inr(g.get("total")) if g else "-",
            (f"<span class='bad'>{inr(diff)}</span>" if diff else inr(diff)) if diff is not None else "-",
            _e(inv["status"]), _decision_label(inv),
        ])

    register = [[_e(i["invoiceNo"]), _e(i["date"]), _supplier(i), inr(i["books"]["taxable"]), _split(i["books"], "cgst"),
                 _split(i["books"], "sgst"), _split(i["books"], "igst"), inr(i["books"]["gst"]), inr(i["books"]["total"])]
                for i in invoices]
    gstr_only = [[_e(g["invoiceNo"]), _e(g["date"]), _supplier(g), inr(g["taxable"]), inr(g["gst"]), inr(g["total"])]
                 for g in data["gstr2bNotInBooks"]]
    docs = [[_e(d["fileName"]), _e(d["type"]), _e(d["status"]), _e(d["uploadedAt"])] for d in data["documents"]]

    officer_line = o["name"] + (f", {o['firm']}" if o["firm"] else "") + (f" (ICAI {o['icai']})" if o["icai"] else "")
    return f"""
<h1>Input Tax Credit (ITC) Report: {_e(data['period'])}</h1>
<p class='muted'>Report no. {_e(report_no)} · Generated {_e(data['generatedAt'])} by ReconAI</p>
<table class='kv'><tr>
  <td><b>Client</b><br/>{_e(c['name'])}{f"<br/><span class='muted'>{_e(c['legalName'])}</span>" if c['legalName'] and c['legalName'] != c['name'] else ""}</td>
  <td><b>GSTIN</b><br/>{_e(c['gstin'])}</td>
  <td><b>Tax period</b><br/>{_e(data['period'])}</td>
  <td><b>Tax officer</b><br/>{_e(officer_line)}</td>
</tr></table>

<!--section--><h2>1. Summary</h2>
<table class='kv box'><tr>
  <td><b>Purchase register</b><br/>{_count(s['booksInvoices'], 'invoice')}<br/>Taxable Rs. {inr(s['booksTaxable'])}<br/>GST (ITC claimed) Rs. {inr(s['booksGst'])}</td>
  <td><b>GSTR-2B</b><br/>{_count(s['gstr2bRecords'], 'record')}<br/>GST Rs. {inr(s['gstr2bGst'])}<br/>{s['gstr2bNotInBooks']} not in purchase register</td>
  <td><b>Reconciliation</b><br/>Matched {rec['Matched']} · Mismatched {rec['Mismatched']}<br/>Missing in GSTR-2B {rec['Missing']} · Duplicate {rec['Duplicate']}<br/>Not reconciled {rec['Pending']}</td>
  <td><b>ITC decisions</b><br/><span class='approved'>Approved</span> {s['approved']['invoices']} · Rs. {inr(s['approved']['gst'])}<br/><span class='rejected'>Rejected</span> {s['rejected']['invoices']} · Rs. {inr(s['rejected']['gst'])}<br/><span class='pending'>Awaiting</span> {s['pending']['invoices']} · Rs. {inr(s['pending']['gst'])}</td>
  <td><b>ITC at risk</b><br/>Rs. {inr(s['itcAtRisk'])}<br/><span class='muted small'>GST not backed by a matching GSTR-2B record</span></td>
</tr></table>

<!--section--><h2>2. ITC approved ({_count(s['approved']['invoices'], 'invoice')} · Rs. {inr(s['approved']['gst'])})</h2>
{_table(decided_cols, decision_rows(ITC_APPROVED), "No ITC was approved for this month.")}

<!--section--><h2>3. ITC rejected ({_count(s['rejected']['invoices'], 'invoice')} · Rs. {inr(s['rejected']['gst'])})</h2>
{_table(decided_cols + [("Reason", False)], decision_rows(ITC_REJECTED), "No ITC was rejected for this month.")}

<!--section--><h2>4. Awaiting the tax officer's decision ({_count(s['pending']['invoices'], 'invoice')} · Rs. {inr(s['pending']['gst'])})</h2>
{_table(base_cols, decision_rows("pending"), "Every invoice for this month has a decision.")}

<!--section--><h2>5. Purchase register vs GSTR-2B, invoice by invoice</h2>
{_table([("Invoice no.", False), ("Supplier / GSTIN", False), ("Books taxable", True), ("Books GST", True), ("Books total", True),
         ("GSTR-2B taxable", True), ("GSTR-2B GST", True), ("GSTR-2B total", True), ("GST difference", True),
         ("Recon status", False), ("ITC decision", False)], comparison, "No purchase-register invoices for this month.")}

<!--section--><h2>6. Purchase register (books): all invoices</h2>
{_table([("Invoice no.", False), ("Date", False), ("Supplier / GSTIN", False), ("Taxable", True), ("CGST", True),
         ("SGST", True), ("IGST", True), ("GST", True), ("Total", True)], register, "No purchase-register invoices for this month.")}

<!--section--><h2>7. In GSTR-2B but not in the purchase register ({len(gstr_only)})</h2>
{_table([("Invoice no.", False), ("Date", False), ("Supplier / GSTIN", False), ("Taxable", True), ("GST", True), ("Total", True)],
        gstr_only, "Every GSTR-2B record for this month is in the purchase register.")}

<!--section--><h2>8. Source documents for this month</h2>
{_table([("File", False), ("Type", False), ("Status", False), ("Uploaded", False)], docs, "No documents were uploaded for this month.")}

<!--section--><h2>Notes</h2>
<p>Amounts are in Indian Rupees (Rs.). ITC (GST) = CGST + SGST + IGST on the invoice; "-" in a CGST/SGST/IGST column means the source document gives only the total GST. "ITC at risk" is GST in the purchase register not backed by a matching GSTR-2B record: the books-minus-GSTR-2B GST difference for mismatched invoices, and the full GST for invoices missing from GSTR-2B or duplicated.</p>
<p>ITC can only be approved for invoices matched with GSTR-2B. Decisions are those recorded in ReconAI by the tax officer up to the time this report was generated.</p>
<p style='margin-top:14pt'>__________________________<br/>{_e(o['name'])}<br/><span class='muted'>Tax officer{(' · ' + _e(o['firm'])) if o['firm'] else ''}</span></p>
"""


_SECTION = "<!--section-->"
_MIN_SECTION_SPACE = 70  # points: start a section on a new page rather than leave its heading alone at the bottom


class _Layout:
    """Places HTML blocks one below the other, starting new pages as needed.

    Every block is its own Story. With one Story for the whole report, MuPDF draws empty copies of
    table header rows on later pages, so long tables are split here instead (see `table`).
    """

    def __init__(self, writer: "pymupdf.DocumentWriter", page: "pymupdf.Rect", content: "pymupdf.Rect") -> None:
        self.writer, self.page, self.content = writer, page, content
        self.device, self.y = writer.begin_page(page), content.y0

    def new_page(self) -> None:
        self.writer.end_page()
        self.device, self.y = self.writer.begin_page(self.page), self.content.y0

    def fits(self, html_text: str) -> bool:
        story = pymupdf.Story(html=html_text, user_css=_CSS)
        more, _ = story.place(pymupdf.Rect(self.content.x0, self.y, self.content.x1, self.content.y1))
        return not more

    def draw(self, html_text: str) -> None:
        """Draw a block that fits (or, at the top of a page, as much as fits)."""
        story = pymupdf.Story(html=html_text, user_css=_CSS)
        while True:
            more, filled = story.place(pymupdf.Rect(self.content.x0, self.y, self.content.x1, self.content.y1))
            story.draw(self.device)
            filled = pymupdf.Rect(filled)
            self.y = filled.y1 if not filled.is_empty else self.y
            if not more:
                return
            self.new_page()

    def section(self, chunk: str) -> None:
        if self.content.y1 - self.y < _MIN_SECTION_SPACE and self.y > self.content.y0:
            self.new_page()
        if _ROW not in chunk:
            self.draw(chunk)
            return
        # heading + "<table><tr>header</tr>", then the rows, then "</table>" and anything after it
        before, *rows = chunk.split(_ROW)
        last, after = rows[-1].split("</table>", 1)
        rows[-1] = last
        table_at = before.index("<table>")
        heading, table_head = before[:table_at], before[table_at:]
        continued = heading.replace("</h2>", " (continued)</h2>")
        i, title = 0, heading
        while i < len(rows):
            block = lambda k: f"{title}{table_head}{''.join(rows[i:k])}</table>"  # noqa: E731
            if not self.fits(block(i + 1)):
                if self.y > self.content.y0:
                    self.new_page()
                    continue
                k = i + 1  # a single row taller than a page: draw it anyway
            else:
                lo, hi = i + 1, len(rows)  # most rows that still fit on this page
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    lo, hi = (mid, hi) if self.fits(block(mid)) else (lo, mid - 1)
                k = lo
            self.draw(block(k))
            i, title = k, continued
            if i < len(rows):
                self.new_page()
        if after.strip():
            self.draw(after)


def render_pdf(data: dict, report_no: str) -> bytes:
    page = pymupdf.paper_rect("a4-l")
    content = page + (32, 34, -32, -34)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    layout = _Layout(writer, page, content)
    for chunk in _html(data, report_no).split(_SECTION):
        if chunk.strip():
            layout.section(chunk)
    writer.end_page()
    writer.close()

    doc = pymupdf.open("pdf", buffer.getvalue())
    footer = f"ReconAI ITC Report · {data['client']['name']} · {data['period']} · {report_no}"
    for number, pdf_page in enumerate(doc, start=1):
        pdf_page.insert_text((32, page.height - 16), footer, fontsize=6.5, color=(0.42, 0.45, 0.5))
        pdf_page.insert_text((page.width - 92, page.height - 16), f"Page {number} of {len(doc)}", fontsize=6.5, color=(0.42, 0.45, 0.5))
    doc.set_metadata({"title": f"ITC Report {data['period']} - {data['client']['name']}", "author": data["officer"]["name"],
                      "creator": "ReconAI", "subject": "Input Tax Credit report"})
    return doc.tobytes(garbage=3, deflate=True)
