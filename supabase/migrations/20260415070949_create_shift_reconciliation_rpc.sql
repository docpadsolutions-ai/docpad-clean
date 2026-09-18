-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415070949.

CREATE OR REPLACE FUNCTION public.get_shift_reconciliation(
  p_hospital_id  uuid,
  p_date         date DEFAULT CURRENT_DATE,
  p_collected_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'date', p_date,
    'summary', jsonb_build_object(
      'total_transactions',  COUNT(*),
      'total_collected',     COALESCE(SUM(py.amount), 0),
      'cash',                COALESCE(SUM(CASE WHEN py.payment_method = 'cash'   THEN py.amount ELSE 0 END), 0),
      'upi',                 COALESCE(SUM(CASE WHEN py.payment_method = 'upi'    THEN py.amount ELSE 0 END), 0),
      'card',                COALESCE(SUM(CASE WHEN py.payment_method = 'card'   THEN py.amount ELSE 0 END), 0),
      'other',               COALESCE(SUM(CASE WHEN py.payment_method NOT IN ('cash','upi','card') THEN py.amount ELSE 0 END), 0)
    ),
    'transactions', jsonb_agg(
      jsonb_build_object(
        'payment_id',      py.id,
        'time',            py.payment_date,
        'patient_name',    pt.full_name,
        'amount',          py.amount,
        'method',          py.payment_method,
        'collected_by',    pr.full_name,
        'invoice_number',  inv.invoice_number,
        'type',            COALESCE(inv.type, 'lab'),
        'voided',          (py.status = 'voided')
      ) ORDER BY py.payment_date
    ),
    'overrides', (
      SELECT jsonb_agg(jsonb_build_object(
        'patient_name',    pt2.full_name,
        'token',           rq.token_prefix || '-' || rq.token_number,
        'override_by',     pr2.full_name,
        'override_at',     rq.payment_override_at
      ))
      FROM public.reception_queue rq
      JOIN public.patients pt2 ON pt2.id = rq.patient_id
      LEFT JOIN public.practitioners pr2 ON pr2.id = rq.payment_override_by
      WHERE rq.hospital_id = p_hospital_id
        AND rq.queue_date = p_date
        AND rq.payment_override = true
    )
  )
  INTO v_result
  FROM public.payments py
  JOIN public.patients pt ON pt.id = py.patient_id
  LEFT JOIN public.practitioners pr ON pr.id = py.collected_by
  LEFT JOIN public.invoices inv ON inv.id = py.invoice_id
  WHERE py.hospital_id = p_hospital_id
    AND py.payment_date::date = p_date
    AND py.status != 'voided'
    AND (p_collected_by IS NULL OR py.collected_by = p_collected_by);

  RETURN COALESCE(v_result, jsonb_build_object(
    'date', p_date,
    'summary', jsonb_build_object(
      'total_transactions', 0, 'total_collected', 0,
      'cash', 0, 'upi', 0, 'card', 0, 'other', 0
    ),
    'transactions', '[]'::jsonb,
    'overrides', '[]'::jsonb
  ));
END;
$$;
