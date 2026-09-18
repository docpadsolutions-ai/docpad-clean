-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417170320.

ALTER TABLE nursing_tasks DROP CONSTRAINT nursing_tasks_shift_check;

ALTER TABLE nursing_tasks 
ADD CONSTRAINT nursing_tasks_shift_check 
CHECK (shift = ANY (ARRAY['morning'::text, 'afternoon'::text, 'night'::text, 'Morning'::text, 'Afternoon'::text, 'Night'::text]));

NOTIFY pgrst, 'reload schema';
