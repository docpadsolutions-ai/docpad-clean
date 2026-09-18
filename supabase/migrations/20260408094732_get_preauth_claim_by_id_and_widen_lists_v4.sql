-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408094732.

-- Get preauth by ID
CREATE OR REPLACE FUNCTION public.get_preauth_by_id(p_id UUID)
RETURNS TABLE (
  id UUID,
  hospital_id UUID,
  patient_id UUID,
  encounter_id UUID,
  coverage_id UUID,
  request_number TEXT,
  request_date TIMESTAMPTZ,
  estimated_amount NUMERIC,
  requested_procedures JSONB,
  clinical_summary TEXT,
  diagnosis_codes JSONB,
  supporting_documents JSONB,
  status TEXT,
  approved_amount NUMERIC,
  rejection_reason TEXT,
  tpa_reference_number TEXT,
  insurance_reference_number TEXT,
  approved_at TIMESTAMPTZ,
  valid_until DATE,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  fhir_claim_json JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id,
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    request_number,
    request_date,
    estimated_amount,
    requested_procedures,
    clinical_summary,
    diagnosis_codes,
    supporting_documents,
    status,
    approved_amount,
    rejection_reason,
    tpa_reference_number,
    insurance_reference_number,
    approved_at,
    valid_until,
    submitted_by,
    submitted_at,
    fhir_claim_json,
    created_at,
    updated_at
  FROM preauth_requests
  WHERE preauth_requests.id = p_id;
$$;

-- Get claim by ID
CREATE OR REPLACE FUNCTION public.get_claim_by_id(p_id UUID)
RETURNS TABLE (
  id UUID,
  hospital_id UUID,
  patient_id UUID,
  encounter_id UUID,
  coverage_id UUID,
  preauth_id UUID,
  claim_number TEXT,
  claim_type TEXT,
  claim_date TIMESTAMPTZ,
  invoice_id UUID,
  total_billed_amount NUMERIC,
  claimed_amount NUMERIC,
  approved_amount NUMERIC,
  settled_amount NUMERIC,
  deductions NUMERIC,
  deduction_reason TEXT,
  status TEXT,
  tpa_reference_number TEXT,
  insurance_reference_number TEXT,
  query_remarks TEXT,
  rejection_reason TEXT,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  fhir_claim_response_json JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id,
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    preauth_id,
    claim_number,
    claim_type,
    claim_date,
    invoice_id,
    total_billed_amount,
    claimed_amount,
    approved_amount,
    settled_amount,
    deductions,
    deduction_reason,
    status,
    tpa_reference_number,
    insurance_reference_number,
    query_remarks,
    rejection_reason,
    submitted_by,
    submitted_at,
    settled_at,
    fhir_claim_response_json,
    created_at,
    updated_at
  FROM insurance_claims
  WHERE insurance_claims.id = p_id;
$$;

-- List preauth requests (includes drafts)
CREATE OR REPLACE FUNCTION public.list_preauth_requests(p_patient_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  hospital_id UUID,
  patient_id UUID,
  encounter_id UUID,
  coverage_id UUID,
  request_number TEXT,
  request_date TIMESTAMPTZ,
  estimated_amount NUMERIC,
  status TEXT,
  approved_amount NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id,
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    request_number,
    request_date,
    estimated_amount,
    status,
    approved_amount,
    created_at,
    updated_at
  FROM preauth_requests
  WHERE (p_patient_id IS NULL OR preauth_requests.patient_id = p_patient_id)
  ORDER BY created_at DESC;
$$;

-- List claims (includes drafts)
CREATE OR REPLACE FUNCTION public.list_claims(p_patient_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  hospital_id UUID,
  patient_id UUID,
  encounter_id UUID,
  coverage_id UUID,
  preauth_id UUID,
  claim_number TEXT,
  claim_date TIMESTAMPTZ,
  total_billed_amount NUMERIC,
  claimed_amount NUMERIC,
  approved_amount NUMERIC,
  settled_amount NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id,
    hospital_id,
    patient_id,
    encounter_id,
    coverage_id,
    preauth_id,
    claim_number,
    claim_date,
    total_billed_amount,
    claimed_amount,
    approved_amount,
    settled_amount,
    status,
    created_at,
    updated_at
  FROM insurance_claims
  WHERE (p_patient_id IS NULL OR insurance_claims.patient_id = p_patient_id)
  ORDER BY created_at DESC;
$$;
