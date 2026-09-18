-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416101113.

-- =============================================
-- PHASE 3: WARD INVENTORY + CONSUMABLE USAGE
-- PHASE 5: AUTO-BILLING FROM NURSING PROCEDURES
-- NABH MOM.11 compliant, FHIR ChargeItem sourced
-- =============================================

-- 1. Ward Inventory Master
CREATE TABLE IF NOT EXISTS ward_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL,
  ward_id             UUID NOT NULL REFERENCES ipd_wards(id) ON DELETE CASCADE,
  item_name           TEXT NOT NULL,
  item_code           TEXT,
  category            TEXT CHECK (category IN ('consumable','medication','equipment','linen','other')) DEFAULT 'consumable',
  unit_of_measure     TEXT NOT NULL DEFAULT 'piece',
  current_stock       NUMERIC NOT NULL DEFAULT 0,
  minimum_stock       NUMERIC NOT NULL DEFAULT 5,
  unit_cost           NUMERIC,
  charge_item_def_id  UUID REFERENCES charge_item_definitions(id),
  is_billable         BOOLEAN NOT NULL DEFAULT true,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  last_restocked_at   TIMESTAMPTZ,
  last_restocked_by   UUID REFERENCES practitioners(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ward_id, item_code)
);

-- 2. Consumable Usage Log
CREATE TABLE IF NOT EXISTS consumable_usage_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL,
  ward_inventory_id   UUID NOT NULL REFERENCES ward_inventory(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  admission_id        UUID REFERENCES ipd_admissions(id),
  nursing_task_id     UUID REFERENCES nursing_tasks(id),
  quantity_used       NUMERIC NOT NULL CHECK (quantity_used > 0),
  unit_of_measure     TEXT NOT NULL,
  used_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_by             UUID NOT NULL REFERENCES practitioners(id),
  notes               TEXT,
  charge_item_id      UUID REFERENCES charge_items(id),
  is_billed           BOOLEAN NOT NULL DEFAULT false,
  bill_override_reason TEXT,
  fhir_json           JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Ward Stock Restock Log
CREATE TABLE IF NOT EXISTS ward_stock_restock_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL,
  ward_inventory_id UUID NOT NULL REFERENCES ward_inventory(id),
  quantity_added    NUMERIC NOT NULL,
  restocked_by      UUID NOT NULL REFERENCES practitioners(id),
  source_note       TEXT,
  restocked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Nursing Procedure Logs
CREATE TABLE IF NOT EXISTS nursing_procedure_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL,
  patient_id        UUID NOT NULL REFERENCES patients(id),
  admission_id      UUID REFERENCES ipd_admissions(id),
  nursing_task_id   UUID REFERENCES nursing_tasks(id),
  procedure_name    TEXT NOT NULL,
  procedure_code    TEXT,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by      UUID NOT NULL REFERENCES practitioners(id),
  notes             TEXT,
  charge_item_def_id UUID REFERENCES charge_item_definitions(id),
  charge_item_id     UUID REFERENCES charge_items(id),
  is_billed          BOOLEAN NOT NULL DEFAULT false,
  fhir_json          JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ward_inventory_ward ON ward_inventory(ward_id);
CREATE INDEX IF NOT EXISTS idx_ward_inventory_hospital ON ward_inventory(hospital_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_patient ON consumable_usage_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_admission ON consumable_usage_logs(admission_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_unbilled ON consumable_usage_logs(is_billed) WHERE is_billed = false;
CREATE INDEX IF NOT EXISTS idx_nursing_procedure_patient ON nursing_procedure_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_nursing_procedure_unbilled ON nursing_procedure_logs(is_billed) WHERE is_billed = false;

-- =============================================
-- TRIGGER: Deduct stock on consumable use
-- =============================================
CREATE OR REPLACE FUNCTION deduct_ward_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ward_inventory
  SET current_stock = current_stock - NEW.quantity_used, updated_at = now()
  WHERE id = NEW.ward_inventory_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deduct_ward_stock ON consumable_usage_logs;
CREATE TRIGGER trg_deduct_ward_stock
  AFTER INSERT ON consumable_usage_logs
  FOR EACH ROW EXECUTE FUNCTION deduct_ward_stock();

-- =============================================
-- TRIGGER: Auto-bill on consumable usage
-- =============================================
CREATE OR REPLACE FUNCTION auto_bill_consumable_usage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv   ward_inventory%ROWTYPE;
  v_def   charge_item_definitions%ROWTYPE;
  v_ci_id UUID;
  v_price NUMERIC;
BEGIN
  SELECT * INTO v_inv FROM ward_inventory WHERE id = NEW.ward_inventory_id;
  IF v_inv.is_billable = false OR v_inv.charge_item_def_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_def FROM charge_item_definitions WHERE id = v_inv.charge_item_def_id;
  v_price := COALESCE(v_inv.unit_cost, v_def.base_price, 0);

  INSERT INTO charge_items (
    hospital_id, patient_id, encounter_id,
    definition_id, charge_code, charge_code_system, charge_code_display,
    category, status, quantity_value, quantity_unit,
    unit_price, unit_price_snapshot, net_amount,
    source_type, source_id,
    service_period_start, service_period_end,
    created_by, created_at, updated_at
  ) VALUES (
    NEW.hospital_id, NEW.patient_id, NEW.admission_id,
    v_def.id, COALESCE(v_def.code,'CONSUMABLE'), COALESCE(v_def.code_system,'local'),
    COALESCE(v_def.display_name, v_inv.item_name),
    COALESCE(v_def.category,'consumable'), 'billable',
    NEW.quantity_used, NEW.unit_of_measure,
    v_price, v_price, (v_price * NEW.quantity_used),
    'consumable_usage', NEW.id,
    NEW.used_at, NEW.used_at,
    NEW.used_by, now(), now()
  ) RETURNING id INTO v_ci_id;

  UPDATE consumable_usage_logs SET charge_item_id = v_ci_id, is_billed = true WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_bill_consumable ON consumable_usage_logs;
CREATE TRIGGER trg_auto_bill_consumable
  AFTER INSERT ON consumable_usage_logs
  FOR EACH ROW EXECUTE FUNCTION auto_bill_consumable_usage();

-- =============================================
-- TRIGGER: Auto-bill on nursing procedure
-- =============================================
CREATE OR REPLACE FUNCTION auto_bill_nursing_procedure()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_def   charge_item_definitions%ROWTYPE;
  v_ci_id UUID;
  v_price NUMERIC;
BEGIN
  IF NEW.charge_item_def_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_def FROM charge_item_definitions WHERE id = NEW.charge_item_def_id;
  v_price := COALESCE(v_def.base_price, 0);

  INSERT INTO charge_items (
    hospital_id, patient_id, encounter_id,
    definition_id, charge_code, charge_code_system, charge_code_display,
    category, status, quantity_value, quantity_unit,
    unit_price, unit_price_snapshot, net_amount,
    source_type, source_id,
    service_period_start, service_period_end,
    created_by, created_at, updated_at
  ) VALUES (
    NEW.hospital_id, NEW.patient_id, NEW.admission_id,
    v_def.id, COALESCE(v_def.code,'PROCEDURE'), COALESCE(v_def.code_system,'local'),
    COALESCE(v_def.display_name, NEW.procedure_name),
    COALESCE(v_def.category,'nursing_procedure'), 'billable',
    1, 'procedure',
    v_price, v_price, v_price,
    'nursing_procedure', NEW.id,
    NEW.performed_at, NEW.performed_at,
    NEW.performed_by, now(), now()
  ) RETURNING id INTO v_ci_id;

  UPDATE nursing_procedure_logs SET charge_item_id = v_ci_id, is_billed = true WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_bill_nursing_proc ON nursing_procedure_logs;
CREATE TRIGGER trg_auto_bill_nursing_proc
  AFTER INSERT ON nursing_procedure_logs
  FOR EACH ROW EXECUTE FUNCTION auto_bill_nursing_procedure();

-- =============================================
-- RPCs
-- =============================================

CREATE OR REPLACE FUNCTION get_ward_inventory(p_ward_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID, item_name TEXT, item_code TEXT, category TEXT,
  unit_of_measure TEXT, current_stock NUMERIC, minimum_stock NUMERIC,
  unit_cost NUMERIC, is_billable BOOLEAN, is_low_stock BOOLEAN,
  charge_item_def_id UUID
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id, item_name, item_code, category, unit_of_measure,
    current_stock, minimum_stock, unit_cost, is_billable,
    (current_stock <= minimum_stock) AS is_low_stock, charge_item_def_id
  FROM ward_inventory
  WHERE ward_id = p_ward_id AND is_active = true
  ORDER BY category, item_name;
$$;

CREATE OR REPLACE FUNCTION use_consumable(
  p_ward_inventory_id UUID DEFAULT NULL,
  p_patient_id UUID DEFAULT NULL,
  p_admission_id UUID DEFAULT NULL,
  p_nursing_task_id UUID DEFAULT NULL,
  p_quantity_used NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_used_by UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv     ward_inventory%ROWTYPE;
  v_hosp_id UUID;
  v_log_id  UUID;
BEGIN
  SELECT * INTO v_inv FROM ward_inventory WHERE id = p_ward_inventory_id FOR UPDATE;
  IF v_inv.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Item not found'); END IF;
  IF v_inv.current_stock < p_quantity_used THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient stock', 'available', v_inv.current_stock);
  END IF;

  SELECT hospital_id INTO v_hosp_id FROM patients WHERE id = p_patient_id;

  INSERT INTO consumable_usage_logs (
    hospital_id, ward_inventory_id, patient_id, admission_id,
    nursing_task_id, quantity_used, unit_of_measure, used_by, notes
  ) VALUES (
    v_hosp_id, p_ward_inventory_id, p_patient_id, p_admission_id,
    p_nursing_task_id, p_quantity_used, v_inv.unit_of_measure, p_used_by, p_notes
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('success', true, 'log_id', v_log_id, 'remaining_stock', v_inv.current_stock - p_quantity_used);
END;
$$;

CREATE OR REPLACE FUNCTION restock_ward_item(
  p_ward_inventory_id UUID DEFAULT NULL,
  p_quantity_added NUMERIC DEFAULT NULL,
  p_restocked_by UUID DEFAULT NULL,
  p_source_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hosp_id UUID;
BEGIN
  SELECT hospital_id INTO v_hosp_id FROM ward_inventory WHERE id = p_ward_inventory_id;
  UPDATE ward_inventory
  SET current_stock = current_stock + p_quantity_added,
      last_restocked_at = now(), last_restocked_by = p_restocked_by, updated_at = now()
  WHERE id = p_ward_inventory_id;
  INSERT INTO ward_stock_restock_log (hospital_id, ward_inventory_id, quantity_added, restocked_by, source_note)
  VALUES (v_hosp_id, p_ward_inventory_id, p_quantity_added, p_restocked_by, p_source_note);
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_unbilled_nursing_charges(p_admission_id UUID DEFAULT NULL)
RETURNS TABLE (
  source TEXT, source_id UUID, description TEXT,
  quantity NUMERIC, unit TEXT, unit_price NUMERIC, total NUMERIC, used_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT 'consumable', cul.id, wi.item_name,
    cul.quantity_used, cul.unit_of_measure,
    COALESCE(wi.unit_cost, 0), (COALESCE(wi.unit_cost, 0) * cul.quantity_used), cul.used_at
  FROM consumable_usage_logs cul
  JOIN ward_inventory wi ON wi.id = cul.ward_inventory_id
  WHERE cul.admission_id = p_admission_id AND cul.is_billed = false
  UNION ALL
  SELECT 'procedure', npl.id, npl.procedure_name,
    1, 'procedure', COALESCE(cid.base_price, 0), COALESCE(cid.base_price, 0), npl.performed_at
  FROM nursing_procedure_logs npl
  LEFT JOIN charge_item_definitions cid ON cid.id = npl.charge_item_def_id
  WHERE npl.admission_id = p_admission_id AND npl.is_billed = false
  ORDER BY used_at;
$$;

-- RLS
ALTER TABLE ward_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ward_stock_restock_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_procedure_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_ward_inventory" ON ward_inventory FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_isolation_consumable_usage" ON consumable_usage_logs FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_isolation_restock_log" ON ward_stock_restock_log FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));
CREATE POLICY "hospital_isolation_nursing_procedures" ON nursing_procedure_logs FOR ALL
  USING (hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
