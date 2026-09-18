-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412065235.

-- Fix all IPD tables with broken ALL-policy (null with_check blocks all INSERTs)
-- Pattern: drop the ALL policy, replace with explicit SELECT + INSERT + UPDATE + DELETE

-- Helper: each table uses same hospital_id isolation pattern

-- ipd_admissions
DROP POLICY IF EXISTS ipd_admissions_isolation ON ipd_admissions;
CREATE POLICY ipd_admissions_select ON ipd_admissions FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admissions.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_admissions_insert ON ipd_admissions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admissions.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_admissions_update ON ipd_admissions FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admissions.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_admissions_delete ON ipd_admissions FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admissions.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_treatments
DROP POLICY IF EXISTS ipd_treatments_isolation ON ipd_treatments;
CREATE POLICY ipd_treatments_select ON ipd_treatments FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_treatments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_treatments_insert ON ipd_treatments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_treatments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_treatments_update ON ipd_treatments FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_treatments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_treatments_delete ON ipd_treatments FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_treatments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_vitals
DROP POLICY IF EXISTS ipd_vitals_isolation ON ipd_vitals;
CREATE POLICY ipd_vitals_select ON ipd_vitals FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_vitals.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_vitals_insert ON ipd_vitals FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_vitals.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_vitals_update ON ipd_vitals FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_vitals.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_vitals_delete ON ipd_vitals FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_vitals.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_consult_requests
DROP POLICY IF EXISTS ipd_consults_isolation ON ipd_consult_requests;
CREATE POLICY ipd_consults_select ON ipd_consult_requests FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_consult_requests.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_consults_insert ON ipd_consult_requests FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_consult_requests.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_consults_update ON ipd_consult_requests FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_consult_requests.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_consults_delete ON ipd_consult_requests FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_consult_requests.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_discharge_summaries (two policies existed - drop both)
DROP POLICY IF EXISTS ipd_ds_isolation ON ipd_discharge_summaries;
DROP POLICY IF EXISTS discharge_summary_hospital_access ON ipd_discharge_summaries;
CREATE POLICY ipd_ds_select ON ipd_discharge_summaries FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_discharge_summaries.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ds_insert ON ipd_discharge_summaries FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_discharge_summaries.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ds_update ON ipd_discharge_summaries FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_discharge_summaries.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ds_delete ON ipd_discharge_summaries FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_discharge_summaries.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_investigation_orders
DROP POLICY IF EXISTS hospital_inv_ord ON ipd_investigation_orders;
CREATE POLICY ipd_inv_ord_select ON ipd_investigation_orders FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_investigation_orders.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_inv_ord_insert ON ipd_investigation_orders FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_investigation_orders.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_inv_ord_update ON ipd_investigation_orders FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_investigation_orders.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_inv_ord_delete ON ipd_investigation_orders FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_investigation_orders.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_nar_records
DROP POLICY IF EXISTS hospital_nar ON ipd_nar_records;
CREATE POLICY ipd_nar_select ON ipd_nar_records FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nar_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nar_insert ON ipd_nar_records FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nar_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nar_update ON ipd_nar_records FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nar_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nar_delete ON ipd_nar_records FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nar_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_nabh_checklist
DROP POLICY IF EXISTS hospital_nabh ON ipd_nabh_checklist;
CREATE POLICY ipd_nabh_select ON ipd_nabh_checklist FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nabh_checklist.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nabh_insert ON ipd_nabh_checklist FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nabh_checklist.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nabh_update ON ipd_nabh_checklist FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nabh_checklist.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_nabh_delete ON ipd_nabh_checklist FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_nabh_checklist.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_wound_assessments
DROP POLICY IF EXISTS hospital_wound ON ipd_wound_assessments;
CREATE POLICY ipd_wound_select ON ipd_wound_assessments FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wound_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_wound_insert ON ipd_wound_assessments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wound_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_wound_update ON ipd_wound_assessments FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wound_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_wound_delete ON ipd_wound_assessments FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wound_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_io_records
DROP POLICY IF EXISTS hospital_io ON ipd_io_records;
CREATE POLICY ipd_io_select ON ipd_io_records FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_io_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_io_insert ON ipd_io_records FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_io_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_io_update ON ipd_io_records FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_io_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_io_delete ON ipd_io_records FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_io_records.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_condition_timeline
DROP POLICY IF EXISTS hospital_cond_tl ON ipd_condition_timeline;
CREATE POLICY ipd_cond_tl_select ON ipd_condition_timeline FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_condition_timeline.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_cond_tl_insert ON ipd_condition_timeline FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_condition_timeline.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_cond_tl_update ON ipd_condition_timeline FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_condition_timeline.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_cond_tl_delete ON ipd_condition_timeline FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_condition_timeline.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_admission_consents
DROP POLICY IF EXISTS ipd_consents_isolation ON ipd_admission_consents;
CREATE POLICY ipd_ac_select ON ipd_admission_consents FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admission_consents.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ac_insert ON ipd_admission_consents FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admission_consents.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ac_update ON ipd_admission_consents FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admission_consents.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_ac_delete ON ipd_admission_consents FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_admission_consents.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_pre_admission_assessments
DROP POLICY IF EXISTS ipd_paa_isolation ON ipd_pre_admission_assessments;
CREATE POLICY ipd_paa_select ON ipd_pre_admission_assessments FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_pre_admission_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_paa_insert ON ipd_pre_admission_assessments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_pre_admission_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_paa_update ON ipd_pre_admission_assessments FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_pre_admission_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_paa_delete ON ipd_pre_admission_assessments FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_pre_admission_assessments.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_bed_transfers
DROP POLICY IF EXISTS ipd_transfers_isolation ON ipd_bed_transfers;
CREATE POLICY ipd_bt_select ON ipd_bed_transfers FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_bed_transfers.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_bt_insert ON ipd_bed_transfers FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_bed_transfers.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_bt_update ON ipd_bed_transfers FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_bed_transfers.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_bt_delete ON ipd_bed_transfers FOR DELETE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_bed_transfers.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_wards (read-only for non-admin, insert/update only for hospital staff)
DROP POLICY IF EXISTS ipd_wards_isolation ON ipd_wards;
CREATE POLICY ipd_wards_select ON ipd_wards FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wards.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_wards_insert ON ipd_wards FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wards.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_wards_update ON ipd_wards FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_wards.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ipd_beds
DROP POLICY IF EXISTS ipd_beds_isolation ON ipd_beds;
CREATE POLICY ipd_beds_select ON ipd_beds FOR SELECT USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_beds.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_beds_insert ON ipd_beds FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_beds.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
CREATE POLICY ipd_beds_update ON ipd_beds FOR UPDATE USING (EXISTS (SELECT 1 FROM practitioners pr WHERE pr.hospital_id = ipd_beds.hospital_id AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
