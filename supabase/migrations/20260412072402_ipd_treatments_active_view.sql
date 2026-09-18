-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412072402.

-- Active treatments summary view per admission
-- Shows current medications/orders with last administration time
CREATE OR REPLACE VIEW ipd_treatments_summary AS
WITH last_nar AS (
  SELECT DISTINCT ON (treatment_id)
    treatment_id,
    administered_at,
    status        AS nar_status,
    dose_given,
    route_given,
    administered_by
  FROM ipd_nar_records
  ORDER BY treatment_id, administered_at DESC NULLS LAST
),
due_next AS (
  SELECT DISTINCT ON (treatment_id)
    treatment_id,
    scheduled_at  AS next_due_at,
    status        AS due_status
  FROM ipd_nar_records
  WHERE status = 'scheduled'
    AND scheduled_at >= NOW()
  ORDER BY treatment_id, scheduled_at ASC
)
SELECT
  t.id                          AS treatment_id,
  t.admission_id,
  t.patient_id,
  t.hospital_id,
  t.progress_note_id,
  t.treatment_kind,
  t.name,
  t.description,
  t.dose,
  t.route,
  t.frequency,
  t.duration_days,
  t.status,
  t.ordered_date,
  t.start_date,
  t.end_date,
  t.treatment_date,
  t.ordering_practitioner_id,
  pr.full_name                  AS ordered_by_name,
  -- Last administration
  ln.administered_at            AS last_given_at,
  ln.nar_status                 AS last_nar_status,
  ln.dose_given                 AS last_dose_given,
  ln.route_given                AS last_route_given,
  -- Next due
  dn.next_due_at,
  -- Days remaining
  CASE
    WHEN t.end_date IS NOT NULL THEN (t.end_date - CURRENT_DATE)
    WHEN t.duration_days IS NOT NULL AND t.start_date IS NOT NULL
      THEN (t.start_date + t.duration_days - CURRENT_DATE)
    ELSE NULL
  END                           AS days_remaining,
  -- Overdue flag: active medication with no admin in last 12 hours
  CASE
    WHEN t.status IN ('active', 'ordered')
      AND t.treatment_kind = 'medical'
      AND (ln.administered_at IS NULL OR ln.administered_at < NOW() - INTERVAL '12 hours')
    THEN true
    ELSE false
  END                           AS is_overdue,
  t.created_at,
  t.updated_at
FROM ipd_treatments t
LEFT JOIN practitioners pr ON t.ordering_practitioner_id = pr.id
LEFT JOIN last_nar ln ON t.id = ln.treatment_id
LEFT JOIN due_next dn ON t.id = dn.treatment_id;

GRANT SELECT ON ipd_treatments_summary TO authenticated;
