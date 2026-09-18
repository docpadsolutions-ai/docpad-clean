-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411071903.

-- ============================================================
-- IPD MIGRATION 2: Admission Consents
-- NABH: COP.3 (informed consent), MOM.2
-- DPDPA 2023: Section 6 — consent for digital health data
-- ABDM: HDMP consent framework
-- HL7 FHIR R4: Consent resource
-- ============================================================

-- Consent type master (seeded below)
CREATE TABLE IF NOT EXISTS public.ipd_consent_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,    -- e.g. 'GENERAL_ADMISSION', 'DPDPA_DIGITAL_HEALTH'
  display_name  TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'admission'
                  CHECK (category IN ('admission','procedure','anaesthesia','blood_transfusion','dpdpa','financial','research')),
  is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  fhir_category_code TEXT,              -- FHIR Consent.category code
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed mandatory consent types (per Figma + NABH + DPDPA)
INSERT INTO public.ipd_consent_types (code, display_name, description, category, is_mandatory, sort_order, fhir_category_code) VALUES
  ('GENERAL_ADMISSION',   'General Admission & Treatment Consent', 'Patient rights, treatment authorization', 'admission', TRUE, 1, '59284-0'),
  ('DPDPA_DIGITAL_HEALTH','Digital Health Data Consent (DPDPA)',   'Data collection, ABHA linking, privacy rights', 'dpdpa', TRUE, 2, '57016-8'),
  ('FINANCIAL_RESP',      'Financial Responsibility Agreement',     'Billing, payment guarantee', 'financial', TRUE, 3, '42348-3'),
  ('ANAESTHESIA',         'Anaesthesia Consent',                   'Risks and authorization for anaesthesia', 'anaesthesia', FALSE, 4, '59284-0'),
  ('BLOOD_PRODUCTS',      'Blood Products & Transfusion Consent',  'Transfusion risks and authorization', 'blood_transfusion', FALSE, 5, '59284-0'),
  ('SURGERY_PROCEDURE',   'Surgical / Procedure Specific Consent', 'Named procedure risks and authorization', 'procedure', FALSE, 6, '59284-0')
ON CONFLICT (code) DO NOTHING;

-- Per-admission consent records (FHIR Consent resource)
CREATE TABLE IF NOT EXISTS public.ipd_admission_consents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  admission_id          UUID NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id),
  consent_type_id       UUID NOT NULL REFERENCES public.ipd_consent_types(id),

  -- Status
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','obtained','refused','withdrawn','not_applicable')),

  -- Signatory (patient or guardian)
  signed_by_name        TEXT,
  signed_by_relation    TEXT,                                   -- 'self','spouse','parent','guardian','next_of_kin'
  signed_at             TIMESTAMPTZ,

  -- OTP-based verification (Aadhaar/ABHA mock now, real later)
  otp_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  otp_reference         TEXT,                                   -- masked reference / transaction ID
  otp_verified_at       TIMESTAMPTZ,
  verification_mode     TEXT DEFAULT 'mock'
                          CHECK (verification_mode IN ('mock','aadhaar_otp','abha_otp','biometric','witness')),

  -- Witnessed by staff
  witnessed_by          UUID REFERENCES public.practitioners(id),
  witnessed_at          TIMESTAMPTZ,

  -- Content
  consent_text_version  TEXT,                                   -- version of consent form shown
  consent_document_url  TEXT,                                   -- signed PDF storage path
  notes                 TEXT,

  -- FHIR Consent resource
  fhir_consent_id       TEXT,
  fhir_json             JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (admission_id, consent_type_id)
);

CREATE INDEX IF NOT EXISTS idx_ipd_consents_admission ON public.ipd_admission_consents(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_consents_patient ON public.ipd_admission_consents(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_consents_status ON public.ipd_admission_consents(status);

CREATE TRIGGER set_ipd_consents_updated_at BEFORE UPDATE ON public.ipd_admission_consents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ipd_admission_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipd_consents_isolation ON public.ipd_admission_consents
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_admission_consents.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
