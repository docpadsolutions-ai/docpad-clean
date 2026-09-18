-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408072318.

-- Auto-create charge_item when OPD encounter completes
CREATE OR REPLACE FUNCTION auto_create_consultation_charge()
RETURNS TRIGGER AS $$
DECLARE
  v_dept_id uuid;
  v_consult_def_id uuid;
  v_price numeric;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Get department
    v_dept_id := NEW.department_id;
    
    -- Find consultation fee definition
    SELECT id, base_price INTO v_consult_def_id, v_price
    FROM charge_item_definitions
    WHERE hospital_id = NEW.hospital_id
      AND category = 'consultation'
      AND status = 'active'
    LIMIT 1;
    
    -- Create charge item if definition exists
    IF v_consult_def_id IS NOT NULL THEN
      INSERT INTO charge_items (
        hospital_id,
        status,
        charge_code_display,
        category,
        patient_id,
        encounter_id,
        department_id,
        definition_id,
        performing_practitioner_id,
        unit_price,
        net_amount,
        quantity_value
      ) VALUES (
        NEW.hospital_id,
        'billable',
        'OPD Consultation',
        'consultation',
        NEW.patient_id,
        NEW.id,
        v_dept_id,
        v_consult_def_id,
        NEW.doctor_id,
        v_price,
        v_price,
        1
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_consultation_charge ON opd_encounters;
CREATE TRIGGER trigger_auto_consultation_charge
  AFTER UPDATE ON opd_encounters
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_consultation_charge();

-- Auto-create charge_item when investigation is ordered
CREATE OR REPLACE FUNCTION auto_create_investigation_charge()
RETURNS TRIGGER AS $$
DECLARE
  v_def_id uuid;
  v_price numeric;
BEGIN
  -- Only trigger on INSERT
  IF TG_OP = 'INSERT' THEN
    
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
        NEW.test_category,
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

DROP TRIGGER IF EXISTS trigger_auto_investigation_charge ON investigations;
CREATE TRIGGER trigger_auto_investigation_charge
  AFTER INSERT ON investigations
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_investigation_charge();
