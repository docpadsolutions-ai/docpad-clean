-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413150812.

-- Add maintenance_duration_mins to ipd_wards so admin can configure per ward
ALTER TABLE public.ipd_wards 
ADD COLUMN IF NOT EXISTS post_discharge_maintenance_mins integer NOT NULL DEFAULT 60;

-- Trigger: when admission finishes, set bed to 'maintenance'
-- A pg_cron job (or the frontend) can flip it back to 'available' after the duration
CREATE OR REPLACE FUNCTION public.fn_bed_post_discharge_maintenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act when status changes TO 'finished'
  IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
    IF NEW.bed_id IS NOT NULL THEN
      UPDATE public.ipd_beds SET
        status = 'maintenance',
        maintenance_until = now() + (
          SELECT (post_discharge_maintenance_mins || ' minutes')::interval
          FROM public.ipd_wards WHERE id = NEW.ward_id
        ),
        updated_at = now()
      WHERE id = NEW.bed_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Add maintenance_until column to track when bed becomes available again
ALTER TABLE public.ipd_beds
ADD COLUMN IF NOT EXISTS maintenance_until timestamp with time zone;

CREATE TRIGGER trg_bed_post_discharge_maintenance
  AFTER UPDATE ON public.ipd_admissions
  FOR EACH ROW EXECUTE FUNCTION fn_bed_post_discharge_maintenance();

-- RPC: release_bed_from_maintenance
-- Called manually by nurse/housekeeping OR auto-called after timer
CREATE OR REPLACE FUNCTION public.release_bed_from_maintenance(
  p_bed_id      uuid,
  p_hospital_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.ipd_beds SET
    status = 'available',
    maintenance_until = NULL,
    updated_at = now()
  WHERE id = p_bed_id 
    AND hospital_id = p_hospital_id
    AND status = 'maintenance';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bed not in maintenance');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
