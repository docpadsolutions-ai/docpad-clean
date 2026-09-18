-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413102814.

CREATE TABLE IF NOT EXISTS public.ipd_mar (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id),
  admission_id          uuid NOT NULL REFERENCES public.ipd_admissions(id),
  patient_id            uuid NOT NULL REFERENCES public.patients(id),
  treatment_id          uuid REFERENCES public.ipd_treatments(id),  -- links to ordered medication
  -- Drug details (denormalized for MAR record integrity)
  drug_name             text NOT NULL,
  drug_id               uuid REFERENCES public.drugs(id),
  dose                  text NOT NULL,
  route                 text NOT NULL,   -- 'oral','iv','im','sc','topical','inhaled','pr','sl'
  frequency             text NOT NULL,   -- 'OD','BD','TDS','QID','SOS','stat','q4h' etc.
  -- Scheduled slot
  scheduled_date        date NOT NULL,
  scheduled_time        time NOT NULL,
  -- Administration record
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','given','held','refused','not_available','omitted')),
  administered_at       timestamp with time zone,
  administered_by       uuid REFERENCES public.practitioners(id),
  actual_dose_given     text,
  actual_route          text,
  -- Hold / omission tracking (NABH requirement)
  hold_reason           text,
  omission_reason       text,
  -- IV-specific
  iv_site               text,
  iv_rate               text,           -- e.g., '50 ml/hr'
  infusion_start_at     timestamp with time zone,
  infusion_end_at       timestamp with time zone,
  -- Adverse event flag
  adverse_event         boolean DEFAULT false,
  adverse_event_notes   text,
  -- Verification (double-check for high-alert drugs)
  verified_by           uuid REFERENCES public.practitioners(id),
  verified_at           timestamp with time zone,
  -- Audit
  notes                 text,
  fhir_medication_administration_id text,
  fhir_json             jsonb,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_mar_admission ON public.ipd_mar(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_mar_scheduled ON public.ipd_mar(scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_ipd_mar_status ON public.ipd_mar(status);
CREATE INDEX IF NOT EXISTS idx_ipd_mar_treatment ON public.ipd_mar(treatment_id);

ALTER TABLE public.ipd_mar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ipd_mar_select" ON public.ipd_mar
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_mar.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_mar_insert" ON public.ipd_mar
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_mar.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_mar_update" ON public.ipd_mar
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_mar.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE TRIGGER set_updated_at_ipd_mar
  BEFORE UPDATE ON public.ipd_mar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
