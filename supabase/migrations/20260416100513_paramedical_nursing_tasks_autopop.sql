-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416100513.

-- ============================================================
-- 1. RLS for nursing_tasks
-- ============================================================
ALTER TABLE nursing_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nursing_tasks_hospital_access" ON nursing_tasks;
CREATE POLICY "nursing_tasks_hospital_access" ON nursing_tasks
  FOR ALL USING (
    hospital_id = (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1
    )
  );

-- ============================================================
-- 2. Trigger: when a doctor order is inserted (order_category = 'nursing'),
--    auto-create a nursing_task for current shift
-- ============================================================
CREATE OR REPLACE FUNCTION auto_create_nursing_task_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift text;
  v_hour int;
BEGIN
  -- Only fire for nursing-category orders
  IF NEW.order_category NOT IN ('nursing', 'vte', 'fall_risk', 'pressure_sore', 'positioning', 'monitoring') THEN
    RETURN NEW;
  END IF;

  -- Determine shift from current time
  v_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  v_shift := CASE
    WHEN v_hour >= 7  AND v_hour < 15 THEN 'morning'
    WHEN v_hour >= 15 AND v_hour < 23 THEN 'afternoon'
    ELSE 'night'
  END;

  INSERT INTO nursing_tasks (
    hospital_id, admission_id, patient_id,
    source_doctor_order_id,
    task_name, task_category, instructions,
    priority, shift, due_date,
    frequency, is_recurring, status,
    created_by
  ) VALUES (
    NEW.hospital_id, NEW.admission_id, NEW.patient_id,
    NEW.id,
    NEW.order_text,
    NEW.order_category,
    COALESCE((NEW.details_json->>'instructions')::text, NEW.order_text),
    NEW.priority,
    v_shift,
    CURRENT_DATE,
    COALESCE((NEW.details_json->>'frequency')::text, '1xshift'),
    COALESCE((NEW.details_json->>'recurring')::boolean, false),
    'pending',
    NEW.ordered_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_nursing_task_from_order ON ipd_doctor_orders;
CREATE TRIGGER trg_auto_nursing_task_from_order
  AFTER INSERT ON ipd_doctor_orders
  FOR EACH ROW EXECUTE FUNCTION auto_create_nursing_task_from_order();

-- ============================================================
-- 3. Trigger: when ipd_nabh_checklist item is saved with a 
--    nursing-side flag, push to nursing_tasks
--    Checks existing columns first — uses is_completed, checklist_type
-- ============================================================
CREATE OR REPLACE FUNCTION auto_create_nursing_task_from_nabh()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift text;
  v_hour int;
  v_task_name text;
  v_admission ipd_admissions%ROWTYPE;
BEGIN
  -- Only act when something relevant is newly checked
  -- Only for nursing-actionable checklist types
  IF NEW.checklist_type NOT IN ('vte_prophylaxis','fall_risk','pressure_sore','nutrition_screen','pain_assessment','discharge_planning') THEN
    RETURN NEW;
  END IF;

  -- Only fire on first completion (was NULL or false, now true)
  IF COALESCE(OLD.is_completed, false) = true THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.is_completed, false) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_admission FROM ipd_admissions WHERE id = NEW.admission_id LIMIT 1;

  v_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  v_shift := CASE
    WHEN v_hour >= 7  AND v_hour < 15 THEN 'morning'
    WHEN v_hour >= 15 AND v_hour < 23 THEN 'afternoon'
    ELSE 'night'
  END;

  v_task_name := CASE NEW.checklist_type
    WHEN 'vte_prophylaxis'    THEN 'VTE Prophylaxis — administer LMWH / apply TED stockings'
    WHEN 'fall_risk'          THEN 'Fall Risk — bed rails up, call bell in reach, non-slip footwear'
    WHEN 'pressure_sore'      THEN 'Pressure Sore Prevention — 2-hourly repositioning'
    WHEN 'nutrition_screen'   THEN 'Nutrition Screen — complete MUST/NRS-2002 score'
    WHEN 'pain_assessment'    THEN 'Pain Assessment — record VAS/NRS score'
    WHEN 'discharge_planning' THEN 'Discharge Planning — initiate checklist with family'
    ELSE NEW.checklist_type
  END;

  -- Avoid duplicate tasks for same admission+type+date
  IF NOT EXISTS (
    SELECT 1 FROM nursing_tasks
    WHERE admission_id = NEW.admission_id
      AND task_category = NEW.checklist_type
      AND due_date = CURRENT_DATE
      AND status = 'pending'
  ) THEN
    INSERT INTO nursing_tasks (
      hospital_id, admission_id, patient_id,
      task_name, task_category,
      priority, shift, due_date,
      frequency, is_recurring, status,
      created_by
    ) VALUES (
      v_admission.hospital_id, NEW.admission_id, v_admission.patient_id,
      v_task_name, NEW.checklist_type,
      'high', v_shift, CURRENT_DATE,
      '1xshift', true, 'pending',
      COALESCE(NEW.checked_by, v_admission.admitting_doctor_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nabh_to_nursing_task ON ipd_nabh_checklist;
CREATE TRIGGER trg_nabh_to_nursing_task
  AFTER INSERT OR UPDATE ON ipd_nabh_checklist
  FOR EACH ROW EXECUTE FUNCTION auto_create_nursing_task_from_nabh();

-- ============================================================
-- 4. RPC: complete a nursing task
-- ============================================================
CREATE OR REPLACE FUNCTION complete_nursing_task(
  p_task_id uuid,
  p_notes text DEFAULT NULL,
  p_outcome jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nurse_id uuid;
BEGIN
  SELECT id INTO v_nurse_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  UPDATE nursing_tasks SET
    status           = 'completed',
    completed_at     = NOW(),
    completed_by     = v_nurse_id,
    completion_notes = p_notes,
    outcome_json     = p_outcome,
    updated_at       = NOW()
  WHERE id = p_task_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 5. RPC: get shift task queue for nurse
-- ============================================================
CREATE OR REPLACE FUNCTION get_nursing_shift_tasks(
  p_shift text DEFAULT NULL,  -- 'morning'|'afternoon'|'night'|null=auto
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  task_id uuid,
  patient_id uuid,
  patient_name text,
  bed_number text,
  ward_name text,
  task_name text,
  task_category text,
  priority text,
  shift text,
  due_time time,
  status text,
  instructions text,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id uuid;
  v_shift text;
  v_hour int;
BEGIN
  SELECT hospital_id INTO v_hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  v_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  v_shift := COALESCE(p_shift, CASE
    WHEN v_hour >= 7  AND v_hour < 15 THEN 'morning'
    WHEN v_hour >= 15 AND v_hour < 23 THEN 'afternoon'
    ELSE 'night'
  END);

  RETURN QUERY
  SELECT
    nt.id,
    nt.patient_id,
    pat.full_name,
    b.bed_number,
    w.ward_name,
    nt.task_name,
    nt.task_category,
    nt.priority,
    nt.shift,
    nt.due_time,
    nt.status,
    nt.instructions,
    CASE
      WHEN nt.source_doctor_order_id IS NOT NULL THEN 'doctor_order'
      WHEN nt.source_care_plan_id IS NOT NULL     THEN 'care_plan'
      ELSE 'manual'
    END
  FROM nursing_tasks nt
  JOIN patients pat ON pat.id = nt.patient_id
  LEFT JOIN ipd_admissions adm ON adm.id = nt.admission_id
  LEFT JOIN ipd_beds b ON b.id = adm.bed_id
  LEFT JOIN ipd_wards w ON w.id = b.ward_id
  WHERE nt.hospital_id = v_hospital_id
    AND nt.due_date = p_date
    AND nt.shift = v_shift
    AND nt.status IN ('pending', 'in_progress')
  ORDER BY
    CASE nt.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
    nt.due_time NULLS LAST;
END;
$$;

NOTIFY pgrst, 'reload schema';
