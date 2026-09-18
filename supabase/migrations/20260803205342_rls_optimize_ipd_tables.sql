-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205342.

-- ============================================================
-- Batch 4: IPD core tables
-- ============================================================

-- ipd_admissions
DROP POLICY IF EXISTS "ipd_admissions_select" ON public.ipd_admissions;
DROP POLICY IF EXISTS "ipd_admissions_insert" ON public.ipd_admissions;
DROP POLICY IF EXISTS "ipd_admissions_update" ON public.ipd_admissions;
DROP POLICY IF EXISTS "ipd_admissions_delete" ON public.ipd_admissions;

CREATE POLICY "adm_select" ON public.ipd_admissions FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "adm_insert" ON public.ipd_admissions FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "adm_update" ON public.ipd_admissions FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "adm_delete" ON public.ipd_admissions FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_wards
DROP POLICY IF EXISTS "ipd_wards_select" ON public.ipd_wards;
DROP POLICY IF EXISTS "ipd_wards_insert" ON public.ipd_wards;
DROP POLICY IF EXISTS "ipd_wards_update" ON public.ipd_wards;

CREATE POLICY "wards_select" ON public.ipd_wards FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "wards_insert" ON public.ipd_wards FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "wards_update" ON public.ipd_wards FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_beds
DROP POLICY IF EXISTS "ipd_beds_select" ON public.ipd_beds;
DROP POLICY IF EXISTS "ipd_beds_insert" ON public.ipd_beds;
DROP POLICY IF EXISTS "ipd_beds_update" ON public.ipd_beds;

CREATE POLICY "beds_select" ON public.ipd_beds FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "beds_insert" ON public.ipd_beds FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "beds_update" ON public.ipd_beds FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_progress_notes
DROP POLICY IF EXISTS "ipd_notes_select" ON public.ipd_progress_notes;
DROP POLICY IF EXISTS "ipd_notes_insert" ON public.ipd_progress_notes;
DROP POLICY IF EXISTS "ipd_notes_update" ON public.ipd_progress_notes;
DROP POLICY IF EXISTS "ipd_notes_delete" ON public.ipd_progress_notes;

CREATE POLICY "notes_select" ON public.ipd_progress_notes FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "notes_insert" ON public.ipd_progress_notes FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "notes_update" ON public.ipd_progress_notes FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "notes_delete" ON public.ipd_progress_notes FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_treatments
DROP POLICY IF EXISTS "ipd_treatments_select" ON public.ipd_treatments;
DROP POLICY IF EXISTS "ipd_treatments_insert" ON public.ipd_treatments;
DROP POLICY IF EXISTS "ipd_treatments_update" ON public.ipd_treatments;
DROP POLICY IF EXISTS "ipd_treatments_delete" ON public.ipd_treatments;

CREATE POLICY "tx_select" ON public.ipd_treatments FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "tx_insert" ON public.ipd_treatments FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "tx_update" ON public.ipd_treatments FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "tx_delete" ON public.ipd_treatments FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_vitals
DROP POLICY IF EXISTS "ipd_vitals_select" ON public.ipd_vitals;
DROP POLICY IF EXISTS "ipd_vitals_insert" ON public.ipd_vitals;
DROP POLICY IF EXISTS "ipd_vitals_update" ON public.ipd_vitals;
DROP POLICY IF EXISTS "ipd_vitals_delete" ON public.ipd_vitals;

CREATE POLICY "vitals_select" ON public.ipd_vitals FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "vitals_insert" ON public.ipd_vitals FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "vitals_update" ON public.ipd_vitals FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "vitals_delete" ON public.ipd_vitals FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_discharge_summaries
DROP POLICY IF EXISTS "ipd_ds_select" ON public.ipd_discharge_summaries;
DROP POLICY IF EXISTS "ipd_ds_insert" ON public.ipd_discharge_summaries;
DROP POLICY IF EXISTS "ipd_ds_update" ON public.ipd_discharge_summaries;
DROP POLICY IF EXISTS "ipd_ds_delete" ON public.ipd_discharge_summaries;

CREATE POLICY "ds_select" ON public.ipd_discharge_summaries FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ds_insert" ON public.ipd_discharge_summaries FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ds_update" ON public.ipd_discharge_summaries FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ds_delete" ON public.ipd_discharge_summaries FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_admission_consents
DROP POLICY IF EXISTS "ipd_ac_select" ON public.ipd_admission_consents;
DROP POLICY IF EXISTS "ipd_ac_insert" ON public.ipd_admission_consents;
DROP POLICY IF EXISTS "ipd_ac_update" ON public.ipd_admission_consents;
DROP POLICY IF EXISTS "ipd_ac_delete" ON public.ipd_admission_consents;

CREATE POLICY "ac_select" ON public.ipd_admission_consents FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ac_insert" ON public.ipd_admission_consents FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ac_update" ON public.ipd_admission_consents FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ac_delete" ON public.ipd_admission_consents FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_pre_admission_assessments
DROP POLICY IF EXISTS "ipd_paa_select" ON public.ipd_pre_admission_assessments;
DROP POLICY IF EXISTS "ipd_paa_insert" ON public.ipd_pre_admission_assessments;
DROP POLICY IF EXISTS "ipd_paa_update" ON public.ipd_pre_admission_assessments;
DROP POLICY IF EXISTS "ipd_paa_delete" ON public.ipd_pre_admission_assessments;

CREATE POLICY "paa_select" ON public.ipd_pre_admission_assessments FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "paa_insert" ON public.ipd_pre_admission_assessments FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "paa_update" ON public.ipd_pre_admission_assessments FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "paa_delete" ON public.ipd_pre_admission_assessments FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());
