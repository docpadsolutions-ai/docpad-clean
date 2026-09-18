-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412040208.

-- IPD Clinical Command Centre view
-- Returns active admissions for the currently logged-in doctor only
-- Joins patient, ward/bed, latest progress note vitals, pending investigation count

CREATE OR REPLACE VIEW ipd_doctor_admissions_summary AS
WITH latest_note AS (
  SELECT DISTINCT ON (admission_id)
    admission_id,
    id            AS progress_note_id,
    note_date,
    hospital_day_number,
    post_op_day,
    condition_status,
    pain_score,
    heart_rate,
    bp_systolic,
    bp_diastolic,
    spo2,
    temperature_c,
    respiratory_rate,
    wound_status,
    drain_status,
    subjective_text,
    assessment_text,
    plan_narrative,
    updated_at    AS note_updated_at
  FROM ipd_progress_notes
  ORDER BY admission_id, note_date DESC, created_at DESC
),
pending_investigations AS (
  SELECT admission_id, COUNT(*) AS pending_inv_count
  FROM ipd_investigation_orders
  WHERE status IN ('ordered', 'pending', 'sample_collected')
  GROUP BY admission_id
),
pending_treatments AS (
  SELECT admission_id, COUNT(*) AS pending_tx_count
  FROM ipd_treatments
  WHERE status IN ('active', 'ordered')
  GROUP BY admission_id
),
surgery_info AS (
  SELECT
    ia.id AS admission_id,
    os.procedure_name,
    os.surgery_date,
    os.status AS surgery_status,
    os.actual_start_time,
    os.actual_end_time
  FROM ipd_admissions ia
  JOIN ot_surgeries os ON ia.surgery_id = os.id
)

SELECT
  -- Admission core
  ia.id                          AS admission_id,
  ia.admission_number,
  ia.status                      AS admission_status,
  ia.admitted_at,
  ia.expected_discharge_date,
  ia.primary_diagnosis_display,
  ia.primary_diagnosis_icd10,
  ia.specialty,
  ia.admission_type,

  -- Patient
  pat.id                         AS patient_id,
  pat.full_name                  AS patient_name,
  pat.age_years,
  pat.sex,
  pat.blood_group,
  pat.phone                      AS patient_phone,
  pat.docpad_id,
  pat.known_allergies,

  -- Bed / Ward
  w.name                         AS ward_name,
  b.bed_number,
  b.bed_type,

  -- Doctor
  pr.id                          AS doctor_id,
  pr.full_name                   AS doctor_name,
  pr.user_id                     AS doctor_user_id,

  -- Hospital day calculation
  GREATEST(
    DATE_PART('day', NOW() - ia.admitted_at)::int + 1,
    1
  )                              AS computed_hospital_day,

  -- Latest progress note snapshot
  ln.progress_note_id,
  ln.note_date,
  ln.hospital_day_number,
  ln.post_op_day,
  ln.condition_status,
  ln.pain_score,
  ln.heart_rate,
  ln.bp_systolic,
  ln.bp_diastolic,
  ln.spo2,
  ln.temperature_c,
  ln.respiratory_rate,
  ln.wound_status,
  ln.drain_status,
  ln.subjective_text,
  ln.assessment_text,
  ln.plan_narrative,
  ln.note_updated_at,

  -- Pending counts
  COALESCE(pi.pending_inv_count, 0)  AS pending_investigations,
  COALESCE(pt.pending_tx_count, 0)   AS pending_treatments,

  -- Surgery
  si.procedure_name              AS surgery_procedure,
  si.surgery_date,
  si.surgery_status,
  si.actual_start_time           AS surgery_start,
  si.actual_end_time             AS surgery_end,

  -- Hospital
  ia.hospital_id

FROM ipd_admissions ia
JOIN patients     pat ON ia.patient_id          = pat.id
JOIN practitioners pr  ON ia.admitting_doctor_id = pr.id
LEFT JOIN ipd_wards   w  ON ia.ward_id           = w.id
LEFT JOIN ipd_beds    b  ON ia.bed_id            = b.id
LEFT JOIN latest_note ln ON ia.id               = ln.admission_id
LEFT JOIN pending_investigations pi ON ia.id   = pi.admission_id
LEFT JOIN pending_treatments     pt ON ia.id   = pt.admission_id
LEFT JOIN surgery_info           si ON ia.id   = si.admission_id

WHERE
  ia.status IN ('in-progress', 'admitted')
  -- Doctor filter: matches the logged-in user via practitioners.user_id
  AND pr.user_id = auth.uid();

-- Grant SELECT to authenticated users (RLS on underlying tables still applies)
GRANT SELECT ON ipd_doctor_admissions_summary TO authenticated;
