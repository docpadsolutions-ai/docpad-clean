-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416182811.

ALTER TABLE ipd_discharge_summaries
  ADD COLUMN IF NOT EXISTS ai_draft_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_draft_status TEXT DEFAULT 'none' CHECK (ai_draft_status IN ('none','generating','ready','accepted','rejected')),
  ADD COLUMN IF NOT EXISTS ai_draft JSONB;

COMMENT ON COLUMN ipd_discharge_summaries.ai_draft IS 
'Gemini-generated draft: {hospital_course_summary, discharge_instructions, diet_advice, activity_restrictions, wound_care_instructions, post_op_protocol, physiotherapy_plan, discharge_medications_summary}';
COMMENT ON COLUMN ipd_discharge_summaries.ai_draft_status IS 
'none=not generated, generating=in progress, ready=draft ready for review, accepted=doctor approved, rejected=doctor discarded';
