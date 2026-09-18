-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417163822.

CREATE OR REPLACE FUNCTION public.generate_mar_slots(p_treatment_id uuid, p_for_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_treatment ipd_treatments%ROWTYPE;
  v_times time[];
  t time;
  v_count int := 0;
BEGIN
  SELECT * INTO v_treatment FROM ipd_treatments WHERE id = p_treatment_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_times := CASE upper(trim(v_treatment.frequency))
    WHEN 'OD'    THEN ARRAY['08:00'::time]
    WHEN 'QD'    THEN ARRAY['08:00'::time]
    WHEN 'ONCE'  THEN ARRAY['08:00'::time]
    WHEN 'BD'    THEN ARRAY['08:00'::time, '20:00'::time]
    WHEN 'BID'   THEN ARRAY['08:00'::time, '20:00'::time]
    WHEN 'TDS'   THEN ARRAY['08:00'::time, '14:00'::time, '20:00'::time]
    WHEN 'TID'   THEN ARRAY['08:00'::time, '14:00'::time, '20:00'::time]  -- alias
    WHEN 'QID'   THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '22:00'::time]
    WHEN 'QDS'   THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '22:00'::time]
    WHEN 'Q6H'   THEN ARRAY['06:00'::time, '12:00'::time, '18:00'::time, '00:00'::time]
    WHEN 'Q8H'   THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    WHEN 'Q12H'  THEN ARRAY['08:00'::time, '20:00'::time]
    WHEN 'SOS'   THEN ARRAY['08:00'::time]
    WHEN 'PRN'   THEN ARRAY['08:00'::time]
    WHEN 'STAT'  THEN ARRAY[CURRENT_TIME::time]
    WHEN 'HS'    THEN ARRAY['22:00'::time]  -- hora somni / bedtime
    WHEN 'AC'    THEN ARRAY['07:30'::time, '12:30'::time, '18:30'::time]  -- before meals
    WHEN 'PC'    THEN ARRAY['09:00'::time, '14:00'::time, '20:00'::time]  -- after meals
    ELSE ARRAY['08:00'::time]
  END;

  FOREACH t IN ARRAY v_times LOOP
    IF NOT EXISTS (
      SELECT 1 FROM ipd_mar
      WHERE treatment_id = p_treatment_id
        AND scheduled_date = p_for_date
        AND scheduled_time = t
    ) THEN
      INSERT INTO ipd_mar (
        hospital_id, admission_id, patient_id, treatment_id,
        drug_name, drug_id, dose, route, frequency,
        scheduled_date, scheduled_time, status
      ) VALUES (
        v_treatment.hospital_id, v_treatment.admission_id, v_treatment.patient_id,
        p_treatment_id, v_treatment.name, NULL,
        COALESCE(v_treatment.dose, ''), COALESCE(v_treatment.route, 'oral'),
        COALESCE(v_treatment.frequency, 'OD'),
        p_for_date, t, 'pending'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Also backfill today's missing TID slots for Deepak Kumar
SELECT generate_mar_slots(id, CURRENT_DATE)
FROM ipd_treatments
WHERE admission_id = '13be29b2-afed-4aa6-9fc8-aabdc85ccc45'
  AND upper(trim(frequency)) = 'TID';

NOTIFY pgrst, 'reload schema';
