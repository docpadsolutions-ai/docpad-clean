-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415063615.

CREATE OR REPLACE FUNCTION public.record_lab_payment(
  p_charge_item_id  uuid,
  p_hospital_id     uuid,
  p_patient_id      uuid,
  p_amount          numeric,
  p_payment_method  text DEFAULT 'cash',
  p_collected_by    uuid DEFAULT NULL,
  p_notes           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id   uuid;
  v_invoice_id   uuid;
  v_inv_number   text;
  v_encounter_id uuid;
  v_account_id   uuid;
BEGIN
  -- Check for existing invoice via line items
  SELECT ili.invoice_id INTO v_invoice_id
  FROM public.invoice_line_items ili
  WHERE ili.charge_item_id = p_charge_item_id
  LIMIT 1;

  -- Get encounter_id from charge_item
  SELECT encounter_id INTO v_encounter_id
  FROM public.charge_items
  WHERE id = p_charge_item_id;

  -- If no invoice exists, create one now
  IF v_invoice_id IS NULL THEN

    -- Generate invoice number
    SELECT 'INV-' || to_char(now(), 'YYYY') || '-' ||
           LPAD((COUNT(*) + 1)::text, 6, '0')
    INTO v_inv_number
    FROM public.invoices
    WHERE hospital_id = p_hospital_id;

    -- Get or find account
    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE patient_id = p_patient_id
      AND hospital_id = p_hospital_id
    LIMIT 1;

    -- Create invoice
    INSERT INTO public.invoices (
      hospital_id, invoice_number, status, type,
      patient_id, encounter_id, account_id,
      recipient_type, recipient_id,
      invoice_date, issuer_org_id,
      total_gross, total_net, amount_paid
    ) VALUES (
      p_hospital_id, v_inv_number, 'issued', 'patient',
      p_patient_id, v_encounter_id, v_account_id,
      'patient', p_patient_id,
      now(), p_hospital_id,
      p_amount, p_amount, p_amount  -- pre-paid at reception
    )
    RETURNING id INTO v_invoice_id;

    -- Create line item on invoice
    INSERT INTO public.invoice_line_items (
      invoice_id, charge_item_id,
      item_description,
      unit_price, quantity, net_amount, gross_amount, line_subtotal,
      service_date, line_number
    )
    SELECT
      v_invoice_id, ci.id,
      COALESCE(ci.charge_code_display, ci.display_label, 'Lab Test'),
      ci.unit_price, ci.quantity_value,
      ci.net_amount, ci.net_amount, ci.net_amount,
      ci.service_period_start::date, 1
    FROM public.charge_items ci
    WHERE ci.id = p_charge_item_id;

  ELSE
    -- Invoice exists — just update amount_paid
    UPDATE public.invoices
    SET amount_paid = COALESCE(amount_paid, 0) + p_amount
    WHERE id = v_invoice_id;
  END IF;

  -- Mark charge_item as billed
  UPDATE public.charge_items
  SET status = 'billed'
  WHERE id = p_charge_item_id;

  -- Record payment
  INSERT INTO public.payments (
    hospital_id, invoice_id, patient_id,
    amount, payment_method,
    collected_by, notes,
    status, payment_date
  ) VALUES (
    p_hospital_id, v_invoice_id, p_patient_id,
    p_amount, p_payment_method,
    p_collected_by, p_notes,
    'confirmed', now()
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;
