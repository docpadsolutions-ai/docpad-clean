-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408195431.

-- Drop existing get_vendors function
DROP FUNCTION IF EXISTS public.get_vendors(p_status text);

-- Recreate with hospital_id parameter for RLS
CREATE OR REPLACE FUNCTION public.get_vendors(
    p_hospital_id uuid,
    p_status text DEFAULT NULL
)
RETURNS TABLE (
    vendor_id uuid,
    vendor_name text,
    contact_person text,
    phone text,
    email text,
    address jsonb,
    drug_license_no text,
    gst_no text,
    payment_terms_days integer,
    bank_details jsonb,
    status text,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.vendor_id,
        v.vendor_name,
        v.contact_person,
        v.phone,
        v.email,
        v.address,
        v.drug_license_no,
        v.gst_no,
        v.payment_terms_days,
        v.bank_details,
        v.status,
        v.created_at,
        v.updated_at
    FROM vendors v
    WHERE v.hospital_id = p_hospital_id
      AND (p_status IS NULL OR v.status = p_status)
    ORDER BY v.vendor_name;
END;
$$;
