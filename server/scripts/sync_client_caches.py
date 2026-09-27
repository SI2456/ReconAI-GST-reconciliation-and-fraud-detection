import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://reconai:reconai@localhost:5432/reconai")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor(cursor_factory=RealDictCursor)

cur.execute("SELECT * FROM clients ORDER BY created_at DESC")
clients = cur.fetchall()

print("--- Updating Client Caches in PostgreSQL ---")
for c in clients:
    cid = c["id"]
    # 1. Invoices count and matched
    cur.execute(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Matched' THEN 1 ELSE 0 END) AS matched FROM invoices WHERE client_id = %s AND source = 'books'",
        (cid,)
    )
    inv_stat = cur.fetchone() or {}
    tot = inv_stat.get("total") or 0
    mat = inv_stat.get("matched") or 0
    compliance = round((mat / tot) * 100) if tot > 0 else 0

    # 2. Fraud alerts blended risk
    cur.execute(
        "SELECT AVG(risk) AS avg_risk, MAX(risk) AS max_risk, COUNT(*) AS count FROM fraud_alerts WHERE client_id = %s AND status NOT IN ('Resolved', 'Dismissed')",
        (cid,)
    )
    alt_stat = cur.fetchone() or {}
    avg_alert_risk = float(alt_stat.get("avg_risk") or 0.0) if alt_stat and alt_stat.get("avg_risk") is not None else 0.0
    max_risk = alt_stat.get("max_risk") or 0

    comp_gap = 100 - compliance
    blended_risk = round((0.5 * comp_gap) + (0.5 * avg_alert_risk), 1)

    if blended_risk >= 75:
        risk_level = "Critical"
    elif blended_risk >= 50:
        risk_level = "High"
    elif blended_risk >= 25:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    cur.execute(
        "UPDATE clients SET compliance = %s, risk = %s WHERE id = %s",
        (compliance, risk_level, cid)
    )
    print(f"Client {cid} ({c['name']}): Books={tot}, Matched={mat}, Compliance={compliance}%, BlendedRisk={blended_risk} (Avg={avg_alert_risk:.1f}) -> Risk={risk_level}")

conn.commit()
conn.close()
print("--- Update Complete ---")
