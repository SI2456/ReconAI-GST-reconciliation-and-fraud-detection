#!/usr/bin/env python3
"""
001_add_partial_unique_index_invoices.py

Migration to add a blanket unique index on invoices (client_id, normalized_key, source).
Ensures silent duplicate row creation cannot happen across the entire database.
"""

import sys
from pathlib import Path

server_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(server_dir))

from scripts.dedupe_all_invoices import get_db_connection

def apply_migration():
    conn, db_type = get_db_connection()
    cur = conn.cursor()

    print("=" * 80)
    print("MIGRATION: 001_add_blanket_unique_index_invoices")
    print("=" * 80)
    print(f"Database Type: {db_type.upper()}")

    sql_postgres = """
    DROP INDEX IF EXISTS uq_invoices_client_key_source;
    CREATE UNIQUE INDEX uq_invoices_client_key_source 
    ON invoices (client_id, normalized_key, source);
    """

    sql_sqlite = """
    DROP INDEX IF EXISTS uq_invoices_client_key_source;
    CREATE UNIQUE INDEX uq_invoices_client_key_source 
    ON invoices (client_id, normalized_key, source);
    """

    sql = sql_postgres if db_type == "postgres" else sql_sqlite

    try:
        print("Applying blanket unique index...")
        cur.execute(sql)
        conn.commit()
        print("[SUCCESS] Blanket unique index 'uq_invoices_client_key_source' created successfully!")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Failed to apply migration: {e}")
        raise e
    finally:
        conn.close()

if __name__ == "__main__":
    apply_migration()
