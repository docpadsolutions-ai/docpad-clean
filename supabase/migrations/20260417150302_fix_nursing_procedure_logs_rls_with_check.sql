-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417150302.

-- Drop and recreate with proper WITH CHECK
DROP POLICY IF EXISTS hospital_isolation_nursing_procedures ON nursing_procedure_logs;

CREATE POLICY hospital_isolation_nursing_procedures ON nursing_procedure_logs
  FOR ALL
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

NOTIFY pgrst, 'reload schema';
