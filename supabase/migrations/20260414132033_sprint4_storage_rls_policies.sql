-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414132033.

-- Storage RLS for patient-photos bucket (correct approach via auth.rls on storage.objects)
CREATE POLICY "patient_photos_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'patient-photos'
    AND auth.uid() IN (
      SELECT pr.user_id FROM practitioners pr
      JOIN patients p ON p.hospital_id = pr.hospital_id
      WHERE p.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "patient_photos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'patient-photos'
    AND auth.uid() IN (
      SELECT user_id FROM practitioners
    )
  );

CREATE POLICY "patient_photos_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'patient-photos'
    AND auth.uid() IN (
      SELECT user_id FROM practitioners
    )
  );
