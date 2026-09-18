-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414091645.

-- Function: creates today's progress note for all active admissions that don't have one yet
CREATE OR REPLACE FUNCTION public.ensure_daily_progress_notes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission   RECORD;
  v_day_number  INTEGER;
  v_count       INTEGER := 0;
BEGIN
  FOR v_admission IN
    SELECT a.id, a.hospital_id, a.patient_id, a.admitting_doctor_id, a.admitted_at
    FROM public.ipd_admissions a
    WHERE a.status = 'in-progress'
      AND NOT EXISTS (
        SELECT 1 FROM public.ipd_progress_notes n
        WHERE n.admission_id = a.id
          AND n.note_date = CURRENT_DATE
      )
  LOOP
    v_day_number := (CURRENT_DATE - a.admitted_at::date) + 1;

    INSERT INTO public.ipd_progress_notes (
      hospital_id, admission_id, patient_id,
      note_date, hospital_day_number, day_label,
      day_tags, authored_by, status
    ) VALUES (
      v_admission.hospital_id,
      v_admission.id,
      v_admission.patient_id,
      CURRENT_DATE,
      v_day_number,
      'Day ' || v_day_number,
      ARRAY[]::text[],
      v_admission.admitting_doctor_id,
      'draft'
    )
    ON CONFLICT DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Also backfill ALL missing past days for active admissions
CREATE OR REPLACE FUNCTION public.backfill_missing_progress_notes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission   RECORD;
  v_date        DATE;
  v_day_number  INTEGER;
  v_count       INTEGER := 0;
BEGIN
  FOR v_admission IN
    SELECT a.id, a.hospital_id, a.patient_id, a.admitting_doctor_id, a.admitted_at
    FROM public.ipd_admissions a
    WHERE a.status = 'in-progress'
  LOOP
    -- Loop through every date from admission day to today
    v_date := v_admission.admitted_at::date;
    WHILE v_date <= CURRENT_DATE LOOP
      v_day_number := (v_date - v_admission.admitted_at::date) + 1;

      INSERT INTO public.ipd_progress_notes (
        hospital_id, admission_id, patient_id,
        note_date, hospital_day_number, day_label,
        day_tags, authored_by, status
      ) VALUES (
        v_admission.hospital_id,
        v_admission.id,
        v_admission.patient_id,
        v_date,
        v_day_number,
        'Day ' || v_day_number,
        ARRAY[]::text[],
        v_admission.admitting_doctor_id,
        'draft'
      )
      ON CONFLICT DO NOTHING;

      v_count := v_count + 1;
      v_date := v_date + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;
