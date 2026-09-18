-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415074634.

-- Fix trigger to use valid status value (pending_collection not in check constraint)
-- When billing_status = 'paid', status stays 'ordered' — lab portal filters on billing_status
CREATE OR REPLACE FUNCTION fn_investigation_billing_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.billing_status = 'paid' AND (OLD.billing_status IS DISTINCT FROM 'paid') THEN
    -- status stays 'ordered' — lab portal should show billing_status = 'paid' + status = 'ordered'
    -- as "pending collection"
    NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
