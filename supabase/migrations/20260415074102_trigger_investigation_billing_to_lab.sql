-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415074102.

-- Trigger: when billing_status becomes 'paid', advance investigation status to 'pending_collection'
CREATE OR REPLACE FUNCTION fn_investigation_billing_paid()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when billing_status transitions TO 'paid'
  IF NEW.billing_status = 'paid' AND (OLD.billing_status IS DISTINCT FROM 'paid') THEN
    -- Only advance if still in early states (don't overwrite collected/resulted etc.)
    IF NEW.status IN ('ordered', 'sent_to_billing', 'pending_payment') THEN
      NEW.status := 'pending_collection';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_investigation_billing_paid ON investigations;

CREATE TRIGGER trg_investigation_billing_paid
  BEFORE UPDATE ON investigations
  FOR EACH ROW
  EXECUTE FUNCTION fn_investigation_billing_paid();
