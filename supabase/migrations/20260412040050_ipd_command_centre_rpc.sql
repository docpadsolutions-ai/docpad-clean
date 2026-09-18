-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412040050.

-- =====================================================
-- IPD Command Centre: get_my_ipd_patients
-- Returns active admissions for the calling doctor
-- Joins: patient, ward, bed, latest vitals, progress notes count
-- =====================================================

DROP FUNCTION IF EXISTS get_my_ipd_patients(text);

CREATE OR REPLACE FUNCTION get_my_ipd_patients(
  p_status text DEFAULT NULL  -- NULL = active only, 'all' = include discharged
)
RETURNS TABLE (
  -- Admission core
  admission_id          uuid,
  admission_number      text,
  admission_type        text,
  admission_class       text,
  status                text,
  admitted_at           timestamptz,
  expected_discharge_date date,
  surgery_date          date,
  primary_diagnosis_display text,
  primary_diagnosis_icd10   text,
  specialty             text,

  -- Patient
  patient_id            uuid,
  patient_name          text,
  patient_uhid          text,
  patient_age           int,
  patient_gender        text,
  patient_blood_group   text,
  patient_phone         text,

  -- Ward / Bed
  ward_name             text,
  bed_number            text,
  bed_type              text,

  -- Days admitted
  los_days              int,

  -- Latest vitals (from ipd_vitals)
  latest_bp             text,
  latest_pulse          numeric,
  latest_temp           numeric,
  latest_spo2           numeric,
  latest_vitals_at      timestamptz,

  -- Progress notes count
  progress_notes_count  bigint,

  -- Pending orders
  pending_investigations bigint,

  -- Consent status
  consents_obtained     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id uuid;
  v_hospital_id     uuid;
BEGIN
  -- Resolve calling user to practitioner record
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
    a.id                        AS admission_id,
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

    -- Patient
    pt.id                       AS patient_id,
    pt.full_name                AS patient_name,
    pt.uhid                     AS patient_uhid,
    EXTRACT(YEAR FROM AGE(pt.date_of_birth))::int AS patient_age,
    pt.gender                   AS patient_gender,
    pt.blood_group              AS patient_blood_group,
    pt.phone                    AS patient_phone,

    -- Ward / Bed
    w.name                      AS ward_name,
    b.bed_number,
    b.bed_type,

    -- LOS
    GREATEST(0, EXTRACT(DAY FROM (NOW() - a.admitted_at)))::int AS los_days,

    -- Latest vitals
    lv.blood_pressure           AS latest_bp,
    lv.pulse_rate               AS latest_pulse,
    lv.temperature              AS latest_temp,
    lv.spo2                     AS latest_spo2,
    lv.recorded_at              AS latest_vitals_at,

    -- Progress notes count
    COALESCE(pn.note_count, 0)  AS progress_notes_count,

    -- Pending investigations
    COALESCE(inv.pending_count, 0) AS pending_investigations,

    -- Consents obtained
    COALESCE(con.consent_count, 0) AS consents_obtained

  FROM ipd_admissions a

  -- Patient join
  JOIN patients pt ON pt.id = a.patient_id

  -- Ward / Bed (optional)
  LEFT JOIN ipd_wards w  ON w.id = a.ward_id
  LEFT JOIN ipd_beds  b  ON b.id = a.bed_id

  -- Latest vitals subquery
  LEFT JOIN LATERAL (
    SELECT iv.blood_pressure, iv.pulse_rate, iv.temperature, iv.spo2, iv.recorded_at
    FROM ipd_vitals iv
    WHERE iv.admission_id = a.id
    ORDER BY iv.recorded_at DESC
    LIMIT 1
  ) lv ON true

  -- Progress notes count
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS note_count
    FROM ipd_progress_notes pn2
    WHERE pn2.admission_id = a.id
  ) pn ON true

  -- Pending investigations count
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS pending_count
    FROM ipd_investigation_orders io
    WHERE io.admission_id = a.id
      AND io.status IN ('ordered', 'sample_collected', 'processing')
  ) inv ON true

  -- Consents obtained
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
      OR p_status IS NULL  -- default: active only
    )
    AND (
      p_status = 'all'
      OR a.status IN ('admitted', 'active', 'pending_discharge')
    )

  ORDER BY
    -- Surgery today first
    CASE WHEN a.surgery_date = CURRENT_DATE THEN 0 ELSE 1 END,
    -- Then by LOS descending (longest admitted)
    a.admitted_at ASC;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION get_my_ipd_patients(text) TO authenticated;


-- =====================================================
-- IPD Command Centre Stats: get_ipd_dashboard_stats
-- Summary counts for the IPD header cards
-- =====================================================

DROP FUNCTION IF EXISTS get_ipd_dashboard_stats();

CREATE OR REPLACE FUNCTION get_ipd_dashboard_stats()
RETURNS TABLE (
  total_active          bigint,
  surgery_today         bigint,
  pending_discharge     bigint,
  critical_patients     bigint,   -- LOS > 7 days (flag for review)
  avg_los_days          numeric,
  pending_investigations bigint
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
    RAISE EXCEPTION 'Practitioner not found';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('admitted', 'active'))                      AS total_active,
    COUNT(*) FILTER (WHERE a.surgery_date = CURRENT_DATE)                           AS surgery_today,
    COUNT(*) FILTER (WHERE a.status = 'pending_discharge')                          AS pending_discharge,
    COUNT(*) FILTER (
      WHERE a.status IN ('admitted', 'active')
        AND EXTRACT(DAY FROM (NOW() - a.admitted_at)) > 7
    )                                                                                AS critical_patients,
    ROUND(AVG(
      EXTRACT(DAY FROM (COALESCE(a.discharged_at, NOW()) - a.admitted_at))
    )::numeric, 1)                                                                   AS avg_los_days,
    (
      SELECT COUNT(*)
      FROM ipd_investigation_orders io2
      JOIN ipd_admissions a2 ON a2.id = io2.admission_id
      WHERE a2.admitting_doctor_id = v_practitioner_id
        AND a2.hospital_id = v_hospital_id
        AND a2.status IN ('admitted', 'active')
        AND io2.status IN ('ordered', 'sample_collected', 'processing')
    )                                                                                AS pending_investigations
  FROM ipd_admissions a
  WHERE a.admitting_doctor_id = v_practitioner_id
    AND a.hospital_id = v_hospital_id
    AND a.status IN ('admitted', 'active', 'pending_discharge');
END;
$$;

GRANT EXECUTE ON FUNCTION get_ipd_dashboard_stats() TO authenticated;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
