-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413173254.

-- ============================================================
-- CORE FUNCTION: Get or create today's rolling invoice for a patient
-- OPD: one invoice per patient per day per encounter
-- IPD: one invoice per admission (rolling)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_rolling_invoice(
  p_hospital_id   uuid,
  p_patient_id    uuid,
  p_account_id    uuid,
  p_encounter_id  uuid DEFAULT NULL,
  p_admission_id  uuid DEFAULT NULL,
  p_invoice_type  text DEFAULT 'composite'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invoice_id    uuid;
  v_invoice_date  date := CURRENT_DATE;
BEGIN
  IF p_admission_id IS NOT NULL THEN
    -- IPD: one rolling invoice per admission
    SELECT id INTO v_invoice_id
    FROM public.invoices
    WHERE hospital_id  = p_hospital_id
      AND patient_id   = p_patient_id
      AND account_id   = p_account_id
      AND status       NOT IN ('cancelled','balanced','entered-in-error')
      AND notes LIKE '%admission:' || p_admission_id::text || '%'
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    -- OPD: one rolling invoice per encounter per day
    SELECT id INTO v_invoice_id
    FROM public.invoices
    WHERE hospital_id  = p_hospital_id
      AND patient_id   = p_patient_id
      AND account_id   = p_account_id
      AND COALESCE(encounter_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE(p_encounter_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND invoice_date::date = v_invoice_date
      AND status NOT IN ('cancelled','balanced','entered-in-error')
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_invoice_id IS NULL THEN
    INSERT INTO public.invoices (
      hospital_id, patient_id, account_id, encounter_id,
      status, type, invoice_date, issuer_org_id,
      total_net, total_tax, total_gross, total_discount, amount_paid,
      notes
    ) VALUES (
      p_hospital_id, p_patient_id, p_account_id, p_encounter_id,
      'draft', p_invoice_type, now(), p_hospital_id,
      0, 0, 0, 0, 0,
      CASE WHEN p_admission_id IS NOT NULL
           THEN 'Rolling IPD invoice | admission:' || p_admission_id::text
           ELSE 'Rolling OPD invoice | ' || v_invoice_date::text
      END
    ) RETURNING id INTO v_invoice_id;
  END IF;

  RETURN v_invoice_id;
END;
$$;

-- ============================================================
-- CORE FUNCTION: Append a charge_item as a line item on invoice
-- and update invoice totals atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.append_charge_to_invoice(
  p_invoice_id    uuid,
  p_charge_item_id uuid,
  p_display       text,
  p_unit_price    numeric,
  p_quantity      numeric DEFAULT 1,
  p_tax_percent   numeric DEFAULT 0,
  p_discount_pct  numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line_id        uuid;
  v_net            numeric;
  v_tax_amt        numeric;
  v_disc_amt       numeric;
  v_gross          numeric;
  v_line_number    int;
BEGIN
  v_disc_amt  := ROUND(p_unit_price * p_quantity * p_discount_pct / 100, 2);
  v_net       := ROUND(p_unit_price * p_quantity - v_disc_amt, 2);
  v_tax_amt   := ROUND(v_net * p_tax_percent / 100, 2);
  v_gross     := v_net + v_tax_amt;

  SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_line_number
  FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, charge_item_id, inline_display,
    quantity, unit_price, discount_percent, discount_amount,
    net_amount, tax_percent, tax_amount, gross_amount,
    line_subtotal, line_number, service_date
  ) VALUES (
    p_invoice_id, p_charge_item_id, p_display,
    p_quantity, p_unit_price, p_discount_pct, v_disc_amt,
    v_net, p_tax_percent, v_tax_amt, v_gross,
    v_gross, v_line_number, CURRENT_DATE
  ) RETURNING id INTO v_line_id;

  -- Update invoice totals
  UPDATE public.invoices SET
    total_net      = total_net + v_net,
    total_tax      = total_tax + v_tax_amt,
    total_gross    = total_gross + v_gross,
    total_discount = total_discount + v_disc_amt,
    status         = 'issued',
    updated_at     = now()
  WHERE id = p_invoice_id;

  RETURN v_line_id;
END;
$$;

-- ============================================================
-- CORE FUNCTION: Create a charge_item from a definition lookup
-- Returns charge_item id. If definition not found, creates
-- unpriced charge_item flagged for manual pricing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_charge_item_for_event(
  p_hospital_id         uuid,
  p_patient_id          uuid,
  p_category            text,
  p_display_label       text,
  p_source_type         text,
  p_source_id           uuid,
  p_encounter_id        uuid DEFAULT NULL,
  p_requesting_pract_id uuid DEFAULT NULL,
  p_quantity            numeric DEFAULT 1
) RETURNS TABLE(charge_item_id uuid, unit_price numeric, definition_found boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_def_id     uuid;
  v_price      numeric := 0;
  v_found      boolean := false;
  v_ci_id      uuid;
  v_account_id uuid;
BEGIN
  -- Price lookup from charge_item_definitions
  SELECT id, base_price INTO v_def_id, v_price
  FROM public.charge_item_definitions
  WHERE hospital_id  = p_hospital_id
    AND category     = p_category
    AND status       = 'active'
    AND display_name ILIKE '%' || p_display_label || '%'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_def_id IS NOT NULL THEN
    v_found := true;
  ELSE
    v_price := 0; -- unpriced — receptionist must fill
  END IF;

  -- Get account_id for this patient
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id   = p_hospital_id
    AND subject_id    = p_patient_id
    AND subject_type  = 'Patient'
    AND status        = 'active'
  LIMIT 1;

  INSERT INTO public.charge_items (
    hospital_id, patient_id, account_id, definition_id,
    category, charge_code_display, display_label,
    source_type, source_id, encounter_id,
    requesting_practitioner_id,
    quantity_value, unit_price, net_amount,
    unit_price_snapshot,
    status,
    override_reason
  ) VALUES (
    p_hospital_id, p_patient_id, v_account_id, v_def_id,
    p_category, p_display_label, p_display_label,
    p_source_type, p_source_id, p_encounter_id,
    p_requesting_pract_id,
    p_quantity, v_price, v_price * p_quantity,
    v_price,
    CASE WHEN v_found THEN 'billable' ELSE 'planned' END,
    CASE WHEN NOT v_found THEN 'UNPRICED: awaiting manual price entry' ELSE NULL END
  ) RETURNING id INTO v_ci_id;

  RETURN QUERY SELECT v_ci_id, v_price, v_found;
END;
$$;

-- ============================================================
-- TRIGGER: OPD investigation ordered → auto charge_item + invoice line
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_investigation_to_billing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ci_id      uuid;
  v_price      numeric;
  v_found      boolean;
  v_inv_id     uuid;
  v_account_id uuid;
BEGIN
  -- Only fire on new orders, not cancellations
  IF NEW.status = 'cancelled' OR NEW.billing_status != 'unbilled' THEN
    RETURN NEW;
  END IF;

  -- Create charge_item
  SELECT ci.charge_item_id, ci.unit_price, ci.definition_found
  INTO v_ci_id, v_price, v_found
  FROM public.create_charge_item_for_event(
    NEW.hospital_id,
    NEW.patient_id,
    CASE NEW.test_category
      WHEN 'imaging' THEN 'imaging'
      ELSE 'lab_test'
    END,
    NEW.test_name,
    'service_request',
    NEW.id,
    NEW.encounter_id,
    NEW.doctor_id
  ) ci;

  -- Get account
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id = NEW.hospital_id AND subject_id = NEW.patient_id
    AND subject_type = 'Patient' AND status = 'active'
  LIMIT 1;

  -- Get or create rolling invoice
  v_inv_id := public.get_or_create_rolling_invoice(
    NEW.hospital_id, NEW.patient_id, v_account_id,
    NEW.encounter_id, NULL
  );

  -- Append line item
  PERFORM public.append_charge_to_invoice(v_inv_id, v_ci_id, NEW.test_name, v_price);

  -- Update investigation billing status
  UPDATE public.investigations SET
    billing_status = 'sent_to_billing',
    bill_id        = NULL  -- old field; new invoice path used
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investigation_to_billing ON public.investigations;
CREATE TRIGGER trg_investigation_to_billing
  AFTER INSERT ON public.investigations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_investigation_to_billing();

-- ============================================================
-- TRIGGER: IPD investigation order → auto charge_item + invoice line
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_ipd_investigation_to_billing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ci_id      uuid;
  v_price      numeric;
  v_found      boolean;
  v_inv_id     uuid;
  v_account_id uuid;
BEGIN
  IF NEW.billing_status != 'pending_payment' THEN
    RETURN NEW;
  END IF;

  SELECT ci.charge_item_id, ci.unit_price, ci.definition_found
  INTO v_ci_id, v_price, v_found
  FROM public.create_charge_item_for_event(
    NEW.hospital_id, NEW.patient_id,
    CASE NEW.test_category WHEN 'imaging' THEN 'imaging' ELSE 'lab_test' END,
    NEW.test_name, 'service_request', NEW.id,
    NULL, NEW.ordered_by
  ) ci;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id = NEW.hospital_id AND subject_id = NEW.patient_id
    AND subject_type = 'Patient' AND status = 'active'
  LIMIT 1;

  v_inv_id := public.get_or_create_rolling_invoice(
    NEW.hospital_id, NEW.patient_id, v_account_id,
    NULL, NEW.admission_id
  );

  PERFORM public.append_charge_to_invoice(v_inv_id, v_ci_id, NEW.test_name, v_price);

  -- Link charge_item back to the order
  UPDATE public.ipd_investigation_orders SET charge_item_id = v_ci_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ipd_investigation_to_billing ON public.ipd_investigation_orders;
CREATE TRIGGER trg_ipd_investigation_to_billing
  AFTER INSERT ON public.ipd_investigation_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_ipd_investigation_to_billing();

-- ============================================================
-- TRIGGER: IPD treatment (procedure/surgical) → charge_item + invoice
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_ipd_treatment_to_billing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ci_id      uuid;
  v_price      numeric;
  v_found      boolean;
  v_inv_id     uuid;
  v_account_id uuid;
BEGIN
  -- Only bill surgical/procedure treatments
  IF NEW.treatment_kind NOT IN ('surgical','procedure') THEN
    RETURN NEW;
  END IF;

  SELECT ci.charge_item_id, ci.unit_price, ci.definition_found
  INTO v_ci_id, v_price, v_found
  FROM public.create_charge_item_for_event(
    NEW.hospital_id, NEW.patient_id,
    'procedure', NEW.name,
    'procedure', NEW.id,
    NULL, NEW.ordering_practitioner_id
  ) ci;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id = NEW.hospital_id AND subject_id = NEW.patient_id
    AND subject_type = 'Patient' AND status = 'active'
  LIMIT 1;

  v_inv_id := public.get_or_create_rolling_invoice(
    NEW.hospital_id, NEW.patient_id, v_account_id,
    NULL, NEW.admission_id
  );

  PERFORM public.append_charge_to_invoice(v_inv_id, v_ci_id, NEW.name, v_price);

  UPDATE public.ipd_treatments SET charge_item_id = v_ci_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ipd_treatment_to_billing ON public.ipd_treatments;
CREATE TRIGGER trg_ipd_treatment_to_billing
  AFTER INSERT ON public.ipd_treatments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_ipd_treatment_to_billing();

-- ============================================================
-- TRIGGER: Cancellation → void the charge_item (don't delete)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_investigation_cancel_billing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    -- Mark charge_item as aborted, not deleted
    UPDATE public.charge_items SET
      status       = 'aborted',
      override_reason = 'Cancelled by: investigation status set to cancelled',
      updated_at   = now()
    WHERE source_type = 'service_request'
      AND source_id   = NEW.id
      AND status NOT IN ('billed','not-billable');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investigation_cancel_billing ON public.investigations;
CREATE TRIGGER trg_investigation_cancel_billing
  AFTER UPDATE ON public.investigations
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
  EXECUTE FUNCTION public.trg_fn_investigation_cancel_billing();

-- ============================================================
-- FUNCTION: Compile discharge invoice (called by discharge action)
-- Rolls up all unbilled daily charges + any remaining charge_items
-- ============================================================
CREATE OR REPLACE FUNCTION public.compile_discharge_invoice(
  p_admission_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_adm          record;
  v_account_id   uuid;
  v_inv_id       uuid;
  r              record;
BEGIN
  SELECT * INTO v_adm FROM public.ipd_admissions WHERE id = p_admission_id;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id = v_adm.hospital_id AND subject_id = v_adm.patient_id
    AND subject_type = 'Patient' AND status = 'active'
  LIMIT 1;

  -- Get the existing rolling IPD invoice or create discharge invoice
  v_inv_id := public.get_or_create_rolling_invoice(
    v_adm.hospital_id, v_adm.patient_id, v_account_id,
    NULL, p_admission_id
  );

  -- Append all unbilled daily charges
  FOR r IN
    SELECT * FROM public.ipd_daily_charges
    WHERE admission_id = p_admission_id AND billing_status = 'unbilled'
    ORDER BY charge_date
  LOOP
    PERFORM public.append_charge_to_invoice(
      v_inv_id, r.charge_item_id,
      'Bed/Ward charge – ' || r.charge_date::text,
      r.total_charge
    );
    UPDATE public.ipd_daily_charges SET
      billing_status       = 'billed',
      billed_to_invoice_id = v_inv_id
    WHERE id = r.id;
  END LOOP;

  -- Mark invoice as issued (finalised for payment)
  UPDATE public.invoices SET
    status     = 'issued',
    updated_at = now()
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$$;

-- Notify PostgREST to reload schema
SELECT pg_notify('pgrst', 'reload schema');
