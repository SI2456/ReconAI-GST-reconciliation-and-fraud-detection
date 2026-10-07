from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class UserRole(str, Enum):
    admin = "admin"
    ca = "ca"
    client = "client"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    firm_name: Mapped[str] = mapped_column(String(180), default="")
    gstin: Mapped[str] = mapped_column(String(20), default="")
    icai_number: Mapped[str] = mapped_column(String(40), default="")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(180))
    gstin: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    gst_legal_name: Mapped[str] = mapped_column(String(255), default="")
    gst_trade_name: Mapped[str] = mapped_column(String(255), default="")
    gst_status: Mapped[str] = mapped_column(String(80), default="")
    gst_details_json: Mapped[str] = mapped_column(Text, default="{}")
    gst_verified_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    ca_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True)
    city: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(32), default="Active")
    risk: Mapped[str] = mapped_column(String(32), default="Low")
    compliance: Mapped[int] = mapped_column(Integer, default=0)
    ca = relationship("User")


class CAProfile(Base):
    __tablename__ = "ca_profiles"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    specialization: Mapped[str] = mapped_column(String(120), default="GST")
    experience: Mapped[str] = mapped_column(String(80), default="0 Years")
    city: Mapped[str] = mapped_column(String(80), default="")
    profile_photo: Mapped[str] = mapped_column(String(500), default="")
    rating: Mapped[float] = mapped_column(Float, default=4.5)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user = relationship("User")


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    selected_ca_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user = relationship("User", foreign_keys=[user_id])
    selected_ca = relationship("User", foreign_keys=[selected_ca_id])


class EmailOtp(Base):
    __tablename__ = "email_otps"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    otp_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    resend_count: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    used_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user = relationship("User")


class DocumentTypeEnum(str, Enum):
    PURCHASE_REGISTER = "PURCHASE_REGISTER"
    GSTR2B = "GSTR2B"
    TAX_INVOICE = "TAX_INVOICE"
    PURCHASE_ORDER = "PURCHASE_ORDER"
    SUPPLIER_MASTER = "SUPPLIER_MASTER"
    CREDIT_NOTE = "CREDIT_NOTE"
    DEBIT_NOTE = "DEBIT_NOTE"
    REVIEWER_ATTACHMENT = "REVIEWER_ATTACHMENT"


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    file_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(40))
    document_type: Mapped[str] = mapped_column(String(50), default="TAX_INVOICE", index=True)
    gstin: Mapped[str] = mapped_column(String(20), default="")
    financial_year: Mapped[str] = mapped_column(String(20), default="")
    tax_periods: Mapped[str] = mapped_column(String(255), default="")
    period_warnings: Mapped[str] = mapped_column(Text, default="[]")
    gstin_verification_status: Mapped[str] = mapped_column(String(40), default="valid")
    object_key: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(40), default="received")
    validation_errors: Mapped[str] = mapped_column(Text, default="[]")
    parsed_rows: Mapped[int] = mapped_column(Integer, default=0)
    visible_to_client: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(40), default="invoice")
    is_reupload: Mapped[bool] = mapped_column(Boolean, default=False)
    reupload_invoice_id: Mapped[str] = mapped_column(String(80), default="")
    reupload_note: Mapped[str] = mapped_column(Text, default="")
    # Full structured result of the last AI extraction (reference_data/extract.py schema):
    # addresses, line items, tax rates... everything that doesn't fit the invoice row.
    extracted_json: Mapped[str] = mapped_column(Text, default="")
    # When the file was last parsed / processed / AI-extracted (None until then).
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    upload_id: Mapped[str] = mapped_column(ForeignKey("uploads.id"), nullable=True)
    preview_upload_id: Mapped[str | None] = mapped_column(
        ForeignKey("uploads.id"), nullable=True
    )
    invoice_no: Mapped[str] = mapped_column(String(120), index=True)
    supplier: Mapped[str] = mapped_column(String(180))
    supplier_gstin: Mapped[str] = mapped_column(String(20), index=True)
    recipient_gstin: Mapped[str] = mapped_column(String(20), default="")
    invoice_date: Mapped[str] = mapped_column(String(20))
    taxable: Mapped[float] = mapped_column(Float, default=0)
    cgst: Mapped[float] = mapped_column(Float, default=0)
    sgst: Mapped[float] = mapped_column(Float, default=0)
    igst: Mapped[float] = mapped_column(Float, default=0)
    gst: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String(20), index=True)
    source_document_type: Mapped[str] = mapped_column(String(50), default="TAX_INVOICE")
    tax_period: Mapped[str] = mapped_column(String(50), default="")
    period_warning: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(40), default="Pending")
    risk: Mapped[str] = mapped_column(String(40), default="Low")
    normalized_key: Mapped[str] = mapped_column(String(180), index=True)
    validation_flags: Mapped[str] = mapped_column(Text, default="{}")  # JSON: per-level rule results
    # Extra occurrences of this invoice within the same uploaded file. The unique index keeps one
    # row per invoice, so repeats are counted here and reported as "Duplicate" by reconciliation.
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    reupload_status: Mapped[str] = mapped_column(String(40), default="")
    reupload_note: Mapped[str] = mapped_column(Text, default="")
    reuploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    reuploaded_file_name: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index(
            "uq_invoices_client_key_source",
            "client_id",
            "normalized_key",
            "source",
            unique=True,
        ),
    )


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    upload_id: Mapped[str] = mapped_column(ForeignKey("uploads.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    gstin: Mapped[str] = mapped_column(String(20), index=True)
    state_code: Mapped[str] = mapped_column(String(10), default="")
    state_name: Mapped[str] = mapped_column(String(100), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    city: Mapped[str] = mapped_column(String(100), default="")
    hsn_sac: Mapped[str] = mapped_column(String(50), default="")
    gst_rate: Mapped[float] = mapped_column(Float, default=0)
    email: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    status: Mapped[str] = mapped_column(String(50), default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ReconciliationJob(Base):
    __tablename__ = "reconciliation_jobs"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    run_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(40), default="completed")
    summary_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class FraudAlert(Base):
    __tablename__ = "fraud_alerts"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(80))
    entity: Mapped[str] = mapped_column(String(180))
    risk: Mapped[int] = mapped_column(Integer)
    amount: Mapped[float] = mapped_column(Float, default=0)
    reason: Mapped[str] = mapped_column(Text)
    shap_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(40), default="Open")
    reupload_status: Mapped[str] = mapped_column(String(40), default="")
    reupload_note: Mapped[str] = mapped_column(Text, default="")
    risk_breakdown: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    generated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40), default="Ready")
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CAChangeRequest(Base):
    __tablename__ = "ca_change_requests"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    current_ca_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True)
    requested_ca_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="Pending", index=True)
    reviewed_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    sender = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(180))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CaseNote(Base):
    __tablename__ = "case_notes"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    exception_id: Mapped[str] = mapped_column(String(80), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    note_text: Mapped[str] = mapped_column(Text)
    attachment_filename: Mapped[str] = mapped_column(String(255), default="")
    attachment_object_key: Mapped[str] = mapped_column(String(500), default="")
    document_type: Mapped[str] = mapped_column(String(50), default="REVIEWER_ATTACHMENT")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    author = relationship("User")
