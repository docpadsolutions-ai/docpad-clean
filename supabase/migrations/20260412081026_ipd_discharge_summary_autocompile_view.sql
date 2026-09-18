-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412081026.

-- Smart discharge summary compilation view
-- Pulls all relevant data from the admission to pre-fill the discharge form
CREATE OR REPLACE VIEW ipd_discharge_autocompile AS
WITH progress_notes_ordered AS (
  SELECT 
    pn.*,
    ROW_NUMBER() OVER (PARTITION BY pn.admission_id ORDER BY pn.note_date ASC) as day_rank
  FROM ipd_progress_notes pn
  WHERE pn.status IN ('signed', 'draft')
),
hospital_course AS (
  -- Build day-by-day hospital course from signed/draft progress notes
  SELECT 
    admission_id,
    STRING_AGG(
      'Day ' || hospital_day_number || ' (' || TO_CHAR(note_date, 'DD Mon') || '): ' ||
      COALESCE(
        NULLIF(TRIM(
          COALESCE('Condition: ' || condition_status || '. ', '') ||
          COALESCE('S: ' || subjective_text || ' ', '') ||
          COALESCE('A: ' || assessment_text || ' ', '') ||
          COALESCE(plan_narrative, '')
        ), ''),
        'No note content recorded.'
      ),
      E'\n'
      ORDER BY note_date ASC
    ) as compiled_course,
    MAX(condition_status) FILTER (WHERE note_date = (SELECT MAX(note_date) FROM ipd_progress_notes pn2 WHERE pn2.admission_id = progress_notes_ordered.admission_id)) as last_condition,
    MAX(pain_score) FILTER (WHERE note_date = (SELECT MAX(note_date) FROM ipd_progress_notes pn2 WHERE pn2.admission_id = progress_notes_ordered.admission_id)) as last_pain_score
  FROM progress_notes_ordered
  GROUP BY admission_id
),
active_treatments AS (
  -- Active medications to become discharge medications
  SELECT 
    admission_id,
    JSON_AGG(
      JSON_BUILD_OBJECT(
        'name', name,
        'dose', dose,
        'route', route,
        'frequency', frequency,
        'duration_days', duration_days,
        'treatment_kind', treatment_kind
      ) ORDER BY created_at ASC
    ) FILTER (WHERE status IN ('active', 'ordered')) as discharge_meds
  FROM ipd_treatments
  GROUP BY admission_id
),
investigations_summary AS (
  SELECT
    admission_id,
    COUNT(*) FILTER (WHERE status = 'resulted') as resulted_count,
    COUNT(*) FILTER (WHERE is_critical = true) as critical_count,
    STRING_AGG(
      test_name || COALESCE(': ' || result_text, ''),
      ', '
      ORDER BY ordered_date ASC
    ) FILTER (WHERE status = 'resulted') as results_text
  FROM ipd_investigation_orders
  GROUP BY admission_id
)
SELECT
  ia.id                           AS admission_id,
  ia.hospital_id,
  ia.patient_id,
  ia.admission_number,
  ia.admitted_at,
  ia.expected_discharge_date,
  ia.primary_diagnosis_display,
  ia.primary_diagnosis_icd10,
  ia.primary_diagnosis_snomed,
  ia.specialty,
  ia.admission_type,

  -- Patient info
  pat.full_name                   AS patient_name,
  pat.age_years,
  pat.sex,
  pat.blood_group,
  pat.docpad_id,
  pat.known_allergies,

  -- Bed / Ward
  w.name                          AS ward_name,
  b.bed_number,

  -- Doctor
  pr.full_name                    AS doctor_name,

  -- Hospital course (auto-compiled from daily notes)
  COALESCE(hc.compiled_course, 'No progress notes recorded.') AS compiled_hospital_course,
  hc.last_condition,
  hc.last_pain_score,

  -- Discharge medications (from active treatments)
  COALESCE(at.discharge_meds, '[]'::json) AS suggested_discharge_medications,

  -- Investigations
  COALESCE(inv.resulted_count, 0)  AS investigations_resulted,
  COALESCE(inv.critical_count, 0)  AS critical_investigations,
  inv.results_text                 AS investigations_summary,

  -- Surgery info
  os.procedure_name               AS surgery_procedure,
  os.surgery_date,
  os.laterality                   AS surgery_laterality,
  os.implants_used,
  os.complications                AS surgery_complications,

  -- Consults
  (SELECT STRING_AGG(DISTINCT dep.name, ', ')
   FROM ipd_consult_requests cr
   JOIN departments dep ON cr.consulting_department_id = dep.id
   WHERE cr.admission_id = ia.id) AS consultants_involved,

  -- Length of stay
  EXTRACT(DAY FROM (NOW() - ia.admitted_at))::int AS los_days,

  -- Existing discharge summary if any
  ds.id                           AS discharge_summary_id,
  ds.status                       AS ds_status,
  ds.discharge_type,
  ds.discharge_condition,
  ds.final_diagnosis_display,
  ds.hospital_course_summary      AS saved_course,
  ds.discharge_medications        AS saved_medications,
  ds.discharge_instructions,
  ds.follow_up_date,
  ds.diet_advice,
  ds.activity_restrictions,
  ds.wound_care_instructions,
  ds.implant_details,
  ds.post_op_protocol,
  ds.physiotherapy_plan,
  ds.signed_at

FROM ipd_admissions ia
JOIN patients     pat ON ia.patient_id            = pat.id
JOIN practitioners pr  ON ia.admitting_doctor_id   = pr.id
LEFT JOIN ipd_wards   w   ON ia.ward_id             = w.id
LEFT JOIN ipd_beds    b   ON ia.bed_id              = b.id
LEFT JOIN hospital_course   hc  ON ia.id           = hc.admission_id
LEFT JOIN active_treatments at  ON ia.id           = at.admission_id
LEFT JOIN investigations_summary inv ON ia.id      = inv.admission_id
LEFT JOIN ot_surgeries os ON ia.surgery_id         = os.id
LEFT JOIN ipd_discharge_summaries ds ON ia.id      = ds.admission_id;

GRANT SELECT ON ipd_discharge_autocompile TO authenticated;
