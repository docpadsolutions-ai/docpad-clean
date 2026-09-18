-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409132825.

-- Add RLS policies for reception_queue
-- Allow authenticated users from same hospital to SELECT
CREATE POLICY "Users can view queue for their hospital"
ON reception_queue
FOR SELECT
TO authenticated
USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users from same hospital to INSERT
CREATE POLICY "Users can add to queue for their hospital"
ON reception_queue
FOR INSERT
TO authenticated
WITH CHECK (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users from same hospital to UPDATE
CREATE POLICY "Users can update queue for their hospital"
ON reception_queue
FOR UPDATE
TO authenticated
USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users from same hospital to DELETE
CREATE POLICY "Users can delete from queue for their hospital"
ON reception_queue
FOR DELETE
TO authenticated
USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);
