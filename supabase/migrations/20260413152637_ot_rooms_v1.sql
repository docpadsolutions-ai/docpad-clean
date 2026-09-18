-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413152637.

CREATE TABLE public.ot_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id),
  name          text NOT NULL,        -- e.g. "OT-1", "Main OT"
  ot_number     text NOT NULL,        -- short code used in surgery scheduling
  specialty     text,                 -- e.g. 'Orthopedics', 'General' or NULL for shared
  floor         integer,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ot_rooms_hospital ON public.ot_rooms(hospital_id);

ALTER TABLE public.ot_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ot_rooms_select" ON public.ot_rooms
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ot_rooms.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
  ));

CREATE POLICY "ot_rooms_insert_admin" ON public.ot_rooms
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ot_rooms.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
      AND pr.role IN ('admin','doctor')
  ));

CREATE POLICY "ot_rooms_update_admin" ON public.ot_rooms
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.practitioners pr
    WHERE pr.hospital_id = ot_rooms.hospital_id
      AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
      AND pr.role IN ('admin','doctor')
  ));

CREATE TRIGGER set_updated_at_ot_rooms
  BEFORE UPDATE ON public.ot_rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed for Rameshwar Dass Memorial Hospital
INSERT INTO public.ot_rooms (hospital_id, name, ot_number, specialty, floor, is_active)
VALUES
  ('e90e4607-dd60-4821-b736-02a2577432e0', 'Main OT', 'OT-1', NULL, 2, true),
  ('e90e4607-dd60-4821-b736-02a2577432e0', 'Ortho OT', 'OT-2', 'Orthopedics', 2, true);

NOTIFY pgrst, 'reload schema';
