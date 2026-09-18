-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260416094233.

-- 1. Add columns to correct table
ALTER TABLE ipd_nursing_vitals
  ADD COLUMN IF NOT EXISTS avpu text CHECK (avpu IN ('A','V','P','U')),
  ADD COLUMN IF NOT EXISTS mews_score integer,
  ADD COLUMN IF NOT EXISTS mews_components jsonb,
  ADD COLUMN IF NOT EXISTS mews_alert_level text CHECK (mews_alert_level IN ('normal','yellow','red'));

-- 2. Helper to parse "120/80" → systolic integer
CREATE OR REPLACE FUNCTION parse_systolic(bp text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[];
BEGIN
  IF bp IS NULL OR bp = '' THEN RETURN NULL; END IF;
  parts := string_to_array(bp, '/');
  RETURN (parts[1])::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- 3. Trigger function on ipd_nursing_vitals
CREATE OR REPLACE FUNCTION trg_nursing_vitals_mews()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  result jsonb;
  sbp integer;
  s_rr integer := 0;
  s_spo2 integer := 0;
  s_temp integer := 0;
  s_sbp integer := 0;
  s_hr integer := 0;
  s_avpu integer := 0;
  total integer := 0;
  alert_level text;
BEGIN
  sbp := parse_systolic(NEW.blood_pressure);

  -- RR
  IF NEW.respiratory_rate IS NOT NULL THEN
    IF NEW.respiratory_rate < 5 THEN s_rr := 3;
    ELSIF NEW.respiratory_rate <= 8 THEN s_rr := 2;
    ELSIF NEW.respiratory_rate <= 11 THEN s_rr := 1;
    ELSIF NEW.respiratory_rate <= 20 THEN s_rr := 0;
    ELSIF NEW.respiratory_rate <= 24 THEN s_rr := 2;
    ELSE s_rr := 3;
    END IF;
  END IF;

  -- SpO2
  IF NEW.spo2 IS NOT NULL THEN
    IF NEW.spo2 <= 91 THEN s_spo2 := 3;
    ELSIF NEW.spo2 <= 93 THEN s_spo2 := 2;
    ELSIF NEW.spo2 <= 95 THEN s_spo2 := 1;
    ELSE s_spo2 := 0;
    END IF;
  END IF;

  -- Temperature
  IF NEW.temperature IS NOT NULL THEN
    IF NEW.temperature < 35.0 THEN s_temp := 2;
    ELSIF NEW.temperature <= 36.0 THEN s_temp := 1;
    ELSIF NEW.temperature <= 38.0 THEN s_temp := 0;
    ELSIF NEW.temperature <= 39.0 THEN s_temp := 1;
    ELSE s_temp := 2;
    END IF;
  END IF;

  -- Systolic BP (parsed from text)
  IF sbp IS NOT NULL THEN
    IF sbp <= 70 THEN s_sbp := 3;
    ELSIF sbp <= 80 THEN s_sbp := 2;
    ELSIF sbp <= 100 THEN s_sbp := 1;
    ELSIF sbp <= 199 THEN s_sbp := 0;
    ELSE s_sbp := 2;
    END IF;
  END IF;

  -- Heart Rate (pulse column)
  IF NEW.pulse IS NOT NULL THEN
    IF NEW.pulse <= 40 THEN s_hr := 3;
    ELSIF NEW.pulse <= 50 THEN s_hr := 1;
    ELSIF NEW.pulse <= 90 THEN s_hr := 0;
    ELSIF NEW.pulse <= 110 THEN s_hr := 1;
    ELSIF NEW.pulse <= 129 THEN s_hr := 2;
    ELSE s_hr := 3;
    END IF;
  END IF;

  -- AVPU
  IF NEW.avpu IS NOT NULL THEN
    CASE NEW.avpu
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

  NEW.mews_score       := total;
  NEW.mews_alert_level := alert_level;
  NEW.mews_components  := jsonb_build_object(
    'respiratory_rate', jsonb_build_object('value', NEW.respiratory_rate, 'score', s_rr),
    'spo2',             jsonb_build_object('value', NEW.spo2, 'score', s_spo2),
    'temperature',      jsonb_build_object('value', NEW.temperature, 'score', s_temp),
    'systolic_bp',      jsonb_build_object('value', sbp, 'score', s_sbp),
    'heart_rate',       jsonb_build_object('value', NEW.pulse, 'score', s_hr),
    'avpu',             jsonb_build_object('value', NEW.avpu, 'score', s_avpu)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mews_autoscore ON ipd_nursing_vitals;
CREATE TRIGGER trg_mews_autoscore
  BEFORE INSERT OR UPDATE ON ipd_nursing_vitals
  FOR EACH ROW EXECUTE FUNCTION trg_nursing_vitals_mews();

-- 4. Backfill existing rows
UPDATE ipd_nursing_vitals SET notes = notes;

-- 5. Ward MEWS summary RPC (updated for correct table + column names)
CREATE OR REPLACE FUNCTION get_ward_mews_summary(p_hospital_id uuid DEFAULT NULL)
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
    v.recorded_at,
    v.mews_score,
    v.mews_alert_level,
    v.mews_components
  FROM ipd_nursing_vitals v
  JOIN ipd_admissions a ON a.id = v.admission_id
  WHERE (p_hospital_id IS NULL OR v.hospital_id = p_hospital_id)
    AND a.status = 'admitted'
  ORDER BY v.admission_id, v.recorded_at DESC;
$$;

-- 6. Per-admission MEWS trend RPC
CREATE OR REPLACE FUNCTION get_mews_trend(p_admission_id uuid DEFAULT NULL)
RETURNS TABLE (
  recorded_at timestamptz,
  mews_score integer,
  mews_alert_level text,
  mews_components jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT recorded_at, mews_score, mews_alert_level, mews_components
  FROM ipd_nursing_vitals
  WHERE admission_id = p_admission_id
    AND mews_score IS NOT NULL
  ORDER BY recorded_at ASC;
$$;

NOTIFY pgrst, 'reload schema';
