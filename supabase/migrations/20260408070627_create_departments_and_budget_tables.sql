-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408070627.

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  name text NOT NULL,
  code text,
  type text NOT NULL CHECK (type IN ('clinical', 'diagnostic', 'administrative', 'support')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_hospital_scoped" ON departments;
CREATE POLICY "departments_hospital_scoped" ON departments
  FOR ALL
  TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_departments_hospital ON departments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_departments_hospital_active ON departments(hospital_id, is_active);

-- Add department_id columns
ALTER TABLE charge_items ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE opd_encounters ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS primary_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;

-- Indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_charge_items_department ON charge_items(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_department ON invoices(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encounters_department ON opd_encounters(department_id) WHERE department_id IS NOT NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO authenticated, service_role;

-- Seed departments for DocPad
INSERT INTO departments (hospital_id, name, code, type)
SELECT id, 'Orthopedics', 'ORTHO', 'clinical'
FROM hospitals 
WHERE hospital_name = 'DocPad Health Clinic'
ON CONFLICT DO NOTHING;

INSERT INTO departments (hospital_id, name, code, type)
SELECT id, 'General Medicine', 'GENMED', 'clinical'
FROM hospitals 
WHERE hospital_name = 'DocPad Health Clinic'
ON CONFLICT DO NOTHING;

INSERT INTO departments (hospital_id, name, code, type)
SELECT id, 'Diagnostics', 'DIAG', 'diagnostic'
FROM hospitals 
WHERE hospital_name = 'DocPad Health Clinic'
ON CONFLICT DO NOTHING;

INSERT INTO departments (hospital_id, name, code, type)
SELECT id, 'Pharmacy', 'PHARM', 'support'
FROM hospitals 
WHERE hospital_name = 'DocPad Health Clinic'
ON CONFLICT DO NOTHING;

INSERT INTO departments (hospital_id, name, code, type)
SELECT id, 'Administration', 'ADMIN', 'administrative'
FROM hospitals 
WHERE hospital_name = 'DocPad Health Clinic'
ON CONFLICT DO NOTHING;
