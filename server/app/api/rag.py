from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.models import User
from app.db.session import get_db
from app.services.assistant import AssistantUnavailable, ask as ask_assistant, engine_status
from app.services.assistant_tools import AssistantContext


router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    text: str


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # Earlier turns of this chat, so follow-ups like "and only for Krunal?" work.
    history: list[ChatMessage] = Field(default_factory=list, max_length=50)
    clientId: str | int | None = None  # accepted for older clients; the assistant covers all clients


@router.get("/status")
def status(user: User = Depends(require_roles("ca", "admin"))) -> dict:
    return engine_status()


@router.post("/ask")
def ask(payload: AskRequest, db: Session = Depends(get_db), user: User = Depends(require_roles("ca", "admin"))) -> dict:
    """Answer a tax officer's question from the data in their own workspace only."""
    ctx = AssistantContext(db=db, user=user)
    try:
        reply = ask_assistant(ctx, payload.question.strip(), [m.model_dump() for m in payload.history])
    except AssistantUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "answer": reply.answer,
        "refused": reply.refused,
        "engine": reply.engine,
        "toolsUsed": reply.tools_used,
    }
