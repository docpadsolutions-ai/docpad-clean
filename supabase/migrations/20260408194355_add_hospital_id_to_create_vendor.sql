-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408194355.

-- Drop existing function
DROP FUNCTION IF EXISTS public.create_vendor(
    p_vendor_name text,
    p_contact_person text,
    p_phone text,
    p_email text,
    p_address jsonb,
    p_drug_license_no text,
    p_gst_no text,
    p_payment_terms_days integer,
    p_bank_details jsonb
);

-- Recreate with hospital_id parameter
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
    -- Insert vendor with hospital_id
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
