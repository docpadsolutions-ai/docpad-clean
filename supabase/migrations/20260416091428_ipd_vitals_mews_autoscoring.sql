-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416091428.

-- 1. Add AVPU + MEWS columns to ipd_vitals
ALTER TABLE ipd_vitals
  ADD COLUMN IF NOT EXISTS avpu text CHECK (avpu IN ('A','V','P','U')),
  ADD COLUMN IF NOT EXISTS mews_score integer,
  ADD COLUMN IF NOT EXISTS mews_components jsonb,
  ADD COLUMN IF NOT EXISTS mews_alert_level text CHECK (mews_alert_level IN ('normal','yellow','red'));

-- 2. MEWS scoring function
CREATE OR REPLACE FUNCTION calculate_mews(
  p_rr integer,
  p_spo2 integer,
  p_temp numeric,
  p_sbp integer,
  p_hr integer,
  p_avpu text
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s_rr integer := 0;
  s_spo2 integer := 0;
  s_temp integer := 0;
  s_sbp integer := 0;
  s_hr integer := 0;
  s_avpu integer := 0;
  total integer := 0;
  alert_level text;
BEGIN
  IF p_rr IS NOT NULL THEN
    IF p_rr < 5 THEN s_rr := 3;
    ELSIF p_rr <= 8 THEN s_rr := 2;
    ELSIF p_rr <= 11 THEN s_rr := 1;
    ELSIF p_rr <= 20 THEN s_rr := 0;
    ELSIF p_rr <= 24 THEN s_rr := 2;
    ELSE s_rr := 3;
    END IF;
  END IF;

  IF p_spo2 IS NOT NULL THEN
    IF p_spo2 <= 91 THEN s_spo2 := 3;
    ELSIF p_spo2 <= 93 THEN s_spo2 := 2;
    ELSIF p_spo2 <= 95 THEN s_spo2 := 1;
    ELSE s_spo2 := 0;
    END IF;
  END IF;

  IF p_temp IS NOT NULL THEN
    IF p_temp < 35.0 THEN s_temp := 2;
    ELSIF p_temp <= 36.0 THEN s_temp := 1;
    ELSIF p_temp <= 38.0 THEN s_temp := 0;
    ELSIF p_temp <= 39.0 THEN s_temp := 1;
    ELSE s_temp := 2;
    END IF;
  END IF;

  IF p_sbp IS NOT NULL THEN
    IF p_sbp <= 70 THEN s_sbp := 3;
    ELSIF p_sbp <= 80 THEN s_sbp := 2;
    ELSIF p_sbp <= 100 THEN s_sbp := 1;
    ELSIF p_sbp <= 199 THEN s_sbp := 0;
    ELSE s_sbp := 2;
    END IF;
  END IF;

  IF p_hr IS NOT NULL THEN
    IF p_hr <= 40 THEN s_hr := 3;
    ELSIF p_hr <= 50 THEN s_hr := 1;
    ELSIF p_hr <= 90 THEN s_hr := 0;
    ELSIF p_hr <= 110 THEN s_hr := 1;
    ELSIF p_hr <= 129 THEN s_hr := 2;
    ELSE s_hr := 3;
    END IF;
  END IF;

  IF p_avpu IS NOT NULL THEN
    CASE p_avpu
      WHEN 'A' THEN s_avpu := 0;
      WHEN 'V' THEN s_avpu := 1;
      WHEN 'P' THEN s_avpu := 2;
      WHEN 'U' THEN s_avpu := 3;
      ELSE s_avpu := 0;
    END CASE;
  END IF;

  total := s_rr + s_spo2 + s_temp + s_sbp + s_hr + s_avpu;

  IF total >= 5 THEN alert_level := 'red';
  ELSIF total >= 3 THEN alert_level := 'yellow';
  ELSE alert_level := 'normal';
  END IF;

  RETURN jsonb_build_object(
    'total', total,
    'alert_level', alert_level,
    'components', jsonb_build_object(
      'respiratory_rate', jsonb_build_object('value', p_rr, 'score', s_rr),
      'spo2',             jsonb_build_object('value', p_spo2, 'score', s_spo2),
      'temperature',      jsonb_build_object('value', p_temp, 'score', s_temp),
      'systolic_bp',      jsonb_build_object('value', p_sbp, 'score', s_sbp),
      'heart_rate',       jsonb_build_object('value', p_hr, 'score', s_hr),
      'avpu',             jsonb_build_object('value', p_avpu, 'score', s_avpu)
    )
  );
END;
$$;

-- 3. Trigger function
CREATE OR REPLACE FUNCTION trg_ipd_vitals_mews()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  result jsonb;
BEGIN
  result := calculate_mews(
    NEW.respiratory_rate,
    NEW.spo2,
    NEW.temperature_c,
    NEW.bp_systolic,
    NEW.heart_rate,
    NEW.avpu
  );
  NEW.mews_score       := (result->>'total')::integer;
  NEW.mews_alert_level := result->>'alert_level';
  NEW.mews_components  := result->'components';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mews_autoscore ON ipd_vitals;
CREATE TRIGGER trg_mews_autoscore
  BEFORE INSERT OR UPDATE ON ipd_vitals
  FOR EACH ROW EXECUTE FUNCTION trg_ipd_vitals_mews();

-- 4. Backfill existing rows (no updated_at column)
UPDATE ipd_vitals
SET mews_score = (calculate_mews(respiratory_rate, spo2, temperature_c, bp_systolic, heart_rate, avpu)->>'total')::integer,
    mews_alert_level = calculate_mews(respiratory_rate, spo2, temperature_c, bp_systolic, heart_rate, avpu)->>'alert_level',
    mews_components  = calculate_mews(respiratory_rate, spo2, temperature_c, bp_systolic, heart_rate, avpu)->'components';

-- 5. Ward-level MEWS summary RPC
CREATE OR REPLACE FUNCTION get_ward_mews_summary(p_hospital_id uuid)
RETURNS TABLE (
  admission_id uuid,
  patient_id uuid,
  bed_id uuid,
  ward_id uuid,
  latest_vitals_at timestamptz,
  mews_score integer,
  mews_alert_level text,
  mews_components jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT ON (v.admission_id)
    v.admission_id,
    v.patient_id,
    a.bed_id,
    a.ward_id,
    v.recorded_at AS latest_vitals_at,
    v.mews_score,
    v.mews_alert_level,
    v.mews_components
  FROM ipd_vitals v
  JOIN ipd_admissions a ON a.id = v.admission_id
  WHERE v.hospital_id = p_hospital_id
    AND a.status = 'admitted'
  ORDER BY v.admission_id, v.recorded_at DESC;
$$;

-- 6. Per-admission MEWS trend RPC
CREATE OR REPLACE FUNCTION get_mews_trend(p_admission_id uuid)
RETURNS TABLE (
  recorded_at timestamptz,
  mews_score integer,
  mews_alert_level text,
  mews_components jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT recorded_at, mews_score, mews_alert_level, mews_components
  FROM ipd_vitals
  WHERE admission_id = p_admission_id
    AND mews_score IS NOT NULL
  ORDER BY recorded_at ASC;
$$;

NOTIFY pgrst, 'reload schema';
