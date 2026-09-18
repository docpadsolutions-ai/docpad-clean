-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408062205.

-- RPC 1: Record payment on invoice
-- Updates amount_paid, balance_due auto-recalcs via generated column
-- Inserts payment record
CREATE OR REPLACE FUNCTION record_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_collected_by UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hospital_id UUID;
  v_patient_id UUID;
  v_balance_due NUMERIC;
  v_payment_id UUID;
BEGIN
  -- Get invoice details
  SELECT hospital_id, patient_id, balance_due
  INTO v_hospital_id, v_patient_id, v_balance_due
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  IF p_amount > v_balance_due THEN
    RAISE EXCEPTION 'Payment amount exceeds balance due';
  END IF;

  -- Insert payment record
  INSERT INTO payments (
    hospital_id,
    invoice_id,
    patient_id,
    amount,
    payment_method,
    reference_number,
    collected_by,
    notes,
    status,
    payment_date
  ) VALUES (
    v_hospital_id,
    p_invoice_id,
    v_patient_id,
    p_amount,
    p_payment_method,
    p_reference_number,
    p_collected_by,
    p_notes,
    'confirmed',
    NOW()
  )
  RETURNING id INTO v_payment_id;

  -- Update invoice amount_paid (balance_due auto-recalcs)
  UPDATE invoices
  SET 
    amount_paid = amount_paid + p_amount,
    status = CASE 
      WHEN (total_gross - total_discount) - (amount_paid + p_amount) = 0 THEN 'balanced'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = p_invoice_id;

  -- Return updated invoice
  RETURN (
    SELECT jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'invoice', row_to_json(i.*)
    )
    FROM invoices i
    WHERE i.id = p_invoice_id
  );
END;
$$;

-- RPC 2: Reconcile account balance
-- Syncs accounts.balance with sum of invoice balances
CREATE OR REPLACE FUNCTION reconcile_account_balance(
  p_account_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_balance NUMERIC;
  v_hospital_id UUID;
BEGIN
  -- Get account hospital_id
  SELECT hospital_id INTO v_hospital_id
  FROM accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  -- Calculate total balance from all invoices linked to this account
  SELECT COALESCE(SUM(balance_due), 0)
  INTO v_total_balance
  FROM invoices
  WHERE account_id = p_account_id
    AND status NOT IN ('cancelled', 'entered-in-error');

  -- Update account balance
  UPDATE accounts
  SET 
    balance = v_total_balance,
    updated_at = NOW()
  WHERE id = p_account_id;

  -- Return updated account
  RETURN (
    SELECT jsonb_build_object(
      'success', true,
      'account_id', p_account_id,
      'previous_balance', balance,
      'new_balance', v_total_balance,
      'account', row_to_json(a.*)
    )
    FROM accounts a
    WHERE a.id = p_account_id
  );
END;
$$;
