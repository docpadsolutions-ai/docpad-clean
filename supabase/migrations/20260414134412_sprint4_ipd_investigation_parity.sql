-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414134412.

-- Bring ipd_investigation_orders to parity with investigations for Sprint 4

-- 1. result_severity tier (mirrors investigations table)
ALTER TABLE ipd_investigation_orders
  ADD COLUMN IF NOT EXISTS result_severity TEXT DEFAULT 'normal'
  CHECK (result_severity IN ('critical', 'high', 'abnormal', 'normal'));

-- 2. expected_at — IPD orders use ordered_date (date only), no TAT hours column
-- Add expected_tat_hours so the same pattern works
ALTER TABLE ipd_investigation_orders
  ADD COLUMN IF NOT EXISTS expected_tat_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;

-- Trigger to compute expected_at from ordered_date + TAT
CREATE OR REPLACE FUNCTION set_ipd_investigation_expected_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expected_tat_hours IS NOT NULL AND NEW.ordered_date IS NOT NULL THEN
    NEW.expected_at := NEW.ordered_date::TIMESTAMPTZ + (NEW.expected_tat_hours * INTERVAL '1 hour');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ipd_investigation_expected_at ON ipd_investigation_orders;
CREATE TRIGGER trg_ipd_investigation_expected_at
  BEFORE INSERT OR UPDATE OF expected_tat_hours, ordered_date ON ipd_investigation_orders
  FOR EACH ROW EXECUTE FUNCTION set_ipd_investigation_expected_at();

-- 3. Unified acknowledged columns (is_critical + critical_acknowledged_at already exist,
--    add generic acknowledged_at/by that mirrors OPD investigations)
ALTER TABLE ipd_investigation_orders
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES practitioners(id);

-- Backfill: if critical already acknowledged, sync to new columns
UPDATE ipd_investigation_orders
SET acknowledged_at = critical_acknowledged_at,
    acknowledged_by = critical_acknowledged_by
WHERE critical_acknowledged_at IS NOT NULL AND acknowledged_at IS NULL;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_ipd_inv_orders_pending
  ON ipd_investigation_orders(hospital_id, status, expected_at)
  WHERE status IN ('ordered', 'sample_collected', 'processing');

CREATE INDEX IF NOT EXISTS idx_ipd_inv_orders_unacked
  ON ipd_investigation_orders(hospital_id, acknowledged_at, status)
  WHERE acknowledged_at IS NULL AND status = 'resulted';

CREATE INDEX IF NOT EXISTS idx_ipd_inv_orders_severity
  ON ipd_investigation_orders(hospital_id, result_severity)
  WHERE result_severity IN ('critical', 'high');

NOTIFY pgrst, 'reload schema';
