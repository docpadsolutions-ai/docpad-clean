-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411071833.

-- ============================================================
-- IPD MIGRATION 1: Wards, Beds, Admissions
-- FHIR R4: Location (ward/bed), Encounter class=IMP
-- NABH 6th Ed: COP.2 (admission), MOM.1 (bed mgmt)
-- ABDM: care context linkage per admission
-- ============================================================

-- 1. WARDS (FHIR Location physicalType = wa)
CREATE TABLE IF NOT EXISTS public.ipd_wards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  name                  TEXT NOT NULL,
  code                  TEXT,
  ward_type             TEXT NOT NULL DEFAULT 'general'
                          CHECK (ward_type IN ('general','private','semi_private','icu','hdu','nicu','picu','isolation','daycare')),
  specialty             TEXT,
  floor                 INTEGER,
  total_beds            INTEGER NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  fhir_location_id      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. BEDS (FHIR Location physicalType = bd)
CREATE TABLE IF NOT EXISTS public.ipd_beds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id),
  ward_id               UUID NOT NULL REFERENCES public.ipd_wards(id),
  bed_number            TEXT NOT NULL,
  bed_type              TEXT NOT NULL DEFAULT 'standard'
                          CHECK (bed_type IN ('standard','icu','hdu','isolation','daycare','observation')),
  status                TEXT NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available','occupied','reserved','maintenance','blocked')),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  fhir_location_id      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ward_id, bed_number)
);

-- 3. IPD ADMISSIONS (FHIR Encounter class=IMP)
CREATE TABLE IF NOT EXISTS public.ipd_admissions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 UUID NOT NULL REFERENCES public.hospitals(id),
  patient_id                  UUID NOT NULL REFERENCES public.patients(id),

  -- OPD source linkage
  source_opd_encounter_id     UUID REFERENCES public.opd_encounters(id),
  source_appointment_id       UUID REFERENCES public.appointments(id),

  -- Identifiers
  admission_number            TEXT NOT NULL,
  uhid                        TEXT,

  -- Bed
  ward_id                     UUID REFERENCES public.ipd_wards(id),
  bed_id                      UUID REFERENCES public.ipd_beds(id),

  -- Clinical
  admission_type              TEXT NOT NULL DEFAULT 'elective'
                                CHECK (admission_type IN ('elective','emergency','transfer_in','daycare')),
  admission_class             TEXT NOT NULL DEFAULT 'inpatient'
                                CHECK (admission_class IN ('inpatient','daycare','observation')),
  admitting_doctor_id         UUID REFERENCES public.practitioners(id),
  primary_diagnosis_icd10     TEXT,
  primary_diagnosis_display   TEXT,
  primary_diagnosis_snomed    TEXT,
  admitting_department_id     UUID REFERENCES public.departments(id),
  specialty                   TEXT,

  -- FHIR Encounter.status
  status                      TEXT NOT NULL DEFAULT 'planned'
                                CHECK (status IN ('planned','arrived','triaged','in-progress','onleave','finished','cancelled','entered-in-error')),

  -- Dates
  admitted_at                 TIMESTAMPTZ,
  discharged_at               TIMESTAMPTZ,
  expected_discharge_date     DATE,

  -- ABDM / FHIR
  care_context_ref            TEXT,
  fhir_encounter_id           TEXT,
  fhir_json                   JSONB,

  -- Insurance
  coverage_id                 UUID REFERENCES public.patient_insurance_coverage(id),
  preauth_id                  UUID REFERENCES public.insurance_preauths(id),

  -- Billing
  billing_account_id          UUID REFERENCES public.billing_accounts(id),

  -- Audit
  admitted_by                 UUID REFERENCES public.practitioners(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_admissions_number 
  ON public.ipd_admissions(hospital_id, admission_number);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_patient ON public.ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_status ON public.ipd_admissions(status);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_bed ON public.ipd_admissions(bed_id);
CREATE INDEX IF NOT EXISTS idx_ipd_wards_hospital ON public.ipd_wards(hospital_id);
CREATE INDEX IF NOT EXISTS idx_ipd_beds_ward ON public.ipd_beds(ward_id);
CREATE INDEX IF NOT EXISTS idx_ipd_beds_status ON public.ipd_beds(status);

-- Triggers
CREATE TRIGGER set_ipd_wards_updated_at BEFORE UPDATE ON public.ipd_wards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_ipd_beds_updated_at BEFORE UPDATE ON public.ipd_beds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_ipd_admissions_updated_at BEFORE UPDATE ON public.ipd_admissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE public.ipd_wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_admissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ipd_wards_isolation ON public.ipd_wards
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_wards.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

CREATE POLICY ipd_beds_isolation ON public.ipd_beds
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_beds.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));

CREATE POLICY ipd_admissions_isolation ON public.ipd_admissions
  USING (EXISTS (SELECT 1 FROM public.practitioners pr 
    WHERE pr.hospital_id = ipd_admissions.hospital_id 
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())));
