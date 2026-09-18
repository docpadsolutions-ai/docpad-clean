-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408055255.

-- Create trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- FHIR Account resource for billing contexts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    
    -- FHIR Account fields
    account_number TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'entered-in-error', 'on-hold', 'unknown')),
    type TEXT,
    account_name TEXT NOT NULL,
    
    -- Subject (patient/organization this account is for)
    subject_type TEXT CHECK (subject_type IN ('Patient', 'Organization')),
    subject_id UUID,
    
    -- Coverage and guarantor
    coverage_id UUID,
    guarantor_type TEXT CHECK (guarantor_type IN ('Patient', 'RelatedPerson', 'Organization')),
    guarantor_id UUID,
    
    -- Billing period
    service_period_start TIMESTAMPTZ,
    service_period_end TIMESTAMPTZ,
    
    -- Financial
    currency TEXT DEFAULT 'INR',
    balance NUMERIC(10,2) DEFAULT 0,
    
    -- FHIR JSON
    fhir_json JSONB,
    
    -- Metadata
    created_by UUID REFERENCES practitioners(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_accounts_hospital ON accounts(hospital_id);
CREATE INDEX idx_accounts_subject ON accounts(subject_type, subject_id);
CREATE INDEX idx_accounts_status ON accounts(status);

-- RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accounts in their hospital"
    ON accounts FOR SELECT
    USING (
        hospital_id IN (
            SELECT hospital_id FROM practitioners 
            WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can manage accounts in their hospital"
    ON accounts FOR ALL
    USING (
        hospital_id IN (
            SELECT hospital_id FROM practitioners 
            WHERE id = auth.uid()
        )
    );

-- Trigger
CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add foreign key from invoices to accounts
ALTER TABLE invoices 
    ADD CONSTRAINT fk_invoices_account 
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
