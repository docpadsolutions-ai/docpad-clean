-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413154542.

-- 1. Add is_in_house flag to test_catalogue
ALTER TABLE public.test_catalogue
ADD COLUMN IF NOT EXISTS is_in_house boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS external_lab_name text,
ADD COLUMN IF NOT EXISTS requires_prereception boolean NOT NULL DEFAULT false;
-- requires_prereception = must pass through reception billing before lab sees it

-- 2. Add billing/routing fields to ipd_investigation_orders
ALTER TABLE public.ipd_investigation_orders
ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'pending_payment'
  CHECK (billing_status IN ('pending_payment','paid','insurance_covered','waived','emergency_override')),
ADD COLUMN IF NOT EXISTS charge_item_id uuid REFERENCES public.charge_items(id),
ADD COLUMN IF NOT EXISTS insurance_coverage_id uuid REFERENCES public.patient_insurance_coverage(id),
ADD COLUMN IF NOT EXISTS is_in_house boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS external_lab_name text,
ADD COLUMN IF NOT EXISTS requisition_printed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sample_collected_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS sample_collected_by uuid REFERENCES public.practitioners(id);

-- 3. RPC: place_investigation_order
-- Handles billing gate logic automatically
CREATE OR REPLACE FUNCTION public.place_investigation_order(
  p_hospital_id       uuid,
  p_admission_id      uuid,
  p_patient_id        uuid,
  p_progress_note_id  uuid,
  p_test_name         text,
  p_test_category     text,
  p_loinc_code        text DEFAULT NULL,
  p_priority          text DEFAULT 'routine',
  p_ordered_by        uuid DEFAULT NULL,
  p_investigation_id  uuid DEFAULT NULL,
  p_ordered_on_day    integer DEFAULT NULL,
  p_ordered_date      date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id          uuid;
  v_billing_status    text;
  v_order_status      text;
  v_is_in_house       boolean := true;
  v_external_lab      text;
  v_coverage_id       uuid;
  v_base_price        numeric;
  v_charge_item_id    uuid;
BEGIN
  -- Check if patient has active insurance coverage for this admission
  SELECT pc.id INTO v_coverage_id
  FROM public.ipd_admissions a
  JOIN public.patient_insurance_coverage pc ON pc.patient_id = a.patient_id
  WHERE a.id = p_admission_id
    AND pc.is_active = true
  LIMIT 1;

  -- Get test details from catalogue
  SELECT is_in_house, external_lab_name
  INTO v_is_in_house, v_external_lab
  FROM public.test_catalogue
  WHERE id = p_investigation_id AND hospital_id = p_hospital_id;

  -- Determine billing status and initial order status
  IF v_coverage_id IS NOT NULL THEN
    -- Insurance patient → no billing gate
    v_billing_status := 'insurance_covered';
    v_order_status   := 'ordered';
  ELSIF p_priority = 'stat' THEN
    -- STAT orders bypass billing gate
    v_billing_status := 'emergency_override';
    v_order_status   := 'ordered';
  ELSE
    -- Self-pay → billing gate
    v_billing_status := 'pending_payment';
    v_order_status   := 'pending_payment';
  END IF;

  -- Create the order
  INSERT INTO public.ipd_investigation_orders (
    hospital_id, admission_id, patient_id, progress_note_id,
    test_name, test_category, loinc_code, priority, status,
    ordered_by, investigation_id, ordered_on_day, ordered_date,
    billing_status, insurance_coverage_id, is_in_house, external_lab_name
  ) VALUES (
    p_hospital_id, p_admission_id, p_patient_id, p_progress_note_id,
    p_test_name, p_test_category, p_loinc_code, p_priority, v_order_status,
    p_ordered_by, p_investigation_id, p_ordered_on_day, p_ordered_date,
    v_billing_status, v_coverage_id, v_is_in_house, v_external_lab
  ) RETURNING id INTO v_order_id;

  -- Auto-create charge item
  SELECT base_price INTO v_base_price
  FROM public.investigation_price_master
  WHERE test_catalogue_id = p_investigation_id
    AND hospital_id = p_hospital_id
  LIMIT 1;

  IF v_base_price IS NOT NULL THEN
    INSERT INTO public.charge_items (
      hospital_id, patient_id, category,
      description, quantity, unit_price,
      status, source_type
    ) VALUES (
      p_hospital_id, p_patient_id, 'lab_test',
      p_test_name, 1, v_base_price,
      CASE WHEN v_coverage_id IS NOT NULL THEN 'planned' ELSE 'planned' END,
      'service_request'
    ) RETURNING id INTO v_charge_item_id;

    UPDATE public.ipd_investigation_orders
    SET charge_item_id = v_charge_item_id
    WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object(
    'order_id',       v_order_id,
    'status',         v_order_status,
    'billing_status', v_billing_status,
    'is_in_house',    v_is_in_house,
    'has_insurance',  (v_coverage_id IS NOT NULL),
    'charge_item_id', v_charge_item_id
  );
END;
$$;

-- 4. RPC: confirm_investigation_payment (reception calls this)
CREATE OR REPLACE FUNCTION public.confirm_investigation_payment(
  p_order_id    uuid,
  p_confirmed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.ipd_investigation_orders SET
    billing_status = 'paid',
    status         = 'ordered',
    updated_at     = now()
  WHERE id = p_order_id
    AND billing_status = 'pending_payment';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found or already paid');
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$;

-- 5. RPC: get_lab_queue (lab tech portal)
-- Only shows orders that have cleared billing
CREATE OR REPLACE FUNCTION public.get_lab_queue(p_hospital_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'order_id',        o.id,
    'test_name',       o.test_name,
    'test_category',   o.test_category,
    'loinc_code',      o.loinc_code,
    'priority',        o.priority,
    'ordered_date',    o.ordered_date,
    'status',          o.status,
    'is_in_house',     o.is_in_house,
    'billing_status',  o.billing_status,
    'patient_name',    p.full_name,
    'patient_age',     EXTRACT(YEAR FROM age(p.date_of_birth))::int,
    'patient_sex',     p.sex,
    'ward_name',       w.name,
    'bed_number',      b.bed_number,
    'admission_number',a.admission_number,
    'sample_type',     tc.sample_type,
    'requires_fasting',tc.requires_fasting,
    'expected_tat_hrs',tc.expected_tat_hours,
    'ordered_by_name', dr.full_name
  ) ORDER BY 
    CASE o.priority WHEN 'stat' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
    o.created_at
  )
  INTO v_result
  FROM public.ipd_investigation_orders o
  JOIN public.patients p ON p.id = o.patient_id
  JOIN public.ipd_admissions a ON a.id = o.admission_id
  LEFT JOIN public.ipd_wards w ON w.id = a.ward_id
  LEFT JOIN public.ipd_beds b ON b.id = a.bed_id
  LEFT JOIN public.practitioners dr ON dr.id = o.ordered_by
  LEFT JOIN public.test_catalogue tc ON tc.id = o.investigation_id
  WHERE o.hospital_id = p_hospital_id
    AND o.is_in_house = true
    AND o.status IN ('ordered', 'sample_collected')
    AND o.billing_status IN ('paid', 'insurance_covered', 'emergency_override', 'waived');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 6. Add is_in_house to test_catalogue — update existing records
-- Default all to in-house; admin can change external ones
UPDATE public.test_catalogue SET is_in_house = true WHERE is_in_house IS NULL;

NOTIFY pgrst, 'reload schema';
