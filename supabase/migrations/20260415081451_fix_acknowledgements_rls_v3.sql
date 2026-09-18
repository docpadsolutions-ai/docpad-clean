-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260415081451.

DROP POLICY IF EXISTS ack_insert_hospital_scoped ON investigation_acknowledgements;
DROP POLICY IF EXISTS ack_select_hospital_scoped ON investigation_acknowledgements;

-- Allow insert if the acknowledged_by matches auth user (covers case where hospital_id is missing from payload)
CREATE POLICY ack_insert ON investigation_acknowledgements
FOR INSERT WITH CHECK (
  acknowledged_by = auth.uid()
  OR hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

CREATE POLICY ack_select ON investigation_acknowledgements
FOR SELECT USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);

CREATE POLICY ack_update ON investigation_acknowledgements
FOR UPDATE USING (
  hospital_id IN (
    SELECT hospital_id FROM practitioners WHERE user_id = auth.uid()
  )
);
