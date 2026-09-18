-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413150605.

ALTER TABLE public.ipd_beds DROP CONSTRAINT ipd_beds_bed_type_check;

ALTER TABLE public.ipd_beds ADD CONSTRAINT ipd_beds_bed_type_check
CHECK (bed_type IN ('standard','private','icu','hdu','isolation','daycare','observation'));
