-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260420170219.

-- ================================================================
-- Helper: returns the hospital_id for the current auth user.
-- SECURITY DEFINER bypasses RLS on practitioners to avoid the
-- circular-reference that would occur if practitioners' own RLS
-- policy tried to query practitioners through normal RLS.
-- The OR id = auth.uid() branch handles legacy rows where
-- practitioners.id was set to the user's auth UUID.
-- ================================================================
CREATE OR REPLACE FUNCTION auth_hospital_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hospital_id
  FROM practitioners
  WHERE user_id = auth.uid()
     OR id       = auth.uid()
  LIMIT 1;
$$;

-- ================================================================
-- 1. opd_prescriptions
--    No hospital_id column; scope via encounter → opd_encounters.
--    Frontend reads: .in("encounter_id", ids)  (usePatientSummary.ts)
--    No client-side INSERT found; guard it anyway for defence.
-- ================================================================
ALTER TABLE opd_prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opd_prescriptions_select_hospital"
ON opd_prescriptions FOR SELECT TO authenticated
USING (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "opd_prescriptions_insert_hospital"
ON opd_prescriptions FOR INSERT TO authenticated
WITH CHECK (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "opd_prescriptions_update_hospital"
ON opd_prescriptions FOR UPDATE TO authenticated
USING (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
)
WITH CHECK (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

-- ================================================================
-- 2. practitioners
--    hospital_id = auth_hospital_id() uses the SECURITY DEFINER
--    function so the subquery does NOT recurse through this policy.
--    UPDATE restricted to own row only (admin edits own profile).
-- ================================================================
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "practitioners_select_hospital"
ON practitioners FOR SELECT TO authenticated
USING (
  hospital_id = auth_hospital_id()
);

CREATE POLICY "practitioners_update_own"
ON practitioners FOR UPDATE TO authenticated
USING    (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ================================================================
-- 3. hospitals
--    id IS the hospital — scope to the one hospital the user belongs to.
--    Frontend: .eq("id", hid) to fetch name/address for invoices etc.
-- ================================================================
ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospitals_select_own"
ON hospitals FOR SELECT TO authenticated
USING (
  id = auth_hospital_id()
);

-- ================================================================
-- 4. patient_abha
--    No hospital_id column; scope via patients.hospital_id.
-- ================================================================
ALTER TABLE patient_abha ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_abha_select_hospital"
ON patient_abha FOR SELECT TO authenticated
USING (
  patient_id IN (
    SELECT id FROM patients WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "patient_abha_insert_hospital"
ON patient_abha FOR INSERT TO authenticated
WITH CHECK (
  patient_id IN (
    SELECT id FROM patients WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "patient_abha_update_hospital"
ON patient_abha FOR UPDATE TO authenticated
USING (
  patient_id IN (
    SELECT id FROM patients WHERE hospital_id = auth_hospital_id()
  )
)
WITH CHECK (
  patient_id IN (
    SELECT id FROM patients WHERE hospital_id = auth_hospital_id()
  )
);

-- ================================================================
-- 5. transcriptions
--    VoiceDictationButton inserts with encounter_id always set.
--    Scope via opd_encounters.hospital_id.
-- ================================================================
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transcriptions_select_hospital"
ON transcriptions FOR SELECT TO authenticated
USING (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "transcriptions_insert_hospital"
ON transcriptions FOR INSERT TO authenticated
WITH CHECK (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

-- ================================================================
-- 6. voice_sessions
-- ================================================================
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_sessions_select_hospital"
ON voice_sessions FOR SELECT TO authenticated
USING (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "voice_sessions_insert_hospital"
ON voice_sessions FOR INSERT TO authenticated
WITH CHECK (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

-- ================================================================
-- 7. clinical_extractions
--    VoiceDictationButton inserts with encounter_id always set.
-- ================================================================
ALTER TABLE clinical_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinical_extractions_select_hospital"
ON clinical_extractions FOR SELECT TO authenticated
USING (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);

CREATE POLICY "clinical_extractions_insert_hospital"
ON clinical_extractions FOR INSERT TO authenticated
WITH CHECK (
  encounter_id IN (
    SELECT id FROM opd_encounters WHERE hospital_id = auth_hospital_id()
  )
);
