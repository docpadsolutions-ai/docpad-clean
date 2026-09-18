-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408101448.

CREATE TABLE IF NOT EXISTS abdm_webhook_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE abdm_webhook_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_only ON abdm_webhook_inbox
    USING (true);
