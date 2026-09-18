-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061212.

-- Make account_id nullable OR add trigger to auto-populate
ALTER TABLE charge_items 
ALTER COLUMN account_id DROP NOT NULL;

-- Optional: Add trigger to auto-sync account_id from patient
CREATE OR REPLACE FUNCTION sync_charge_item_account()
RETURNS TRIGGER AS $$
DECLARE
    v_account_id UUID;
BEGIN
    -- If account_id already set, skip
    IF NEW.account_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Get or create patient account
    SELECT id INTO v_account_id
    FROM accounts
    WHERE subject_type = 'Patient'
    AND subject_id = NEW.patient_id
    AND hospital_id = NEW.hospital_id
    LIMIT 1;

    IF v_account_id IS NULL THEN
        -- Create account
        INSERT INTO accounts (
            hospital_id,
            account_name,
            subject_type,
            subject_id,
            type,
            status
        )
        SELECT 
            NEW.hospital_id,
            COALESCE(p.full_name, 'Patient') || ' - Patient Account',
            'Patient',
            NEW.patient_id,
            'patient',
            'active'
        FROM patients p
        WHERE p.id = NEW.patient_id
        RETURNING id INTO v_account_id;
    END IF;

    NEW.account_id = v_account_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_sync_charge_item_account
    BEFORE INSERT ON charge_items
    FOR EACH ROW
    EXECUTE FUNCTION sync_charge_item_account();
