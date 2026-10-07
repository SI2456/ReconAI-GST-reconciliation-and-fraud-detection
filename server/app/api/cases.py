import io
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user, scoped_client_ids
from app.db.models import CaseNote, Client, User
from app.db.session import get_db
from app.core.timeutil import iso_utc, utcnow
from app.services.storage import get_bytes, inline_disposition, upload_bytes


router = APIRouter()


@router.post("/{exception_id}/notes", status_code=201)
async def add_case_note(
    exception_id: str,
    clientId: str | None = Form(None),
    note_text: str = Form(...),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if not note_text or not note_text.strip():
        raise HTTPException(status_code=422, detail="note_text is required.")

    if clientId is None:
        client_ids = scoped_client_ids(db, user)
        if not client_ids:
            raise HTTPException(status_code=404, detail="No client workspace linked to this account.")
        clientId = client_ids[0]

    ensure_client_scope(db, user, clientId)

    attachment_filename = ""
    attachment_object_key = ""

    if file and file.filename:
        safe_filename = re.sub(r"[^A-Za-z0-9_.-]", "_", file.filename)
        attachment_filename = safe_filename
        attachment_object_key = f"clients/{clientId}/case_notes/{exception_id}/{safe_filename}"
        content = await file.read()
        upload_bytes(attachment_object_key, content, file.content_type or "application/octet-stream")

    note = CaseNote(
        id=f"note_{uuid.uuid4().hex[:16]}",
        exception_id=str(exception_id),
        client_id=clientId,
        author_id=user.id,
        note_text=note_text.strip(),
        attachment_filename=attachment_filename,
        attachment_object_key=attachment_object_key,
        document_type="REVIEWER_ATTACHMENT",
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return {
        "note": {
            "id": note.id,
            "exceptionId": note.exception_id,
            "clientId": note.client_id,
            "authorId": note.author_id,
            "authorName": user.name,
            "authorRole": user.role,
            "noteText": note.note_text,
            "attachmentFilename": note.attachment_filename,
            "hasAttachment": bool(note.attachment_filename),
            "createdAt": iso_utc(note.created_at) or "",
        }
    }


@router.get("/{exception_id}/notes")
def get_case_notes(
    exception_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    client_ids = scoped_client_ids(db, user)
    if not client_ids:
        return {"notes": []}

    notes = (
        db.query(CaseNote)
        .filter(CaseNote.exception_id == str(exception_id), CaseNote.client_id.in_(client_ids))
        .order_by(CaseNote.created_at.asc())
        .all()
    )

    result = []
    for n in notes:
        author = db.get(User, n.author_id)
        result.append({
            "id": n.id,
            "exceptionId": n.exception_id,
            "clientId": n.client_id,
            "authorId": n.author_id,
            "authorName": author.name if author else "Reviewer",
            "authorRole": author.role if author else "ca",
            "noteText": n.note_text,
            "attachmentFilename": n.attachment_filename,
            "hasAttachment": bool(n.attachment_filename),
            "createdAt": iso_utc(n.created_at) or "",
        })

    return {"notes": result}


@router.get("/notes/{note_id}/attachment")
def download_note_attachment(
    note_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = db.get(CaseNote, note_id)
    if not note or not note.attachment_object_key:
        raise HTTPException(status_code=404, detail="Attachment not found.")

    ensure_client_scope(db, user, note.client_id)

    try:
        content, content_type = get_bytes(note.attachment_object_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Attachment file content not found in storage.")

    return StreamingResponse(
        io.BytesIO(content),
        media_type=content_type or "application/octet-stream",
        headers={"Content-Disposition": inline_disposition(note.attachment_filename)},
    )
