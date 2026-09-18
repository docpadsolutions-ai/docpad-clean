-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409055900.

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Appointments hospital isolation" ON appointments;

-- Create more permissive policy allowing hospital staff to create appointments
CREATE POLICY "Appointments hospital access" ON appointments
FOR ALL
USING (
  -- Allow if user is a practitioner in the same hospital
  hospital_id = (SELECT hospital_id FROM practitioners WHERE user_id = auth.uid())
  OR
  -- Allow if user is staff in the same hospital (add when staff table exists)
  -- hospital_id = (SELECT hospital_id FROM hospital_staff WHERE user_id = auth.uid())
  -- For now, allowing same hospital via ANY role
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    -- UNION
    -- SELECT hospital_id FROM hospital_staff WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
    -- UNION
    -- SELECT hospital_id FROM hospital_staff WHERE user_id = auth.uid()
  )
);
