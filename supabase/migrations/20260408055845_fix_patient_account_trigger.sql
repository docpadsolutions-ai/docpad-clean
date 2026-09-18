-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408055845.

-- Fix function to use correct patients table schema
CREATE OR REPLACE FUNCTION ensure_patient_account()
RETURNS TRIGGER AS $$
DECLARE
    v_account_id UUID;
    v_patient_name TEXT;
BEGIN
    -- If account_id already provided, do nothing
    IF NEW.account_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Get patient name (patients table uses full_name)
    SELECT 
        COALESCE(full_name, 'Patient') 
    INTO v_patient_name
    FROM patients 
    WHERE id = NEW.patient_id;

    -- Check if account exists for this patient
    SELECT id INTO v_account_id
    FROM accounts
    WHERE subject_type = 'Patient'
    AND subject_id = NEW.patient_id
    AND hospital_id = NEW.hospital_id
    LIMIT 1;

    -- Create account if not exists
    IF v_account_id IS NULL THEN
        INSERT INTO accounts (
            hospital_id,
            account_name,
            subject_type,
            subject_id,
            type,
            status,
            created_by
        ) VALUES (
            NEW.hospital_id,
            v_patient_name || ' - Patient Account',
            'Patient',
            NEW.patient_id,
            'patient',
            'active',
            NEW.created_by
        )
        RETURNING id INTO v_account_id;
    END IF;

    -- Set account_id on invoice
    NEW.account_id = v_account_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
