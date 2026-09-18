-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415081403.

DROP POLICY IF EXISTS ack_insert_hospital_scoped ON investigation_acknowledgements;
DROP POLICY IF EXISTS ack_select_hospital_scoped ON investigation_acknowledgements;

CREATE POLICY ack_insert_hospital_scoped ON investigation_acknowledgements
FOR INSERT WITH CHECK (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

CREATE POLICY ack_select_hospital_scoped ON investigation_acknowledgements
FOR SELECT USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);
