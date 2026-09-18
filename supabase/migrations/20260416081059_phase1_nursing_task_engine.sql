-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416081059.

-- ============================================================
-- PHASE 1: NURSING TASK ENGINE
-- Maps ipd_doctor_orders → per-shift nurse task checklist
-- NABH NCS.2 / FHIR Task R4 compliant
-- ============================================================

-- 1. TASK TEMPLATES: Hospital-level reusable task library
--    Ortho-specific templates (distal pulse checks, neuro checks,
--    wound care, traction checks, etc.)
CREATE TABLE IF NOT EXISTS nursing_task_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  task_name           TEXT NOT NULL,
  task_category       TEXT NOT NULL CHECK (task_category IN (
                        'vitals', 'medication', 'wound_care', 'neuro_check',
                        'vascular_check', 'positioning', 'mobilisation',
                        'drain_care', 'traction_check', 'cast_check',
                        'iv_care', 'catheter_care', 'diet', 'education',
                        'specimen', 'procedure', 'other'
                      )),
  default_frequency   TEXT NOT NULL DEFAULT '1xshift'
                        CHECK (default_frequency IN (
                          'once', '1xshift', '2xshift', '4xshift',
                          'hourly', '2hourly', '4hourly', '6hourly',
                          '8hourly', '12hourly', '24hourly', 'prn'
                        )),
  default_shift       TEXT CHECK (default_shift IN ('morning','afternoon','night','all')),
  snomed_code         TEXT,
  snomed_display      TEXT,
  fhir_activity_code  TEXT,
  instructions        TEXT,
  is_ortho_specific   BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. NURSING TASKS: The actual per-patient per-shift task instances
--    Source can be doctor order (auto-generated) or manually added by nurse
CREATE TABLE IF NOT EXISTS nursing_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id        UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id),

  -- Source linkage (nullable = manual task)
  source_doctor_order_id   UUID REFERENCES ipd_doctor_orders(id),
  source_care_plan_id      UUID REFERENCES ipd_nursing_care_plans(id),
  template_id              UUID REFERENCES nursing_task_templates(id),

  -- Task definition
  task_name           TEXT NOT NULL,
  task_category       TEXT NOT NULL CHECK (task_category IN (
                        'vitals', 'medication', 'wound_care', 'neuro_check',
                        'vascular_check', 'positioning', 'mobilisation',
                        'drain_care', 'traction_check', 'cast_check',
                        'iv_care', 'catheter_care', 'diet', 'education',
                        'specimen', 'procedure', 'other'
                      )),
  instructions        TEXT,
  priority            TEXT NOT NULL DEFAULT 'routine'
                        CHECK (priority IN ('stat', 'urgent', 'routine')),

  -- Scheduling
  shift               TEXT NOT NULL CHECK (shift IN ('morning','afternoon','night')),
  due_date            DATE NOT NULL,
  due_time            TIME,
  frequency           TEXT NOT NULL DEFAULT '1xshift'
                        CHECK (frequency IN (
                          'once', '1xshift', '2xshift', '4xshift',
                          'hourly', '2hourly', '4hourly', '6hourly',
                          '8hourly', '12hourly', '24hourly', 'prn'
                        )),
  is_recurring        BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_days     INTEGER,           -- NULL = ongoing until cancelled

  -- Completion tracking
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','skipped','cancelled')),
  completed_at        TIMESTAMPTZ,
  completed_by        UUID REFERENCES practitioners(id),
  completion_notes    TEXT,
  skip_reason         TEXT,

  -- Outcome / observations recorded at task completion
  outcome_json        JSONB,             -- e.g. {pulse: 'present', capillary_refill: '<2s'}

  -- FHIR R4 Task mapping
  fhir_task_id        TEXT,
  fhir_json           JSONB,

  created_by          UUID NOT NULL REFERENCES practitioners(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_admission  ON nursing_tasks(admission_id);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_due        ON nursing_tasks(due_date, shift);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_status     ON nursing_tasks(status);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_category   ON nursing_tasks(task_category);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_patient    ON nursing_tasks(patient_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_hospital  ON nursing_task_templates(hospital_id);

-- 4. RLS
ALTER TABLE nursing_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY nursing_tasks_hospital_isolation ON nursing_tasks
  USING (hospital_id = (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY nursing_task_templates_hospital_isolation ON nursing_task_templates
  USING (hospital_id = (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1
  ));

-- 5. Auto-update updated_at
CREATE OR REPLACE FUNCTION update_nursing_tasks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER nursing_tasks_updated_at
  BEFORE UPDATE ON nursing_tasks
  FOR EACH ROW EXECUTE FUNCTION update_nursing_tasks_updated_at();

-- 6. AUTO-TASK GENERATOR: When a doctor order is inserted/activated,
--    auto-spawn nursing_task rows for the current shift
CREATE OR REPLACE FUNCTION generate_tasks_from_doctor_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
  v_patient_id  UUID;
  v_shift       TEXT;
  v_category    TEXT;
  v_frequency   TEXT;
  v_priority    TEXT;
BEGIN
  -- Only fire for actionable nursing orders
  IF NEW.status NOT IN ('active', 'acknowledged') THEN
    RETURN NEW;
  END IF;

  IF NEW.order_category NOT IN (
    'nursing', 'monitoring', 'wound_care', 'positioning',
    'physiotherapy', 'diet', 'specimen', 'procedure'
  ) THEN
    RETURN NEW;
  END IF;

  -- Get hospital/patient from admission
  SELECT hospital_id, patient_id
  INTO v_hospital_id, v_patient_id
  FROM ipd_admissions
  WHERE id = NEW.admission_id;

  -- Determine current shift from wall clock (IST = UTC+5:30)
  DECLARE v_hour INT := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'));
  BEGIN
    v_shift := CASE
      WHEN v_hour >= 7  AND v_hour < 14 THEN 'morning'
      WHEN v_hour >= 14 AND v_hour < 21 THEN 'afternoon'
      ELSE 'night'
    END;
  END;

  -- Map order_category to task_category
  v_category := CASE NEW.order_category
    WHEN 'monitoring'    THEN 'vitals'
    WHEN 'wound_care'    THEN 'wound_care'
    WHEN 'positioning'   THEN 'positioning'
    WHEN 'physiotherapy' THEN 'mobilisation'
    WHEN 'diet'          THEN 'diet'
    WHEN 'specimen'      THEN 'specimen'
    WHEN 'procedure'     THEN 'procedure'
    ELSE 'other'
  END;

  -- Map priority
  v_priority := CASE NEW.priority
    WHEN 'stat'    THEN 'stat'
    WHEN 'urgent'  THEN 'urgent'
    ELSE 'routine'
  END;

  INSERT INTO nursing_tasks (
    hospital_id, admission_id, patient_id,
    source_doctor_order_id,
    task_name, task_category, instructions,
    priority, shift, due_date, frequency,
    is_recurring, recurrence_days,
    status, created_by
  ) VALUES (
    v_hospital_id, NEW.admission_id, v_patient_id,
    NEW.id,
    NEW.order_text, v_category,
    CASE WHEN NEW.details_json IS NOT NULL
         THEN NEW.details_json->>'instructions' END,
    v_priority, v_shift, CURRENT_DATE,
    '1xshift',
    TRUE, NULL,   -- recurring until order cancelled
    'pending', NEW.ordered_by
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_generate_nursing_tasks
  AFTER INSERT OR UPDATE OF status ON ipd_doctor_orders
  FOR EACH ROW EXECUTE FUNCTION generate_tasks_from_doctor_order();

-- 7. RPC: Get nurse's task checklist for a shift (used by frontend)
CREATE OR REPLACE FUNCTION get_nursing_shift_tasks(
  p_admission_id UUID,
  p_shift TEXT,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  task_id           UUID,
  task_name         TEXT,
  task_category     TEXT,
  priority          TEXT,
  due_time          TIME,
  status            TEXT,
  instructions      TEXT,
  source_order_text TEXT,
  completed_at      TIMESTAMPTZ,
  completed_by_name TEXT,
  completion_notes  TEXT,
  outcome_json      JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nt.id,
    nt.task_name,
    nt.task_category,
    nt.priority,
    nt.due_time,
    nt.status,
    nt.instructions,
    ido.order_text,
    nt.completed_at,
    pr.full_name,
    nt.completion_notes,
    nt.outcome_json
  FROM nursing_tasks nt
  LEFT JOIN ipd_doctor_orders ido ON ido.id = nt.source_doctor_order_id
  LEFT JOIN practitioners pr ON pr.id = nt.completed_by
  WHERE nt.admission_id = p_admission_id
    AND nt.shift = p_shift
    AND nt.due_date = p_date
    AND nt.status != 'cancelled'
  ORDER BY
    CASE nt.priority WHEN 'stat' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
    CASE nt.task_category WHEN 'vascular_check' THEN 1 WHEN 'neuro_check' THEN 2 ELSE 3 END,
    nt.due_time NULLS LAST;
END;
$$;

-- 8. RPC: Complete a task (called by nurse on checklist tap)
CREATE OR REPLACE FUNCTION complete_nursing_task(
  p_task_id        UUID,
  p_notes          TEXT DEFAULT NULL,
  p_outcome_json   JSONB DEFAULT NULL,
  p_skip_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_practitioner_id UUID;
  v_new_status      TEXT;
BEGIN
  SELECT id INTO v_practitioner_id
  FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Practitioner not found');
  END IF;

  v_new_status := CASE WHEN p_skip_reason IS NOT NULL THEN 'skipped' ELSE 'completed' END;

  UPDATE nursing_tasks SET
    status           = v_new_status,
    completed_at     = NOW(),
    completed_by     = v_practitioner_id,
    completion_notes = p_notes,
    outcome_json     = p_outcome_json,
    skip_reason      = p_skip_reason
  WHERE id = p_task_id
    AND hospital_id = (
      SELECT hospital_id FROM practitioners WHERE id = v_practitioner_id
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task not found or access denied');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_new_status);
END;
$$;

-- 9. Seed ortho-specific task templates for Rameshwar Dass Memorial Hospital
INSERT INTO nursing_task_templates
  (hospital_id, task_name, task_category, default_frequency, default_shift,
   snomed_code, snomed_display, instructions, is_ortho_specific)
VALUES
  -- Vascular checks (post-fracture / post-op essential)
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Check distal pulses (6 Ps)',      'vascular_check', '2hourly', 'all',
   '113257007', 'Pulse taking',
   'Check: Pulse, Pain, Pallor, Paraesthesia, Paralysis, Poikilothermia. Document limb and findings.', TRUE),

  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Capillary refill check',          'vascular_check', '4hourly', 'all',
   NULL, NULL,
   'Press nail bed for 5 seconds. Normal refill <2 seconds. Compare bilaterally.', TRUE),

  -- Neuro checks (post-spine / THR / TKR)
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Neurological observation',        'neuro_check', '4hourly', 'all',
   '397808000', 'Neurological assessment',
   'Assess sensation, motor power, and reflexes in operated limb. Document dermatome affected if any.', TRUE),

  -- Wound / drain care
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Drain output measurement',        'drain_care', '1xshift', 'all',
   '225209004', 'Wound drain care',
   'Record volume (mL) and colour of drain output. Check for clots. Record in I/O chart.', TRUE),

  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Wound dressing inspection',       'wound_care', '1xshift', 'morning',
   '182531007', 'Dressing of wound',
   'Inspect for soakage, signs of infection (erythema, warmth, discharge). Do not change unless saturated.', TRUE),

  -- Traction / cast checks
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Traction weight & alignment check', 'traction_check', '1xshift', 'all',
   NULL, NULL,
   'Verify traction weight as per order. Check rope alignment, free-hanging weights, pulley position.', TRUE),

  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'Cast pressure sore inspection',   'cast_check', '1xshift', 'morning',
   NULL, NULL,
   'Check for tight cast: numbness, tingling, pain, swelling distal to cast. Inspect cast edges for skin breakdown.', TRUE),

  -- Positioning / mobilisation
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   '2-hourly repositioning (bed-bound)', 'positioning', '2hourly', 'all',
   '229070002', 'Repositioning patient',
   'Turn patient as per pressure sore protocol. Document position and skin inspection in NAR.', FALSE),

  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'DVT prevention exercises',        'mobilisation', '2xshift', 'all',
   '229070002', 'Therapeutic exercises',
   'Ankle pumps 10x, quad sets 10x. Elevate limb. Encourage deep breathing. Document compliance.', TRUE),

  -- IV care
  ('e90e4607-dd60-4821-b736-02a2577432e0',
   'IV site inspection',              'iv_care', '1xshift', 'all',
   NULL, NULL,
   'Inspect IV site for phlebitis (redness, swelling, pain). Change site if grade ≥2 by VIP scale.', FALSE);

-- 10. Enable realtime for live checklist updates
ALTER PUBLICATION supabase_realtime ADD TABLE nursing_tasks;

NOTIFY pgrst, 'reload schema';
