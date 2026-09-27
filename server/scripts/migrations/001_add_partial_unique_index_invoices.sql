-- Migration: 001_add_partial_unique_index_invoices.sql
-- Description: Create blanket unique index on invoices to prevent duplicate row creation across all clients

DROP INDEX IF EXISTS uq_invoices_client_key_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_client_key_source 
ON invoices (client_id, normalized_key, source);
