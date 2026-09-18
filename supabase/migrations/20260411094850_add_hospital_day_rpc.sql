-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411094850.

-- RPC: add a new hospital day (progress note) for an admission
CREATE OR REPLACE FUNCTION public.add_hospital_day(
  p_admission_id UUID,
  p_note_date    DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id   UUID;
  v_patient_id    UUID;
  v_authored_by   UUID;
  v_admitted_date DATE;
  v_surgery_date  DATE;
  v_day_number    INTEGER;
  v_label         TEXT;
  v_note_id       UUID;
BEGIN
  SELECT hospital_id, patient_id, admitting_doctor_id, admitted_at::DATE, surgery_date::DATE
  INTO v_hospital_id, v_patient_id, v_authored_by, v_admitted_date, v_surgery_date
  FROM public.ipd_admissions WHERE id = p_admission_id;

  -- Day numbering logic:
  -- If no surgery: Day 1, Day 2, Day 3...
  -- If surgery exists: days before = Pre-op Day -N, surgery day = POD 0, after = POD 1, POD 2...
  IF v_surgery_date IS NULL THEN
    v_day_number := (p_note_date - v_admitted_date) + 1;
    v_label := 'Day ' || v_day_number;
  ELSE
    v_day_number := p_note_date - v_surgery_date;
    v_label := CASE
      WHEN v_day_number < 0  THEN 'Pre-op – Day ' || v_day_number
      WHEN v_day_number = 0  THEN 'POD 0 – Surgery'
      ELSE 'POD ' || v_day_number
    END;
  END IF;

  INSERT INTO public.ipd_progress_notes (
    hospital_id, admission_id, patient_id,
    note_date, hospital_day_number, day_label,
    is_surgery_day, authored_by, status
  ) VALUES (
    v_hospital_id, p_admission_id, v_patient_id,
    p_note_date, v_day_number, v_label,
    (v_surgery_date IS NOT NULL AND p_note_date = v_surgery_date),
    v_authored_by, 'draft'
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

-- RPC: mark a progress note as surgery day and relabel all notes for this admission
CREATE OR REPLACE FUNCTION public.mark_surgery_day(
  p_note_id      UUID,
  p_surgery_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admission_id UUID;
  v_hospital_id  UUID;
  v_note         RECORD;
  v_day_number   INTEGER;
  v_label        TEXT;
BEGIN
  SELECT admission_id, hospital_id INTO v_admission_id, v_hospital_id
  FROM public.ipd_progress_notes WHERE id = p_note_id;

  -- Update surgery_date on admission
  UPDATE public.ipd_admissions SET surgery_date = p_surgery_date WHERE id = v_admission_id;

  -- Relabel all notes for this admission relative to surgery date
  FOR v_note IN
    SELECT id, note_date FROM public.ipd_progress_notes
    WHERE admission_id = v_admission_id ORDER BY note_date
  LOOP
    v_day_number := v_note.note_date - p_surgery_date;
    v_label := CASE
      WHEN v_day_number < 0  THEN 'Pre-op – Day ' || v_day_number
      WHEN v_day_number = 0  THEN 'POD 0 – Surgery'
      ELSE 'POD ' || v_day_number
    END;
    UPDATE public.ipd_progress_notes
    SET
      hospital_day_number = v_day_number,
      day_label           = v_label,
      is_surgery_day      = (v_note.note_date = p_surgery_date)
    WHERE id = v_note.id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'surgery_date', p_surgery_date, 'admission_id', v_admission_id);
END;
$$;
