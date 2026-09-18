-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408094028.

-- Create submit preauth request function
CREATE OR REPLACE FUNCTION public.submit_preauth_request(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_number TEXT;
  v_result JSONB;
BEGIN
  -- Generate request number if not exists
  SELECT request_number INTO v_request_number
  FROM preauth_requests
  WHERE id = p_id;
  
  IF v_request_number IS NULL THEN
    v_request_number := 'PA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;

  -- Update status to submitted
  UPDATE preauth_requests
  SET 
    status = 'submitted',
    request_number = v_request_number,
    request_date = NOW(),
    submitted_at = NOW(),
    submitted_by = auth.uid(),
    updated_at = NOW()
  WHERE id = p_id
  RETURNING jsonb_build_object(
    'id', id,
    'request_number', request_number,
    'status', status,
    'submitted_at', submitted_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;
