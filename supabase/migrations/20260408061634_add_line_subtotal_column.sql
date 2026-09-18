-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061634.

ALTER TABLE invoice_line_items 
ADD COLUMN line_subtotal NUMERIC(10,2) DEFAULT 0;
