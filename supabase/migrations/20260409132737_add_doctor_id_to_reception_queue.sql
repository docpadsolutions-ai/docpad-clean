-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260409132737.

-- Add doctor_id column as alias to assigned_doctor_id
ALTER TABLE reception_queue 
ADD COLUMN IF NOT EXISTS doctor_id uuid;

-- Add FK constraint to practitioners
ALTER TABLE reception_queue
ADD CONSTRAINT reception_queue_doctor_id_fkey
FOREIGN KEY (doctor_id) REFERENCES practitioners(id);

-- Add comment
COMMENT ON COLUMN reception_queue.doctor_id IS 'Alias for assigned_doctor_id - references practitioners.id';
