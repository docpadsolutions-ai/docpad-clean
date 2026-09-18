-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417163048.

CREATE TABLE nursing_task_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES practitioners(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);

-- Seed system defaults
INSERT INTO nursing_task_categories (hospital_id, name, is_system)
SELECT 'e90e4607-dd60-4821-b736-02a2577432e0', unnest(ARRAY[
  'Vascular','Neuro','Wound Care','Drain','Traction',
  'Cast','Vitals','IV Care','Medication','Mobilisation','Positioning'
]), true;

-- RLS
ALTER TABLE nursing_task_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY nursing_task_categories_hospital ON nursing_task_categories
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
