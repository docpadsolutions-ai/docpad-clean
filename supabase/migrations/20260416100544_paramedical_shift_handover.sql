-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416100544.

-- ============================================================
-- ipd_shift_handovers: NABH MNS structured nurse handover
-- FHIR: Communication resource (category: handover)
-- ============================================================
CREATE TABLE IF NOT EXISTS ipd_shift_handovers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES hospitals(id),
  admission_id          uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id            uuid NOT NULL REFERENCES patients(id),

  -- Shift metadata
  shift_date            date NOT NULL DEFAULT CURRENT_DATE,
  shift_type            text NOT NULL CHECK (shift_type IN ('morning','afternoon','night')),
  -- Who is handing over and who is receiving
  handover_by           uuid NOT NULL REFERENCES practitioners(id),  -- outgoing nurse
  handover_to           uuid REFERENCES practitioners(id),            -- incoming nurse (may be filled later)
  handover_time         timestamptz NOT NULL DEFAULT NOW(),
  received_time         timestamptz,                                  -- when incoming nurse signs off

  -- SBAR structured content
  situation             text,   -- S: current clinical status in 1-2 sentences
  background            text,   -- B: relevant history, admission reason, day of stay
  assessment            text,   -- A: nurse's assessment of patient condition
  recommendation        text,   -- R: pending actions, watch items for next shift

  -- Nursing-specific handover fields
  current_vitals_json   jsonb,  -- snapshot of latest vitals at handover
  pending_tasks         jsonb,  -- array of {task_name, priority} not yet done
  pending_investigations jsonb, -- array of {test_name, ordered_at}
  iv_access             text,   -- IV site, gauge, last changed
  drain_status          text,   -- drain summary
  pain_score            integer CHECK (pain_score BETWEEN 0 AND 10),
  mobility_status       text,   -- bed-bound / assisted / independent
  special_concerns      text,   -- anything flagged for next shift

  -- Signature
  is_signed_by_receiver boolean NOT NULL DEFAULT false,
  receiver_signature_at timestamptz,

  -- FHIR
  fhir_json             jsonb,

  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_handover_admission ON ipd_shift_handovers(admission_id);
CREATE INDEX idx_handover_date_shift ON ipd_shift_handovers(shift_date, shift_type);

ALTER TABLE ipd_shift_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handover_hospital_access" ON ipd_shift_handovers
  FOR ALL USING (
    hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1)
  );

-- FHIR Communication trigger
CREATE OR REPLACE FUNCTION build_handover_fhir_json()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.fhir_json := jsonb_build_object(
    'resourceType', 'Communication',
    'id', NEW.id::text,
    'status', CASE WHEN NEW.is_signed_by_receiver THEN 'completed' ELSE 'in-progress' END,
    'category', jsonb_build_array(jsonb_build_object(
      'coding', jsonb_build_array(jsonb_build_object(
        'system', 'http://terminology.hl7.org/CodeSystem/communication-category',
        'code', 'notification',
        'display', 'Shift Handover'
      ))
    )),
    'subject', jsonb_build_object('reference', 'Patient/' || NEW.patient_id::text),
    'encounter', jsonb_build_object('reference', 'Encounter/' || NEW.admission_id::text),
    'sent', NEW.handover_time::text,
    'sender', jsonb_build_object('reference', 'Practitioner/' || NEW.handover_by::text),
    'payload', jsonb_build_array(
      jsonb_build_object('contentString', 'S: ' || COALESCE(NEW.situation, '')),
      jsonb_build_object('contentString', 'B: ' || COALESCE(NEW.background, '')),
      jsonb_build_object('contentString', 'A: ' || COALESCE(NEW.assessment, '')),
      jsonb_build_object('contentString', 'R: ' || COALESCE(NEW.recommendation, ''))
    )
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handover_fhir
  BEFORE INSERT OR UPDATE ON ipd_shift_handovers
  FOR EACH ROW EXECUTE FUNCTION build_handover_fhir_json();

-- RPC: get latest handover for an admission
CREATE OR REPLACE FUNCTION get_latest_handover(p_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row ipd_shift_handovers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM ipd_shift_handovers
  WHERE admission_id = p_admission_id
  ORDER BY handover_time DESC LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN row_to_json(v_row)::jsonb;
END;
$$;

-- RPC: receiver signs off handover
CREATE OR REPLACE FUNCTION sign_handover_received(p_handover_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_nurse_id uuid;
BEGIN
  SELECT id INTO v_nurse_id FROM practitioners WHERE user_id = auth.uid() LIMIT 1;
  UPDATE ipd_shift_handovers SET
    handover_to = v_nurse_id,
    is_signed_by_receiver = true,
    received_time = NOW(),
    updated_at = NOW()
  WHERE id = p_handover_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
