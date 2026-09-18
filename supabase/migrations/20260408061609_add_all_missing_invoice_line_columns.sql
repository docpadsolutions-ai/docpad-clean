-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061609.

-- Add all missing columns from invoice form UI
ALTER TABLE invoice_line_items 
ADD COLUMN IF NOT EXISTS line_number INTEGER,
ADD COLUMN IF NOT EXISTS item_code TEXT,
ADD COLUMN IF NOT EXISTS item_description TEXT,
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) DEFAULT 0;

-- Rename sequence to line_number if sequence exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoice_line_items' AND column_name = 'sequence'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoice_line_items' AND column_name = 'line_number'
  ) THEN
    ALTER TABLE invoice_line_items RENAME COLUMN sequence TO line_number;
  END IF;
END $$;
