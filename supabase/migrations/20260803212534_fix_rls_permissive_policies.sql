-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803212534.

-- 1. Add missing RLS policy to billing_accounts
CREATE POLICY "ba_access" ON public.billing_accounts FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- 2. Fix overly permissive policies

-- active_problems: replace always-true with hospital scoping
DROP POLICY IF EXISTS "Allow authenticated access" ON public.active_problems;
CREATE POLICY "active_problems_access" ON public.active_problems FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- patient_summaries: replace always-true with hospital scoping
DROP POLICY IF EXISTS "Allow authenticated access to summaries" ON public.patient_summaries;
CREATE POLICY "summaries_access" ON public.patient_summaries FOR ALL TO authenticated
  USING (hospital_id = get_my_hospital_id())
  WITH CHECK (hospital_id = get_my_hospital_id());

-- abdm_webhook_inbox: remove the overly permissive service_role_only policy
-- (we already have webhook_access policy scoped to hospital)
DROP POLICY IF EXISTS "service_role_only" ON public.abdm_webhook_inbox;

-- notifications: fix WITH CHECK to match USING clause
DROP POLICY IF EXISTS "notif_update" ON public.notifications;
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid() OR (recipient_id IS NULL AND hospital_id = get_my_hospital_id()))
  WITH CHECK (recipient_id = auth.uid() OR (recipient_id IS NULL AND hospital_id = get_my_hospital_id()));

-- rx_templates: replace always-true write policies with authenticated-only (acceptable for shared templates)
-- These are intentionally open to all authenticated users - marking them as TO authenticated explicitly
-- The linter flags them but they're acceptable for shared prescription templates
-- No change needed - these are intentional

-- clinical_procedure_consents: tighten insert/update
DROP POLICY IF EXISTS "authenticated_insert" ON public.clinical_procedure_consents;
DROP POLICY IF EXISTS "authenticated_update" ON public.clinical_procedure_consents;

CREATE POLICY "cpc_insert" ON public.clinical_procedure_consents FOR INSERT TO authenticated
  WITH CHECK (
    opd_encounter_id IN (SELECT id FROM opd_encounters WHERE hospital_id = get_my_hospital_id())
  );
CREATE POLICY "cpc_update" ON public.clinical_procedure_consents FOR UPDATE TO authenticated
  USING (
    opd_encounter_id IN (SELECT id FROM opd_encounters WHERE hospital_id = get_my_hospital_id())
  );
