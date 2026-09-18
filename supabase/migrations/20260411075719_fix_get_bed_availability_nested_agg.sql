-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260411075719.

CREATE OR REPLACE FUNCTION public.get_bed_availability(p_hospital_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_agg(ward_row)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'ward_id', w.id,
      'ward_name', w.name,
      'ward_type', w.ward_type,
      'specialty', w.specialty,
      'total_beds', COUNT(b.id),
      'available', COUNT(b.id) FILTER (WHERE b.status = 'available'),
      'occupied', COUNT(b.id) FILTER (WHERE b.status = 'occupied'),
      'beds', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', b2.id,
          'bed_number', b2.bed_number,
          'status', b2.status,
          'bed_type', b2.bed_type
        ) ORDER BY b2.bed_number)
        FROM public.ipd_beds b2
        WHERE b2.ward_id = w.id AND b2.is_active = TRUE
      )
    ) AS ward_row
    FROM public.ipd_wards w
    LEFT JOIN public.ipd_beds b ON b.ward_id = w.id AND b.is_active = TRUE
    WHERE w.hospital_id = p_hospital_id AND w.is_active = TRUE
    GROUP BY w.id, w.name, w.ward_type, w.specialty
  ) sub;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;
