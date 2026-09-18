-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061448.

-- Add all missing columns needed by invoice form
ALTER TABLE invoice_line_items 
ADD COLUMN discount_percent NUMERIC(5,2) DEFAULT 0,
ADD COLUMN discount_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN tax_percent NUMERIC(5,2) DEFAULT 0;

-- Update existing rows
UPDATE invoice_line_items 
SET discount_percent = 0, 
    discount_amount = 0, 
    tax_percent = 0
WHERE discount_percent IS NULL;
