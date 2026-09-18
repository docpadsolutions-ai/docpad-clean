-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415061723.

-- 1. Seed INR into price master
INSERT INTO public.investigation_price_master (
  hospital_id, test_name, test_category, base_price, is_active
)
VALUES (
  'e90e4607-dd60-4821-b736-02a2577432e0',
  'International Normalized Ratio',
  'haematology',
  300, true
)
ON CONFLICT DO NOTHING;

-- 2. Fix existing zero-price INR charge_item
UPDATE public.charge_items
SET unit_price = 300, unit_price_snapshot = 300, net_amount = 300, status = 'billable'
WHERE source_type = 'service_request'
  AND charge_code_display = 'International Normalized Ratio'
  AND (unit_price IS NULL OR unit_price = 0);

-- 3. Fix invoice line item for INR
UPDATE public.invoice_line_items ili
SET unit_price = 300, net_amount = 300, gross_amount = 300, line_subtotal = 300
FROM public.charge_items ci
WHERE ili.charge_item_id = ci.id
  AND ci.charge_code_display = 'International Normalized Ratio'
  AND (ili.unit_price IS NULL OR ili.unit_price = 0);

-- 4. Recalculate all invoice totals
UPDATE public.invoices i
SET total_gross = agg.total, total_net = agg.total
FROM (
  SELECT invoice_id, SUM(gross_amount) AS total
  FROM public.invoice_line_items
  GROUP BY invoice_id
) agg
WHERE i.id = agg.invoice_id;

-- 5. Fix the invoice creation RPC to copy prices from charge_items at invoice time
-- First drop the old version
DROP FUNCTION IF EXISTS create_invoice_from_charge_items(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS create_invoice_from_charge_items(uuid, uuid);

-- Recreate with correct price propagation
CREATE OR REPLACE FUNCTION public.create_invoice_from_charge_items(
  p_encounter_id uuid DEFAULT NULL,
  p_patient_id   uuid DEFAULT NULL,
  p_hospital_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id  uuid;
  v_inv_number  text;
  v_hospital_id uuid;
  v_patient_id  uuid;
  v_account_id  uuid;
  v_total       numeric := 0;
BEGIN
  -- Resolve hospital
  v_hospital_id := COALESCE(p_hospital_id,
    (SELECT hospital_id FROM public.opd_encounters WHERE id = p_encounter_id LIMIT 1));
  v_patient_id  := COALESCE(p_patient_id,
    (SELECT patient_id FROM public.opd_encounters WHERE id = p_encounter_id LIMIT 1));

  -- Generate invoice number
  SELECT 'INV-' || to_char(now(), 'YYYY') || '-' ||
         LPAD((COUNT(*) + 1)::text, 6, '0')
  INTO v_inv_number
  FROM public.invoices
  WHERE hospital_id = v_hospital_id;

  -- Get or create account
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE patient_id = v_patient_id AND hospital_id = v_hospital_id
  LIMIT 1;

  -- Create invoice header
  INSERT INTO public.invoices (
    hospital_id, invoice_number, status, type,
    patient_id, encounter_id, account_id,
    recipient_type, recipient_id,
    invoice_date, issuer_org_id
  ) VALUES (
    v_hospital_id, v_inv_number, 'issued', 'patient',
    v_patient_id, p_encounter_id, v_account_id,
    'patient', v_patient_id,
    now(), v_hospital_id
  )
  RETURNING id INTO v_invoice_id;

  -- Insert line items from billable charge_items, copying price at invoice time
  INSERT INTO public.invoice_line_items (
    invoice_id, charge_item_id,
    item_description,
    unit_price, quantity, net_amount, gross_amount, line_subtotal,
    service_date, line_number
  )
  SELECT
    v_invoice_id,
    ci.id,
    COALESCE(ci.charge_code_display, ci.display_label, 'Service'),
    ci.unit_price,
    ci.quantity_value,
    ci.net_amount,
    ci.net_amount,
    ci.net_amount,
    ci.service_period_start::date,
    ROW_NUMBER() OVER (ORDER BY ci.created_at)
  FROM public.charge_items ci
  WHERE ci.status = 'billable'
    AND ci.hospital_id = v_hospital_id
    AND (
      ci.encounter_id = p_encounter_id
      OR (p_encounter_id IS NULL AND ci.patient_id = v_patient_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_line_items ili2
      WHERE ili2.charge_item_id = ci.id
    );

  -- Calculate total from line items
  SELECT SUM(gross_amount) INTO v_total
  FROM public.invoice_line_items
  WHERE invoice_id = v_invoice_id;

  -- Update invoice totals
  UPDATE public.invoices
  SET total_gross = COALESCE(v_total, 0),
      total_net   = COALESCE(v_total, 0)
  WHERE id = v_invoice_id;

  -- Mark charge_items as billed
  UPDATE public.charge_items ci
  SET status = 'billed'
  FROM public.invoice_line_items ili
  WHERE ili.invoice_id = v_invoice_id
    AND ili.charge_item_id = ci.id;

  RETURN v_invoice_id;
END;
$$;
