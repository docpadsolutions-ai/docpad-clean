-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411140848.

-- In-app notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES hospitals(id),
  recipient_id    uuid NOT NULL REFERENCES practitioners(id),
  sender_id       uuid REFERENCES practitioners(id),
  type            text NOT NULL,
  -- types: 'pac_request','consult_request','surgery_scheduled',
  --        'result_critical','discharge_ready','task_assigned'
  title           text NOT NULL,
  body            text,
  data            jsonb,          -- arbitrary context (admission_id, surgery_id etc)
  is_read         boolean DEFAULT false,
  read_at         timestamptz,
  action_url      text,           -- deep link e.g. /ipd/{admissionId}
  priority        text DEFAULT 'normal' 
                    CHECK (priority IN ('low','normal','high','urgent')),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient 
  ON notifications(recipient_id, is_read, created_at DESC);

-- PAC (Pre-Anaesthetic Checkup) requests
CREATE TABLE IF NOT EXISTS pac_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES hospitals(id),
  admission_id        uuid NOT NULL REFERENCES ipd_admissions(id),
  surgery_id          uuid REFERENCES ot_surgeries(id),
  patient_id          uuid NOT NULL,
  requesting_doctor_id uuid REFERENCES practitioners(id),
  anaesthetist_id     uuid REFERENCES practitioners(id),
  requested_at        timestamptz DEFAULT now(),
  status              text DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','completed','deferred')),
  asa_grade           text,
  pac_notes           text,
  clearance_given     boolean,
  clearance_notes     text,
  completed_at        timestamptz,
  notification_id     uuid REFERENCES notifications(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pac_requests_anaesthetist 
  ON pac_requests(anaesthetist_id, status);
CREATE INDEX IF NOT EXISTS idx_pac_requests_admission 
  ON pac_requests(admission_id);

NOTIFY pgrst, 'reload schema';
