-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205409.

-- ============================================================
-- Batch 5: IPD secondary tables (nursing, consults, transfers)
-- ============================================================

-- ipd_mar
DROP POLICY IF EXISTS "ipd_mar_hospital_access" ON public.ipd_mar;
DROP POLICY IF EXISTS "ipd_mar_select" ON public.ipd_mar;
DROP POLICY IF EXISTS "ipd_mar_insert" ON public.ipd_mar;
DROP POLICY IF EXISTS "ipd_mar_update" ON public.ipd_mar;

CREATE POLICY "mar_access" ON public.ipd_mar FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_consult_requests
DROP POLICY IF EXISTS "ipd_consults_select" ON public.ipd_consult_requests;
DROP POLICY IF EXISTS "ipd_consults_insert" ON public.ipd_consult_requests;
DROP POLICY IF EXISTS "ipd_consults_update" ON public.ipd_consult_requests;
DROP POLICY IF EXISTS "ipd_consults_delete" ON public.ipd_consult_requests;

CREATE POLICY "consults_access" ON public.ipd_consult_requests FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_bed_transfers
DROP POLICY IF EXISTS "ipd_bt_select" ON public.ipd_bed_transfers;
DROP POLICY IF EXISTS "ipd_bt_insert" ON public.ipd_bed_transfers;
DROP POLICY IF EXISTS "ipd_bt_update" ON public.ipd_bed_transfers;
DROP POLICY IF EXISTS "ipd_bt_delete" ON public.ipd_bed_transfers;

CREATE POLICY "bt_access" ON public.ipd_bed_transfers FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_nar_records
DROP POLICY IF EXISTS "ipd_nar_select" ON public.ipd_nar_records;
DROP POLICY IF EXISTS "ipd_nar_insert" ON public.ipd_nar_records;
DROP POLICY IF EXISTS "ipd_nar_update" ON public.ipd_nar_records;
DROP POLICY IF EXISTS "ipd_nar_delete" ON public.ipd_nar_records;

CREATE POLICY "nar_access" ON public.ipd_nar_records FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_nabh_checklist
DROP POLICY IF EXISTS "ipd_nabh_select" ON public.ipd_nabh_checklist;
DROP POLICY IF EXISTS "ipd_nabh_insert" ON public.ipd_nabh_checklist;
DROP POLICY IF EXISTS "ipd_nabh_update" ON public.ipd_nabh_checklist;
DROP POLICY IF EXISTS "ipd_nabh_delete" ON public.ipd_nabh_checklist;

CREATE POLICY "nabh_access" ON public.ipd_nabh_checklist FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_condition_timeline
DROP POLICY IF EXISTS "ipd_cond_tl_select" ON public.ipd_condition_timeline;
DROP POLICY IF EXISTS "ipd_cond_tl_insert" ON public.ipd_condition_timeline;
DROP POLICY IF EXISTS "ipd_cond_tl_update" ON public.ipd_condition_timeline;
DROP POLICY IF EXISTS "ipd_cond_tl_delete" ON public.ipd_condition_timeline;

CREATE POLICY "cond_tl_access" ON public.ipd_condition_timeline FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_io_records
DROP POLICY IF EXISTS "ipd_io_select" ON public.ipd_io_records;
DROP POLICY IF EXISTS "ipd_io_insert" ON public.ipd_io_records;
DROP POLICY IF EXISTS "ipd_io_update" ON public.ipd_io_records;
DROP POLICY IF EXISTS "ipd_io_delete" ON public.ipd_io_records;

CREATE POLICY "io_access" ON public.ipd_io_records FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_wound_assessments
DROP POLICY IF EXISTS "ipd_wound_select" ON public.ipd_wound_assessments;
DROP POLICY IF EXISTS "ipd_wound_insert" ON public.ipd_wound_assessments;
DROP POLICY IF EXISTS "ipd_wound_update" ON public.ipd_wound_assessments;
DROP POLICY IF EXISTS "ipd_wound_delete" ON public.ipd_wound_assessments;
DROP POLICY IF EXISTS "wound_hospital_access" ON public.ipd_wound_assessments;

CREATE POLICY "wound_access" ON public.ipd_wound_assessments FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_wound_photos
DROP POLICY IF EXISTS "wound_photos_hospital_access" ON public.ipd_wound_photos;
CREATE POLICY "wound_photos_access" ON public.ipd_wound_photos FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_drain_records
DROP POLICY IF EXISTS "drain_records_hospital_access" ON public.ipd_drain_records;
CREATE POLICY "drain_access" ON public.ipd_drain_records FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_shift_handovers
DROP POLICY IF EXISTS "handover_hospital_access" ON public.ipd_shift_handovers;
CREATE POLICY "handover_access" ON public.ipd_shift_handovers FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_investigation_orders
DROP POLICY IF EXISTS "ipd_inv_ord_select" ON public.ipd_investigation_orders;
DROP POLICY IF EXISTS "ipd_inv_ord_insert" ON public.ipd_investigation_orders;
DROP POLICY IF EXISTS "ipd_inv_ord_update" ON public.ipd_investigation_orders;
DROP POLICY IF EXISTS "ipd_inv_ord_delete" ON public.ipd_investigation_orders;

CREATE POLICY "ipd_inv_ord_access" ON public.ipd_investigation_orders FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_doctor_orders
DROP POLICY IF EXISTS "ipd_doctor_orders_select" ON public.ipd_doctor_orders;
DROP POLICY IF EXISTS "ipd_doctor_orders_insert" ON public.ipd_doctor_orders;
DROP POLICY IF EXISTS "ipd_doctor_orders_update" ON public.ipd_doctor_orders;

CREATE POLICY "doctor_orders_access" ON public.ipd_doctor_orders FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_nursing_care_plans
DROP POLICY IF EXISTS "ipd_ncp_select" ON public.ipd_nursing_care_plans;
DROP POLICY IF EXISTS "ipd_ncp_insert" ON public.ipd_nursing_care_plans;
DROP POLICY IF EXISTS "ipd_ncp_update" ON public.ipd_nursing_care_plans;

CREATE POLICY "ncp_access" ON public.ipd_nursing_care_plans FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_nursing_vitals
DROP POLICY IF EXISTS "hospital_staff_vitals_select" ON public.ipd_nursing_vitals;
DROP POLICY IF EXISTS "hospital_staff_vitals_insert" ON public.ipd_nursing_vitals;
DROP POLICY IF EXISTS "hospital_staff_vitals_update" ON public.ipd_nursing_vitals;

CREATE POLICY "nursing_vitals_access" ON public.ipd_nursing_vitals FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ipd_consents
DROP POLICY IF EXISTS "ipd_consents_select" ON public.ipd_consents;
DROP POLICY IF EXISTS "ipd_consents_insert" ON public.ipd_consents;
DROP POLICY IF EXISTS "ipd_consents_update" ON public.ipd_consents;

CREATE POLICY "ipd_consents_access" ON public.ipd_consents FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- clinical_attachments
DROP POLICY IF EXISTS "hospital_staff_attachments_select" ON public.clinical_attachments;
DROP POLICY IF EXISTS "hospital_staff_attachments_insert" ON public.clinical_attachments;
DROP POLICY IF EXISTS "hospital_staff_attachments_update" ON public.clinical_attachments;

CREATE POLICY "attachments_access" ON public.clinical_attachments FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());
