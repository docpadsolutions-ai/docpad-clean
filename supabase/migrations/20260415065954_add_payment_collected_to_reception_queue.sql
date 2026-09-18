-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415065954.

ALTER TABLE public.reception_queue 
ADD COLUMN IF NOT EXISTS payment_collected boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_override boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_override_by uuid REFERENCES public.practitioners(id),
ADD COLUMN IF NOT EXISTS payment_override_at timestamptz;

-- When record_lab_payment RPC marks a consultation charge as billed,
-- also mark the queue row as payment_collected
CREATE OR REPLACE FUNCTION sync_queue_payment_on_charge_billed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'billed' AND OLD.status = 'billable' 
     AND NEW.source_type = 'queue' THEN
    UPDATE public.reception_queue
    SET payment_collected = true,
        billed_at = now()
    WHERE id = NEW.source_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_queue_payment ON public.charge_items;
CREATE TRIGGER trg_sync_queue_payment
  AFTER UPDATE ON public.charge_items
  FOR EACH ROW
  EXECUTE FUNCTION sync_queue_payment_on_charge_billed();
