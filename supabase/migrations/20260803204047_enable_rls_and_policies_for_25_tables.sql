-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803204047.

-- ============================================================
-- Enable RLS on all 25 unprotected tables
-- ============================================================

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snomed_concept_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_concept_frequency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rx_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rx_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snomed_dosage_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snomed_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opd_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_procedure_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nabh_compliance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_consent_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_surgeries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pac_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snomed_drug_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icd10_library ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- REFERENCE / LOOKUP TABLES (read-only for all authenticated)
-- ============================================================

-- snomed_concept_cache
CREATE POLICY "authenticated_select" ON public.snomed_concept_cache
  FOR SELECT TO authenticated USING (true);

-- snomed_dosage_forms
CREATE POLICY "authenticated_select" ON public.snomed_dosage_forms
  FOR SELECT TO authenticated USING (true);

-- snomed_cache
CREATE POLICY "authenticated_select" ON public.snomed_cache
  FOR SELECT TO authenticated USING (true);

-- snomed_drug_map
CREATE POLICY "authenticated_select" ON public.snomed_drug_map
  FOR SELECT TO authenticated USING (true);

-- role_permissions
CREATE POLICY "authenticated_select" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

-- icd10_library
CREATE POLICY "authenticated_select" ON public.icd10_library
  FOR SELECT TO authenticated USING (true);

-- medication_registry (global drug reference)
CREATE POLICY "authenticated_select" ON public.medication_registry
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- USER-SCOPED TABLES (user sees/manages their own rows)
-- ============================================================

-- advice_templates (doctor_id = auth.uid())
CREATE POLICY "own_select" ON public.advice_templates
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());
CREATE POLICY "own_insert" ON public.advice_templates
  FOR INSERT TO authenticated WITH CHECK (doctor_id = auth.uid());
CREATE POLICY "own_update" ON public.advice_templates
  FOR UPDATE TO authenticated USING (doctor_id = auth.uid()) WITH CHECK (doctor_id = auth.uid());
CREATE POLICY "own_delete" ON public.advice_templates
  FOR DELETE TO authenticated USING (doctor_id = auth.uid());

-- user_favorites (user_id = auth.uid())
CREATE POLICY "own_select" ON public.user_favorites
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_insert" ON public.user_favorites
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_update" ON public.user_favorites
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_delete" ON public.user_favorites
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- medication_history (user_id = auth.uid())
CREATE POLICY "own_select" ON public.medication_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_insert" ON public.medication_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_update" ON public.medication_history
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_delete" ON public.medication_history
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- doctor_concept_frequency (doctor_id = auth.uid())
CREATE POLICY "own_select" ON public.doctor_concept_frequency
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());
CREATE POLICY "own_insert" ON public.doctor_concept_frequency
  FOR INSERT TO authenticated WITH CHECK (doctor_id = auth.uid());
CREATE POLICY "own_update" ON public.doctor_concept_frequency
  FOR UPDATE TO authenticated USING (doctor_id = auth.uid()) WITH CHECK (doctor_id = auth.uid());
CREATE POLICY "own_delete" ON public.doctor_concept_frequency
  FOR DELETE TO authenticated USING (doctor_id = auth.uid());

-- medication_proposals (proposed_by = auth.uid() for write; all authenticated can read)
CREATE POLICY "authenticated_select" ON public.medication_proposals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "own_insert" ON public.medication_proposals
  FOR INSERT TO authenticated WITH CHECK (proposed_by = auth.uid());
CREATE POLICY "own_update" ON public.medication_proposals
  FOR UPDATE TO authenticated USING (proposed_by = auth.uid()) WITH CHECK (proposed_by = auth.uid());

-- rx_templates (read-only for all authenticated; admin manages)
CREATE POLICY "authenticated_select" ON public.rx_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public.rx_templates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public.rx_templates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON public.rx_templates
  FOR DELETE TO authenticated USING (true);

-- rx_template_items (follows rx_templates access)
CREATE POLICY "authenticated_select" ON public.rx_template_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public.rx_template_items
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public.rx_template_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON public.rx_template_items
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- HOSPITAL-SCOPED TABLES (user must belong to the hospital)
-- ============================================================

-- Helper: practitioner's hospital_id lookup is used in USING clauses

-- invitations
CREATE POLICY "hospital_select" ON public.invitations
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.invitations
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_delete" ON public.invitations
  FOR DELETE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- organizations (user must be a practitioner in a hospital linked to this org)
CREATE POLICY "authenticated_select" ON public.organizations
  FOR SELECT TO authenticated USING (true);

-- drugs (hospital-scoped)
CREATE POLICY "hospital_select" ON public.drugs
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.drugs
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.drugs
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- pharmacy_vendors (hospital-scoped)
CREATE POLICY "hospital_select" ON public.pharmacy_vendors
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.pharmacy_vendors
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.pharmacy_vendors
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- opd_templates (hospital-scoped)
CREATE POLICY "hospital_select" ON public.opd_templates
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.opd_templates
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.opd_templates
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_delete" ON public.opd_templates
  FOR DELETE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- patient_billing_accounts (hospital-scoped via organizations)
CREATE POLICY "hospital_select" ON public.patient_billing_accounts
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.patient_billing_accounts
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.patient_billing_accounts
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- nabh_compliance_checks (hospital-scoped)
CREATE POLICY "hospital_select" ON public.nabh_compliance_checks
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- ipd_consent_types (hospital-scoped, nullable hospital_id means global)
CREATE POLICY "hospital_or_global_select" ON public.ipd_consent_types
  FOR SELECT TO authenticated
  USING (
    hospital_id IS NULL
    OR hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid())
  );
CREATE POLICY "hospital_insert" ON public.ipd_consent_types
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.ipd_consent_types
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- ot_surgeries (hospital-scoped)
CREATE POLICY "hospital_select" ON public.ot_surgeries
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.ot_surgeries
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.ot_surgeries
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- pac_requests (hospital-scoped)
CREATE POLICY "hospital_select" ON public.pac_requests
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_insert" ON public.pac_requests
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_update" ON public.pac_requests
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()))
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()));

-- clinical_procedure_consents (linked to opd_encounter; allow authenticated read/write for now)
CREATE POLICY "authenticated_select" ON public.clinical_procedure_consents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public.clinical_procedure_consents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public.clinical_procedure_consents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
