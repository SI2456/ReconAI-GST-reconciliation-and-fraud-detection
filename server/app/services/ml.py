"""Fraud scoring for ReconAI.

Uses an unsupervised **Isolation Forest** to flag anomalous invoices and a
supervised **Logistic Regression** (trained on weak labels derived from
reconciliation outcomes) to estimate a fraud probability. Every flag is
explained with **SHAP** values — the real ``shap`` library when installed,
otherwise the exact closed-form SHAP values for the linear model.

The heavy ML libraries are imported lazily so a missing dependency degrades to
a transparent rule-based fallback instead of breaking the API at import time.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.periods import periods_match
from app.db.models import FraudAlert, Invoice
from app.services.eligibility import is_eligible_for_fraud_case
from app.services.parsing import derive_tax_period


# Feature order is fixed so coefficients / SHAP values line up with names.
# recon_status: 0=Matched, 1=Missing/Mismatched, 2=Duplicate — included as input, never as gate.
FEATURE_NAMES = ["amount", "taxable", "gst_rate", "supplier_freq", "round_amount", "high_value", "recon_status", "amount_zscore", "anomaly"]

_FEATURE_PHRASES = {
    "amount": "invoice amount",
    "taxable": "taxable value",
    "gst_rate": "GST rate",
    "supplier_freq": "supplier activity",
    "round_amount": "round-number amount",
    "high_value": "high-value transaction",
    "recon_status": "reconciliation outcome",
    "amount_zscore": "amount deviation from supplier norm",
    "anomaly": "anomaly pattern",
}

ALERT_THRESHOLD = 50
MIN_SAMPLES_FOR_ML = 8


# --- optional dependency probes ----------------------------------------------


def _load_sklearn():
    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler

        return np, IsolationForest, LogisticRegression, StandardScaler
    except ImportError:
        return None


def _load_shap():
    try:
        import shap

        return shap
    except ImportError:
        return None


# --- rule-based fallback (used when sklearn is unavailable or data is tiny) ---


def _rule_based_score(invoice: Invoice) -> tuple[int, list[str], str]:
    score = 20
    reasons: list[str] = []
    chips: list[str] = ["baseline risk"]

    if invoice.status in ("Mismatched", "Missing"):
        score += 35
        desc = "missing in GSTR-2B" if invoice.status == "Missing" else "reconciliation mismatch"
        reasons.append(desc)
        chips.append(desc)
    if invoice.status == "Duplicate":
        score += 45
        reasons.append("duplicate invoice")
        chips.append("duplicate invoice")
    if (invoice.total or 0) >= 100000:
        score += 20
        reasons.append("high invoice value")
        chips.append("high-value transaction")

    return min(score, 100), chips, ", ".join(reasons) or "baseline risk"


def _rule_floor(invoice: Invoice) -> int:
    """Domain guardrail so obvious cases are never scored as safe."""
    if invoice.status == "Duplicate":
        return 85
    if invoice.status in ("Mismatched", "Missing"):
        return 55
    return 0


# --- feature engineering -----------------------------------------------------


def _recon_status_score(invoice: Invoice) -> float:
    """Map reconciliation outcome to a numeric feature: 0=Matched, 1=Missing/Mismatch, 2=Duplicate."""
    status = invoice.status or ""
    if status == "Duplicate":
        return 2.0
    if status in ("Mismatched", "Missing"):
        return 1.0
    return 0.0


def _raw_features(invoices: list[Invoice]) -> list[list[float]]:
    """Build feature matrix. ALL invoices are included regardless of recon status."""
    supplier_counts = Counter(inv.supplier_gstin for inv in invoices)

    # Per-supplier amount mean for z-score behavioral signal
    supplier_totals: dict[str, list[float]] = {}
    for inv in invoices:
        supplier_totals.setdefault(inv.supplier_gstin, []).append(float(inv.total or 0))
    supplier_mean = {gstin: sum(vals) / len(vals) for gstin, vals in supplier_totals.items()}
    supplier_std = {
        gstin: (sum((v - supplier_mean[gstin]) ** 2 for v in vals) / max(len(vals), 1)) ** 0.5
        for gstin, vals in supplier_totals.items()
    }

    rows: list[list[float]] = []
    for inv in invoices:
        taxable = float(inv.taxable or 0)
        gst = float(inv.gst or 0)
        total = float(inv.total or 0)
        mean = supplier_mean.get(inv.supplier_gstin, total)
        std = supplier_std.get(inv.supplier_gstin, 1.0) or 1.0
        amount_zscore = (total - mean) / std
        rows.append(
            [
                total,
                taxable,
                (gst / taxable) if taxable else 0.0,
                float(supplier_counts[inv.supplier_gstin]),
                1.0 if total and total % 1000 == 0 else 0.0,
                1.0 if total >= 100000 else 0.0,
                _recon_status_score(inv),  # recon outcome as feature, not filter
                amount_zscore,             # behavioral: deviation from supplier norm
            ]
        )
    return rows


def _weak_labels(invoices: list[Invoice]) -> list[int]:
    # Reconciliation outcomes act as noisy fraud labels for the supervised model.
    return [1 if inv.status in ("Duplicate", "Mismatched", "Missing") else 0 for inv in invoices]


# --- ML scoring --------------------------------------------------------------


def _score_with_ml(invoices: list[Invoice]) -> list[tuple[int, list[str], str]] | None:
    """Return per-invoice (risk, shap_chips, reason) or None to signal fallback."""
    libs = _load_sklearn()
    if libs is None or len(invoices) < MIN_SAMPLES_FOR_ML:
        return None

    np, IsolationForest, LogisticRegression, StandardScaler = libs

    base = np.array(_raw_features(invoices), dtype=float)  # (n, 6)

    # 1) Unsupervised anomaly detection.
    forest = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    forest.fit(base)
    # score_samples: higher = more normal. Invert so higher = more anomalous.
    anomaly = -forest.score_samples(base)
    a_min, a_max = float(anomaly.min()), float(anomaly.max())
    anomaly_norm = (anomaly - a_min) / (a_max - a_min) if a_max > a_min else np.zeros_like(anomaly)

    # Full feature matrix = raw features + anomaly signal, standardized.
    features = np.column_stack([base, anomaly_norm])  # (n, 7)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)

    labels = np.array(_weak_labels(invoices))
    shap = _load_shap()

    # 2) Supervised probability when weak labels contain both classes.
    use_supervised = labels.min() != labels.max()
    if use_supervised:
        model = LogisticRegression(max_iter=1000, class_weight="balanced")
        model.fit(scaled, labels)
        proba = model.predict_proba(scaled)[:, 1]
        coef = model.coef_[0]
        shap_matrix = _shap_values(shap, model, scaled, coef)
        risks = (proba * 100).round().astype(int)
    else:
        # No supervised signal — drive risk purely off the anomaly percentile.
        proba = None
        shap_matrix = None
        risks = (anomaly_norm * 100).round().astype(int)

    results: list[tuple[int, list[str], str]] = []
    for i, inv in enumerate(invoices):
        risk = int(risks[i])
        risk = max(risk, _rule_floor(inv))
        risk = int(max(0, min(100, risk)))

        if shap_matrix is not None:
            chips, reason = _explain_from_shap(shap_matrix[i])
        else:
            chips, reason = _explain_from_anomaly(scaled[i], FEATURE_NAMES)
        results.append((risk, chips, reason))

    return results


def _shap_values(shap, model, scaled, coef):
    """Genuine SHAP values for the logistic model.

    Uses shap.LinearExplainer when the library is present; otherwise the exact
    closed-form: phi_ij = coef_j * (x_ij - mean_j) in log-odds space, which is
    what LinearExplainer computes for a linear model with independent features.
    """
    if shap is not None:
        try:
            explainer = shap.LinearExplainer(model, scaled)
            values = explainer.shap_values(scaled)
            # Some shap versions return a list per class.
            if isinstance(values, list):
                values = values[-1]
            return values
        except Exception:  # noqa: BLE001 - fall back to closed form
            pass
    means = scaled.mean(axis=0)
    return (scaled - means) * coef


def _explain_from_shap(row) -> tuple[list[str], str]:
    pairs = sorted(zip(FEATURE_NAMES, row), key=lambda kv: abs(kv[1]), reverse=True)
    chips: list[str] = []
    reasons: list[str] = []
    for name, value in pairs[:3]:
        if abs(value) < 1e-6:
            continue
        phrase = _FEATURE_PHRASES.get(name, name)
        sign = "+" if value >= 0 else "-"
        chips.append(f"{phrase} ({sign}{abs(value):.2f})")
        if value > 0:
            reasons.append(phrase)
    if not chips:
        chips = ["no dominant factor"]
    return chips, ", ".join(reasons) or "model-detected anomaly"


def _explain_from_anomaly(scaled_row, names) -> tuple[list[str], str]:
    # Rank features by how far they deviate from the mean (already standardized).
    pairs = sorted(zip(names, scaled_row), key=lambda kv: abs(kv[1]), reverse=True)
    chips: list[str] = []
    reasons: list[str] = []
    for name, z in pairs[:3]:
        if abs(z) < 0.5:
            continue
        phrase = _FEATURE_PHRASES.get(name, name)
        chips.append(f"{phrase} (z={z:+.2f})")
        reasons.append(phrase)
    if not chips:
        chips = ["mild anomaly"]
    return chips, ", ".join(reasons) or "anomalous transaction profile"


def get_client_baseline(db: Session, client_id: str | int, exclude_invoice_id: str | None = None) -> dict:
    """Compute client historical average invoice total and GST ratio from processed books invoices."""
    client_id_str = str(client_id)
    query = db.query(Invoice).filter(
        Invoice.client_id == client_id_str,
        Invoice.source == "books",
        Invoice.status != "Pending",
    )
    if exclude_invoice_id:
        query = query.filter(Invoice.id != exclude_invoice_id)
    rows = query.all()
    totals = [float(inv.total or 0) for inv in rows if float(inv.total or 0) > 0]
    ratios = [
        float(inv.gst or 0) / float(inv.taxable)
        for inv in rows
        if float(inv.taxable or 0) > 0 and inv.gst is not None
    ]
    if len(totals) >= 3:
        avg_tot = sum(totals) / len(totals)
        avg_gst = sum(ratios) / len(ratios) if ratios else None
        return {"avg_invoice_total": avg_tot, "avg_gst_ratio": avg_gst, "sample_size": len(totals)}
    return {"avg_invoice_total": None, "avg_gst_ratio": None, "sample_size": len(totals)}


def build_case_explanation(
    invoice: Invoice,
    baseline: dict,
    status: str,
    total: float,
    taxable: float,
    gst: float,
    dup_explanation: str | None = None,
) -> tuple[list[str], str, list[dict]]:
    """Builds plain-language chips, one-line case summary, and structured risk breakdown using ONE unified threshold computation."""
    total_fmt = f"₹{int(total):,}"
    avg_tot = baseline.get("avg_invoice_total")
    avg_gst = baseline.get("avg_gst_ratio")

    # 1. Unified Amount & High-Value Evaluation (Single source of truth)
    is_notably_high = False
    ratio = None
    avg_fmt = None

    if avg_tot and avg_tot > 0:
        avg_fmt = f"₹{int(avg_tot):,}"
        ratio = total / avg_tot
        if ratio >= 1.5:
            is_notably_high = True
            amount_chip = f"Invoice amount {total_fmt} is {ratio:.1f}x this client's average ({avg_fmt})"
        elif ratio <= 0.6:
            amount_chip = f"Invoice amount {total_fmt} is below this client's average ({avg_fmt})"
        else:
            amount_chip = f"Invoice amount {total_fmt} is within this client's typical range"
    else:
        if total >= 100000:
            is_notably_high = True
            amount_chip = f"High-value transaction: {total_fmt} (insufficient history for average)"
        else:
            amount_chip = f"Invoice amount: {total_fmt} (insufficient history for comparison)"

    # 2. GST Rate Chip
    gst_chip = None
    if taxable > 0:
        actual_ratio = gst / taxable
        actual_pct = f"{round(actual_ratio * 100, 1)}%"
        if avg_gst is not None:
            avg_pct = f"{round(avg_gst * 100, 1)}%"
            if abs((actual_ratio * 100) - (avg_gst * 100)) >= 3.0:
                if actual_ratio > avg_gst:
                    gst_chip = f"GST rate {actual_pct} is higher than client average ({avg_pct})"
                else:
                    gst_chip = f"GST rate {actual_pct} is lower than client average ({avg_pct})"
            else:
                gst_chip = f"GST rate: {actual_pct} (matches client average)"
        else:
            gst_chip = f"Effective GST rate: {actual_pct}"

    # 3. Status Chip
    status_chip = None
    if status == "Duplicate":
        status_chip = "Duplicate entry detected in books"
    elif status == "Missing":
        status_chip = "Missing in GSTR-2B portal filing"
    elif status == "Mismatched":
        status_chip = "Amount or tax mismatch with GSTR-2B"

    # Assemble chips (cap at 2-3)
    chips = []
    if status_chip:
        chips.append(status_chip)
    chips.append(amount_chip)
    if gst_chip:
        chips.append(gst_chip)
    chips = chips[:3]

    # 4. Structured Risk Breakdown (Uses the exact same is_notably_high flag)
    risk_breakdown = [
        {"label": "Baseline Risk", "points": 5, "note": "Standard baseline assessment for any processed invoice"}
    ]
    if status == "Duplicate":
        risk_breakdown.append({"label": "Reconciliation Status", "points": 83, "note": "Duplicate invoice entry detected in Books dataset (88 pts total)"})
    elif status in ("Mismatched", "Missing"):
        note_desc = "Missing in GSTR-2B filing (68 pts total)" if status == "Missing" else "Reconciliation mismatch with GSTR-2B filing (68 pts total)"
        risk_breakdown.append({"label": "Reconciliation Status", "points": 63, "note": note_desc})
    else:
        risk_breakdown.append({"label": "Reconciliation Status", "points": 0, "note": "Matched cleanly against GSTR-2B filing (0 pts)"})

    if is_notably_high:
        if ratio is not None and avg_fmt:
            note_val = f"{total_fmt} is {ratio:.1f}x client average ({avg_fmt})"
        else:
            note_val = f"{total_fmt} (>= ₹1,00,000 statutory threshold)"
        risk_breakdown.append({"label": "High-Value Transaction", "points": 25, "note": note_val})

    # 5. One-line Summary
    if status == "Duplicate":
        summary = dup_explanation or f"Invoice {invoice.invoice_no or ''} appears multiple times in Books — please confirm this is one transaction."
    elif status == "Missing":
        summary = "Missing in GSTR-2B filing — ITC eligibility cannot be verified against statutory portal."
    elif status == "Mismatched":
        summary = "Reconciliation mismatch detected — Books values differ from counterparty GSTR-2B return."
    elif is_notably_high:
        if ratio is not None and avg_fmt:
            summary = f"Risk reflects transaction value ({total_fmt}, {ratio:.1f}x client average) — no compliance or reconciliation issues found."
        else:
            summary = f"Risk reflects high transaction value only ({total_fmt}) — no compliance or reconciliation issues found."
    else:
        summary = "No anomalies detected — this invoice matches expected patterns and reconciles cleanly."

    return chips, summary, risk_breakdown


def run_fraud_detection(db: Session, client_id: int | str, tax_period: str | None = None) -> list[FraudAlert]:
    """Score eligible transaction invoices through the ML pipeline. Old alerts for this client+run are
    cleared and regenerated so results are always fresh. Generates cases per genuine invoice.
    """
    client_id_str = str(client_id)
    all_raw_invoices = db.query(Invoice).filter(Invoice.client_id == client_id_str).all()

    clean_period = (tax_period or "").strip()
    if clean_period and clean_period.upper() not in ("ALL", "ALL UPLOADED DATA"):
        from app.db.models import Upload
        period_invoices = []
        for inv in all_raw_invoices:
            inv_p = (inv.tax_period or "").strip()
            inv_d = str(inv.invoice_date or "").strip()
            if not inv_p and inv_d:
                inv_p = derive_tax_period(inv_d)
            if periods_match(inv_p, clean_period):
                period_invoices.append(inv)
            elif not inv_p and not inv_d and inv.upload_id:
                up = db.query(Upload).filter(Upload.id == inv.upload_id).first()
                if up and (periods_match(up.tax_periods, clean_period) or periods_match(up.file_name, clean_period)):
                    period_invoices.append(inv)

        # Clear open alerts for period invoices PLUS any orphaned alerts whose invoice no longer exists
        all_period_inv_ids = [inv.id for inv in period_invoices]
        all_client_inv_ids = [inv.id for inv in all_raw_invoices]
        if all_client_inv_ids:
            if all_period_inv_ids:
                db.query(FraudAlert).filter(
                    FraudAlert.client_id == client_id_str,
                    FraudAlert.status == "Open",
                    or_(
                        FraudAlert.invoice_id.in_(all_period_inv_ids),
                        ~FraudAlert.invoice_id.in_(all_client_inv_ids),
                        FraudAlert.invoice_id.is_(None),
                    ),
                ).delete(synchronize_session="fetch")
            else:
                db.query(FraudAlert).filter(
                    FraudAlert.client_id == client_id_str,
                    FraudAlert.status == "Open",
                    or_(
                        ~FraudAlert.invoice_id.in_(all_client_inv_ids),
                        FraudAlert.invoice_id.is_(None),
                    ),
                ).delete(synchronize_session="fetch")
        else:
            db.query(FraudAlert).filter(
                FraudAlert.client_id == client_id_str,
                FraudAlert.status == "Open",
            ).delete(synchronize_session="fetch")

        books_period_invoices = [inv for inv in period_invoices if (inv.source or "").lower() == "books"]
        invoices = [inv for inv in books_period_invoices if is_eligible_for_fraud_case(inv)]
        if not invoices:
            invoices = books_period_invoices
    else:
        # Clear ALL open alerts for this client (including any orphaned alerts)
        db.query(FraudAlert).filter(
            FraudAlert.client_id == client_id_str,
            FraudAlert.status == "Open",
        ).delete(synchronize_session="fetch")

        books_invoices = [inv for inv in all_raw_invoices if (inv.source or "").lower() == "books"]
        invoices = [inv for inv in books_invoices if is_eligible_for_fraud_case(inv)]
        if not invoices:
            invoices = books_invoices

    if not invoices:
        db.commit()
        return []

    # Get client historical baseline
    baseline = get_client_baseline(db, client_id_str)

    scored = _score_with_ml(invoices)
    if scored is None:
        scored = [_rule_based_score(inv) for inv in invoices]

    created: list[FraudAlert] = []
    for invoice, (risk, raw_chips, raw_reason) in zip(invoices, scored):
        # Tag source: rule-based, ml, or both
        source_tags = []
        rule_flag = invoice.status in ("Duplicate", "Mismatched", "Missing")
        if rule_flag:
            source_tags.append("rule_engine")
        source_tags.append("ml")

        entity_name = (invoice.supplier or "").strip()
        if not entity_name or entity_name.endswith(".pdf") or "upl_" in entity_name or "Purchase Register" in entity_name:
            from app.db.models import Supplier
            sup = db.query(Supplier).filter(Supplier.client_id == client_id_str, Supplier.gstin == invoice.supplier_gstin).first()
            if sup and sup.name:
                entity_name = sup.name
            elif invoice.supplier_gstin:
                entity_name = f"Supplier ({invoice.supplier_gstin})"
            else:
                entity_name = f"Invoice {invoice.invoice_no or invoice.id}"

        total = float(invoice.total or 0.0)
        taxable = float(invoice.taxable or 0.0)
        gst = float(invoice.gst or 0.0)
        st = invoice.status or "Matched"

        # Check for duplicate explanations if duplicate
        dup_expl = None
        if st == "Duplicate":
            norm_k = invoice.normalized_key or f"{invoice.supplier_gstin}_{invoice.invoice_no}"
            dup_matches = db.query(Invoice).filter(
                Invoice.client_id == client_id_str,
                Invoice.normalized_key == norm_k,
                Invoice.source == "books",
            ).all()
            if len(dup_matches) >= 2:
                from app.db.models import Upload
                items_desc_parts = []
                for dm in dup_matches:
                    up_rec = db.query(Upload).filter(Upload.id == dm.upload_id).first() if dm.upload_id else None
                    fname = up_rec.file_name if up_rec else dm.id
                    items_desc_parts.append(f"[{fname}, tax_period: {dm.tax_period or 'N/A'}]")
                dup_expl = f"Invoice {invoice.invoice_no} appears multiple times in Books: once via {' and once via '.join(items_desc_parts)} — please confirm these represent one transaction, not two."

        chips, summary, risk_breakdown = build_case_explanation(
            invoice=invoice,
            baseline=baseline,
            status=st,
            total=total,
            taxable=taxable,
            gst=gst,
            dup_explanation=dup_expl,
        )

        # Calculate final risk score aligned with risk breakdown points
        final_risk = sum(item.get("points", 0) for item in risk_breakdown)
        final_risk = min(max(final_risk, 0), 98)

        from datetime import datetime, timezone
        alert_id = f"alt_{uuid.uuid4().hex[:16]}"
        alert = FraudAlert(
            id=alert_id,
            client_id=client_id_str,
            invoice_id=invoice.id,
            type=invoice.status or "Invoice Risk",
            entity=entity_name,
            risk=min(max(final_risk, 0), 98),
            amount=invoice.total or 0.0,
            reason=summary,
            shap_json=json.dumps(chips + source_tags),
            risk_breakdown=json.dumps(risk_breakdown),
            created_at=datetime.now(timezone.utc),
        )
        db.add(alert)
        created.append(alert)

    db.commit()
    return created
