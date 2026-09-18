-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260420170953.

ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS logo_url         text,
  ADD COLUMN IF NOT EXISTS tagline          text,
  ADD COLUMN IF NOT EXISTS registration_no  text,
  ADD COLUMN IF NOT EXISTS letterhead_color text DEFAULT '#1d4ed8';

NOTIFY pgrst, 'reload schema';
