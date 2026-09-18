-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413145634.

ALTER TABLE public.ipd_admissions 
  DROP CONSTRAINT ipd_admissions_status_check;

ALTER TABLE public.ipd_admissions
  ADD CONSTRAINT ipd_admissions_status_check 
  CHECK (status IN (
    'pending_billing',
    'planned',
    'arrived', 
    'triaged',
    'in-progress',
    'onleave',
    'finished',
    'cancelled',
    'entered-in-error'
  ));
