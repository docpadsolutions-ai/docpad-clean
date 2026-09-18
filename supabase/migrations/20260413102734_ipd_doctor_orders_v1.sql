-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413102734.

CREATE TABLE IF NOT EXISTS public.ipd_doctor_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id),
  admission_id          uuid NOT NULL REFERENCES public.ipd_admissions(id),
  patient_id            uuid NOT NULL REFERENCES public.patients(id),
  progress_note_id      uuid REFERENCES public.ipd_progress_notes(id),
  order_date            date NOT NULL DEFAULT CURRENT_DATE,
  order_time            time NOT NULL DEFAULT CURRENT_TIME,
  order_day             integer,
  order_category        text NOT NULL CHECK (order_category IN ('diet','activity','nursing','iv_fluid','blood_product','physio','isolation','other')),
  order_text            text NOT NULL,
  details_json          jsonb,
  priority              text NOT NULL DEFAULT 'routine' CHECK (priority IN ('stat','urgent','routine')),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','held')),
  ordered_by            uuid NOT NULL REFERENCES public.practitioners(id),
  acknowledged_by       uuid REFERENCES public.practitioners(id),
  acknowledged_at       timestamp with time zone,
  completed_at          timestamp with time zone,
  cancelled_at          timestamp with time zone,
  cancel_reason         text,
  fhir_service_request_id text,
  fhir_json             jsonb,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_doctor_orders_admission ON public.ipd_doctor_orders(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_orders_status ON public.ipd_doctor_orders(status);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_orders_category ON public.ipd_doctor_orders(order_category);

ALTER TABLE public.ipd_doctor_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ipd_doctor_orders_select" ON public.ipd_doctor_orders
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_doctor_orders.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_doctor_orders_insert" ON public.ipd_doctor_orders
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_doctor_orders.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ipd_doctor_orders_update" ON public.ipd_doctor_orders
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ipd_doctor_orders.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE TRIGGER set_updated_at_ipd_doctor_orders
  BEFORE UPDATE ON public.ipd_doctor_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
