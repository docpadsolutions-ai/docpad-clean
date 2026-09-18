-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205452.

-- ============================================================
-- Batch 6: Nursing, Pharmacy, Staff, Insurance, and misc tables
-- ============================================================

-- nursing_tasks
DROP POLICY IF EXISTS "nursing_tasks_hospital_access" ON public.nursing_tasks;
DROP POLICY IF EXISTS "nursing_tasks_hospital_isolation" ON public.nursing_tasks;

CREATE POLICY "nursing_tasks_access" ON public.nursing_tasks FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- nursing_task_templates
DROP POLICY IF EXISTS "nursing_task_templates_hospital_isolation" ON public.nursing_task_templates;
CREATE POLICY "ntt_access" ON public.nursing_task_templates FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- nursing_task_categories
DROP POLICY IF EXISTS "nursing_task_categories_hospital" ON public.nursing_task_categories;
CREATE POLICY "ntc_access" ON public.nursing_task_categories FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- nursing_procedure_logs
DROP POLICY IF EXISTS "hospital_isolation_nursing_procedures" ON public.nursing_procedure_logs;
CREATE POLICY "npl_access" ON public.nursing_procedure_logs FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- consumable_usage_logs
DROP POLICY IF EXISTS "hospital_isolation_consumable_usage" ON public.consumable_usage_logs;
CREATE POLICY "cul_access" ON public.consumable_usage_logs FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ward_inventory
DROP POLICY IF EXISTS "hospital_isolation_ward_inventory" ON public.ward_inventory;
CREATE POLICY "wi_access" ON public.ward_inventory FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ward_stock_restock_log
DROP POLICY IF EXISTS "hospital_isolation_restock_log" ON public.ward_stock_restock_log;
CREATE POLICY "restock_access" ON public.ward_stock_restock_log FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- hospital_inventory
DROP POLICY IF EXISTS "hospital_inventory_select_practitioner_hospital" ON public.hospital_inventory;
CREATE POLICY "hi_select" ON public.hospital_inventory FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- stock_transactions
DROP POLICY IF EXISTS "Hospital staff can view stock transactions" ON public.stock_transactions;
DROP POLICY IF EXISTS "Pharmacists can create stock transactions" ON public.stock_transactions;

CREATE POLICY "st_select" ON public.stock_transactions FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "st_insert" ON public.stock_transactions FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());

-- staff_shifts
DROP POLICY IF EXISTS "hospital_staff_shifts" ON public.staff_shifts;
CREATE POLICY "shifts_access" ON public.staff_shifts FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- staff_attendance
DROP POLICY IF EXISTS "hospital_attendance" ON public.staff_attendance;
CREATE POLICY "attendance_access" ON public.staff_attendance FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ward_staff_assignments
DROP POLICY IF EXISTS "ward_staff_select" ON public.ward_staff_assignments;
DROP POLICY IF EXISTS "ward_staff_insert_admin" ON public.ward_staff_assignments;
DROP POLICY IF EXISTS "ward_staff_update_admin" ON public.ward_staff_assignments;

CREATE POLICY "wsa_select" ON public.ward_staff_assignments FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "wsa_insert" ON public.ward_staff_assignments FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "wsa_update" ON public.ward_staff_assignments FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- insurance_preauths
DROP POLICY IF EXISTS "preauth_hospital_scoped" ON public.insurance_preauths;
CREATE POLICY "preauth_access" ON public.insurance_preauths FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- insurance_claims
DROP POLICY IF EXISTS "claims_hospital_scoped" ON public.insurance_claims;
CREATE POLICY "claims_access" ON public.insurance_claims FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- corporate_panels
DROP POLICY IF EXISTS "corporate_panels_hospital_scoped" ON public.corporate_panels;
CREATE POLICY "panels_access" ON public.corporate_panels FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- patient_insurance_coverage (scoped via patient.hospital_id)
DROP POLICY IF EXISTS "patient_coverage_hospital_scoped" ON public.patient_insurance_coverage;
CREATE POLICY "coverage_access" ON public.patient_insurance_coverage FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE hospital_id = get_my_hospital_id()));

-- departments
DROP POLICY IF EXISTS "departments_hospital_scoped" ON public.departments;
CREATE POLICY "dept_access" ON public.departments FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- department_budgets
DROP POLICY IF EXISTS "dept_budgets_hospital_scoped" ON public.department_budgets;
CREATE POLICY "budgets_access" ON public.department_budgets FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- services
DROP POLICY IF EXISTS "services_hospital_scoped" ON public.services;
CREATE POLICY "services_access" ON public.services FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- ot_rooms
DROP POLICY IF EXISTS "ot_rooms_select" ON public.ot_rooms;
DROP POLICY IF EXISTS "ot_rooms_insert_admin" ON public.ot_rooms;
DROP POLICY IF EXISTS "ot_rooms_update_admin" ON public.ot_rooms;

CREATE POLICY "ot_rooms_access" ON public.ot_rooms FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- prescription_attachments
DROP POLICY IF EXISTS "hospital_users_prescription_attachments" ON public.prescription_attachments;
CREATE POLICY "rx_attach_access" ON public.prescription_attachments FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- patient_photos
DROP POLICY IF EXISTS "photos_hospital_scoped" ON public.patient_photos;
CREATE POLICY "photos_access" ON public.patient_photos FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- xray_measurements
DROP POLICY IF EXISTS "hospital_isolation_xray_measurements" ON public.xray_measurements;
CREATE POLICY "xray_access" ON public.xray_measurements FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- xray_measurement_templates
DROP POLICY IF EXISTS "xray_templates_select" ON public.xray_measurement_templates;
DROP POLICY IF EXISTS "xray_templates_write" ON public.xray_measurement_templates;

CREATE POLICY "xray_tpl_select" ON public.xray_measurement_templates FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "xray_tpl_write" ON public.xray_measurement_templates FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id() AND doctor_id IN (SELECT id FROM practitioners WHERE user_id = auth.uid()));

-- abdm_webhook_inbox
DROP POLICY IF EXISTS "Users can view ABDM webhooks for their hospital" ON public.abdm_webhook_inbox;
CREATE POLICY "webhook_access" ON public.abdm_webhook_inbox FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- doctor_interaction_embeddings
DROP POLICY IF EXISTS "doctors_own_embeddings" ON public.doctor_interaction_embeddings;
CREATE POLICY "embeddings_access" ON public.doctor_interaction_embeddings FOR ALL TO authenticated
  USING (practitioner_id IN (SELECT id FROM practitioners WHERE user_id = auth.uid()));

-- Updated tables from batch 1 that we created earlier with subqueries:
-- invitations
DROP POLICY IF EXISTS "hospital_select" ON public.invitations;
DROP POLICY IF EXISTS "hospital_insert" ON public.invitations;
DROP POLICY IF EXISTS "hospital_update" ON public.invitations;
DROP POLICY IF EXISTS "hospital_delete" ON public.invitations;

CREATE POLICY "inv_select" ON public.invitations FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "inv_insert" ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "inv_update" ON public.invitations FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id()) WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "inv_delete" ON public.invitations FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- drugs
DROP POLICY IF EXISTS "hospital_select" ON public.drugs;
DROP POLICY IF EXISTS "hospital_insert" ON public.drugs;
DROP POLICY IF EXISTS "hospital_update" ON public.drugs;

CREATE POLICY "drugs_select" ON public.drugs FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "drugs_insert" ON public.drugs FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "drugs_update" ON public.drugs FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- pharmacy_vendors
DROP POLICY IF EXISTS "hospital_select" ON public.pharmacy_vendors;
DROP POLICY IF EXISTS "hospital_insert" ON public.pharmacy_vendors;
DROP POLICY IF EXISTS "hospital_update" ON public.pharmacy_vendors;

CREATE POLICY "pv_select" ON public.pharmacy_vendors FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "pv_insert" ON public.pharmacy_vendors FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "pv_update" ON public.pharmacy_vendors FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- opd_templates
DROP POLICY IF EXISTS "hospital_select" ON public.opd_templates;
DROP POLICY IF EXISTS "hospital_insert" ON public.opd_templates;
DROP POLICY IF EXISTS "hospital_update" ON public.opd_templates;
DROP POLICY IF EXISTS "hospital_delete" ON public.opd_templates;

CREATE POLICY "tpl_select" ON public.opd_templates FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "tpl_insert" ON public.opd_templates FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "tpl_update" ON public.opd_templates FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "tpl_delete" ON public.opd_templates FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- patient_billing_accounts
DROP POLICY IF EXISTS "hospital_select" ON public.patient_billing_accounts;
DROP POLICY IF EXISTS "hospital_insert" ON public.patient_billing_accounts;
DROP POLICY IF EXISTS "hospital_update" ON public.patient_billing_accounts;

CREATE POLICY "pba_select" ON public.patient_billing_accounts FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "pba_insert" ON public.patient_billing_accounts FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "pba_update" ON public.patient_billing_accounts FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- nabh_compliance_checks
DROP POLICY IF EXISTS "hospital_select" ON public.nabh_compliance_checks;
CREATE POLICY "nabh_cc_select" ON public.nabh_compliance_checks FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_consent_types
DROP POLICY IF EXISTS "hospital_or_global_select" ON public.ipd_consent_types;
DROP POLICY IF EXISTS "hospital_insert" ON public.ipd_consent_types;
DROP POLICY IF EXISTS "hospital_update" ON public.ipd_consent_types;

CREATE POLICY "ct_select" ON public.ipd_consent_types FOR SELECT TO authenticated
  USING (hospital_id IS NULL OR hospital_id = get_my_hospital_id());
CREATE POLICY "ct_insert" ON public.ipd_consent_types FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ct_update" ON public.ipd_consent_types FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ot_surgeries
DROP POLICY IF EXISTS "hospital_select" ON public.ot_surgeries;
DROP POLICY IF EXISTS "hospital_insert" ON public.ot_surgeries;
DROP POLICY IF EXISTS "hospital_update" ON public.ot_surgeries;

CREATE POLICY "ot_select" ON public.ot_surgeries FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ot_insert" ON public.ot_surgeries FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ot_update" ON public.ot_surgeries FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- pac_requests
DROP POLICY IF EXISTS "hospital_select" ON public.pac_requests;
DROP POLICY IF EXISTS "hospital_insert" ON public.pac_requests;
DROP POLICY IF EXISTS "hospital_update" ON public.pac_requests;

CREATE POLICY "pac_select" ON public.pac_requests FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "pac_insert" ON public.pac_requests FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "pac_update" ON public.pac_requests FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
