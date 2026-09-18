-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205318.

-- ============================================================
-- Batch 3: Billing & Finance tables
-- ============================================================

-- charge_item_definitions
DROP POLICY IF EXISTS "charge_item_definitions_select_practitioner_hospital" ON public.charge_item_definitions;
DROP POLICY IF EXISTS "charge_item_definitions_insert_admin" ON public.charge_item_definitions;
DROP POLICY IF EXISTS "charge_item_definitions_update_admin" ON public.charge_item_definitions;

CREATE POLICY "cid_select" ON public.charge_item_definitions FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "cid_insert" ON public.charge_item_definitions FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "cid_update" ON public.charge_item_definitions FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- charge_items
DROP POLICY IF EXISTS "charge_items_select_practitioner_hospital" ON public.charge_items;
DROP POLICY IF EXISTS "charge_items_insert_practitioner_hospital" ON public.charge_items;

CREATE POLICY "ci_select" ON public.charge_items FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "ci_insert" ON public.charge_items FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "ci_update" ON public.charge_items FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- invoices
DROP POLICY IF EXISTS "invoices_select_practitioner_hospital" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_practitioner_hospital" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_practitioner_hospital" ON public.invoices;

CREATE POLICY "inv_select" ON public.invoices FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "inv_insert" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "inv_update" ON public.invoices FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- invoice_line_items (joins through invoices)
DROP POLICY IF EXISTS "invoice_line_items_select_practitioner_hospital" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_line_items_insert_practitioner_hospital" ON public.invoice_line_items;

CREATE POLICY "ili_select" ON public.invoice_line_items FOR SELECT TO authenticated
  USING (invoice_id IN (SELECT id FROM invoices WHERE hospital_id = get_my_hospital_id()));
CREATE POLICY "ili_insert" ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (invoice_id IN (SELECT id FROM invoices WHERE hospital_id = get_my_hospital_id()));
CREATE POLICY "ili_update" ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (invoice_id IN (SELECT id FROM invoices WHERE hospital_id = get_my_hospital_id()));

-- payments
DROP POLICY IF EXISTS "payments_select_hospital" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_hospital" ON public.payments;
DROP POLICY IF EXISTS "payments_update_void" ON public.payments;

CREATE POLICY "pay_select" ON public.payments FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "pay_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "pay_update" ON public.payments FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id()) WITH CHECK (status = 'voided');

-- billing_audit_log
DROP POLICY IF EXISTS "hospital_scope" ON public.billing_audit_log;
CREATE POLICY "audit_access" ON public.billing_audit_log FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- patient_wallet
DROP POLICY IF EXISTS "hospital_scope" ON public.patient_wallet;
CREATE POLICY "wallet_access" ON public.patient_wallet FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- wallet_transactions
DROP POLICY IF EXISTS "hospital_scope" ON public.wallet_transactions;
CREATE POLICY "wallet_tx_access" ON public.wallet_transactions FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- procedure_estimates
DROP POLICY IF EXISTS "hospital_scope" ON public.procedure_estimates;
CREATE POLICY "estimates_access" ON public.procedure_estimates FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ipd_daily_charges
DROP POLICY IF EXISTS "hospital_scope" ON public.ipd_daily_charges;
CREATE POLICY "daily_charges_access" ON public.ipd_daily_charges FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- ward_rate_master
DROP POLICY IF EXISTS "hospital_scope" ON public.ward_rate_master;
CREATE POLICY "ward_rate_access" ON public.ward_rate_master FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());
