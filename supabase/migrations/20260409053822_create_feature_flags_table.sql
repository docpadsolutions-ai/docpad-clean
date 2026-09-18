-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409053822.

CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hospital_id, feature_key)
);

CREATE INDEX idx_feature_flags_hospital ON feature_flags(hospital_id);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE feature_flags IS 'Feature toggles per hospital for gradual rollouts';
