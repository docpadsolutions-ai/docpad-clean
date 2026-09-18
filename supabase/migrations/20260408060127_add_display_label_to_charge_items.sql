-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408060127.

ALTER TABLE charge_items 
ADD COLUMN display_label TEXT;
