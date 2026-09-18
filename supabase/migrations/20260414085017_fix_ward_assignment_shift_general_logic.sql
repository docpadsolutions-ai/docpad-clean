-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414085017.

UPDATE public.ward_staff_assignments SET shift = lower(shift);

DROP FUNCTION IF EXISTS public.get_nurse_ward_patients(uuid,uuid,text,date);

CREATE FUNCTION public.get_nurse_ward_patients(
  p_nurse_id    UUID,
  p_hospital_id UUID,
  p_shift       TEXT,
  p_date        DATE
)
RETURNS JSONB
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
    'latest_bp',         lv.bp_systolic || '/' || lv.bp_diastolic,
    'latest_hr',         lv.heart_rate,
    'latest_temp_c',     lv.temperature_c,
    'latest_spo2',       lv.spo2,
    'latest_pain',       lv.pain_score,
    'latest_vitals_at',  lv.recorded_at,
    'pending_meds',      (
      SELECT COUNT(*) FROM public.ipd_mar m
      WHERE m.admission_id = a.id
        AND m.scheduled_date = p_date
        AND m.status = 'pending'
    ),
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
    AND (wsa.shift = 'general' OR p_shift IS NULL OR lower(wsa.shift) = lower(p_shift));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
