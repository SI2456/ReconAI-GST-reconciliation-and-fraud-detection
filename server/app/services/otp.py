from datetime import datetime, timedelta
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.models import EmailOtp, User
from app.services.email import send_email


OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_MAX_RESENDS = 3


def _now() -> datetime:
    return datetime.utcnow()


def otp_delivery_note(email: str) -> str:
    """Tell the user where the OTP went (the code itself is never returned by the API)."""
    if settings.email_host and settings.email_host_user:
        return f"We sent a 6-digit OTP to {email}."
    return "Email sending isn't configured on this server, so the OTP was printed in the backend terminal."


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def create_email_otp(db: Session, user: User, purpose: str, resend: bool = False) -> None:
    active_otp = (
        db.query(EmailOtp)
        .filter(
            EmailOtp.email == user.email,
            EmailOtp.purpose == purpose,
            EmailOtp.used_at.is_(None),
            EmailOtp.expires_at > _now(),
        )
        .order_by(EmailOtp.created_at.desc())
        .first()
    )

    if resend and active_otp:
        if active_otp.resend_count >= OTP_MAX_RESENDS:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="OTP resend limit reached. Try again later.")
        active_otp.used_at = _now()
        resend_count = active_otp.resend_count + 1
    else:
        resend_count = 0

    otp = generate_otp()
    record = EmailOtp(
        id=f"otp_{uuid.uuid4().hex[:16]}",
        user_id=user.id,
        email=user.email,
        purpose=purpose,
        otp_hash=hash_password(otp),
        expires_at=_now() + timedelta(minutes=OTP_EXPIRY_MINUTES),
        resend_count=resend_count,
        last_sent_at=_now(),
    )
    db.add(record)
    db.flush()

    title = "Verify your ReconAI email" if purpose == "registration" else "Reset your ReconAI password"
    body = (
        f"Hello {user.name},\n\n"
        f"Your ReconAI OTP is {otp}.\n"
        f"It expires in {OTP_EXPIRY_MINUTES} minutes and can be used only once.\n\n"
        "If you did not request this, ignore this email."
    )
    # With email disabled, send_email prints the OTP to the server log for local dev.
    # Never return it in an API response: anyone could then verify any account.
    send_email(user.email, title, body)


def verify_email_otp(db: Session, email: str, otp: str, purpose: str, consume: bool = True) -> User:
    user = db.query(User).filter(User.email == email.lower()).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    record = (
        db.query(EmailOtp)
        .filter(
            EmailOtp.email == user.email,
            EmailOtp.purpose == purpose,
            EmailOtp.used_at.is_(None),
        )
        .order_by(EmailOtp.created_at.desc())
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active OTP found.")
    if record.expires_at <= _now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP expired. Request a new OTP.")
    if record.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many OTP attempts. Request a new OTP.")

    record.attempts += 1
    if not verify_password(otp, record.otp_hash):
        # Commit the failed attempt before raising; get_db rolls back on
        # exceptions, which would otherwise discard the counter.
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP.")

    if consume:
        record.used_at = _now()
    return user
