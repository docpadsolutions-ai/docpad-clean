-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408200928.

-- Temporarily remove auth check from create_vendor
DROP FUNCTION IF EXISTS public.create_vendor(text, text, text, text, jsonb, text, text, integer, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_vendor(
    p_vendor_name text,
    p_contact_person text,
    p_phone text,
    p_email text,
    p_address jsonb,
    p_drug_license_no text,
    p_gst_no text,
    p_payment_terms_days integer,
    p_bank_details jsonb,
    p_hospital_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_vendor_id uuid;
BEGIN
    INSERT INTO vendors (
        vendor_name,
        contact_person,
        phone,
        email,
        address,
        drug_license_no,
        gst_no,
        payment_terms_days,
        bank_details,
        hospital_id,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_vendor_name,
        p_contact_person,
        p_phone,
        p_email,
        p_address,
        p_drug_license_no,
        p_gst_no,
        p_payment_terms_days,
        p_bank_details,
        p_hospital_id,
        'active',
        now(),
        now()
    )
    RETURNING vendor_id INTO v_vendor_id;

    RETURN v_vendor_id;
END;
$$;

-- Temporarily remove auth check from get_vendors
DROP FUNCTION IF EXISTS public.get_vendors(uuid, text);

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
