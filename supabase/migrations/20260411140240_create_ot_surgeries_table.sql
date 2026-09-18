-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411140240.

CREATE TABLE IF NOT EXISTS ot_surgeries (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id               uuid NOT NULL REFERENCES hospitals(id),
  admission_id              uuid NOT NULL REFERENCES ipd_admissions(id),
  patient_id                uuid NOT NULL,

  -- Scheduling
  surgery_date              date NOT NULL,
  start_time                time,
  estimated_duration_mins   integer,
  ot_number                 text,

  -- Procedure
  procedure_name            text NOT NULL,
  procedure_snomed          text,
  procedure_icd10           text,
  laterality                text CHECK (laterality IN ('left','right','bilateral','not_applicable')),
  anaesthesia_type          text CHECK (anaesthesia_type IN ('general','spinal','epidural','local','regional','sedation')),

  -- Team
  primary_surgeon_id        uuid REFERENCES practitioners(id),
  assistant_surgeon_id      uuid REFERENCES practitioners(id),
  anaesthetist_id           uuid REFERENCES practitioners(id),
  scrub_nurse_id            uuid REFERENCES practitioners(id),

  -- Status
  status                    text DEFAULT 'scheduled' 
                              CHECK (status IN ('scheduled','in_progress','completed','postponed','cancelled')),
  postpone_reason           text,

  -- Intraop (filled post-op)
  actual_start_time         time,
  actual_end_time           time,
  intraop_notes             text,
  implants_used             jsonb,
  blood_loss_ml             integer,
  complications             text,

  -- NABH / compliance
  site_marking_confirmed    boolean DEFAULT false,
  consent_verified          boolean DEFAULT false,
  natssips_checklist        jsonb,

  -- FHIR
  fhir_procedure_id         text,
  fhir_json                 jsonb,

  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  created_by                uuid
);

CREATE INDEX IF NOT EXISTS idx_ot_surgeries_admission ON ot_surgeries(admission_id);
CREATE INDEX IF NOT EXISTS idx_ot_surgeries_date ON ot_surgeries(surgery_date);
CREATE INDEX IF NOT EXISTS idx_ot_surgeries_hospital ON ot_surgeries(hospital_id);

ALTER TABLE ipd_admissions 
  ADD COLUMN IF NOT EXISTS surgery_id uuid REFERENCES ot_surgeries(id);

NOTIFY pgrst, 'reload schema';
