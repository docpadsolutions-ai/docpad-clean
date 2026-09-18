-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415062725.

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
  v_payment_id  uuid;
  v_invoice_id  uuid;
BEGIN
  -- Find linked invoice if any
  SELECT ili.invoice_id INTO v_invoice_id
  FROM public.invoice_line_items ili
  WHERE ili.charge_item_id = p_charge_item_id
  LIMIT 1;

  -- Insert payment record
  INSERT INTO public.payments (
    hospital_id,
    invoice_id,
    patient_id,
    amount,
    payment_method,
    collected_by,
    notes,
    status,
    payment_date
  ) VALUES (
    p_hospital_id,
    v_invoice_id,
    p_patient_id,
    p_amount,
    p_payment_method,
    p_collected_by,
    p_notes,
    'confirmed',
    now()
  )
  RETURNING id INTO v_payment_id;

  -- Mark charge_item as billed
  UPDATE public.charge_items
  SET status = 'billed'
  WHERE id = p_charge_item_id;

  -- Update invoice amount_paid if linked
  IF v_invoice_id IS NOT NULL THEN
    UPDATE public.invoices
    SET amount_paid = COALESCE(amount_paid, 0) + p_amount
    WHERE id = v_invoice_id;
  END IF;

  -- Insert into investigation_bills for lab ledger
  INSERT INTO public.investigation_bills (
    hospital_id,
    patient_id,
    gross_amount,
    net_amount,
    paid_amount,
    payment_status,
    payment_method,
    paid_at,
    created_by
  ) VALUES (
    p_hospital_id,
    p_patient_id,
    p_amount,
    p_amount,
    p_amount,
    'paid',
    p_payment_method,
    now(),
    p_collected_by
  );

  RETURN v_payment_id;
END;
$$;
