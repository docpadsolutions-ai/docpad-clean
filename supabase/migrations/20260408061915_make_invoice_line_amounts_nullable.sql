-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061915.

-- Make all amount columns nullable with defaults
ALTER TABLE invoice_line_items 
ALTER COLUMN net_amount DROP NOT NULL,
ALTER COLUMN net_amount SET DEFAULT 0,
ALTER COLUMN tax_amount DROP NOT NULL,
ALTER COLUMN tax_amount SET DEFAULT 0,
ALTER COLUMN gross_amount DROP NOT NULL,
ALTER COLUMN gross_amount SET DEFAULT 0;
