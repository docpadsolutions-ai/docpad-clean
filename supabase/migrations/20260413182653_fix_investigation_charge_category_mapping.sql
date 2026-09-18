-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413182653.

CREATE OR REPLACE FUNCTION auto_create_investigation_charge()
RETURNS TRIGGER AS $$
DECLARE
  v_def_id uuid;
  v_price numeric;
  v_mapped_category text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    
    -- Map test_category to valid charge_items category enum
    v_mapped_category := CASE lower(NEW.test_category)
      WHEN 'lab'           THEN 'lab_test'
      WHEN 'lab_test'      THEN 'lab_test'
      WHEN 'biochemistry'  THEN 'lab_test'
      WHEN 'haematology'   THEN 'lab_test'
      WHEN 'hematology'    THEN 'lab_test'
      WHEN 'microbiology'  THEN 'lab_test'
      WHEN 'serology'      THEN 'lab_test'
      WHEN 'coagulation'   THEN 'lab_test'
      WHEN 'immunology'    THEN 'lab_test'
      WHEN 'urine'         THEN 'lab_test'
      WHEN 'imaging'       THEN 'imaging'
      WHEN 'radiology'     THEN 'imaging'
      WHEN 'xray'          THEN 'imaging'
      WHEN 'x-ray'         THEN 'imaging'
      WHEN 'mri'           THEN 'imaging'
      WHEN 'ct'            THEN 'imaging'
      WHEN 'ultrasound'    THEN 'imaging'
      WHEN 'cardiac'       THEN 'procedure'
      WHEN 'ecg'           THEN 'procedure'
      WHEN 'echo'          THEN 'procedure'
      WHEN 'advanced'      THEN 'procedure'
      WHEN 'procedure'     THEN 'procedure'
      ELSE 'lab_test'
    END;

    -- Find test definition by matching test_name
    SELECT cid.id, cid.base_price INTO v_def_id, v_price
    FROM charge_item_definitions cid
    WHERE cid.hospital_id = NEW.hospital_id
      AND cid.category IN ('lab_test', 'imaging')
      AND cid.display_name ILIKE '%' || NEW.test_name || '%'
      AND cid.status = 'active'
    LIMIT 1;
    
    -- Fallback: use investigation_price_master
    IF v_def_id IS NULL THEN
      SELECT base_price INTO v_price
      FROM investigation_price_master
      WHERE hospital_id = NEW.hospital_id
        AND test_name = NEW.test_name
        AND is_active = true
      LIMIT 1;
    END IF;
    
    -- Create charge if price found
    IF v_price IS NOT NULL THEN
      INSERT INTO charge_items (
        hospital_id,
        status,
        charge_code_display,
        category,
        patient_id,
        encounter_id,
        department_id,
        definition_id,
        requesting_practitioner_id,
        unit_price,
        net_amount,
        quantity_value,
        source_type,
        source_id
      ) VALUES (
        NEW.hospital_id,
        'billable',
        NEW.test_name,
        v_mapped_category,
        NEW.patient_id,
        NEW.encounter_id,
        (SELECT department_id FROM opd_encounters WHERE id = NEW.encounter_id LIMIT 1),
        v_def_id,
        NEW.doctor_id,
        v_price,
        v_price,
        1,
        'service_request',
        NEW.id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
