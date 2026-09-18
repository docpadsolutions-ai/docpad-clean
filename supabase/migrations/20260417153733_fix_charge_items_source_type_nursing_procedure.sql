-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417153733.

-- Add 'nursing_procedure' to the allowed source_type values
ALTER TABLE charge_items DROP CONSTRAINT charge_items_source_type_check;

ALTER TABLE charge_items ADD CONSTRAINT charge_items_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'encounter', 'service_request', 'medication_dispense', 
    'procedure', 'observation', 'manual', 'queue', 'nursing_procedure'
  ]));

NOTIFY pgrst, 'reload schema';
