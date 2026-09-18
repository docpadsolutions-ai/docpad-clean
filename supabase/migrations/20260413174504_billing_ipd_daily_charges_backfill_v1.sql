-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413174504.

-- ============================================================
-- FUNCTION: backfill_ipd_daily_charges(admission_id)
-- Generates one ipd_daily_charges row per day from admitted_at
-- to CURRENT_DATE (or discharged_at). Pulls rates from
-- ward_rate_master. Skips days already present (idempotent).
-- Called automatically by compile_discharge_invoice().
-- Also callable manually from IPD file UI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.backfill_ipd_daily_charges(
  p_admission_id uuid
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_adm          record;
  v_rate         record;
  v_day          date;
  v_end_date     date;
  v_bed_price    numeric := 0;
  v_nursing_price numeric := 0;
  v_diet_price   numeric := 0;
  v_ci_id        uuid;
  v_rows_created int := 0;
BEGIN
  SELECT a.*,
         w.ward_type,
         b.bed_type
  INTO v_adm
  FROM public.ipd_admissions a
  LEFT JOIN public.ipd_wards w ON w.id = a.ward_id
  LEFT JOIN public.ipd_beds  b ON b.id = a.bed_id
  WHERE a.id = p_admission_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  v_day      := COALESCE(v_adm.admitted_at::date, CURRENT_DATE);
  v_end_date := COALESCE(v_adm.discharged_at::date, CURRENT_DATE);

  -- Get rates from ward_rate_master
  SELECT rate_per_day, nursing_charge_per_day, diet_charge_per_day
  INTO v_bed_price, v_nursing_price, v_diet_price
  FROM public.ward_rate_master
  WHERE hospital_id  = v_adm.hospital_id
    AND ward_type    = COALESCE(v_adm.ward_type, 'general')
    AND is_active    = true
    AND effective_from <= v_day
    AND (effective_to IS NULL OR effective_to >= v_day)
  ORDER BY effective_from DESC
  LIMIT 1;

  -- Fallback: charge_item_definitions room_charge
  IF v_bed_price IS NULL OR v_bed_price = 0 THEN
    SELECT base_price INTO v_bed_price
    FROM public.charge_item_definitions
    WHERE hospital_id = v_adm.hospital_id
      AND category    = 'room_charge'
      AND status      = 'active'
      AND (
        CASE COALESCE(v_adm.ward_type, 'general')
          WHEN 'general'      THEN display_name ILIKE '%general%'
          WHEN 'private'      THEN display_name ILIKE '%private%'
          WHEN 'semi_private' THEN display_name ILIKE '%semi%'
          WHEN 'icu'          THEN display_name ILIKE '%icu%'
          WHEN 'hdu'          THEN display_name ILIKE '%hdu%'
          ELSE TRUE
        END
      )
    ORDER BY base_price ASC LIMIT 1;
  END IF;

  -- Fallback: nursing from charge_item_definitions
  IF v_nursing_price IS NULL OR v_nursing_price = 0 THEN
    SELECT base_price INTO v_nursing_price
    FROM public.charge_item_definitions
    WHERE hospital_id = v_adm.hospital_id
      AND category    = 'nursing'
      AND status      = 'active'
    LIMIT 1;
  END IF;

  -- Loop day by day, skip existing rows (idempotent)
  WHILE v_day <= v_end_date LOOP

    IF NOT EXISTS (
      SELECT 1 FROM public.ipd_daily_charges
      WHERE admission_id = p_admission_id AND charge_date = v_day
    ) THEN
      -- Create a charge_item for this day's room charge
      INSERT INTO public.charge_items (
        hospital_id, patient_id, account_id,
        category, charge_code_display, display_label,
        source_type, source_id,
        quantity_value, unit_price,
        net_amount, unit_price_snapshot,
        status, currency
      )
      SELECT
        v_adm.hospital_id, v_adm.patient_id,
        (SELECT id FROM public.accounts
         WHERE hospital_id = v_adm.hospital_id
           AND subject_id  = v_adm.patient_id
           AND subject_type = 'Patient' AND status = 'active' LIMIT 1),
        'room_charge',
        'BED-' || v_day::text,
        'Bed/Ward charges – ' || to_char(v_day, 'DD Mon YYYY'),
        'encounter', p_admission_id,
        1, COALESCE(v_bed_price, 0),
        COALESCE(v_bed_price, 0), COALESCE(v_bed_price, 0),
        'billable', 'INR'
      RETURNING id INTO v_ci_id;

      INSERT INTO public.ipd_daily_charges (
        hospital_id, admission_id, patient_id,
        charge_date, ward_id, bed_id, ward_type,
        bed_charge, nursing_charge, diet_charge,
        charge_item_id, billing_status
      ) VALUES (
        v_adm.hospital_id, p_admission_id, v_adm.patient_id,
        v_day, v_adm.ward_id, v_adm.bed_id,
        COALESCE(v_adm.ward_type, 'general'),
        COALESCE(v_bed_price, 0),
        COALESCE(v_nursing_price, 0),
        COALESCE(v_diet_price, 0),
        v_ci_id, 'unbilled'
      );

      v_rows_created := v_rows_created + 1;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN v_rows_created;
END;
$$;

-- ============================================================
-- Update compile_discharge_invoice to call backfill first
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
  WHERE hospital_id  = v_adm.hospital_id
    AND subject_id   = v_adm.patient_id
    AND subject_type = 'Patient'
    AND status       = 'active'
  LIMIT 1;

  -- Backfill any missing daily charges first (idempotent)
  PERFORM public.backfill_ipd_daily_charges(p_admission_id);

  -- Get or create the rolling IPD invoice
  v_inv_id := public.get_or_create_rolling_invoice(
    v_adm.hospital_id, v_adm.patient_id, v_account_id,
    NULL, p_admission_id
  );

  -- Sweep all unbilled daily charges onto the invoice
  FOR r IN
    SELECT * FROM public.ipd_daily_charges
    WHERE admission_id  = p_admission_id
      AND billing_status = 'unbilled'
    ORDER BY charge_date
  LOOP
    PERFORM public.append_charge_to_invoice(
      v_inv_id,
      r.charge_item_id,
      'Bed/Ward charges – ' || to_char(r.charge_date, 'DD Mon YYYY'),
      r.total_charge
    );

    UPDATE public.ipd_daily_charges SET
      billing_status       = 'billed',
      billed_to_invoice_id = v_inv_id
    WHERE id = r.id;
  END LOOP;

  -- Finalise
  UPDATE public.invoices SET
    status     = 'issued',
    updated_at = now()
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$$;

-- Notify PostgREST
SELECT pg_notify('pgrst', 'reload schema');
