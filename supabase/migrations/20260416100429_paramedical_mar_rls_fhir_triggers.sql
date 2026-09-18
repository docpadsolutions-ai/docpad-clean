-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416100429.

-- ============================================================
-- 1. RLS for ipd_mar
-- ============================================================
ALTER TABLE ipd_mar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ipd_mar_hospital_access" ON ipd_mar;
CREATE POLICY "ipd_mar_hospital_access" ON ipd_mar
  FOR ALL USING (
    hospital_id = (
      SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1
    )
  );

-- ============================================================
-- 2. FHIR MedicationAdministration trigger on ipd_mar
-- ============================================================
CREATE OR REPLACE FUNCTION build_mar_fhir_json()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_patient_abha text;
BEGIN
  SELECT p.abha_id INTO v_patient_abha
  FROM patients p WHERE p.id = NEW.patient_id LIMIT 1;

  NEW.fhir_json := jsonb_build_object(
    'resourceType', 'MedicationAdministration',
    'id', NEW.id::text,
    'status', CASE NEW.status
      WHEN 'given'    THEN 'completed'
      WHEN 'held'     THEN 'on-hold'
      WHEN 'refused'  THEN 'not-done'
      WHEN 'omitted'  THEN 'not-done'
      ELSE 'in-progress'
    END,
    'medication', jsonb_build_object(
      'concept', jsonb_build_object(
        'text', NEW.drug_name
      )
    ),
    'subject', jsonb_build_object(
      'reference', 'Patient/' || NEW.patient_id::text
    ),
    'encounter', jsonb_build_object(
      'reference', 'Encounter/' || NEW.admission_id::text
    ),
    'occurenceDateTime', COALESCE(NEW.administered_at, NOW())::text,
    'performer', CASE WHEN NEW.administered_by IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object(
        'actor', jsonb_build_object('reference', 'Practitioner/' || NEW.administered_by::text)
      ))
      ELSE '[]'::jsonb
    END,
    'dosage', jsonb_build_object(
      'text', NEW.dose,
      'route', jsonb_build_object('text', NEW.route),
      'dose', jsonb_build_object('value', NEW.actual_dose_given, 'unit', NEW.dose)
    ),
    'note', CASE WHEN NEW.hold_reason IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object('text', NEW.hold_reason))
      ELSE '[]'::jsonb
    END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mar_fhir ON ipd_mar;
CREATE TRIGGER trg_mar_fhir
  BEFORE INSERT OR UPDATE ON ipd_mar
  FOR EACH ROW EXECUTE FUNCTION build_mar_fhir_json();

-- ============================================================
-- 3. Function to generate MAR slots from ipd_treatments
--    Call after a treatment is ordered: generate_mar_slots(treatment_id, date)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_mar_slots(
  p_treatment_id uuid,
  p_for_date date DEFAULT CURRENT_DATE
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_treatment ipd_treatments%ROWTYPE;
  v_times time[];
  t time;
  v_count int := 0;
BEGIN
  SELECT * INTO v_treatment FROM ipd_treatments WHERE id = p_treatment_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Map frequency to scheduled times (24hr clock)
  v_times := CASE v_treatment.frequency
    WHEN 'OD'   THEN ARRAY['08:00'::time]
    WHEN 'BD'   THEN ARRAY['08:00'::time, '20:00'::time]
    WHEN 'TDS'  THEN ARRAY['08:00'::time, '14:00'::time, '20:00'::time]
    WHEN 'QID'  THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '22:00'::time]
    WHEN 'SOS'  THEN ARRAY['08:00'::time]
    WHEN 'STAT' THEN ARRAY[CURRENT_TIME::time]
    ELSE ARRAY['08:00'::time]
  END;

  FOREACH t IN ARRAY v_times LOOP
    -- Skip if slot already exists for this date+time
    IF NOT EXISTS (
      SELECT 1 FROM ipd_mar
      WHERE treatment_id = p_treatment_id
        AND scheduled_date = p_for_date
        AND scheduled_time = t
    ) THEN
      INSERT INTO ipd_mar (
        hospital_id, admission_id, patient_id, treatment_id,
        drug_name, drug_id, dose, route, frequency,
        scheduled_date, scheduled_time, status
      ) VALUES (
        v_treatment.hospital_id, v_treatment.admission_id, v_treatment.patient_id,
        p_treatment_id, v_treatment.name, NULL,
        COALESCE(v_treatment.dose, ''), COALESCE(v_treatment.route, 'oral'),
        COALESCE(v_treatment.frequency, 'OD'),
        p_for_date, t, 'pending'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. RPC: nurse marks a MAR dose (given/held/refused)
-- ============================================================
CREATE OR REPLACE FUNCTION mark_mar_dose(
  p_mar_id uuid,
  p_status text,  -- 'given' | 'held' | 'refused' | 'omitted'
  p_actual_dose text DEFAULT NULL,
  p_actual_route text DEFAULT NULL,
  p_hold_reason text DEFAULT NULL,
  p_iv_site text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nurse_id uuid;
  v_row ipd_mar%ROWTYPE;
BEGIN
  SELECT id INTO v_nurse_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1;

  UPDATE ipd_mar SET
    status          = p_status,
    administered_at = CASE WHEN p_status = 'given' THEN NOW() ELSE NULL END,
    administered_by = CASE WHEN p_status = 'given' THEN v_nurse_id ELSE NULL END,
    actual_dose_given = COALESCE(p_actual_dose, dose),
    actual_route    = COALESCE(p_actual_route, route),
    hold_reason     = p_hold_reason,
    iv_site         = p_iv_site,
    notes           = p_notes,
    updated_at      = NOW()
  WHERE id = p_mar_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('success', true, 'status', v_row.status, 'administered_at', v_row.administered_at);
END;
$$;

NOTIFY pgrst, 'reload schema';
