-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408095136.

-- Reconciliation summary function
CREATE OR REPLACE FUNCTION public.get_claim_reconciliation(p_claim_id UUID)
RETURNS TABLE (
  claim_id UUID,
  claim_number TEXT,
  patient_name TEXT,
  encounter_date TIMESTAMPTZ,
  total_billed NUMERIC,
  claimed_amount NUMERIC,
  approved_amount NUMERIC,
  settled_amount NUMERIC,
  deductions NUMERIC,
  patient_liability NUMERIC,
  status TEXT,
  tpa_reference TEXT,
  settled_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    ic.id AS claim_id,
    ic.claim_number,
    p.full_name AS patient_name,
    oe.encounter_date,
    ic.total_billed_amount AS total_billed,
    ic.claimed_amount,
    ic.approved_amount,
    ic.settled_amount,
    ic.deductions,
    (ic.total_billed_amount - COALESCE(ic.settled_amount, 0)) AS patient_liability,
    ic.status,
    ic.tpa_reference_number AS tpa_reference,
    ic.settled_at
  FROM insurance_claims ic
  JOIN patients p ON ic.patient_id = p.id
  JOIN opd_encounters oe ON ic.encounter_id = oe.id
  WHERE ic.id = p_claim_id;
$$;
