-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411072012.

-- ============================================================
-- IPD MIGRATION 4: Daily Progress Notes (Hospital Days / POD)
-- NABH: COP.9 (daily assessment documented), MOM.9
-- FHIR R4: Composition (type=progress-note), Observation
-- HL7 CDA: Progress Note (LOINC 11506-3)
-- Figma: Pre-op Day-1, POD 0 Surgery, POD 1, POD 2...
-- ============================================================

-- Each row = one calendar day's note for an admission
CREATE TABLE IF NOT EXISTS public.ipd_progress_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id),

  -- Day labelling (Figma: "Pre-op Day -1", "POD 0 – Surgery", "POD 1", "POD 2")
  note_date             DATE NOT NULL,
  hospital_day_number   INTEGER NOT NULL DEFAULT 0,            -- 0 = admission/surgery day, negative = pre-op
  day_label             TEXT,                                  -- e.g. "Pre-op – Day -1", "POD 2"
  day_tags              TEXT[],                                -- ['Admission','Pre-op assessment','TKR Surgery','Post-op ICU','Physio started']
  is_surgery_day        BOOLEAN NOT NULL DEFAULT FALSE,

  -- SUBJECTIVE (S) — free text as seen in Figma
  subjective_text       TEXT,                                  -- "Patient feeling stronger today..."
  subjective_stt_source BOOLEAN NOT NULL DEFAULT FALSE,        -- from Sarvam STT

  -- OBJECTIVE (O)
  -- Vitals (FHIR Observation bundle per day)
  heart_rate            INTEGER,
  bp_systolic           INTEGER,
  bp_diastolic          INTEGER,
  respiratory_rate      INTEGER,
  temperature_c         NUMERIC(5,2),
  spo2                  INTEGER,
  -- Ortho-specific post-op objective (Figma: ROM, wound, drain)
  objective_text        TEXT,                                  -- "Vitals: BP 128/76, HR 72..."
  wound_status          TEXT,                                  -- 'clean','infected','dehisced'
  drain_status          TEXT,
  rom_active            TEXT,                                  -- "0-50°"
  rom_passive           TEXT,                                  -- "0-60°"
  local_exam_json       JSONB,                                 -- structured local exam (joint-specific)
  objective_stt_source  BOOLEAN NOT NULL DEFAULT FALSE,

  -- ASSESSMENT & PLAN (A/P)
  assessment_text       TEXT,
  plan_text             TEXT,
  ap_stt_source         BOOLEAN NOT NULL DEFAULT FALSE,

  -- Treatments for this day (same structure as pre-admission)
  treatments_json       JSONB,                                 -- [{date, kind, name, dose, route, freq, days, status, clinician_id}]
  medical_surgical_notes TEXT,

  -- FHIR
  fhir_composition_id   TEXT,                                  -- FHIR Composition.id (progress note)
  fhir_json             JSONB,

  -- Authoring
  authored_by           UUID REFERENCES public.practitioners(id),
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','signed','amended','entered-in-error')),
  signed_at             TIMESTAMPTZ,
  amended_at            TIMESTAMPTZ,
  amendment_reason      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (admission_id, note_date)   -- one note per day per admission
);

CREATE INDEX IF NOT EXISTS idx_ipd_notes_admission ON public.ipd_progress_notes(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_notes_patient ON public.ipd_progress_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_notes_date ON public.ipd_progress_notes(note_date);

CREATE TRIGGER set_ipd_notes_updated_at BEFORE UPDATE ON public.ipd_progress_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_progress_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_notes_isolation ON public.ipd_progress_notes
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_progress_notes.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

-- ============================================================
-- IPD TREATMENTS TABLE
-- Treatments ordered per admission (across any day)
-- FHIR R4: MedicationRequest, ServiceRequest
-- Separate from progress note JSON for queryability
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ipd_treatments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id),
  progress_note_id      UUID REFERENCES public.ipd_progress_notes(id),  -- which day's note ordered it

  -- Kind: Medical / Surgical
  treatment_kind        TEXT NOT NULL DEFAULT 'medical'
                          CHECK (treatment_kind IN ('medical','surgical','nursing','physio','diet','investigation')),
  name                  TEXT NOT NULL,
  description           TEXT,

  -- Drug-specific
  dose                  TEXT,
  route                 TEXT,
  frequency             TEXT,
  duration_days         INTEGER,

  -- Surgical-specific
  surgical_details_json JSONB,                                 -- {implant, approach, anaesthesia, laterality}

  -- Status
  status                TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned','active','on-hold','completed','stopped','cancelled')),
  ordered_date          DATE,
  start_date            DATE,
  end_date              DATE,

  -- Ordering / performing
  ordering_practitioner_id  UUID REFERENCES public.practitioners(id),
  performing_practitioner_id UUID REFERENCES public.practitioners(id),

  -- OCR import flag (Figma: "Import orders via OCR")
  imported_via_ocr      BOOLEAN NOT NULL DEFAULT FALSE,
  ocr_upload_id         UUID REFERENCES public.investigation_ocr_uploads(id),

  -- FHIR
  fhir_resource_type    TEXT,                                  -- 'MedicationRequest' or 'ServiceRequest'
  fhir_resource_id      TEXT,
  fhir_json             JSONB,

  -- Charge linkage (auto-billing)
  charge_item_id        UUID REFERENCES public.charge_items(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_treatments_admission ON public.ipd_treatments(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_treatments_status ON public.ipd_treatments(status);

CREATE TRIGGER set_ipd_treatments_updated_at BEFORE UPDATE ON public.ipd_treatments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_treatments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_treatments_isolation ON public.ipd_treatments
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_treatments.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
