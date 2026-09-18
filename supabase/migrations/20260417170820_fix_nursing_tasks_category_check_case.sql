-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417170820.

ALTER TABLE nursing_tasks DROP CONSTRAINT nursing_tasks_task_category_check;

ALTER TABLE nursing_tasks
ADD CONSTRAINT nursing_tasks_task_category_check
CHECK (lower(task_category) = ANY (ARRAY[
  'vitals','medication','wound_care','neuro_check','vascular_check',
  'positioning','mobilisation','drain_care','traction_check','cast_check',
  'iv_care','catheter_care','diet','education','specimen','procedure','other'
]));

NOTIFY pgrst, 'reload schema';
