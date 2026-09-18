-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416095850.

DROP FUNCTION IF EXISTS get_ward_census(uuid);

CREATE OR REPLACE FUNCTION get_ward_census(p_hospital_id uuid DEFAULT NULL)
RETURNS TABLE (
  admission_id uuid,
  patient_id uuid,
  full_name text,
  sex text,
  date_of_birth date,
  ward_id uuid,
  ward_name text,
  ward_type text,
  bed_id uuid,
  bed_number text,
  admission_date date,
  los_days integer,
  primary_diagnosis_display text,
  admitting_doctor_id uuid,
  mews_score integer,
  mews_alert_level text,
  mews_components jsonb,
  latest_vitals_at timestamptz,
  pulse integer,
  bp text,
  spo2 integer,
  temperature numeric
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    a.id AS admission_id,
    a.patient_id,
    p.full_name,
    p.sex,
    p.date_of_birth,
    a.ward_id,
    w.name AS ward_name,
    w.ward_type,
    a.bed_id,
    b.bed_number,
    a.admitted_at::date AS admission_date,
    (CURRENT_DATE - a.admitted_at::date)::integer AS los_days,
    a.primary_diagnosis_display,
    a.admitting_doctor_id,
    v.mews_score,
    v.mews_alert_level,
    v.mews_components,
    v.recorded_at AS latest_vitals_at,
    v.pulse,
    v.blood_pressure AS bp,
    v.spo2,
    v.temperature
  FROM ipd_admissions a
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN ipd_wards w ON w.id = a.ward_id
  LEFT JOIN ipd_beds b ON b.id = a.bed_id
  LEFT JOIN LATERAL (
    SELECT mews_score, mews_alert_level, mews_components,
           recorded_at, pulse, blood_pressure, spo2, temperature
    FROM ipd_nursing_vitals
    WHERE admission_id = a.id
    ORDER BY recorded_at DESC LIMIT 1
  ) v ON true
  WHERE a.status = 'admitted'
    AND (p_hospital_id IS NULL OR a.hospital_id = p_hospital_id)
  ORDER BY
    CASE v.mews_alert_level WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END,
    w.name, b.bed_number;
$$;

NOTIFY pgrst, 'reload schema';
