-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413155805.

-- ================================================================
-- 1. Ward Staff Assignments (shift-based, Option B)
-- ================================================================
CREATE TABLE public.ward_staff_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id),
  practitioner_id uuid NOT NULL REFERENCES public.practitioners(id),
  ward_id       uuid NOT NULL REFERENCES public.ipd_wards(id),
  shift         text NOT NULL CHECK (shift IN ('morning','afternoon','night','general')),
  assigned_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active     boolean NOT NULL DEFAULT true,
  assigned_by   uuid REFERENCES public.practitioners(id),
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ward_staff_hospital ON public.ward_staff_assignments(hospital_id);
CREATE INDEX idx_ward_staff_practitioner ON public.ward_staff_assignments(practitioner_id);
CREATE INDEX idx_ward_staff_ward ON public.ward_staff_assignments(ward_id);
CREATE INDEX idx_ward_staff_date ON public.ward_staff_assignments(assigned_date);

ALTER TABLE public.ward_staff_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ward_staff_select" ON public.ward_staff_assignments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ward_staff_assignments.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ward_staff_insert_admin" ON public.ward_staff_assignments
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ward_staff_assignments.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
      AND pr.role IN ('admin','doctor')
  ));

CREATE POLICY "ward_staff_update_admin" ON public.ward_staff_assignments
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ward_staff_assignments.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
      AND pr.role IN ('admin','doctor')
  ));

CREATE TRIGGER set_updated_at_ward_staff
  BEFORE UPDATE ON public.ward_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ================================================================
-- 2. Auto-generate MAR slots when treatment is added to IPD
-- Trigger on ipd_treatments INSERT
-- ================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_create_mar_slots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_schedule_times time[];
  v_t time;
  v_schedule_date date;
BEGIN
  -- Only for medication treatment kind
  IF NEW.treatment_kind NOT IN ('medication','iv_medication','injection') THEN
    RETURN NEW;
  END IF;

  -- Map frequency to scheduled times
  v_schedule_times := CASE NEW.frequency
    WHEN 'OD'   THEN ARRAY['08:00'::time]
    WHEN 'BD'   THEN ARRAY['08:00'::time, '20:00'::time]
    WHEN 'TDS'  THEN ARRAY['08:00'::time, '14:00'::time, '20:00'::time]
    WHEN 'QID'  THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '00:00'::time]
    WHEN 'q4h'  THEN ARRAY['06:00'::time, '10:00'::time, '14:00'::time, '18:00'::time, '22:00'::time, '02:00'::time]
    WHEN 'q6h'  THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '00:00'::time]
    WHEN 'q8h'  THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    WHEN 'SOS'  THEN ARRAY['08:00'::time]  -- one slot, nurse marks as needed
    WHEN 'stat' THEN ARRAY[CURRENT_TIME::time]
    ELSE ARRAY['08:00'::time]  -- default OD
  END;

  -- Create MAR slots for today (and tomorrow if start_date differs)
  v_schedule_date := COALESCE(NEW.start_date, CURRENT_DATE);

  FOREACH v_t IN ARRAY v_schedule_times LOOP
    INSERT INTO public.ipd_mar (
      hospital_id, admission_id, patient_id, treatment_id,
      drug_name, dose, route, frequency,
      scheduled_date, scheduled_time, status
    ) VALUES (
      NEW.hospital_id, NEW.admission_id, NEW.patient_id, NEW.id,
      NEW.name, NEW.dose, NEW.route, NEW.frequency,
      v_schedule_date, v_t, 'pending'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_mar
  AFTER INSERT ON public.ipd_treatments
  FOR EACH ROW EXECUTE FUNCTION fn_auto_create_mar_slots();


-- ================================================================
-- 3. RPC: get_nurse_ward_patients
-- Returns patients in wards assigned to this nurse today
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_nurse_ward_patients(
  p_nurse_id  uuid,
  p_hospital_id uuid,
  p_shift     text DEFAULT NULL,
  p_date      date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'admission_id',      a.id,
    'admission_number',  a.admission_number,
    'admitted_at',       a.admitted_at,
    'primary_diagnosis', a.primary_diagnosis_display,
    'patient_id',        p.id,
    'patient_name',      p.full_name,
    'patient_age',       EXTRACT(YEAR FROM age(p.date_of_birth))::int,
    'patient_sex',       p.sex,
    'blood_group',       p.blood_group,
    'known_allergies',   p.known_allergies,
    'ward_id',           w.id,
    'ward_name',         w.name,
    'bed_number',        b.bed_number,
    'bed_type',          b.bed_type,
    'doctor_name',       dr.full_name,
    'los_days',          EXTRACT(DAY FROM now() - a.admitted_at)::int,
    -- Latest vitals
    'latest_bp',         lv.bp_systolic || '/' || lv.bp_diastolic,
    'latest_hr',         lv.heart_rate,
    'latest_temp_c',     lv.temperature_c,
    'latest_spo2',       lv.spo2,
    'latest_pain',       lv.pain_score,
    'latest_vitals_at',  lv.recorded_at,
    -- Pending MAR count
    'pending_meds',      (
      SELECT COUNT(*) FROM public.ipd_mar m
      WHERE m.admission_id = a.id
        AND m.scheduled_date = p_date
        AND m.status = 'pending'
    ),
    -- Pending nursing orders
    'pending_orders',    (
      SELECT COUNT(*) FROM public.ipd_doctor_orders o
      WHERE o.admission_id = a.id
        AND o.order_category = 'nursing'
        AND o.status = 'active'
        AND o.acknowledged_at IS NULL
    )
  ) ORDER BY w.name, b.bed_number)
  INTO v_result
  FROM public.ward_staff_assignments wsa
  JOIN public.ipd_wards w ON w.id = wsa.ward_id
  JOIN public.ipd_admissions a ON a.ward_id = w.id AND a.status = 'in-progress'
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.ipd_beds b ON b.id = a.bed_id
  LEFT JOIN public.practitioners dr ON dr.id = a.admitting_doctor_id
  LEFT JOIN LATERAL (
    SELECT bp_systolic, bp_diastolic, heart_rate, temperature_c, spo2, pain_score, recorded_at
    FROM public.ipd_vitals
    WHERE admission_id = a.id
    ORDER BY recorded_at DESC LIMIT 1
  ) lv ON true
  WHERE wsa.practitioner_id = p_nurse_id
    AND wsa.hospital_id = p_hospital_id
    AND wsa.assigned_date = p_date
    AND wsa.is_active = true
    AND (p_shift IS NULL OR wsa.shift = p_shift);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ================================================================
-- 4. RPC: get_nurse_mar_for_patient
-- Returns today's MAR for a specific patient
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_nurse_mar_for_patient(
  p_admission_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'mar_id',          m.id,
    'drug_name',       m.drug_name,
    'dose',            m.dose,
    'route',           m.route,
    'frequency',       m.frequency,
    'scheduled_time',  m.scheduled_time,
    'status',          m.status,
    'administered_at', m.administered_at,
    'administered_by', pr.full_name,
    'actual_dose',     m.actual_dose_given,
    'hold_reason',     m.hold_reason,
    'iv_site',         m.iv_site,
    'adverse_event',   m.adverse_event
  ) ORDER BY m.scheduled_time)
  INTO v_result
  FROM public.ipd_mar m
  LEFT JOIN public.practitioners pr ON pr.id = m.administered_by
  WHERE m.admission_id = p_admission_id
    AND m.scheduled_date = p_date;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
