-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409132223.

-- Step 1: Add missing columns from profiles to practitioners
ALTER TABLE practitioners 
ADD COLUMN IF NOT EXISTS clinic_name text DEFAULT 'DocPad Health Clinic',
ADD COLUMN IF NOT EXISTS signature_url text,
ADD COLUMN IF NOT EXISTS security_question text,
ADD COLUMN IF NOT EXISTS security_answer text,
ADD COLUMN IF NOT EXISTS registration_proof_filename text,
ADD COLUMN IF NOT EXISTS preferred_comm_channel text,
ADD COLUMN IF NOT EXISTS privileges text[],
ADD COLUMN IF NOT EXISTS information_accurate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_accepted boolean DEFAULT false;

-- Step 2: Drop existing FKs that reference profiles
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_doctor_id_fkey;
ALTER TABLE billing_accounts DROP CONSTRAINT IF EXISTS billing_accounts_created_by_fkey;
ALTER TABLE charge_items DROP CONSTRAINT IF EXISTS charge_items_created_by_fkey;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_created_by_fkey;

-- Step 3: Add new FKs pointing to practitioners
ALTER TABLE appointments 
ADD CONSTRAINT appointments_doctor_id_fkey 
FOREIGN KEY (doctor_id) REFERENCES practitioners(id);

ALTER TABLE billing_accounts 
ADD CONSTRAINT billing_accounts_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES practitioners(id);

ALTER TABLE charge_items 
ADD CONSTRAINT charge_items_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES practitioners(id);

ALTER TABLE invoices 
ADD CONSTRAINT invoices_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES practitioners(id);

-- Step 4: Drop profiles table
DROP TABLE IF EXISTS profiles CASCADE;

-- Step 5: Comment for clarity
COMMENT ON TABLE practitioners IS 'Unified practitioner/user table - replaces legacy profiles table';
