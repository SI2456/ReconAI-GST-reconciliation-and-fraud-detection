from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import ensure_client_scope, get_current_user
from app.db.models import Client, User
from app.db.session import get_db
from app.services.audit import record_activity
from app.services.reconciliation import run_reconciliation


router = APIRouter()


class RunRequest(BaseModel):
    clientId: str | int
    taxPeriod: str | None = None


@router.post("/run")
def run(payload: RunRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    ensure_client_scope(db, user, payload.clientId)
    result = run_reconciliation(db, payload.clientId, user.id, payload.taxPeriod)
    client = db.get(Client, str(payload.clientId))
    s = result.get("summary", {})
    record_activity(
        db, user, "RECONCILIATION", client.name if client else str(payload.clientId),
        f"Reconciled {client.name if client else payload.clientId} ({payload.taxPeriod or 'all periods'}): "
        f"{s.get('matched', 0)} matched, {s.get('mismatched', 0)} mismatched, "
        f"{s.get('missing', 0)} missing, {s.get('duplicates', 0)} duplicates",
        client_id=str(payload.clientId), job_id=result.get("jobId"),
    )
    db.commit()
    return result
