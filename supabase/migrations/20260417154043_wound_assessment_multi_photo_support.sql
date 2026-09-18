-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417154043.

ALTER TABLE ipd_wound_assessments 
ADD COLUMN IF NOT EXISTS photo_storage_paths text[] DEFAULT '{}';

DROP POLICY IF EXISTS wound_photos_insert ON storage.objects;
DROP POLICY IF EXISTS wound_photos_select ON storage.objects;

CREATE POLICY wound_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wound-photos');

CREATE POLICY wound_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'wound-photos');

NOTIFY pgrst, 'reload schema';
