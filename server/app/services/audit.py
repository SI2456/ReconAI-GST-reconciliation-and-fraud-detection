"""Activity log for the system admin: who uploaded / processed / reconciled what, and when."""

from __future__ import annotations

import json
import uuid

from sqlalchemy.orm import Session

from app.core.timeutil import iso_utc, utcnow
from app.db.models import AuditLog, User

ROLE_LABELS = {"client": "Client", "ca": "Tax Officer", "admin": "System Admin"}


def record_activity(db: Session, user: User | None, action: str, target: str, details: str = "", **meta) -> None:
    """Add a log entry; it is saved with the caller's next commit."""
    db.add(
        AuditLog(
            id=f"log_{uuid.uuid4().hex[:16]}",
            actor_id=user.id if user else None,
            action=action,
            target=(target or "")[:180],
            metadata_json=json.dumps({"details": details, **meta}, default=str),
            created_at=utcnow(),
        )
    )


def serialize_activity(db: Session, item: AuditLog) -> dict:
    try:
        meta = json.loads(item.metadata_json or "{}")
    except ValueError:
        meta = {}
    actor = db.get(User, item.actor_id) if item.actor_id else None
    return {
        "id": item.id,
        "action": item.action,
        "target": item.target,
        "details": meta.get("details", ""),
        "actor": actor.email if actor else "System",
        "actorName": actor.name if actor else "System",
        "actorRole": ROLE_LABELS.get(actor.role, actor.role) if actor else "System",
        "createdAt": iso_utc(item.created_at),
    }
