-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415084903.

-- 1. Add finalization + language columns to prescriptions
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES practitioners(id),
  ADD COLUMN IF NOT EXISTS pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS rx_language TEXT DEFAULT 'en';

-- 2. Add prescription finalization tracking to opd_encounters
ALTER TABLE opd_encounters
  ADD COLUMN IF NOT EXISTS prescription_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prescription_finalized_by UUID REFERENCES practitioners(id);

-- 3. Rebuild pharmacy queue view with all columns
DROP VIEW IF EXISTS pharmacy_ordered_prescription_queue;
CREATE VIEW pharmacy_ordered_prescription_queue AS
  SELECT 
    p.id,
    p.medicine_name,
    p.dosage_text,
    p.frequency,
    p.duration,
    p.total_quantity,
    p.status,
    p.instructions_hi,
    p.rx_language,
    p.finalized_at,
    p.encounter_id,
    p.created_at,
    pt.full_name AS patient_name,
    pt.docpad_id AS patient_docpad_id,
    e.hospital_id
  FROM prescriptions p
  JOIN opd_encounters e ON p.encounter_id = e.id
  JOIN patients pt ON e.patient_id = pt.id
  WHERE p.status IN ('ordered', 'final');

-- 4. finalize_prescription RPC
DROP FUNCTION IF EXISTS finalize_prescription(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION finalize_prescription(
  p_encounter_id UUID,
  p_patient_id   UUID,
  p_hospital_id  UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_practitioner_id UUID;
  v_count           INT := 0;
BEGIN
  SELECT id INTO v_practitioner_id 
  FROM practitioners WHERE user_id = auth.uid();
  
  IF v_practitioner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Practitioner not found');
  END IF;

  SELECT COUNT(*) INTO v_count 
  FROM prescriptions
  WHERE encounter_id = p_encounter_id AND status = 'ordered';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No medications to finalize');
  END IF;

  UPDATE prescriptions
  SET 
    status       = 'final',
    finalized_at = now(),
    finalized_by = v_practitioner_id
  WHERE encounter_id = p_encounter_id AND status = 'ordered';

  UPDATE opd_encounters
  SET 
    prescription_finalized_at = now(),
    prescription_finalized_by = v_practitioner_id
  WHERE id = p_encounter_id;

  RETURN jsonb_build_object(
    'success',         true,
    'drugs_finalized', v_count,
    'message',         'Prescription finalized and sent to pharmacy'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
