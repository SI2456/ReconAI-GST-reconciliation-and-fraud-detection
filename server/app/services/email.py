from email.message import EmailMessage
import smtplib

from app.core.config import settings


def email_enabled() -> bool:
    return bool(settings.email_host and settings.email_host_user)


def send_email(to_email: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    """Send an email; attachments are (filename, content, mime type) tuples."""
    if not email_enabled():
        names = ", ".join(name for name, _, _ in attachments or [])
        print(f"[email disabled] To: {to_email} | Subject: {subject}" + (f" | Attachments: {names}" if names else "") + f"\n{body}")
        return

    message = EmailMessage()
    message["From"] = settings.default_from_email or settings.email_host_user
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)
    for filename, content, mime in attachments or []:
        maintype, _, subtype = mime.partition("/")
        message.add_attachment(content, maintype=maintype, subtype=subtype or "octet-stream", filename=filename)

    with smtplib.SMTP(settings.email_host, settings.email_port, timeout=20) as smtp:
        if settings.email_use_tls:
            smtp.starttls()
        smtp.login(settings.email_host_user, settings.email_host_password)
        smtp.send_message(message)
