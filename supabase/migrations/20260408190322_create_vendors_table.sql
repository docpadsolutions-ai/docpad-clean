-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408190322.

-- Create vendors table
CREATE TABLE IF NOT EXISTS vendors (
  vendor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address JSONB,
  drug_license_no TEXT NOT NULL,
  gst_no TEXT,
  payment_terms_days INTEGER DEFAULT 30,
  bank_details JSONB,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_hospital_scope" ON vendors
  FOR ALL USING (hospital_id = (auth.jwt() ->> 'hospital_id')::uuid);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vendors_hospital ON vendors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_license ON vendors(drug_license_no);
