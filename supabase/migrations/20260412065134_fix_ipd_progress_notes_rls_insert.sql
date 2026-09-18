-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412065134.

-- Drop the catch-all policy and replace with explicit per-command policies
DROP POLICY IF EXISTS ipd_notes_isolation ON ipd_progress_notes;

-- SELECT / UPDATE / DELETE: must belong to same hospital
CREATE POLICY ipd_notes_select ON ipd_progress_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM practitioners pr
      WHERE pr.hospital_id = ipd_progress_notes.hospital_id
        AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    )
  );

CREATE POLICY ipd_notes_update ON ipd_progress_notes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM practitioners pr
      WHERE pr.hospital_id = ipd_progress_notes.hospital_id
        AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    )
  );

CREATE POLICY ipd_notes_delete ON ipd_progress_notes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM practitioners pr
      WHERE pr.hospital_id = ipd_progress_notes.hospital_id
        AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    )
  );

-- INSERT: with_check must be explicitly set
CREATE POLICY ipd_notes_insert ON ipd_progress_notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM practitioners pr
      WHERE pr.hospital_id = ipd_progress_notes.hospital_id
        AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    )
  );
