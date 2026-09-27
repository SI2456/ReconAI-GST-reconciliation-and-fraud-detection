import collections
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, scoped_client_ids
from app.db.models import Client, FraudAlert, Invoice, User
from app.db.session import get_db
from app.core.periods import parse_month_year


router = APIRouter()


@router.get("")
@router.get("/stats")
def dashboard(
    clientId: str | None = Query(None, alias="clientId"),
    financialYear: str | None = Query(None, alias="financialYear"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    all_scoped_ids = scoped_client_ids(db, user)
    if not all_scoped_ids:
        return {
            "kpis": {
                "totalClients": 0,
                "uploadedInvoices": 0,
                "matchedInvoices": 0,
                "mismatchedInvoices": 0,
                "duplicateInvoices": 0,
                "highRiskTransactions": 0,
                "circularTrading": 0,
                "complianceScore": 100,
            },
            "monthlyData": [],
            "fraudPieData": [],
            "supplierRisk": [],
            "fiscalYears": ["2026-27", "2025-26"],
        }

    # Filter by specific clientId if requested and within user's scope
    if clientId and clientId != "ALL" and clientId in all_scoped_ids:
        client_ids = [clientId]
    else:
        client_ids = all_scoped_ids

    # Query invoices & alerts
    invoices_query = db.query(Invoice).filter(Invoice.client_id.in_(client_ids), Invoice.source == "books")
    alerts_query = db.query(FraudAlert).filter(FraudAlert.client_id.in_(client_ids))

    invoices = invoices_query.all()
    alerts = alerts_query.all()
    clients = db.query(Client).filter(Client.id.in_(all_scoped_ids)).all()

    matched_list = [i for i in invoices if (i.status or "").lower() == "matched"]
    mismatched_list = [i for i in invoices if "mismatch" in (i.status or "").lower()]
    missing_list = [i for i in invoices if "missing" in (i.status or "").lower()]
    duplicate_list = [i for i in invoices if "duplicate" in (i.status or "").lower()]
    high_risk_list = [a for a in alerts if (a.risk or 0) >= 70]
    circular_list = [a for a in alerts if "circular" in (a.type or "").lower() or "cycle" in (a.type or "").lower()]

    # Calculate live compliance score from books-side match rate
    avg_compliance = round((len(matched_list) / len(invoices) * 100)) if invoices else None

    # Build dynamic monthly reconciliation trend
    # Months April to September 2026 (or active period)
    month_keys = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
    monthly_stats = {m: {"matched": 0, "mismatched": 0, "missing": 0, "duplicates": 0} for m in month_keys}

    for inv in invoices:
        p = parse_month_year(inv.tax_period or inv.invoice_date)
        if p and p[0] and p[1]:
            m_key = f"{p[1]:04d}-{p[0]:02d}"
            if m_key in monthly_stats:
                st = (inv.status or "").lower()
                if st == "matched":
                    monthly_stats[m_key]["matched"] += 1
                elif "mismatch" in st:
                    monthly_stats[m_key]["mismatched"] += 1
                elif "missing" in st:
                    monthly_stats[m_key]["missing"] += 1
                elif "duplicate" in st:
                    monthly_stats[m_key]["duplicates"] += 1

    monthly_data = [
        {
            "month": m,
            "matched": monthly_stats[m]["matched"],
            "mismatched": monthly_stats[m]["mismatched"],
            "missing": monthly_stats[m]["missing"],
            "duplicates": monthly_stats[m]["duplicates"],
        }
        for m in month_keys
    ]

    # Fraud severity distribution
    critical_alerts = len([a for a in alerts if (a.risk or 0) >= 80])
    high_alerts = len([a for a in alerts if 60 <= (a.risk or 0) < 80])
    medium_alerts = len([a for a in alerts if 40 <= (a.risk or 0) < 60])
    low_alerts = len([a for a in alerts if (a.risk or 0) < 40])
    tot_alerts = len(alerts) or 1

    fraud_pie_data = [
        {"name": "Critical", "value": round((critical_alerts / tot_alerts) * 100), "color": "#ef4444"},
        {"name": "High", "value": round((high_alerts / tot_alerts) * 100), "color": "#f97316"},
        {"name": "Medium", "value": round((medium_alerts / tot_alerts) * 100), "color": "#eab308"},
        {"name": "Low", "value": round((low_alerts / tot_alerts) * 100), "color": "#10b981"},
    ]
    # Filter out 0% slices if there are other slices, or keep if all zero
    active_pie = [p for p in fraud_pie_data if p["value"] > 0]
    if not active_pie and alerts:
        active_pie = fraud_pie_data

    # Supplier risk ranking
    supplier_map = collections.defaultdict(lambda: {"risk": 0, "amount": 0.0, "invoices": 0, "reasons": []})
    for inv in invoices:
        supp = inv.supplier or "Unknown Supplier"
        supplier_map[supp]["amount"] += (inv.total or inv.taxable or 0.0)
        supplier_map[supp]["invoices"] += 1

    for a in alerts:
        supp = a.entity or "Unknown Supplier"
        supplier_map[supp]["risk"] = max(supplier_map[supp]["risk"], a.risk or 0)
        if a.amount:
            supplier_map[supp]["amount"] = max(supplier_map[supp]["amount"], a.amount)
        if a.reason:
            supplier_map[supp]["reasons"].append(a.reason)

    supplier_risk = []
    for supp, data in sorted(supplier_map.items(), key=lambda x: (x[1]["risk"], x[1]["amount"]), reverse=True)[:6]:
        reason_text = data["reasons"][0] if data["reasons"] else "High-volume transactional supplier"
        supplier_risk.append({
            "supplier": supp,
            "risk": data["risk"] if data["risk"] > 0 else 25,
            "invoices": data["invoices"],
            "amount": f"₹{round(data['amount']):,}",
            "reason": reason_text,
        })

    return {
        "kpis": {
            "totalClients": len(client_ids) if (clientId and clientId != "ALL") else len(all_scoped_ids),
            "uploadedInvoices": len(invoices),
            "matchedInvoices": len(matched_list),
            "mismatchedInvoices": len(mismatched_list),
            "missingInvoices": len(missing_list),
            "duplicateInvoices": len(duplicate_list),
            "highRiskTransactions": len(high_risk_list),
            "circularTrading": len(circular_list),
            "complianceScore": avg_compliance,
        },
        "monthlyData": monthly_data,
        "fraudPieData": active_pie if active_pie else [
            {"name": "Critical", "value": 25, "color": "#ef4444"},
            {"name": "High", "value": 45, "color": "#f97316"},
            {"name": "Medium", "value": 20, "color": "#eab308"},
            {"name": "Low", "value": 10, "color": "#10b981"},
        ],
        "supplierRisk": supplier_risk,
        "fiscalYears": ["2026-27", "2025-26", "2024-25"],
    }

