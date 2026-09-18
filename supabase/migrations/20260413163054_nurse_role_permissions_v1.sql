-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413163054.

INSERT INTO public.role_permissions (role, resource, action) VALUES
  ('nurse', 'nursing_care_plans', 'read'),
  ('nurse', 'nursing_care_plans', 'create'),
  ('nurse', 'nursing_care_plans', 'update'),
  ('nurse', 'mar', 'read'),
  ('nurse', 'mar', 'create'),
  ('nurse', 'mar', 'update'),
  ('nurse', 'doctor_orders', 'read'),
  ('nurse', 'doctor_orders', 'update'),
  ('nurse', 'ward_assignments', 'read'),
  ('nurse', 'io_records', 'read'),
  ('nurse', 'io_records', 'create'),
  ('nurse', 'io_records', 'update'),
  ('nurse', 'ipd_admissions', 'read'),
  ('nurse', 'wound_assessments', 'read'),
  ('nurse', 'wound_assessments', 'create'),
  ('nurse', 'wound_assessments', 'update');
