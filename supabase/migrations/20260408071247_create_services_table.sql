-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408071247.

-- Create services catalog table
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  department_id uuid REFERENCES departments(id),
  service_code text NOT NULL,
  service_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('consultation', 'procedure', 'lab_test', 'imaging', 'medication', 'supply', 'room_charge', 'nursing', 'registration')),
  standard_rate numeric(10,2) DEFAULT 0,
  cost_basis numeric(10,2),
  is_active boolean DEFAULT true,
  snomed_code text,
  loinc_code text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services_hospital_scoped" ON services;
CREATE POLICY "services_hospital_scoped" ON services
  FOR ALL
  TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

-- Link services to charge_items
ALTER TABLE charge_items ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_services_hospital_dept ON services(hospital_id, department_id);
CREATE INDEX IF NOT EXISTS idx_charge_items_service ON charge_items(service_id) WHERE service_id IS NOT NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO authenticated, service_role;
