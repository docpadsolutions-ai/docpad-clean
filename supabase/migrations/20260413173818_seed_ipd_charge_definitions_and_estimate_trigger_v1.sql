-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413173818.

-- ============================================================
-- SEED: Standard IPD charge definitions (admin can edit prices)
-- Only inserts if not already present (idempotent)
-- ============================================================
INSERT INTO public.charge_item_definitions
  (hospital_id, code, display_name, category, base_price, tax_type, status)
SELECT
  'e90e4607-dd60-4821-b736-02a2577432e0',
  code, display_name, category, base_price, 'gst_exempt', 'active'
FROM (VALUES
  ('ANAESTHESIA-GA',   'Anaesthesia charges (General)',        'procedure',    0.00),
  ('ANAESTHESIA-SA',   'Anaesthesia charges (Spinal)',         'procedure',    0.00),
  ('OT-CHARGES',       'Operation Theatre charges',            'procedure',    0.00),
  ('OT-CHARGES-MINOR', 'Operation Theatre charges (Minor)',    'procedure',    0.00),
  ('NURSING-PD',       'Nursing charges per day',              'nursing',      0.00),
  ('CONSUMABLES-SURG', 'Surgical consumables',                 'supply',       0.00),
  ('CONSUMABLES-IMPL', 'Implant / prosthesis charges',         'supply',       0.00),
  ('DIET-PD',          'Diet charges per day',                 'other',        0.00),
  ('PHYSIO-SESSION',   'Physiotherapy session',                'procedure',    0.00),
  ('BLOOD-UNIT',       'Blood transfusion per unit',           'procedure',    0.00),
  ('IV-FLUIDS',        'IV fluids / infusion charges',         'supply',       0.00)
) AS t(code, display_name, category, base_price)
ON CONFLICT DO NOTHING;

-- ============================================================
-- TRIGGER FUNCTION: Auto-draft procedure estimate on ot_surgeries INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_auto_draft_procedure_estimate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admission        record;
  v_ward             record;
  v_est_days         int;
  v_line_items       jsonb := '[]'::jsonb;

  -- definition lookups
  v_admission_def    record;
  v_procedure_def    record;
  v_anaesthesia_def  record;
  v_ot_def           record;
  v_room_def         record;
  v_nursing_def      record;
  v_consumables_def  record;

  v_room_price       numeric := 0;
  v_nursing_price    numeric := 0;
  v_proc_price       numeric := 0;
BEGIN
  -- Fetch admission + ward info
  SELECT a.*, w.ward_type, w.name AS ward_name
  INTO v_admission
  FROM public.ipd_admissions a
  LEFT JOIN public.ipd_wards w ON w.id = a.ward_id
  WHERE a.id = NEW.admission_id;

  -- Estimated length of stay
  v_est_days := GREATEST(
    COALESCE(
      (v_admission.expected_discharge_date - NEW.surgery_date)::int,
      3
    ),
    1
  );

  -- ── 1. Admission fee ──────────────────────────────────────
  SELECT id, base_price INTO v_admission_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'registration'
    AND display_name ILIKE '%admission%'
    AND status = 'active'
  LIMIT 1;

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          1,
    'description',  'Admission Fee',
    'category',     'registration',
    'definition_id', v_admission_def.id,
    'quantity',     1,
    'unit_price',   COALESCE(v_admission_def.base_price, 0),
    'total',        COALESCE(v_admission_def.base_price, 0),
    'is_unpriced',  (v_admission_def.id IS NULL OR v_admission_def.base_price = 0)
  );

  -- ── 2. Procedure / surgery fee ───────────────────────────
  SELECT id, base_price INTO v_procedure_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'procedure'
    AND display_name ILIKE '%' || NEW.procedure_name || '%'
    AND status = 'active'
  LIMIT 1;

  v_proc_price := COALESCE(v_procedure_def.base_price, 0);

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          2,
    'description',  'Surgical Procedure: ' || NEW.procedure_name,
    'category',     'procedure',
    'definition_id', v_procedure_def.id,
    'quantity',     1,
    'unit_price',   v_proc_price,
    'total',        v_proc_price,
    'is_unpriced',  (v_procedure_def.id IS NULL OR v_proc_price = 0),
    'unpriced_note', CASE WHEN v_proc_price = 0
                     THEN 'Surgeon fee — enter before presenting to patient'
                     ELSE NULL END
  );

  -- ── 3. Anaesthesia ───────────────────────────────────────
  SELECT id, base_price INTO v_anaesthesia_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'procedure'
    AND display_name ILIKE '%anaesthesia%'
    AND (
      -- Match type to surgery's anaesthesia_type where possible
      CASE NEW.anaesthesia_type
        WHEN 'spinal'  THEN display_name ILIKE '%spinal%'
        WHEN 'general' THEN display_name ILIKE '%general%'
        ELSE TRUE
      END
    )
    AND status = 'active'
  ORDER BY
    CASE WHEN NEW.anaesthesia_type IS NOT NULL
         AND display_name ILIKE '%' || NEW.anaesthesia_type || '%'
         THEN 0 ELSE 1 END
  LIMIT 1;

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          3,
    'description',  'Anaesthesia charges' ||
                    CASE WHEN NEW.anaesthesia_type IS NOT NULL
                         THEN ' (' || NEW.anaesthesia_type || ')'
                         ELSE '' END,
    'category',     'procedure',
    'definition_id', v_anaesthesia_def.id,
    'quantity',     1,
    'unit_price',   COALESCE(v_anaesthesia_def.base_price, 0),
    'total',        COALESCE(v_anaesthesia_def.base_price, 0),
    'is_unpriced',  (v_anaesthesia_def.id IS NULL OR COALESCE(v_anaesthesia_def.base_price,0) = 0),
    'unpriced_note', 'Enter anaesthesia fee before presenting to patient'
  );

  -- ── 4. Operation Theatre charges ─────────────────────────
  SELECT id, base_price INTO v_ot_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'procedure'
    AND display_name ILIKE '%operation theatre%'
    AND status = 'active'
  LIMIT 1;

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          4,
    'description',  'Operation Theatre charges',
    'category',     'procedure',
    'definition_id', v_ot_def.id,
    'quantity',     1,
    'unit_price',   COALESCE(v_ot_def.base_price, 0),
    'total',        COALESCE(v_ot_def.base_price, 0),
    'is_unpriced',  (v_ot_def.id IS NULL OR COALESCE(v_ot_def.base_price,0) = 0),
    'unpriced_note', 'Enter OT usage charges'
  );

  -- ── 5. Room / bed charges (per day × days) ───────────────
  -- Match ward type to room charge definition
  SELECT id, base_price INTO v_room_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'room_charge'
    AND status = 'active'
    AND (
      CASE COALESCE(v_admission.ward_type, 'general')
        WHEN 'general'      THEN display_name ILIKE '%general%'
        WHEN 'private'      THEN display_name ILIKE '%private%'
        WHEN 'semi_private' THEN display_name ILIKE '%semi%'
        WHEN 'icu'          THEN display_name ILIKE '%icu%'
        WHEN 'hdu'          THEN display_name ILIKE '%hdu%'
        ELSE display_name ILIKE '%general%'
      END
    )
  LIMIT 1;

  -- Fallback: cheapest active room charge
  IF v_room_def.id IS NULL THEN
    SELECT id, base_price INTO v_room_def
    FROM public.charge_item_definitions
    WHERE hospital_id = NEW.hospital_id AND category = 'room_charge' AND status = 'active'
    ORDER BY base_price ASC LIMIT 1;
  END IF;

  v_room_price := COALESCE(v_room_def.base_price, 0);

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          5,
    'description',  COALESCE(v_admission.ward_name, 'Ward') || ' charges per day',
    'category',     'room_charge',
    'definition_id', v_room_def.id,
    'quantity',     v_est_days,
    'unit_price',   v_room_price,
    'total',        v_room_price * v_est_days,
    'is_unpriced',  (v_room_def.id IS NULL OR v_room_price = 0),
    'est_days',     v_est_days
  );

  -- ── 6. Nursing charges (per day × days) ──────────────────
  -- First try ward_rate_master, then charge_item_definitions
  SELECT nursing_charge_per_day INTO v_nursing_price
  FROM public.ward_rate_master
  WHERE hospital_id = NEW.hospital_id
    AND ward_type = COALESCE(v_admission.ward_type, 'general')
    AND is_active = true
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  LIMIT 1;

  IF v_nursing_price IS NULL OR v_nursing_price = 0 THEN
    SELECT id, base_price INTO v_nursing_def
    FROM public.charge_item_definitions
    WHERE hospital_id = NEW.hospital_id
      AND category = 'nursing'
      AND status = 'active'
    LIMIT 1;
    v_nursing_price := COALESCE(v_nursing_def.base_price, 0);
  END IF;

  v_line_items := v_line_items || jsonb_build_object(
    'seq',          6,
    'description',  'Nursing charges per day',
    'category',     'nursing',
    'definition_id', v_nursing_def.id,
    'quantity',     v_est_days,
    'unit_price',   COALESCE(v_nursing_price, 0),
    'total',        COALESCE(v_nursing_price, 0) * v_est_days,
    'is_unpriced',  (COALESCE(v_nursing_price, 0) = 0),
    'unpriced_note', 'Enter nursing charge per day'
  );

  -- ── 7. Surgical consumables (~25% of procedure fee) ──────
  SELECT id, base_price INTO v_consumables_def
  FROM public.charge_item_definitions
  WHERE hospital_id = NEW.hospital_id
    AND category = 'supply'
    AND display_name ILIKE '%consumable%'
    AND status = 'active'
  LIMIT 1;

  -- If procedure is priced, suggest 25%. Otherwise mark unpriced.
  v_line_items := v_line_items || jsonb_build_object(
    'seq',          7,
    'description',  'Surgical consumables & disposables',
    'category',     'supply',
    'definition_id', v_consumables_def.id,
    'quantity',     1,
    'unit_price',   CASE WHEN v_proc_price > 0
                         THEN ROUND(v_proc_price * 0.25, 0)
                         ELSE 0 END,
    'total',        CASE WHEN v_proc_price > 0
                         THEN ROUND(v_proc_price * 0.25, 0)
                         ELSE 0 END,
    'is_unpriced',  (v_proc_price = 0),
    'unpriced_note', 'Auto-estimated at 25% of procedure fee — adjust as needed',
    'is_auto_estimated', true,
    'estimation_basis', '25% of procedure fee'
  );

  -- ── INSERT estimate ───────────────────────────────────────
  INSERT INTO public.procedure_estimates (
    hospital_id,
    patient_id,
    admission_id,
    surgery_id,
    line_items,
    estimated_total,
    deposit_requested,
    status,
    created_by,
    notes
  ) VALUES (
    NEW.hospital_id,
    NEW.patient_id,
    NEW.admission_id,
    NEW.id,
    v_line_items,
    -- Sum all line totals
    (SELECT COALESCE(SUM((item->>'total')::numeric), 0) FROM jsonb_array_elements(v_line_items) AS item),
    -- Suggest 30% of estimated total as deposit
    ROUND(
      (SELECT COALESCE(SUM((item->>'total')::numeric), 0) FROM jsonb_array_elements(v_line_items) AS item) * 0.30,
      0
    ),
    'draft',
    NEW.created_by,
    'Auto-generated estimate. Review and fill unpriced items before presenting to patient. Consumables estimated at 25% of procedure fee — adjust based on actual implants/disposables.'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_draft_procedure_estimate ON public.ot_surgeries;
CREATE TRIGGER trg_auto_draft_procedure_estimate
  AFTER INSERT ON public.ot_surgeries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_auto_draft_procedure_estimate();

-- Notify PostgREST
SELECT pg_notify('pgrst', 'reload schema');
