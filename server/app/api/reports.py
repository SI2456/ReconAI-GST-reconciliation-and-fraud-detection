import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, require_roles, scoped_client_ids
from app.core.timeutil import format_ist, iso_utc, utcnow
from app.db.models import Client, Message, Report, User
from app.db.session import get_db
from app.services.audit import record_activity
from app.services.email import email_enabled, send_email
from app.services.itc_report import build_report_data, parse_period, render_pdf
from app.services.storage import delete_object, inline_disposition, read_bytes, upload_bytes


router = APIRouter()
OFFICER_ROLES = ("ca", "admin")


class CreateReportRequest(BaseModel):
    clientId: str | int
    period: str = Field(min_length=4, description="Month, e.g. '09-2026' or '2026-09'")


class SendReportRequest(BaseModel):
    note: str = Field(default="", max_length=1000)


def _payload(report: Report) -> dict:
    try:
        data = json.loads(report.payload_json or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _visible_to(user: User, report: Report) -> bool:
    """Officers see every report of their clients; a client only sees reports sent to them."""
    return user.role in OFFICER_ROLES or bool(_payload(report).get("sentAt"))


def _get_report(db: Session, user: User, report_id: str) -> Report:
    report = db.get(Report, report_id)
    if not report or str(report.client_id) not in scoped_client_ids(db, user) or not _visible_to(user, report):
        raise HTTPException(status_code=404, detail="Report not found.")
    return report


def serialize_report(report: Report, db: Session | None = None) -> dict:
    data = _payload(report)
    client = db.get(Client, report.client_id) if db else None
    author = db.get(User, report.generated_by) if db and report.generated_by else None
    return {
        "id": report.id,
        "clientId": report.client_id,
        "clientName": client.name if client else data.get("clientName", ""),
        "name": report.name,
        "type": report.type,
        "status": report.status,
        "period": data.get("period", ""),
        "periodCode": data.get("periodCode", ""),
        "fileName": data.get("fileName", ""),
        "hasFile": bool(data.get("objectKey")),
        "summary": data.get("summary", {}),
        "generatedBy": author.name if author else "",
        "sentAt": data.get("sentAt"),
        "sentTo": data.get("sentTo", ""),
        "emailed": bool(data.get("emailed")),
        "createdAt": iso_utc(report.created_at),
    }


@router.get("")
def list_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    client_ids = scoped_client_ids(db, user)
    reports = db.query(Report).filter(Report.client_id.in_(client_ids)).order_by(Report.created_at.desc()).all() if client_ids else []
    return {"reports": [serialize_report(r, db) for r in reports if _visible_to(user, r)]}


@router.post("", status_code=201)
def create_report(payload: CreateReportRequest, db: Session = Depends(get_db),
                  user: User = Depends(require_roles(*OFFICER_ROLES))) -> dict:
    """Generate the monthly ITC report PDF for one client."""
    client_id = str(payload.clientId)
    ensure_client_scope(db, user, client_id)
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    try:
        period = parse_period(payload.period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    report_id = f"rep_{uuid.uuid4().hex[:16]}"
    data = build_report_data(db, client, period, user)
    if not data["invoices"] and not data["gstr2bNotInBooks"]:
        raise HTTPException(
            status_code=422,
            detail=f"No purchase register or GSTR-2B data for {client.name} in {data['period']}. Upload it first.",
        )
    pdf = render_pdf(data, report_no=report_id)
    safe_client = re.sub(r"[^A-Za-z0-9]+", "_", client.name).strip("_") or "client"
    file_name = f"ITC_Report_{safe_client}_{data['periodCode']}.pdf"
    object_key = f"clients/{client_id}/reports/{report_id}.pdf"
    upload_bytes(object_key, pdf, "application/pdf")

    report = Report(
        id=report_id,
        client_id=client_id,
        generated_by=user.id,
        name=f"ITC Report · {client.name} · {data['period']}",
        type="PDF",
        status="Ready",
        payload_json=json.dumps({
            "kind": "itc_monthly",
            "period": data["period"],
            "periodCode": data["periodCode"],
            "clientName": client.name,
            "objectKey": object_key,
            "fileName": file_name,
            "sizeBytes": len(pdf),
            "summary": data["summary"],
            "sentAt": None,
        }),
    )
    db.add(report)
    record_activity(db, user, "REPORT_GENERATED", report.name, f"ITC report for {data['period']}",
                    report_id=report_id, client_id=client_id)
    db.commit()
    db.refresh(report)
    return {"report": serialize_report(report, db)}


@router.get("/{report_id}/file")
def download_report(report_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    report = _get_report(db, user, report_id)
    data = _payload(report)
    if not data.get("objectKey"):
        raise HTTPException(status_code=404, detail="This report has no PDF file.")
    try:
        content = read_bytes(data["objectKey"])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="The report file is no longer available.") from exc
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": inline_disposition(data.get("fileName") or f"{report.id}.pdf")})


@router.post("/{report_id}/send")
def send_report(report_id: str, payload: SendReportRequest, db: Session = Depends(get_db),
                user: User = Depends(require_roles(*OFFICER_ROLES))) -> dict:
    """Share the report with the client: it appears in their dashboard, a chat message tells them,
    and it is emailed (as a PDF attachment) when email is configured."""
    report = _get_report(db, user, report_id)
    data = _payload(report)
    if not data.get("objectKey"):
        raise HTTPException(status_code=409, detail="Only generated PDF reports can be sent.")
    client = db.get(Client, report.client_id)
    now = utcnow()
    note = payload.note.strip()

    text = f"📄 Your ITC report for {data.get('period', 'this period')} is ready. You can download it from Reports in your dashboard."
    if note:
        text += f"\nNote from your tax officer: {note}"
    db.add(Message(id=f"msg_{uuid.uuid4().hex[:16]}", client_id=report.client_id, sender_id=user.id, text=text, created_at=now))

    emailed, email_note = False, ""
    if client and client.email:
        try:
            pdf = read_bytes(data["objectKey"])
            body = (
                f"Dear {client.name},\n\nPlease find attached your Input Tax Credit (ITC) report for {data.get('period')}, "
                f"prepared by {user.name}.\n" + (f"\nNote: {note}\n" if note else "")
                + "\nYou can also download it any time from Reports in your ReconAI dashboard.\n\nRegards,\n"
                + f"{user.name}" + (f"\n{user.firm_name}" if user.firm_name else "")
            )
            send_email(client.email, f"Your ITC report for {data.get('period')}", body,
                       attachments=[(data.get("fileName") or f"{report.id}.pdf", pdf, "application/pdf")])
            emailed = email_enabled()
            email_note = f"emailed to {client.email}" if emailed else "email isn't configured on this server, so it was not emailed"
        except Exception as exc:  # the report is still shared in the dashboard
            email_note = f"the email could not be sent ({exc})"
    else:
        email_note = "the client has no email address, so it was not emailed"

    data.update({"sentAt": iso_utc(now), "sentBy": user.id, "sentTo": client.email if client else "",
                 "emailed": emailed, "sendCount": int(data.get("sendCount") or 0) + 1})
    report.payload_json = json.dumps(data)
    report.status = "Sent"
    record_activity(db, user, "REPORT_SENT", report.name, email_note, report_id=report.id, client_id=report.client_id)
    db.commit()
    return {
        "report": serialize_report(report, db),
        "message": f"Report sent to {client.name if client else 'the client'} on {format_ist(now)}: it is in their dashboard and chat; {email_note}.",
    }


@router.delete("/{report_id}")
def delete_report(report_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles(*OFFICER_ROLES))) -> dict:
    report = _get_report(db, user, report_id)
    data = _payload(report)
    if data.get("sentAt"):
        raise HTTPException(status_code=409, detail="A report that was already sent to the client can't be deleted.")
    db.delete(report)
    db.commit()
    if data.get("objectKey"):
        delete_object(data["objectKey"])
    return {"ok": True}
