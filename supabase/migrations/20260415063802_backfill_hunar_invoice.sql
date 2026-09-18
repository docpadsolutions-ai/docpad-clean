-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415063802.

DO $$
DECLARE
  v_invoice_id     uuid;
  v_inv_number     text;
  v_account_id     uuid;
  v_patient_id     uuid := '065c334c-85b9-4132-8751-b89b0dfa1114';
  v_hospital_id    uuid := 'e90e4607-dd60-4821-b736-02a2577432e0';
  v_encounter_id   uuid := 'e627d246-abac-47bc-8c4a-b71e0bdd0f3d';
  v_charge_item_id uuid := '27639cd1-2cac-45f6-a110-b54d198100fd';
  v_payment_id     uuid := '08c170ed-7802-47e9-834e-41985d97c4ce';
BEGIN
  SELECT 'INV-' || to_char(now(), 'YYYY') || '-' ||
         LPAD((COUNT(*) + 1)::text, 6, '0')
  INTO v_inv_number
  FROM public.invoices WHERE hospital_id = v_hospital_id;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE subject_id = v_patient_id AND hospital_id = v_hospital_id
  LIMIT 1;

  INSERT INTO public.invoices (
    hospital_id, invoice_number, status, type,
    patient_id, encounter_id, account_id,
    recipient_type, recipient_id,
    invoice_date, issuer_org_id,
    total_gross, total_net, amount_paid
  ) VALUES (
    v_hospital_id, v_inv_number, 'issued', 'lab',
    v_patient_id, v_encounter_id, v_account_id,
    'patient', v_patient_id,
    now(), v_hospital_id,
    1000, 1000, 1000
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, charge_item_id,
    item_description, unit_price, quantity,
    net_amount, gross_amount, line_subtotal,
    service_date, line_number
  ) VALUES (
    v_invoice_id, v_charge_item_id,
    'Vitamin B12', 1000, 1,
    1000, 1000, 1000,
    CURRENT_DATE, 1
  );

  UPDATE public.payments
  SET invoice_id = v_invoice_id
  WHERE id = v_payment_id;

END $$;
