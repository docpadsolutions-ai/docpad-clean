-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205300.

-- ============================================================
-- Batch 2: Investigation & Lab tables
-- ============================================================

-- investigations
DROP POLICY IF EXISTS "hospital_scoped_investigations" ON public.investigations;
CREATE POLICY "investigations_access" ON public.investigations FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_bills
DROP POLICY IF EXISTS "hospital_scoped_bills" ON public.investigation_bills;
CREATE POLICY "inv_bills_access" ON public.investigation_bills FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_bill_items (joins through bill)
DROP POLICY IF EXISTS "hospital_scoped_bill_items" ON public.investigation_bill_items;
CREATE POLICY "inv_bill_items_access" ON public.investigation_bill_items FOR ALL TO authenticated
  USING (bill_id IN (SELECT id FROM investigation_bills WHERE hospital_id = get_my_hospital_id()));

-- investigation_files
DROP POLICY IF EXISTS "hospital_scoped_inv_files" ON public.investigation_files;
CREATE POLICY "inv_files_access" ON public.investigation_files FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_ocr_uploads
DROP POLICY IF EXISTS "hospital_scoped_ocr" ON public.investigation_ocr_uploads;
CREATE POLICY "ocr_uploads_access" ON public.investigation_ocr_uploads FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_price_master
DROP POLICY IF EXISTS "hospital_scoped_price_master" ON public.investigation_price_master;
CREATE POLICY "price_master_access" ON public.investigation_price_master FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_results (joins through patient)
DROP POLICY IF EXISTS "hospital_scoped_results" ON public.investigation_results;
CREATE POLICY "inv_results_access" ON public.investigation_results FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE hospital_id = get_my_hospital_id()));

-- investigation_workflow (joins through investigation)
DROP POLICY IF EXISTS "hospital_scoped_workflow" ON public.investigation_workflow;
CREATE POLICY "inv_workflow_access" ON public.investigation_workflow FOR ALL TO authenticated
  USING (investigation_id IN (SELECT id FROM investigations WHERE hospital_id = get_my_hospital_id()));

-- lab_result_entries (joins through investigation)
DROP POLICY IF EXISTS "hospital_scoped_lab_entries" ON public.lab_result_entries;
CREATE POLICY "lab_entries_access" ON public.lab_result_entries FOR ALL TO authenticated
  USING (investigation_id IN (SELECT id FROM investigations WHERE hospital_id = get_my_hospital_id()));

-- ocr_confidence_config
DROP POLICY IF EXISTS "hospital_scoped_ocr_config" ON public.ocr_confidence_config;
CREATE POLICY "ocr_config_access" ON public.ocr_confidence_config FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- test_catalogue
DROP POLICY IF EXISTS "catalogue_hospital_write" ON public.test_catalogue;
CREATE POLICY "test_catalogue_access" ON public.test_catalogue FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- investigation_acknowledgements
DROP POLICY IF EXISTS "ack_select" ON public.investigation_acknowledgements;
DROP POLICY IF EXISTS "ack_insert" ON public.investigation_acknowledgements;
DROP POLICY IF EXISTS "ack_update" ON public.investigation_acknowledgements;

CREATE POLICY "ack_select" ON public.investigation_acknowledgements FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ack_insert" ON public.investigation_acknowledgements FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ack_update" ON public.investigation_acknowledgements FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());
