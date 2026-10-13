from collections.abc import Generator

from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import PROJECT_ROOT, settings


def _sqlite_url(url: str) -> str:
    """Resolve a relative SQLite path against the project folder, not the current directory."""
    path = url[len("sqlite:///"):]
    if path and path != ":memory:" and not Path(path).is_absolute():
        resolved = (PROJECT_ROOT / path).resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{resolved.as_posix()}"
    return url


if settings.database_url.startswith("sqlite"):
    engine = create_engine(_sqlite_url(settings.database_url), connect_args={"check_same_thread": False}, pool_pre_ping=True)
else:
    engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# Lightweight additive migrations for columns added after a table already
# exists (create_all only creates missing tables, never alters columns).
_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "uploads": {
        "visible_to_client": "BOOLEAN NOT NULL DEFAULT false",
        "category": "VARCHAR(40) NOT NULL DEFAULT 'invoice'",
        "document_type": "VARCHAR(50) DEFAULT 'TAX_INVOICE'",
        "gstin": "VARCHAR(20) DEFAULT ''",
        "financial_year": "VARCHAR(20) DEFAULT ''",
        "tax_periods": "VARCHAR(255) DEFAULT ''",
        "period_warnings": "TEXT DEFAULT '[]'",
        "gstin_verification_status": "VARCHAR(40) DEFAULT 'valid'",
        "object_key": "VARCHAR(500) DEFAULT ''",
        "status": "VARCHAR(40) DEFAULT 'received'",
        "validation_errors": "TEXT DEFAULT '[]'",
        "parsed_rows": "INTEGER DEFAULT 0",
        "is_reupload": "BOOLEAN DEFAULT false",
        "reupload_invoice_id": "VARCHAR(80) DEFAULT ''",
        "reupload_note": "TEXT DEFAULT ''",
        "extracted_json": "TEXT DEFAULT ''",
        "processed_at": "TIMESTAMP",
        "file_sha256": "VARCHAR(64) DEFAULT ''",
    },
    "invoices": {
        "recipient_gstin": "VARCHAR(20) DEFAULT ''",
        "cgst": "FLOAT DEFAULT 0",
        "sgst": "FLOAT DEFAULT 0",
        "igst": "FLOAT DEFAULT 0",
        "source_document_type": "VARCHAR(50) DEFAULT 'TAX_INVOICE'",
        "tax_period": "VARCHAR(50) DEFAULT ''",
        "period_warning": "VARCHAR(255) DEFAULT ''",
        "validation_flags": "TEXT DEFAULT '{}'",
        "reupload_status": "VARCHAR(40) DEFAULT ''",
        "reupload_note": "TEXT DEFAULT ''",
        "reuploaded_at": "TIMESTAMP",
        "reuploaded_file_name": "VARCHAR(255) DEFAULT ''",
        "duplicate_count": "INTEGER DEFAULT 0",
        "itc_status": "VARCHAR(20) DEFAULT ''",
        "itc_decided_at": "TIMESTAMP",
        "itc_decided_by": "VARCHAR(80) DEFAULT ''",
        "itc_reject_reason": "TEXT DEFAULT ''",
    },
    "fraud_alerts": {
        "reupload_status": "VARCHAR(40) DEFAULT ''",
        "reupload_note": "TEXT DEFAULT ''",
    },
    "users": {
        "email_verified": "BOOLEAN DEFAULT false",
    },
    "clients": {
        "gst_legal_name": "VARCHAR(255) DEFAULT ''",
        "gst_trade_name": "VARCHAR(255) DEFAULT ''",
        "gst_status": "VARCHAR(80) DEFAULT ''",
        "gst_details_json": "TEXT DEFAULT '{}'",
        "gst_verified_at": "TIMESTAMP",
    },
}


def ensure_schema() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, columns in _ADDITIVE_COLUMNS.items():
        if table not in existing_tables:
            continue
        present = {col["name"] for col in inspector.get_columns(table)}
        for name, ddl in columns.items():
            if name in present:
                continue
            # SQLite doesn't accept "NOT NULL DEFAULT false" cleanly on ALTER; use 0.
            column_ddl = ddl.replace("false", "0") if engine.dialect.name == "sqlite" else ddl
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {column_ddl}"))
