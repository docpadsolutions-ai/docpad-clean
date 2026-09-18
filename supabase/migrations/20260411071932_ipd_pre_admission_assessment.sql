-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411071932.

-- ============================================================
-- IPD MIGRATION 3: Pre-Admission Assessment
-- NABH: COP.4 (initial assessment completed before admission)
-- FHIR R4: ClinicalImpression, Condition, Observation
-- Links the full OPD assessment data to the admission record
-- ============================================================

-- Pre-admission assessment (the complete SOAP form from Figma)
-- This stores the structured content from the "Complete Assessment" form
CREATE TABLE IF NOT EXISTS public.ipd_pre_admission_assessments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id               UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id              UUID REFERENCES public.ipd_admissions(id),
  patient_id                UUID NOT NULL REFERENCES public.patients(id),
  source_opd_encounter_id   UUID REFERENCES public.opd_encounters(id),
  assessing_doctor_id       UUID REFERENCES public.practitioners(id),
  assessed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  specialty                 TEXT,

  -- SUBJECTIVE (S)
  chief_complaint           TEXT,
  chief_complaint_onset     TEXT,
  chief_complaint_duration  TEXT,
  setting                   TEXT[],                            -- ['OPD','IPD','ER','Tele']
  source_reliability        TEXT,
  hpi_one_liner             TEXT,
  hpi_narrative             TEXT,                             -- chronological narrative
  symptoms_json             JSONB,                            -- structured OPQRST symptom array
  ros_all_negative          BOOLEAN DEFAULT FALSE,
  ros_positive_findings     TEXT,
  pmh_text                  TEXT,
  current_medications       JSONB,                            -- [{name, dose, frequency}]
  allergies_text            TEXT,
  risk_factors              TEXT[],

  -- OBJECTIVE (O) — Vitals
  heart_rate                INTEGER,
  bp_systolic               INTEGER,
  bp_diastolic              INTEGER,
  respiratory_rate          INTEGER,
  temperature_f             NUMERIC(5,2),
  spo2                      INTEGER,
  weight_kg                 NUMERIC(6,2),
  bmi                       NUMERIC(5,2),
  consciousness_level       TEXT,
  nutritional_status        TEXT,

  -- Examination findings
  general_appearance        TEXT,
  systemic_examination      JSONB,                            -- {cardiovascular, respiratory, abdomen, cns, ...}
  local_examination         JSONB,                            -- ortho-specific: {joint, rom, neurovascular, etc.}

  -- ASSESSMENT & PLAN (A/P)
  primary_diagnosis_icd10   TEXT,
  primary_diagnosis_display TEXT,
  primary_diagnosis_snomed  TEXT,
  differential_diagnosis    JSONB,
  treatment_plan_notes      TEXT,
  surgical_plan_notes       TEXT,
  treatments_json           JSONB,                            -- [{date, kind, name, dose, route, status, ordering_clinician}]

  -- Pre-op specific (NABH COP.7)
  anaesthesia_fitness       TEXT,
  pre_op_investigations     JSONB,
  pre_op_notes              TEXT,

  -- Completion status
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','complete','verified')),
  verified_by               UUID REFERENCES public.practitioners(id),
  verified_at               TIMESTAMPTZ,

  -- FHIR
  fhir_clinical_impression_id TEXT,
  fhir_json                 JSONB,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add the FK from ipd_admissions back to pre_admission_assessments
ALTER TABLE public.ipd_admissions
  ADD COLUMN IF NOT EXISTS pre_admission_assessment_id UUID
  REFERENCES public.ipd_pre_admission_assessments(id);

CREATE INDEX IF NOT EXISTS idx_ipd_paa_admission ON public.ipd_pre_admission_assessments(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_paa_patient ON public.ipd_pre_admission_assessments(patient_id);

CREATE TRIGGER set_ipd_paa_updated_at BEFORE UPDATE ON public.ipd_pre_admission_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_pre_admission_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_paa_isolation ON public.ipd_pre_admission_assessments
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_pre_admission_assessments.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
