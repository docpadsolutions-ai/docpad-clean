-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415064851.

-- Trigger function: auto-create consultation charge_item when patient joins OPD queue
CREATE OR REPLACE FUNCTION auto_create_consultation_charge_on_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dept_id     uuid;
  v_dept_name   text;
  v_def_id      uuid;
  v_price       numeric;
  v_hospital_id uuid;
BEGIN
  -- Skip if charge already exists for this queue entry
  IF EXISTS (
    SELECT 1 FROM public.charge_items
    WHERE source_type = 'queue'
      AND source_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Get hospital_id
  SELECT hospital_id INTO v_hospital_id
  FROM public.practitioners
  WHERE id = NEW.assigned_doctor_id
  LIMIT 1;

  v_hospital_id := COALESCE(v_hospital_id, NEW.hospital_id);

  -- Get doctor's primary department
  SELECT p.primary_department_id, d.name
  INTO v_dept_id, v_dept_name
  FROM public.practitioners p
  LEFT JOIN public.departments d ON d.id = p.primary_department_id
  WHERE p.id = NEW.assigned_doctor_id
  LIMIT 1;

  -- Look up best matching consultation fee:
  -- Priority 1: department-specific (e.g. "OPD Consultation — Orthopedics")
  -- Priority 2: generic OPD consultation
  SELECT id, base_price INTO v_def_id, v_price
  FROM public.charge_item_definitions
  WHERE hospital_id = v_hospital_id
    AND category = 'consultation'
    AND status = 'active'
    AND display_name ILIKE '%' || COALESCE(v_dept_name, '') || '%'
  ORDER BY
    CASE WHEN display_name ILIKE '%' || COALESCE(v_dept_name, '') || '%' THEN 0 ELSE 1 END
  LIMIT 1;

  -- Fallback to generic consultation
  IF v_def_id IS NULL THEN
    SELECT id, base_price INTO v_def_id, v_price
    FROM public.charge_item_definitions
    WHERE hospital_id = v_hospital_id
      AND category = 'consultation'
      AND status = 'active'
      AND display_name ILIKE '%general%'
    LIMIT 1;
  END IF;

  -- Still no match — use any active consultation fee
  IF v_def_id IS NULL THEN
    SELECT id, base_price INTO v_def_id, v_price
    FROM public.charge_item_definitions
    WHERE hospital_id = v_hospital_id
      AND category = 'consultation'
      AND status = 'active'
    LIMIT 1;
  END IF;

  -- Only create charge if we found a price
  IF v_def_id IS NOT NULL AND v_price > 0 THEN
    INSERT INTO public.charge_items (
      hospital_id,
      status,
      category,
      patient_id,
      department_id,
      definition_id,
      requesting_practitioner_id,
      charge_code_display,
      unit_price,
      unit_price_snapshot,
      net_amount,
      quantity_value,
      source_type,
      source_id
    ) VALUES (
      v_hospital_id,
      'billable',
      'consultation',
      NEW.patient_id,
      v_dept_id,
      v_def_id,
      NEW.assigned_doctor_id,
      (SELECT display_name FROM public.charge_item_definitions WHERE id = v_def_id),
      v_price,
      v_price,
      v_price,
      1,
      'queue',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger on reception_queue INSERT
DROP TRIGGER IF EXISTS trg_auto_consultation_charge ON public.reception_queue;
CREATE TRIGGER trg_auto_consultation_charge
  AFTER INSERT ON public.reception_queue
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_consultation_charge_on_queue();
