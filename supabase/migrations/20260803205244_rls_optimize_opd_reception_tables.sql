-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205244.

-- ============================================================
-- Batch 1: OPD & Reception tables (highest traffic)
-- Replace subquery patterns with get_my_hospital_id()
-- ============================================================

-- reception_queue
DROP POLICY IF EXISTS "Users can view queue for their hospital" ON public.reception_queue;
DROP POLICY IF EXISTS "Users can add to queue for their hospital" ON public.reception_queue;
DROP POLICY IF EXISTS "Users can update queue for their hospital" ON public.reception_queue;
DROP POLICY IF EXISTS "Users can delete from queue for their hospital" ON public.reception_queue;

CREATE POLICY "rq_select" ON public.reception_queue FOR SELECT TO authenticated
  USING (hospital_id = get_my_hospital_id());
CREATE POLICY "rq_insert" ON public.reception_queue FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "rq_update" ON public.reception_queue FOR UPDATE TO authenticated
  USING (hospital_id = get_my_hospital_id()) WITH CHECK (hospital_id = get_my_hospital_id());
CREATE POLICY "rq_delete" ON public.reception_queue FOR DELETE TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- appointments
DROP POLICY IF EXISTS "Appointments hospital access" ON public.appointments;

CREATE POLICY "appointments_access" ON public.appointments FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- opd_bills
DROP POLICY IF EXISTS "hospital_scoped_opd_bills" ON public.opd_bills;

CREATE POLICY "opd_bills_access" ON public.opd_bills FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- consultation_fee_master
DROP POLICY IF EXISTS "hospital_scoped_fee_master" ON public.consultation_fee_master;

CREATE POLICY "fee_master_access" ON public.consultation_fee_master FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id());

-- notifications
DROP POLICY IF EXISTS "users_see_own_notifications" ON public.notifications;
DROP POLICY IF EXISTS "users_mark_read" ON public.notifications;
DROP POLICY IF EXISTS "Hospital members insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "service_insert_notifications" ON public.notifications;

CREATE POLICY "notif_select" ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR (recipient_id IS NULL AND hospital_id = get_my_hospital_id()));
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid() OR (recipient_id IS NULL AND hospital_id = get_my_hospital_id()))
  WITH CHECK (true);
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_my_hospital_id());
