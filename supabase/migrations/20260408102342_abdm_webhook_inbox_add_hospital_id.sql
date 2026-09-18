-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408102342.

-- Add hospital_id to abdm_webhook_inbox for multi-tenant isolation
ALTER TABLE abdm_webhook_inbox 
  ADD COLUMN hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE;

-- Create index for RLS performance
CREATE INDEX idx_abdm_webhook_inbox_hospital_id 
  ON abdm_webhook_inbox(hospital_id);

-- RLS policy: users see only their hospital's webhooks
CREATE POLICY "Users can view ABDM webhooks for their hospital"
  ON abdm_webhook_inbox
  FOR SELECT
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id 
      FROM practitioners 
      WHERE user_id = auth.uid()
    )
  );

-- Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE abdm_webhook_inbox;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
