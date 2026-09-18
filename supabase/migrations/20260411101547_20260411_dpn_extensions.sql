-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411101547.

-- ============================================================
-- DPN EXTENSIONS for Daily Progress Note UI
-- User table = practitioners (not profiles)
-- ============================================================

-- 1. WOUND & SURGICAL SITE ASSESSMENT
CREATE TABLE IF NOT EXISTS ipd_wound_assessments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES hospitals(id),
  admission_id         uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  progress_note_id     uuid REFERENCES ipd_progress_notes(id) ON DELETE SET NULL,
  patient_id           uuid NOT NULL REFERENCES patients(id),
  assessed_at          timestamptz NOT NULL DEFAULT now(),
  assessed_by          uuid REFERENCES practitioners(id),
  wound_location       text,
  wound_type           text DEFAULT 'surgical',
  discharge_type       text DEFAULT 'none',
  suture_status        text DEFAULT 'intact',
  swelling             text DEFAULT 'none',
  erythema             text DEFAULT 'none',
  wound_dehiscence     boolean DEFAULT false,
  drain_present        boolean DEFAULT false,
  drain_type           text,
  drain_output_ml      integer,
  drain_colour         text,
  wound_notes          text,
  photo_storage_path   text,
  fhir_json            jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- 2. INTAKE / OUTPUT (fluid balance)
CREATE TABLE IF NOT EXISTS ipd_io_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES hospitals(id),
  admission_id         uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  progress_note_id     uuid REFERENCES ipd_progress_notes(id) ON DELETE SET NULL,
  patient_id           uuid NOT NULL REFERENCES patients(id),
  record_date          date NOT NULL,
  recorded_by          uuid REFERENCES practitioners(id),
  oral_intake_ml       integer DEFAULT 0,
  iv_fluid_ml          integer DEFAULT 0,
  blood_product_ml     integer DEFAULT 0,
  ng_feed_ml           integer DEFAULT 0,
  other_intake_ml      integer DEFAULT 0,
  total_intake_ml      integer GENERATED ALWAYS AS (
                         COALESCE(oral_intake_ml,0) + COALESCE(iv_fluid_ml,0) +
                         COALESCE(blood_product_ml,0) + COALESCE(ng_feed_ml,0) +
                         COALESCE(other_intake_ml,0)
                       ) STORED,
  urine_output_ml      integer DEFAULT 0,
  drain_output_ml      integer DEFAULT 0,
  stool_ml             integer DEFAULT 0,
  vomit_ml             integer DEFAULT 0,
  other_output_ml      integer DEFAULT 0,
  total_output_ml      integer GENERATED ALWAYS AS (
                         COALESCE(urine_output_ml,0) + COALESCE(drain_output_ml,0) +
                         COALESCE(stool_ml,0) + COALESCE(vomit_ml,0) +
                         COALESCE(other_output_ml,0)
                       ) STORED,
  io_notes             text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, record_date)
);

-- 3. IPD INVESTIGATION ORDERS (day-anchored)
CREATE TABLE IF NOT EXISTS ipd_investigation_orders (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id               uuid NOT NULL REFERENCES hospitals(id),
  admission_id              uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id                uuid NOT NULL REFERENCES patients(id),
  progress_note_id          uuid REFERENCES ipd_progress_notes(id) ON DELETE SET NULL,
  ordered_on_day            integer NOT NULL,
  ordered_date              date NOT NULL,
  ordered_by                uuid REFERENCES practitioners(id),
  test_name                 text NOT NULL,
  test_category             text DEFAULT 'lab',
  loinc_code                text,
  priority                  text DEFAULT 'routine',
  status                    text NOT NULL DEFAULT 'ordered',
  result_text               text,
  result_value              text,
  result_unit               text,
  is_critical               boolean DEFAULT false,
  critical_acknowledged_by  uuid REFERENCES practitioners(id),
  critical_acknowledged_at  timestamptz,
  result_available_at       timestamptz,
  investigation_id          uuid REFERENCES investigations(id),
  report_file_path          text,
  fhir_service_request_id   text,
  fhir_diagnostic_report_id text,
  fhir_json                 jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- 4. NURSING ADMINISTRATION RECORD (NAR)
CREATE TABLE IF NOT EXISTS ipd_nar_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES hospitals(id),
  treatment_id     uuid NOT NULL REFERENCES ipd_treatments(id) ON DELETE CASCADE,
  admission_id     uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES patients(id),
  scheduled_at     timestamptz NOT NULL,
  administered_at  timestamptz,
  administered_by  uuid REFERENCES practitioners(id),
  status           text NOT NULL DEFAULT 'scheduled',
  dose_given       text,
  route_given      text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 5. NABH DAILY CHECKLIST
CREATE TABLE IF NOT EXISTS ipd_nabh_checklist (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              uuid NOT NULL REFERENCES hospitals(id),
  admission_id             uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  progress_note_id         uuid NOT NULL REFERENCES ipd_progress_notes(id) ON DELETE CASCADE,
  patient_id               uuid NOT NULL REFERENCES patients(id),
  checklist_date           date NOT NULL,
  completed_by             uuid REFERENCES practitioners(id),
  vte_prophylaxis_given    boolean DEFAULT false,
  vte_prophylaxis_notes    text,
  fall_risk_assessed       boolean DEFAULT false,
  fall_risk_score          integer,
  fall_risk_level          text,
  pressure_sore_checked    boolean DEFAULT false,
  pressure_sore_grade      integer,
  consent_valid            boolean DEFAULT false,
  restraint_used           boolean DEFAULT false,
  restraint_reviewed       boolean DEFAULT false,
  diet_order               text DEFAULT 'normal',
  diet_notes               text,
  activity_order           text DEFAULT 'bed_rest',
  iv_access_site           text,
  iv_access_notes          text,
  discharge_planning_done  boolean DEFAULT false,
  estimated_discharge_date date,
  discharge_notes          text,
  consults_requested       jsonb DEFAULT '[]',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (progress_note_id)
);

-- 6. CONDITION TIMELINE (drives trend bar)
CREATE TABLE IF NOT EXISTS ipd_condition_timeline (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES hospitals(id),
  admission_id     uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES patients(id),
  progress_note_id uuid REFERENCES ipd_progress_notes(id) ON DELETE SET NULL,
  recorded_date    date NOT NULL,
  hospital_day     integer NOT NULL,
  condition_status text NOT NULL,
  recorded_by      uuid REFERENCES practitioners(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, recorded_date)
);

-- ============================================================
-- EXTEND ipd_progress_notes
-- ============================================================
ALTER TABLE ipd_progress_notes
  ADD COLUMN IF NOT EXISTS appetite         text,
  ADD COLUMN IF NOT EXISTS sleep_ok         boolean,
  ADD COLUMN IF NOT EXISTS bowel_ok         boolean,
  ADD COLUMN IF NOT EXISTS bladder_ok       boolean,
  ADD COLUMN IF NOT EXISTS pain_score       integer,
  ADD COLUMN IF NOT EXISTS condition_status text,
  ADD COLUMN IF NOT EXISTS plan_narrative   text,
  ADD COLUMN IF NOT EXISTS post_op_day      integer;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_wound_admission      ON ipd_wound_assessments(admission_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_io_admission_date    ON ipd_io_records(admission_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_orders_admission ON ipd_investigation_orders(admission_id, ordered_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_orders_pending   ON ipd_investigation_orders(status) WHERE status NOT IN ('reported','cancelled');
CREATE INDEX IF NOT EXISTS idx_nar_treatment        ON ipd_nar_records(treatment_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_nar_admission        ON ipd_nar_records(admission_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_nabh_admission       ON ipd_nabh_checklist(admission_id, checklist_date DESC);
CREATE INDEX IF NOT EXISTS idx_condition_timeline   ON ipd_condition_timeline(admission_id, recorded_date ASC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE ipd_wound_assessments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_io_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_investigation_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_nar_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_nabh_checklist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_condition_timeline   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_wound"     ON ipd_wound_assessments    FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_io"        ON ipd_io_records           FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_inv_ord"   ON ipd_investigation_orders FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_nar"       ON ipd_nar_records          FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_nabh"      ON ipd_nabh_checklist       FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_cond_tl"   ON ipd_condition_timeline   FOR ALL USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
