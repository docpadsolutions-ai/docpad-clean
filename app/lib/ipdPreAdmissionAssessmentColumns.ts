/**
 * Columns on `public.ipd_pre_admission_assessments` confirmed for this app (live DB / product spec).
 * Inserts/updates MUST only use keys from this set — no `symptoms_opqrst`, `ros_json`, `vital_signs`, etc.
 *
 * **Postgres `ARRAY` / list columns** (`setting`, `risk_factors`, `current_medications`): pass native JS
 * `string[]` (use `[]` when empty), never `JSON.stringify` or comma-joined strings. **JSONB** columns
 * (`symptoms_json`, `treatments_json`, `chief_complaint_details`, `source_reliability`, …): pass plain
 * objects/arrays — not stringified JSON.
 *
 * Introspection (run once against your project):\
 * `const { data } = await supabase.from('ipd_pre_admission_assessments').select('*').limit(1)`\
 * then compare `data` keys to this list.
 */
export const IPD_PRE_ADMISSION_ASSESSMENT_COLUMNS = [
  "id",
  "hospital_id",
  "admission_id",
  "patient_id",
  "source_opd_encounter_id",
  "opd_encounter_id",
  "assessing_doctor_id",
  "practitioner_id",
  "assessed_at",
  "specialty",
  "chief_complaint",
  "chief_complaint_onset",
  "chief_complaint_duration",
  "chief_complaint_details",
  "setting",
  "source_reliability",
  "hpi_one_liner",
  "hpi_narrative",
  "symptoms_json",
  "ros_all_negative",
  "ros_positive_findings",
  "pmh_text",
  "current_medications",
  "allergies_text",
  "risk_factors",
  "heart_rate",
  "bp_systolic",
  "bp_diastolic",
  "respiratory_rate",
  "temperature_f",
  "spo2",
  "weight_kg",
  "bmi",
  "consciousness_level",
  "nutritional_status",
  "general_appearance",
  "systemic_examination",
  "local_examination",
  "primary_diagnosis_icd10",
  "primary_diagnosis_display",
  "primary_diagnosis_snomed",
  "differential_diagnosis",
  "treatment_plan_notes",
  "surgical_plan_notes",
  "assessment_plan_notes",
  "treatments_json",
  "anaesthesia_fitness",
  "pre_op_investigations",
  "pre_op_notes",
  "relevant_context",
  "status",
  "verified_by",
  "verified_at",
  "fhir_clinical_impression_id",
  "fhir_json",
  "created_at",
  "updated_at",
] as const;

export type IpdPreAdmissionAssessmentColumn = (typeof IPD_PRE_ADMISSION_ASSESSMENT_COLUMNS)[number];

/** Strip any key not in the confirmed column list (defensive for inserts/updates). */
export function pickIpdPreAdmissionAssessmentColumns(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set<string>(IPD_PRE_ADMISSION_ASSESSMENT_COLUMNS);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) out[key] = row[key];
  }
  return out;
}
