-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803205536.

-- ============================================================
-- Missing indexes for 100 concurrent users / 100 patients per day
-- At current data size, non-concurrent creation is fine (ms-level locks)
-- ============================================================

-- Reception queue: doctor's active view for today (hot path)
CREATE INDEX IF NOT EXISTS idx_rq_doctor_date_active
  ON public.reception_queue (assigned_doctor_id, queue_date, queue_status)
  WHERE queue_status NOT IN ('completed', 'cancelled', 'no_show');

-- OPD encounters: doctor's patient list by date (hot path)
CREATE INDEX IF NOT EXISTS idx_opd_encounters_doctor_date
  ON public.opd_encounters (doctor_id, encounter_date DESC);

-- OPD encounters: hospital + status for active encounters
CREATE INDEX IF NOT EXISTS idx_opd_encounters_hospital_status
  ON public.opd_encounters (hospital_id, status, encounter_date DESC);

-- Prescriptions: by encounter (pharmacist view)
CREATE INDEX IF NOT EXISTS idx_prescriptions_encounter
  ON public.prescriptions (encounter_id);

-- Prescriptions: pharmacy dispensing queue
CREATE INDEX IF NOT EXISTS idx_prescriptions_status
  ON public.prescriptions (status)
  WHERE status IN ('ordered', 'active');

-- Patients: phone lookup (reception search)
CREATE INDEX IF NOT EXISTS idx_patients_phone
  ON public.patients (phone)
  WHERE phone IS NOT NULL;

-- Patients: hospital scoping (used in RLS subqueries for coverage)
CREATE INDEX IF NOT EXISTS idx_patients_hospital
  ON public.patients (hospital_id);

-- Nursing tasks: ward nurse dashboard (shift-based task list)
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_hospital_date_shift
  ON public.nursing_tasks (hospital_id, due_date, shift, status);

-- IPD MAR: overdue medication alerts (pg_cron job)
CREATE INDEX IF NOT EXISTS idx_ipd_mar_hospital_pending
  ON public.ipd_mar (hospital_id, scheduled_date, scheduled_time)
  WHERE status = 'pending';

-- IPD admissions: active admissions per hospital (command centre)
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_hospital_active
  ON public.ipd_admissions (hospital_id, status)
  WHERE status IN ('in-progress', 'arrived', 'triaged');

-- IPD progress notes: by admission + date (daily rounding)
CREATE INDEX IF NOT EXISTS idx_ipd_progress_notes_admission_date
  ON public.ipd_progress_notes (admission_id, note_date DESC);

-- Charge items: unbilled items per patient (billing dashboard)
CREATE INDEX IF NOT EXISTS idx_charge_items_hospital_unbilled
  ON public.charge_items (hospital_id, patient_id, created_at DESC)
  WHERE status = 'billable';

-- Invoices: outstanding balance (collections view)
CREATE INDEX IF NOT EXISTS idx_invoices_hospital_outstanding
  ON public.invoices (hospital_id, status)
  WHERE status IN ('draft', 'issued');

-- Practitioners: user_id lookup (critical for get_my_hospital_id() perf)
CREATE INDEX IF NOT EXISTS idx_practitioners_user_id
  ON public.practitioners (user_id)
  WHERE user_id IS NOT NULL;
