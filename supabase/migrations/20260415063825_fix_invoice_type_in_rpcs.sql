-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415063825.

-- Fix record_lab_payment to use correct invoice type
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
  SELECT ili.invoice_id INTO v_invoice_id
  FROM public.invoice_line_items ili
  WHERE ili.charge_item_id = p_charge_item_id
  LIMIT 1;

  SELECT encounter_id INTO v_encounter_id
  FROM public.charge_items WHERE id = p_charge_item_id;

  IF v_invoice_id IS NULL THEN
    SELECT 'INV-' || to_char(now(), 'YYYY') || '-' ||
           LPAD((COUNT(*) + 1)::text, 6, '0')
    INTO v_inv_number
    FROM public.invoices WHERE hospital_id = p_hospital_id;

    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE subject_id = p_patient_id AND hospital_id = p_hospital_id
    LIMIT 1;

    INSERT INTO public.invoices (
      hospital_id, invoice_number, status, type,
      patient_id, encounter_id, account_id,
      recipient_type, recipient_id,
      invoice_date, issuer_org_id,
      total_gross, total_net, amount_paid
    ) VALUES (
      p_hospital_id, v_inv_number, 'issued', 'lab',
      p_patient_id, v_encounter_id, v_account_id,
      'patient', p_patient_id,
      now(), p_hospital_id,
      p_amount, p_amount, p_amount
    )
    RETURNING id INTO v_invoice_id;

    INSERT INTO public.invoice_line_items (
      invoice_id, charge_item_id,
      item_description, unit_price, quantity,
      net_amount, gross_amount, line_subtotal,
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
    UPDATE public.invoices
    SET amount_paid = COALESCE(amount_paid, 0) + p_amount
    WHERE id = v_invoice_id;
  END IF;

  UPDATE public.charge_items SET status = 'billed' WHERE id = p_charge_item_id;

  INSERT INTO public.payments (
    hospital_id, invoice_id, patient_id,
    amount, payment_method,
    collected_by, notes, status, payment_date
  ) VALUES (
    p_hospital_id, v_invoice_id, p_patient_id,
    p_amount, p_payment_method,
    p_collected_by, p_notes, 'confirmed', now()
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;
