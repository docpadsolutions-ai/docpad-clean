-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408081102.

DROP VIEW IF EXISTS public.insurance_corporate_panels;

CREATE OR REPLACE VIEW public.insurance_corporate_panels AS
SELECT 
  cp.id,
  cp.name as corporate_name,
  cp.type,
  cp.status,
  cp.discount_percent,
  cp.credit_limit,
  cp.credit_period_days,
  cp.requires_preauth,
  cp.preauth_mandatory_above_amount,
  CONCAT('AGR-', LPAD(cp.id::text, 8, '0')) as agreement_reference,
  COALESCE(
    (SELECT SUM(ic.claimed_amount) 
     FROM insurance_claims ic 
     JOIN patient_insurance_coverage pic ON pic.id = ic.coverage_id
     WHERE pic.corporate_panel_id = cp.id), 
    0
  )::numeric as utilized_amount,
  ic.name as insurance_company_name,
  ic.code as insurance_company_code,
  ic.contact_email as insurance_email,
  ic.contact_phone as insurance_phone,
  t.name as tpa_name,
  t.code as tpa_code,
  t.contact_email as tpa_email,
  t.api_endpoint as tpa_api_endpoint,
  cp.agreement_start_date,
  cp.agreement_end_date,
  cp.hospital_id,
  cp.created_at
FROM corporate_panels cp
LEFT JOIN insurance_companies ic ON ic.id = cp.insurance_company_id
LEFT JOIN tpas t ON t.id = cp.tpa_id
WHERE cp.hospital_id::text = auth.jwt() ->> 'hospital_id';

GRANT SELECT ON public.insurance_corporate_panels TO authenticated;
