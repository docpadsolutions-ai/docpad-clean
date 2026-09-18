-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408080859.

-- Create view for insurance_corporate_panels
-- This provides a unified view of corporate panels with insurance details

CREATE OR REPLACE VIEW public.insurance_corporate_panels AS
SELECT 
  cp.id,
  cp.name as panel_name,
  cp.type,
  cp.status,
  cp.discount_percent,
  cp.credit_limit,
  cp.credit_period_days,
  cp.requires_preauth,
  cp.preauth_mandatory_above_amount,
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
  cp.created_at
FROM corporate_panels cp
LEFT JOIN insurance_companies ic ON ic.id = cp.insurance_company_id
LEFT JOIN tpas t ON t.id = cp.tpa_id
WHERE cp.hospital_id::text = auth.jwt() ->> 'hospital_id';

GRANT SELECT ON public.insurance_corporate_panels TO authenticated;
