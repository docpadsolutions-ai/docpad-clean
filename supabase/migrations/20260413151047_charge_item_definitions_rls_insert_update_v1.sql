-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413151047.

CREATE POLICY "charge_item_definitions_insert_admin"
ON public.charge_item_definitions FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.practitioners pr
  WHERE pr.hospital_id = charge_item_definitions.hospital_id
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    AND pr.role IN ('admin', 'doctor')
));

CREATE POLICY "charge_item_definitions_update_admin"
ON public.charge_item_definitions FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.practitioners pr
  WHERE pr.hospital_id = charge_item_definitions.hospital_id
    AND (pr.user_id = auth.uid() OR pr.id = auth.uid())
    AND pr.role IN ('admin', 'doctor')
));
