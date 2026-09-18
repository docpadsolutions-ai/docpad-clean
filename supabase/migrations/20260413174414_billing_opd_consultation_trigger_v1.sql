-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413174414.

-- ============================================================
-- TRIGGER: opd_bills INSERT → create charge_item + rolling invoice
-- Consultation fee is collected at reception BEFORE the encounter.
-- opd_bills is the correct trigger point, not opd_encounters.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_opd_bill_to_invoice()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_consult_def_id  uuid;
  v_consult_price   numeric := 0;
  v_reg_def_id      uuid;
  v_reg_price       numeric := 0;
  v_account_id      uuid;
  v_invoice_id      uuid;
  v_ci_id           uuid;
BEGIN
  -- Skip if already paid/waived (e.g. insurance walk-in)
  IF NEW.payment_status IN ('waived') THEN
    RETURN NEW;
  END IF;

  -- ── Get or create patient account ───────────────────────
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE hospital_id  = NEW.hospital_id
    AND subject_id   = NEW.patient_id
    AND subject_type = 'Patient'
    AND status       = 'active'
  LIMIT 1;

  -- Auto-create account if missing (shouldn't happen but safety net)
  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (
      hospital_id, subject_type, subject_id,
      account_name, status, type, currency
    ) VALUES (
      NEW.hospital_id, 'Patient', NEW.patient_id,
      'Patient Account', 'active', 'patient', 'INR'
    ) RETURNING id INTO v_account_id;
  END IF;

  -- ── Get or create rolling invoice for today ──────────────
  v_invoice_id := public.get_or_create_rolling_invoice(
    NEW.hospital_id, NEW.patient_id, v_account_id,
    NEW.encounter_id, NULL
  );

  -- ── 1. Registration fee (if > 0) ─────────────────────────
  IF COALESCE(NEW.registration_fee, 0) > 0 THEN
    SELECT id, base_price INTO v_reg_def_id, v_reg_price
    FROM public.charge_item_definitions
    WHERE hospital_id = NEW.hospital_id
      AND category    = 'registration'
      AND status      = 'active'
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.charge_items (
      hospital_id, patient_id, account_id, definition_id,
      category, charge_code_display, display_label,
      source_type, source_id, encounter_id,
      quantity_value, unit_price, net_amount, unit_price_snapshot,
      status, currency
    ) VALUES (
      NEW.hospital_id, NEW.patient_id, v_account_id, v_reg_def_id,
      'registration', 'Registration Fee', 'Registration Fee',
      'manual', NEW.id, NEW.encounter_id,
      1, NEW.registration_fee, NEW.registration_fee, NEW.registration_fee,
      'billable', 'INR'
    ) RETURNING id INTO v_ci_id;

    PERFORM public.append_charge_to_invoice(
      v_invoice_id, v_ci_id, 'Registration Fee', NEW.registration_fee
    );
  END IF;

  -- ── 2. Consultation fee ───────────────────────────────────
  IF COALESCE(NEW.consultation_fee, 0) > 0 THEN
    -- Try doctor-specific fee from consultation_fee_master first
    -- We don't have doctor_id on opd_bills directly, so use charge_item_definitions
    SELECT id, base_price INTO v_consult_def_id, v_consult_price
    FROM public.charge_item_definitions
    WHERE hospital_id = NEW.hospital_id
      AND category    = 'consultation'
      AND status      = 'active'
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.charge_items (
      hospital_id, patient_id, account_id, definition_id,
      category, charge_code_display, display_label,
      source_type, source_id, encounter_id,
      quantity_value, unit_price, net_amount, unit_price_snapshot,
      status, currency
    ) VALUES (
      NEW.hospital_id, NEW.patient_id, v_account_id, v_consult_def_id,
      'consultation', 'Consultation Fee', 'Consultation Fee',
      'manual', NEW.id, NEW.encounter_id,
      1, NEW.consultation_fee, NEW.consultation_fee, NEW.consultation_fee,
      'billable', 'INR'
    ) RETURNING id INTO v_ci_id;

    PERFORM public.append_charge_to_invoice(
      v_invoice_id, v_ci_id, 'Consultation Fee', NEW.consultation_fee
    );
  END IF;

  -- ── 3. Mark invoice as issued (patient needs to pay now) ──
  UPDATE public.invoices SET
    status     = 'issued',
    updated_at = now()
  WHERE id = v_invoice_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opd_bill_to_invoice ON public.opd_bills;
CREATE TRIGGER trg_opd_bill_to_invoice
  AFTER INSERT ON public.opd_bills
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_opd_bill_to_invoice();
