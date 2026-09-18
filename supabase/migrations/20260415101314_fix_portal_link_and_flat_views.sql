-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415101314.

-- Error 1: portal_link column alias
ALTER TABLE hospital_insurance_config 
  ADD COLUMN IF NOT EXISTS portal_link text;

-- Update portal_link from portal_url where set
UPDATE hospital_insurance_config SET portal_link = portal_url WHERE portal_url IS NOT NULL;

-- Error 2: ambiguous insurance_preauths <-> patients join
-- Flat view resolves both paths — frontend queries this instead
CREATE OR REPLACE VIEW insurance_preauths_view AS
SELECT 
  ip.id,
  ip.hospital_id,
  ip.patient_id,
  ip.encounter_id,
  ip.coverage_id,
  ip.request_number,
  ip.request_date,
  ip.estimated_amount,
  ip.requested_procedures,
  ip.clinical_summary,
  ip.diagnosis_codes,
  ip.supporting_documents,
  ip.status,
  ip.approved_amount,
  ip.rejection_reason,
  ip.tpa_reference_number,
  ip.insurance_reference_number,
  ip.approved_at,
  ip.valid_until,
  ip.submitted_by,
  ip.submitted_at,
  ip.fhir_claim_json,
  ip.created_at,
  ip.updated_at,
  p.full_name AS patient_name,
  p.docpad_id AS patient_docpad_id,
  p.phone AS patient_phone,
  pic.policy_number,
  pic.insurance_company_id,
  pic.tpa_id,
  pic.sum_insured,
  pic.balance_sum_insured,
  ic.name AS insurer_name,
  t.name AS tpa_name,
  oe.encounter_date,
  oe.diagnosis_term,
  oe.diagnosis_icd10
FROM insurance_preauths ip
LEFT JOIN patients p ON p.id = ip.patient_id
LEFT JOIN patient_insurance_coverage pic ON pic.id = ip.coverage_id
LEFT JOIN insurance_companies ic ON ic.id = pic.insurance_company_id
LEFT JOIN tpas t ON t.id = pic.tpa_id
LEFT JOIN opd_encounters oe ON oe.id = ip.encounter_id;

CREATE OR REPLACE VIEW insurance_claims_view AS
SELECT
  icl.id,
  icl.hospital_id,
  icl.patient_id,
  icl.encounter_id,
  icl.coverage_id,
  icl.preauth_id,
  icl.claim_number,
  icl.claim_type,
  icl.claim_date,
  icl.invoice_id,
  icl.total_billed_amount,
  icl.claimed_amount,
  icl.approved_amount,
  icl.settled_amount,
  icl.deductions,
  icl.deduction_reason,
  icl.status,
  icl.tpa_reference_number,
  icl.insurance_reference_number,
  icl.query_remarks,
  icl.rejection_reason,
  icl.submitted_by,
  icl.submitted_at,
  icl.settled_at,
  icl.created_at,
  icl.updated_at,
  p.full_name AS patient_name,
  p.docpad_id AS patient_docpad_id,
  pic.policy_number,
  pic.insurance_company_id,
  pic.tpa_id,
  ins.name AS insurer_name,
  t.name AS tpa_name
FROM insurance_claims icl
LEFT JOIN patients p ON p.id = icl.patient_id
LEFT JOIN patient_insurance_coverage pic ON pic.id = icl.coverage_id
LEFT JOIN insurance_companies ins ON ins.id = pic.insurance_company_id
LEFT JOIN tpas t ON t.id = pic.tpa_id;

NOTIFY pgrst, 'reload schema';
