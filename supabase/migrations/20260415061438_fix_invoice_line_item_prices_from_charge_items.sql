-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415061438.

-- Step 1: Update invoice_line_items with correct prices from charge_items
UPDATE public.invoice_line_items ili
SET
  unit_price      = ci.unit_price,
  net_amount      = ci.net_amount,
  gross_amount    = ci.net_amount,
  line_subtotal   = ci.net_amount,
  item_description = COALESCE(ili.item_description, ci.charge_code_display, ci.display_label)
FROM public.charge_items ci
WHERE ili.charge_item_id = ci.id
  AND ci.unit_price > 0
  AND (ili.unit_price IS NULL OR ili.unit_price = 0);

-- Step 2: Recalculate invoice totals from their line items
UPDATE public.invoices i
SET
  total_gross   = agg.total,
  total_net     = agg.total,
  amount_paid   = 0
FROM (
  SELECT invoice_id, SUM(gross_amount) AS total
  FROM public.invoice_line_items
  GROUP BY invoice_id
) agg
WHERE i.id = agg.invoice_id;
