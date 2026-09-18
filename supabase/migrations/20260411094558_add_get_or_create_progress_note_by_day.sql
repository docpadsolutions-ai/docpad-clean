-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411094558.

CREATE OR REPLACE FUNCTION public.get_or_create_progress_note(
  p_admission_id        UUID,
  p_hospital_day_number INTEGER,
  p_note_date           DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_note_id    UUID;
  v_label      TEXT;
  v_hospital_id UUID;
  v_patient_id  UUID;
  v_authored_by UUID;
BEGIN
  SELECT hospital_id, patient_id, admitting_doctor_id
  INTO v_hospital_id, v_patient_id, v_authored_by
  FROM public.ipd_admissions WHERE id = p_admission_id;

  v_label := CASE
    WHEN p_hospital_day_number = 0 THEN 'Day 0 – Admission'
    WHEN p_hospital_day_number < 0 THEN 'Pre-op – Day ' || p_hospital_day_number
    ELSE 'POD ' || p_hospital_day_number
  END;

  INSERT INTO public.ipd_progress_notes (
    hospital_id, admission_id, patient_id,
    note_date, hospital_day_number, day_label, authored_by, status
  ) VALUES (
    v_hospital_id, p_admission_id, v_patient_id,
    p_note_date, p_hospital_day_number, v_label, v_authored_by, 'draft'
  )
  ON CONFLICT (admission_id, note_date) DO NOTHING
  RETURNING id INTO v_note_id;

  IF v_note_id IS NULL THEN
    SELECT id INTO v_note_id FROM public.ipd_progress_notes
    WHERE admission_id = p_admission_id AND note_date = p_note_date;
  END IF;

  RETURN (SELECT row_to_json(n)::JSONB FROM public.ipd_progress_notes n WHERE id = v_note_id);
END;
$$;
