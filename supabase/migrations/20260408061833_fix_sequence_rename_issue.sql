-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061833.

-- Check if sequence still exists and make it nullable or drop it
ALTER TABLE invoice_line_items 
ALTER COLUMN sequence DROP NOT NULL;

-- Or if line_number exists, drop sequence entirely
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoice_line_items' AND column_name = 'line_number'
  ) THEN
    ALTER TABLE invoice_line_items DROP COLUMN IF EXISTS sequence;
  END IF;
END $$;
