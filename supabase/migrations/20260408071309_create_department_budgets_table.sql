-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408071309.

-- Create department budgets table
CREATE TABLE IF NOT EXISTS department_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  department_id uuid REFERENCES departments(id) NOT NULL,
  fiscal_year int NOT NULL,
  quarter int CHECK (quarter BETWEEN 1 AND 4),
  target_revenue numeric(12,2) DEFAULT 0,
  target_patient_volume int DEFAULT 0,
  actual_revenue numeric(12,2) DEFAULT 0,
  actual_patient_volume int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE department_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_budgets_hospital_scoped" ON department_budgets;
CREATE POLICY "dept_budgets_hospital_scoped" ON department_budgets
  FOR ALL
  TO authenticated
  USING (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid() OR id = auth.uid() LIMIT 1));

-- Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_dept_budget_unique ON department_budgets(hospital_id, department_id, fiscal_year, quarter);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON department_budgets TO authenticated, service_role;
