-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413102751.

CREATE TABLE IF NOT EXISTS public.ipd_nursing_care_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id),
  admission_id          uuid NOT NULL REFERENCES public.ipd_admissions(id),
  patient_id            uuid NOT NULL REFERENCES public.patients(id),
  plan_date             date NOT NULL DEFAULT CURRENT_DATE,
  shift                 text NOT NULL CHECK (shift IN ('morning','afternoon','night','general')),
  -- NABH-required initial nursing assessment fields
  nursing_diagnosis     text,
  patient_goal          text,
  interventions         jsonb,   -- array of {intervention, frequency, responsible_nurse}
  evaluation_notes      text,
  -- Falls & pressure sore risk (NABH mandatory)
  fall_risk_score       integer,
  fall_risk_level       text CHECK (fall_risk_level IN ('low','medium','high')),
  fall_prevention_measures jsonb,
  braden_score          integer,   -- pressure ulcer risk
  pressure_sore_prevention jsonb,
  -- Pain assessment
  pain_score            integer CHECK (pain_score BETWEEN 0 AND 10),
  pain_location         text,
  pain_intervention     text,
  -- Nutritional & hygiene
  nutritional_assessment text,
  oral_hygiene_done     boolean DEFAULT false,
  skin_care_done        boolean DEFAULT false,
  -- Patient/family education
  education_given       text,
  education_understood  boolean,
  -- Status
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reviewed','closed')),
  created_by            uuid NOT NULL REFERENCES public.practitioners(id),
  reviewed_by           uuid REFERENCES public.practitioners(id),
  reviewed_at           timestamp with time zone,
  fhir_care_plan_id     text,
  fhir_json             jsonb,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_ncp_admission ON public.ipd_nursing_care_plans(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_ncp_date ON public.ipd_nursing_care_plans(plan_date);

ALTER TABLE public.ipd_nursing_care_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ipd_ncp_select" ON public.ipd_nursing_care_plans
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_nursing_care_plans.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_ncp_insert" ON public.ipd_nursing_care_plans
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_nursing_care_plans.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_ncp_update" ON public.ipd_nursing_care_plans
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_nursing_care_plans.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE TRIGGER set_updated_at_ipd_nursing_care_plans
  BEFORE UPDATE ON public.ipd_nursing_care_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
