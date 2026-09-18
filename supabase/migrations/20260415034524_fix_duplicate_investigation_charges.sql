-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415034524.

-- Step 1: Drop the redundant older trigger
DROP TRIGGER IF EXISTS trg_investigation_to_billing ON public.investigations;

-- Step 2: For rows that ARE referenced in invoice_line_items,
-- update them in-place with correct price from the billable sibling
UPDATE public.charge_items ci
SET
  unit_price = sibling.unit_price,
  unit_price_snapshot = sibling.unit_price,
  net_amount = sibling.net_amount,
  status = 'billable'
FROM (
  SELECT ci_good.source_id, ci_good.unit_price, ci_good.net_amount
  FROM public.charge_items ci_good
  WHERE ci_good.source_type = 'service_request'
    AND ci_good.status = 'billable'
    AND ci_good.unit_price > 0
) sibling
WHERE ci.source_type = 'service_request'
  AND ci.status = 'planned'
  AND ci.unit_price = 0
  AND ci.source_id = sibling.source_id;

-- Step 3: Now delete the orphan billable duplicates that are NOT in invoice_line_items
-- (these are the "second copy" that was never attached to an invoice)
DELETE FROM public.charge_items ci
WHERE ci.source_type = 'service_request'
  AND ci.status = 'billable'
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_line_items ili WHERE ili.charge_item_id = ci.id
  )
  AND EXISTS (
    SELECT 1 FROM public.invoice_line_items ili2
    JOIN public.charge_items ci2 ON ci2.id = ili2.charge_item_id
    WHERE ci2.source_id = ci.source_id
      AND ci2.source_type = 'service_request'
      AND ci2.id != ci.id
  );

-- Step 4: Unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_items_unique_service_request
  ON public.charge_items (source_id)
  WHERE source_type = 'service_request';
