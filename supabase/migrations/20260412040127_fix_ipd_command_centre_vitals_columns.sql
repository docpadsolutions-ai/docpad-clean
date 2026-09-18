-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412040127.

DROP FUNCTION IF EXISTS get_my_ipd_patients(text);

CREATE OR REPLACE FUNCTION get_my_ipd_patients(
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  admission_id              uuid,
  admission_number          text,
  admission_type            text,
  admission_class           text,
  status                    text,
  admitted_at               timestamptz,
  expected_discharge_date   date,
  surgery_date              date,
  primary_diagnosis_display text,
  primary_diagnosis_icd10   text,
  specialty                 text,
  patient_id                uuid,
  patient_name              text,
  patient_uhid              text,
  patient_age               int,
  patient_gender            text,
  patient_blood_group       text,
  patient_phone             text,
  ward_name                 text,
  bed_number                text,
  bed_type                  text,
  los_days                  int,
  latest_bp_systolic        int,
  latest_bp_diastolic       int,
  latest_heart_rate         int,
  latest_temp_c             numeric,
  latest_spo2               numeric,
  latest_pain_score         int,
  latest_gcs_score          int,
  latest_vitals_at          timestamptz,
  progress_notes_count      bigint,
  pending_investigations    bigint,
  consents_obtained         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id uuid;
  v_hospital_id     uuid;
BEGIN
  SELECT p.id, p.hospital_id
  INTO v_practitioner_id, v_hospital_id
  FROM practitioners p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RAISE EXCEPTION 'Practitioner not found for current user';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.admission_number,
    a.admission_type,
    a.admission_class,
    a.status,
    a.admitted_at,
    a.expected_discharge_date,
    a.surgery_date,
    a.primary_diagnosis_display,
    a.primary_diagnosis_icd10,
    a.specialty,
    pt.id,
    pt.full_name,
    pt.uhid,
    EXTRACT(YEAR FROM AGE(pt.date_of_birth))::int,
    pt.gender,
    pt.blood_group,
    pt.phone,
    w.name,
    b.bed_number,
    b.bed_type,
    GREATEST(0, EXTRACT(DAY FROM (NOW() - a.admitted_at)))::int,
    lv.bp_systolic,
    lv.bp_diastolic,
    lv.heart_rate,
    lv.temperature_c,
    lv.spo2,
    lv.pain_score,
    lv.gcs_score,
    lv.recorded_at,
    COALESCE(pn.note_count, 0),
    COALESCE(inv.pending_count, 0),
    COALESCE(con.consent_count, 0)

  FROM ipd_admissions a
  JOIN patients pt ON pt.id = a.patient_id
  LEFT JOIN ipd_wards w  ON w.id = a.ward_id
  LEFT JOIN ipd_beds  b  ON b.id = a.bed_id

  LEFT JOIN LATERAL (
    SELECT iv.bp_systolic, iv.bp_diastolic, iv.heart_rate,
           iv.temperature_c, iv.spo2, iv.pain_score, iv.gcs_score, iv.recorded_at
    FROM ipd_vitals iv
    WHERE iv.admission_id = a.id
    ORDER BY iv.recorded_at DESC
    LIMIT 1
  ) lv ON true

  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS note_count
    FROM ipd_progress_notes pn2
    WHERE pn2.admission_id = a.id
  ) pn ON true

  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS pending_count
    FROM ipd_investigation_orders io
    WHERE io.admission_id = a.id
      AND io.status IN ('ordered', 'sample_collected', 'processing')
  ) inv ON true

  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS consent_count
    FROM ipd_admission_consents ic
    WHERE ic.admission_id = a.id
      AND ic.consent_status = 'obtained'
  ) con ON true

  WHERE
    a.hospital_id = v_hospital_id
    AND a.admitting_doctor_id = v_practitioner_id
    AND (
      p_status = 'all'
      OR a.status IN ('admitted', 'active', 'pending_discharge')
    )

  ORDER BY
    CASE WHEN a.surgery_date = CURRENT_DATE THEN 0 ELSE 1 END,
    a.admitted_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_ipd_patients(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
