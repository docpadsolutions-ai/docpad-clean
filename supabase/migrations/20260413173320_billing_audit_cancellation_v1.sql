-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413173320.

-- ============================================================
-- BILLING AUDIT LOG: tracks who cancelled/modified what and why
-- ============================================================
CREATE TABLE IF NOT EXISTS public.billing_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  action          text NOT NULL CHECK (action IN (
    'invoice_created','line_item_added','line_item_voided',
    'charge_item_cancelled','invoice_overridden',
    'payment_collected','payment_voided',
    'wallet_credited','wallet_debited',
    'estimate_presented','estimate_accepted','estimate_declined'
  )),
  performed_by    uuid REFERENCES public.practitioners(id),
  resource_type   text NOT NULL,
  resource_id     uuid NOT NULL,
  patient_id      uuid REFERENCES public.patients(id),
  old_values      jsonb,
  new_values      jsonb,
  reason          text,
  ip_address      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope" ON public.billing_audit_log
  USING (hospital_id IN (
    SELECT hospital_id FROM public.practitioners WHERE user_id = auth.uid()
  ));

-- Index for fast per-patient lookups
CREATE INDEX idx_billing_audit_patient ON public.billing_audit_log(hospital_id, patient_id, created_at DESC);
CREATE INDEX idx_billing_audit_resource ON public.billing_audit_log(resource_type, resource_id);

-- ============================================================
-- RPC: receptionist override — cancel/void a line item with reason
-- Logs to billing_audit_log automatically
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_invoice_line_item(
  p_line_item_id  uuid,
  p_reason        text,
  p_cancelled_by  uuid  -- practitioner id
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line       record;
  v_hospital_id uuid;
BEGIN
  SELECT ili.*, i.hospital_id, i.patient_id
  INTO v_line
  FROM public.invoice_line_items ili
  JOIN public.invoices i ON i.id = ili.invoice_id
  WHERE ili.id = p_line_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Line item not found';
  END IF;

  -- Reverse totals on invoice
  UPDATE public.invoices SET
    total_net      = total_net      - v_line.net_amount,
    total_tax      = total_tax      - v_line.tax_amount,
    total_gross    = total_gross    - v_line.gross_amount,
    total_discount = total_discount - v_line.discount_amount,
    updated_at     = now()
  WHERE id = v_line.invoice_id;

  -- Zero out line item (keep for audit trail, don't delete)
  UPDATE public.invoice_line_items SET
    net_amount    = 0,
    tax_amount    = 0,
    gross_amount  = 0,
    line_subtotal = 0,
    inline_display = '[VOIDED] ' || COALESCE(inline_display,''),
    unit_price    = 0
  WHERE id = p_line_item_id;

  -- Mark the charge_item as aborted
  IF v_line.charge_item_id IS NOT NULL THEN
    UPDATE public.charge_items SET
      status          = 'aborted',
      override_reason = 'Voided by reception: ' || p_reason,
      updated_at      = now()
    WHERE id = v_line.charge_item_id;
  END IF;

  -- Audit log
  INSERT INTO public.billing_audit_log (
    hospital_id, action, performed_by,
    resource_type, resource_id, patient_id,
    old_values, reason
  ) VALUES (
    v_line.hospital_id, 'line_item_voided', p_cancelled_by,
    'invoice_line_item', p_line_item_id, v_line.patient_id,
    jsonb_build_object(
      'invoice_id',    v_line.invoice_id,
      'display',       v_line.inline_display,
      'gross_amount',  v_line.gross_amount
    ),
    p_reason
  );
END;
$$;

-- ============================================================
-- RPC: get patient billing summary (grouped invoices + wallet)
-- Reception dashboard view
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_patient_billing_summary(
  p_hospital_id uuid,
  p_patient_id  uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'wallet_balance',
      COALESCE((SELECT balance FROM public.patient_wallet
                WHERE hospital_id = p_hospital_id AND patient_id = p_patient_id), 0),
    'total_outstanding',
      COALESCE((SELECT SUM(balance_due) FROM public.invoices
                WHERE hospital_id = p_hospital_id AND patient_id = p_patient_id
                  AND status NOT IN ('cancelled','balanced','entered-in-error')), 0),
    'invoices',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',             i.id,
          'invoice_number', i.invoice_number,
          'invoice_date',   i.invoice_date,
          'type',           i.type,
          'status',         i.status,
          'total_gross',    i.total_gross,
          'total_discount', i.total_discount,
          'amount_paid',    i.amount_paid,
          'balance_due',    i.balance_due,
          'line_item_count',(SELECT COUNT(*) FROM public.invoice_line_items WHERE invoice_id = i.id),
          'notes',          i.notes
        ) ORDER BY i.invoice_date DESC)
        FROM public.invoices i
        WHERE i.hospital_id = p_hospital_id AND i.patient_id = p_patient_id
          AND i.status NOT IN ('entered-in-error')
      ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Notify PostgREST
SELECT pg_notify('pgrst', 'reload schema');
