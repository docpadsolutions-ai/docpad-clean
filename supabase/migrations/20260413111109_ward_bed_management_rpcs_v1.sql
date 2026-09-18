-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260413111109.

-- ================================================================
-- upsert_ward: Create or update a ward
-- ================================================================
CREATE OR REPLACE FUNCTION public.upsert_ward(
  p_hospital_id   uuid,
  p_ward_id       uuid DEFAULT NULL,
  p_name          text DEFAULT NULL,
  p_ward_type     text DEFAULT NULL,
  p_specialty     text DEFAULT NULL,
  p_floor         integer DEFAULT NULL,
  p_is_active     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_ward_id uuid;
BEGIN
  IF p_ward_id IS NOT NULL THEN
    UPDATE public.ipd_wards SET
      name        = COALESCE(p_name, name),
      ward_type   = COALESCE(p_ward_type, ward_type),
      specialty   = COALESCE(p_specialty, specialty),
      floor       = COALESCE(p_floor, floor),
      is_active   = p_is_active,
      updated_at  = now()
    WHERE id = p_ward_id AND hospital_id = p_hospital_id
    RETURNING id INTO v_ward_id;
  ELSE
    INSERT INTO public.ipd_wards (
      hospital_id, name, ward_type, specialty, floor, is_active, total_beds
    ) VALUES (
      p_hospital_id, p_name, p_ward_type, p_specialty, p_floor, p_is_active, 0
    ) RETURNING id INTO v_ward_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'ward_id', v_ward_id);
END;
$$;


-- ================================================================
-- add_beds_to_ward: Bulk-add new beds to a ward
-- Auto-generates bed numbers continuing from existing highest
-- ================================================================
CREATE OR REPLACE FUNCTION public.add_beds_to_ward(
  p_hospital_id   uuid,
  p_ward_id       uuid,
  p_count         integer,
  p_bed_type      text DEFAULT 'standard',
  p_prefix        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ward_code     text;
  v_existing_max  integer;
  v_new_number    integer;
  v_bed_number    text;
  v_beds_created  integer := 0;
  i               integer;
BEGIN
  -- Get ward code for bed numbering
  SELECT COALESCE(p_prefix, code, LEFT(UPPER(REPLACE(name,' ','')), 3))
  INTO v_ward_code
  FROM public.ipd_wards WHERE id = p_ward_id;

  -- Find current highest bed number suffix
  SELECT COALESCE(MAX(
    NULLIF(REGEXP_REPLACE(bed_number, '[^0-9]', '', 'g'), '')::integer
  ), 0)
  INTO v_existing_max
  FROM public.ipd_beds
  WHERE ward_id = p_ward_id;

  -- Create beds
  FOR i IN 1..p_count LOOP
    v_new_number := v_existing_max + i;
    v_bed_number := v_ward_code || '-' || v_new_number;

    INSERT INTO public.ipd_beds (
      hospital_id, ward_id, bed_number, bed_type, status, is_active
    ) VALUES (
      p_hospital_id, p_ward_id, v_bed_number, p_bed_type, 'available', true
    );
    v_beds_created := v_beds_created + 1;
  END LOOP;

  -- Update total_beds count on ward
  UPDATE public.ipd_wards
  SET total_beds = (
    SELECT COUNT(*) FROM public.ipd_beds
    WHERE ward_id = p_ward_id AND is_active = true
  ),
  updated_at = now()
  WHERE id = p_ward_id;

  RETURN jsonb_build_object(
    'success', true,
    'beds_created', v_beds_created,
    'ward_id', p_ward_id
  );
END;
$$;


-- ================================================================
-- update_bed: Update a single bed (type, status, deactivate)
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_bed(
  p_bed_id        uuid,
  p_hospital_id   uuid,
  p_bed_type      text DEFAULT NULL,
  p_status        text DEFAULT NULL,
  p_is_active     boolean DEFAULT NULL,
  p_bed_number    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Cannot deactivate an occupied bed
  IF p_is_active = false THEN
    IF EXISTS (
      SELECT 1 FROM public.ipd_beds
      WHERE id = p_bed_id AND status = 'occupied'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot deactivate an occupied bed');
    END IF;
  END IF;

  UPDATE public.ipd_beds SET
    bed_type    = COALESCE(p_bed_type, bed_type),
    status      = COALESCE(p_status, status),
    is_active   = COALESCE(p_is_active, is_active),
    bed_number  = COALESCE(p_bed_number, bed_number),
    updated_at  = now()
  WHERE id = p_bed_id AND hospital_id = p_hospital_id;

  -- Recalculate ward total
  UPDATE public.ipd_wards
  SET total_beds = (
    SELECT COUNT(*) FROM public.ipd_beds b
    WHERE b.ward_id = (SELECT ward_id FROM public.ipd_beds WHERE id = p_bed_id)
    AND b.is_active = true
  ), updated_at = now()
  WHERE id = (SELECT ward_id FROM public.ipd_beds WHERE id = p_bed_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
