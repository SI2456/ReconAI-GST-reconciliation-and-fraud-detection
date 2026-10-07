import sys
from pathlib import Path

from sqlalchemy import inspect, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import CAProfile, Client, ClientProfile, User
from app.db.session import Base, SessionLocal, engine


def add_column_if_missing(table: str, column: str, definition: str) -> None:
    inspector = inspect(engine)
    existing = {item["name"] for item in inspector.get_columns(table)}
    if column in existing:
        return
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def main() -> None:
    Base.metadata.create_all(bind=engine)
    add_column_if_missing("users", "email_verified", "BOOLEAN DEFAULT false")
    add_column_if_missing("clients", "gst_legal_name", "VARCHAR(255) DEFAULT ''")
    add_column_if_missing("clients", "gst_trade_name", "VARCHAR(255) DEFAULT ''")
    add_column_if_missing("clients", "gst_status", "VARCHAR(80) DEFAULT ''")
    add_column_if_missing("clients", "gst_details_json", "TEXT DEFAULT '{}'")
    add_column_if_missing("clients", "gst_verified_at", "TIMESTAMP")

    # Uploads metadata columns
    add_column_if_missing("uploads", "document_type", "VARCHAR(50) DEFAULT 'TAX_INVOICE'")
    add_column_if_missing("uploads", "gstin", "VARCHAR(20) DEFAULT ''")
    add_column_if_missing("uploads", "financial_year", "VARCHAR(20) DEFAULT ''")
    add_column_if_missing("uploads", "tax_periods", "VARCHAR(255) DEFAULT ''")
    add_column_if_missing("uploads", "period_warnings", "TEXT DEFAULT '[]'")
    add_column_if_missing("uploads", "gstin_verification_status", "VARCHAR(40) DEFAULT 'valid'")
    add_column_if_missing("uploads", "extracted_json", "TEXT DEFAULT ''")
    add_column_if_missing("uploads", "processed_at", "TIMESTAMP")

    # Invoices canonical metadata columns
    add_column_if_missing("invoices", "recipient_gstin", "VARCHAR(20) DEFAULT ''")
    add_column_if_missing("invoices", "cgst", "FLOAT DEFAULT 0")
    add_column_if_missing("invoices", "sgst", "FLOAT DEFAULT 0")
    add_column_if_missing("invoices", "igst", "FLOAT DEFAULT 0")
    add_column_if_missing("invoices", "source_document_type", "VARCHAR(50) DEFAULT 'TAX_INVOICE'")
    add_column_if_missing("invoices", "tax_period", "VARCHAR(50) DEFAULT ''")
    add_column_if_missing("invoices", "period_warning", "VARCHAR(255) DEFAULT ''")
    add_column_if_missing("invoices", "preview_upload_id", "VARCHAR(80)")
    add_column_if_missing("invoices", "duplicate_count", "INTEGER DEFAULT 0")

    db = SessionLocal()
    try:
        db.query(User).filter(User.status == "active").update({"email_verified": True})

        for ca_user in db.query(User).filter(User.role == "ca").all():
            profile = db.query(CAProfile).filter(CAProfile.user_id == ca_user.id).first()
            if not profile:
                db.add(
                    CAProfile(
                        user_id=ca_user.id,
                        specialization="GST",
                        experience="8 Years" if ca_user.email == "ca.demo@reconai.local" else "0 Years",
                        city="Ahmedabad",
                        rating=4.8,
                        is_verified=ca_user.email_verified,
                    )
                )

        for client_user in db.query(User).filter(User.role == "client").all():
            client = db.query(Client).filter((Client.email == client_user.email) | (Client.gstin == client_user.gstin)).first()
            profile = db.query(ClientProfile).filter(ClientProfile.user_id == client_user.id).first()
            if not profile:
                db.add(ClientProfile(user_id=client_user.id, selected_ca_id=client.ca_id if client else None))

        db.commit()
        print("Migration complete.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
