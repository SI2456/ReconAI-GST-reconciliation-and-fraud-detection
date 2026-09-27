from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.models import Client, User
from app.db.session import get_db


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    user = db.get(User, str(payload["sub"]))
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions.")
        return user

    return dependency


def scoped_client_ids(db: Session, user: User) -> list[str]:
    if user.role == "admin":
        return [str(item.id) for item in db.query(Client.id).all()]
    if user.role == "ca":
        return [str(item.id) for item in db.query(Client.id).filter(Client.ca_id == user.id).all()]
    return [str(item.id) for item in db.query(Client.id).filter((Client.email == user.email) | (Client.gstin == user.gstin)).all()]


def ensure_client_scope(db: Session, user: User, client_id: str | int) -> None:
    if str(client_id) not in scoped_client_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client is outside your workspace.")
