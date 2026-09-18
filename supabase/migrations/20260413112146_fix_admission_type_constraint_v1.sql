-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413112146.

-- Drop old constraint and add one that covers all variants
ALTER TABLE public.ipd_admissions 
  DROP CONSTRAINT ipd_admissions_admission_type_check;

ALTER TABLE public.ipd_admissions
  ADD CONSTRAINT ipd_admissions_admission_type_check 
  CHECK (admission_type IN ('elective','emergency','daycare','referral','transfer_in'));
