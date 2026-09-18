-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408074209.

-- Insurance Companies
CREATE TABLE insurance_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  contact_email text,
  contact_phone text,
  claim_submission_email text,
  claim_submission_portal_url text,
  avg_approval_time_hours int DEFAULT 48,
  is_active boolean DEFAULT true,
  fhir_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- TPAs (Third Party Administrators)
CREATE TABLE tpas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  contact_email text,
  contact_phone text,
  api_endpoint text,
  api_auth_type text CHECK (api_auth_type IN ('basic', 'bearer', 'oauth2', 'none')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Corporate/Panel Agreements
CREATE TABLE corporate_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  name text NOT NULL, -- "ICICI Lombard Panel", "Star Health Corporate"
  type text CHECK (type IN ('insurance', 'corporate', 'government')),
  insurance_company_id uuid REFERENCES insurance_companies(id),
  tpa_id uuid REFERENCES tpas(id),
  agreement_start_date date,
  agreement_end_date date,
  discount_percent numeric(5,2) DEFAULT 0,
  credit_limit numeric(12,2),
  credit_period_days int DEFAULT 30,
  requires_preauth boolean DEFAULT true,
  preauth_mandatory_above_amount numeric(10,2),
  status text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired')),
  created_at timestamptz DEFAULT now()
);

-- Patient Insurance Coverage
CREATE TABLE patient_insurance_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) NOT NULL,
  corporate_panel_id uuid REFERENCES corporate_panels(id),
  policy_number text NOT NULL,
  member_id text,
  insurance_company_id uuid REFERENCES insurance_companies(id),
  tpa_id uuid REFERENCES tpas(id),
  policy_holder_name text,
  relation_to_patient text CHECK (relation_to_patient IN ('self', 'spouse', 'child', 'parent', 'other')),
  coverage_start_date date,
  coverage_end_date date,
  sum_insured numeric(12,2),
  balance_sum_insured numeric(12,2),
  policy_document_url text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'expired', 'suspended')),
  fhir_coverage_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Preauthorization Requests
CREATE TABLE preauth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_id uuid REFERENCES opd_encounters(id),
  coverage_id uuid REFERENCES patient_insurance_coverage(id) NOT NULL,
  request_number text UNIQUE,
  request_date timestamptz DEFAULT now(),
  estimated_amount numeric(10,2) NOT NULL,
  requested_procedures jsonb, -- [{code, display, snomed_code}]
  clinical_summary text,
  diagnosis_codes jsonb, -- SNOMED/ICD-10
  supporting_documents jsonb, -- [{name, url, type}]
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'pending', 'approved', 'rejected', 'partial_approved', 'cancelled')),
  approved_amount numeric(10,2),
  rejection_reason text,
  tpa_reference_number text,
  insurance_reference_number text,
  approved_at timestamptz,
  valid_until date,
  submitted_by uuid REFERENCES practitioners(id),
  submitted_at timestamptz,
  fhir_claim_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Claims
CREATE TABLE insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_id uuid REFERENCES opd_encounters(id),
  coverage_id uuid REFERENCES patient_insurance_coverage(id) NOT NULL,
  preauth_id uuid REFERENCES preauth_requests(id),
  claim_number text UNIQUE,
  claim_type text CHECK (claim_type IN ('cashless', 'reimbursement')),
  claim_date timestamptz DEFAULT now(),
  invoice_id uuid REFERENCES invoices(id),
  total_billed_amount numeric(10,2) NOT NULL,
  claimed_amount numeric(10,2) NOT NULL,
  approved_amount numeric(10,2),
  settled_amount numeric(10,2),
  deductions numeric(10,2) DEFAULT 0,
  deduction_reason text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'query_raised', 'approved', 'partial_approved', 'rejected', 'settled')),
  tpa_reference_number text,
  insurance_reference_number text,
  query_remarks text,
  rejection_reason text,
  submitted_by uuid REFERENCES practitioners(id),
  submitted_at timestamptz,
  settled_at timestamptz,
  fhir_claim_response_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE insurance_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpas ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_insurance_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE preauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

-- Policies (hospital-scoped)
CREATE POLICY "insurance_companies_public" ON insurance_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "tpas_public" ON tpas FOR SELECT TO authenticated USING (true);

CREATE POLICY "corporate_panels_hospital_scoped" ON corporate_panels FOR ALL TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

CREATE POLICY "patient_coverage_hospital_scoped" ON patient_insurance_coverage FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1)));

CREATE POLICY "preauth_hospital_scoped" ON preauth_requests FOR ALL TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

CREATE POLICY "claims_hospital_scoped" ON insurance_claims FOR ALL TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

-- Indexes
CREATE INDEX idx_coverage_patient ON patient_insurance_coverage(patient_id);
CREATE INDEX idx_preauth_encounter ON preauth_requests(encounter_id);
CREATE INDEX idx_preauth_status ON preauth_requests(status) WHERE status != 'cancelled';
CREATE INDEX idx_claims_encounter ON insurance_claims(encounter_id);
CREATE INDEX idx_claims_status ON insurance_claims(status);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON insurance_companies, tpas, corporate_panels, patient_insurance_coverage, preauth_requests, insurance_claims TO authenticated, service_role;
