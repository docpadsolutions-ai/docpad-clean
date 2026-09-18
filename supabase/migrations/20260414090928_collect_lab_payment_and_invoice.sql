-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414090928.

CREATE OR REPLACE FUNCTION public.collect_lab_payment(
  p_investigation_order_id  UUID,
  p_collected_by            UUID,
  p_hospital_id             UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order           RECORD;
  v_charge          RECORD;
  v_invoice_id      UUID;
  v_invoice_number  TEXT;
  v_line_id         UUID;
  v_unit_price      NUMERIC;
  v_tax_amount      NUMERIC;
  v_gross_amount    NUMERIC;
BEGIN
  -- 1. Fetch the investigation order
  SELECT o.*, a.patient_id, a.id AS admission_id
  INTO v_order
  FROM public.ipd_investigation_orders o
  JOIN public.ipd_admissions a ON a.id = o.admission_id
  WHERE o.id = p_investigation_order_id
    AND o.hospital_id = p_hospital_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'order_not_found');
  END IF;

  IF v_order.billing_status = 'paid' THEN
    RETURN jsonb_build_object('error', 'already_paid');
  END IF;

  -- 2. Get pricing from charge_item_definitions
  IF v_order.charge_item_id IS NOT NULL THEN
    SELECT base_price, tax_rate, display_name
    INTO v_charge
    FROM public.charge_item_definitions
    WHERE id = v_order.charge_item_id;

    v_unit_price   := COALESCE(v_charge.base_price, 0);
    v_tax_amount   := ROUND(v_unit_price * COALESCE(v_charge.tax_rate, 0) / 100, 2);
    v_gross_amount := v_unit_price + v_tax_amount;
  ELSE
    v_unit_price   := 0;
    v_tax_amount   := 0;
    v_gross_amount := 0;
  END IF;

  -- 3. Find existing open IPD invoice for this patient/admission, or create one
  SELECT id INTO v_invoice_id
  FROM public.invoices
  WHERE patient_id = v_order.patient_id
    AND hospital_id = p_hospital_id
    AND type = 'ipd'
    AND status NOT IN ('paid', 'cancelled', 'void')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invoice_id IS NULL THEN
    -- Generate invoice number
    v_invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                        LPAD(NEXTVAL('invoice_number_seq')::TEXT, 6, '0');

    INSERT INTO public.invoices (
      hospital_id, invoice_number, status, type,
      patient_id, invoice_date,
      total_net, total_tax, total_gross, total_discount,
      amount_paid, created_by
    ) VALUES (
      p_hospital_id, v_invoice_number, 'draft', 'ipd',
      v_order.patient_id, CURRENT_DATE,
      0, 0, 0, 0, 0, p_collected_by
    ) RETURNING id INTO v_invoice_id;
  END IF;

  -- 4. Add line item
  INSERT INTO public.invoice_line_items (
    invoice_id, charge_item_id,
    inline_display, service_date,
    quantity, unit_price,
    net_amount, tax_amount, gross_amount,
    tax_percent, item_description
  ) VALUES (
    v_invoice_id, v_order.charge_item_id,
    COALESCE(v_charge.display_name, v_order.test_name),
    CURRENT_DATE,
    1, v_unit_price,
    v_unit_price, v_tax_amount, v_gross_amount,
    COALESCE(v_charge.tax_rate, 0),
    v_order.test_name
  ) RETURNING id INTO v_line_id;

  -- 5. Update invoice totals
  UPDATE public.invoices SET
    total_net   = total_net + v_unit_price,
    total_tax   = total_tax + v_tax_amount,
    total_gross = total_gross + v_gross_amount,
    updated_at  = NOW()
  WHERE id = v_invoice_id;

  -- 6. Mark investigation as paid + sample ready to collect
  UPDATE public.ipd_investigation_orders SET
    billing_status       = 'paid',
    sample_collected_at  = NOW(),
    sample_collected_by  = p_collected_by,
    updated_at           = NOW()
  WHERE id = p_investigation_order_id;

  RETURN jsonb_build_object(
    'success',      true,
    'invoice_id',   v_invoice_id,
    'line_item_id', v_line_id,
    'amount',       v_gross_amount
  );
END;
$$;
