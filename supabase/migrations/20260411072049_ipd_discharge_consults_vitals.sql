-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411072049.

-- ============================================================
-- IPD MIGRATION 5: Discharge Summary, Consults, Daily Vitals
-- NABH: COP.14 (discharge summary), COP.10 (consults)
-- FHIR R4: Composition (discharge-summary LOINC 18842-5), Task
-- ABDM: Discharge Summary as FHIR document for HIE-CM
-- ============================================================

-- DISCHARGE SUMMARIES
CREATE TABLE IF NOT EXISTS public.ipd_discharge_summaries (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id                UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id                  UUID NOT NULL REFERENCES public.patients(id),

  -- Patient details at discharge (denormalized for immutability)
  discharge_date              DATE,
  discharge_type              TEXT DEFAULT 'regular'
                                CHECK (discharge_type IN ('regular','lama','death','transfer_out','absconded','daycare')),
  discharge_condition         TEXT CHECK (discharge_condition IN ('recovered','improved','not_improved','deteriorated','death')),

  -- Clinical summary
  final_diagnosis_icd10       TEXT[],
  final_diagnosis_display     TEXT[],
  final_diagnosis_snomed      TEXT[],
  hospital_course_summary     TEXT,
  procedures_done             TEXT[],
  procedure_codes_snomed      TEXT[],

  -- Discharge plan
  discharge_medications       JSONB,                           -- [{name, dose, freq, duration, instructions}]
  discharge_instructions      TEXT,
  follow_up_date              DATE,
  follow_up_doctor_id         UUID REFERENCES public.practitioners(id),
  diet_advice                 TEXT,
  activity_restrictions       TEXT,
  wound_care_instructions     TEXT,

  -- Condition-specific (Ortho)
  implant_details             JSONB,                           -- {type, brand, size, lot_number, surgeon}
  post_op_protocol            TEXT,
  physiotherapy_plan          TEXT,

  -- Document
  status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','final','amended')),
  prepared_by                 UUID REFERENCES public.practitioners(id),
  signed_by                   UUID REFERENCES public.practitioners(id),
  signed_at                   TIMESTAMPTZ,
  document_url                TEXT,                            -- PDF storage path

  -- FHIR / ABDM
  fhir_composition_id         TEXT,                            -- LOINC 18842-5
  fhir_json                   JSONB,
  abdm_pushed                 BOOLEAN NOT NULL DEFAULT FALSE,
  abdm_pushed_at              TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admission_id)
);

CREATE TRIGGER set_ipd_ds_updated_at BEFORE UPDATE ON public.ipd_discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_discharge_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_ds_isolation ON public.ipd_discharge_summaries
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_discharge_summaries.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ============================================================
-- CONSULT REQUESTS (Figma: "Request Consult" button)
-- FHIR R4: ServiceRequest category=consult
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ipd_consult_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id),
  progress_note_id      UUID REFERENCES public.ipd_progress_notes(id),

  requesting_doctor_id  UUID REFERENCES public.practitioners(id),
  consulting_doctor_id  UUID REFERENCES public.practitioners(id),
  consulting_specialty  TEXT,
  consulting_department_id UUID REFERENCES public.departments(id),

  reason_for_consult    TEXT,
  urgency               TEXT DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','stat')),
  status                TEXT NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','accepted','completed','declined','cancelled')),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at          TIMESTAMPTZ,
  consult_notes         TEXT,

  fhir_service_request_id TEXT,
  fhir_json             JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_consults_admission ON public.ipd_consult_requests(admission_id);

CREATE TRIGGER set_ipd_consults_updated_at BEFORE UPDATE ON public.ipd_consult_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_consult_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_consults_isolation ON public.ipd_consult_requests
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_consult_requests.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ============================================================
-- IPD DAILY VITALS (separate from progress note for granularity)
-- FHIR R4: Observation (vital-signs profile)
-- Allows multiple vitals readings per day
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ipd_vitals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id),
  progress_note_id      UUID REFERENCES public.ipd_progress_notes(id),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by           UUID REFERENCES public.practitioners(id),

  heart_rate            INTEGER,
  bp_systolic           INTEGER,
  bp_diastolic          INTEGER,
  respiratory_rate      INTEGER,
  temperature_c         NUMERIC(5,2),
  spo2                  INTEGER,
  weight_kg             NUMERIC(6,2),
  pain_score            INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  gcs_score             INTEGER,
  urine_output_ml       INTEGER,
  drain_output_ml       INTEGER,
  notes                 TEXT,

  fhir_observation_bundle JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_vitals_admission ON public.ipd_vitals(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_vitals_recorded ON public.ipd_vitals(recorded_at);

ALTER TABLE public.ipd_vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_vitals_isolation ON public.ipd_vitals
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_vitals.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ============================================================
-- BED TRANSFER LOG (NABH: MOM.3 - bed transfer tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ipd_bed_transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  from_ward_id          UUID REFERENCES public.ipd_wards(id),
  from_bed_id           UUID REFERENCES public.ipd_beds(id),
  to_ward_id            UUID REFERENCES public.ipd_wards(id),
  to_bed_id             UUID REFERENCES public.ipd_beds(id),
  transferred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason                TEXT,
  transferred_by        UUID REFERENCES public.practitioners(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_transfers_admission ON public.ipd_bed_transfers(admission_id);

ALTER TABLE public.ipd_bed_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_transfers_isolation ON public.ipd_bed_transfers
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_bed_transfers.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
