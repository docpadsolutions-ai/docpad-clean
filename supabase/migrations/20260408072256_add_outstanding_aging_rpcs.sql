-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408072256.

-- Outstanding by department with aging
CREATE OR REPLACE FUNCTION get_outstanding_by_department(
  p_hospital_id uuid
)
RETURNS TABLE(
  department_id uuid,
  department_name text,
  outstanding_0_30 numeric,
  outstanding_31_60 numeric,
  outstanding_61_90 numeric,
  outstanding_90_plus numeric,
  total_outstanding numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.name,
    COALESCE(SUM(CASE 
      WHEN CURRENT_DATE - i.invoice_date::date <= 30 
      THEN i.balance_due 
      ELSE 0 
    END), 0) as outstanding_0_30,
    COALESCE(SUM(CASE 
      WHEN CURRENT_DATE - i.invoice_date::date BETWEEN 31 AND 60 
      THEN i.balance_due 
      ELSE 0 
    END), 0) as outstanding_31_60,
    COALESCE(SUM(CASE 
      WHEN CURRENT_DATE - i.invoice_date::date BETWEEN 61 AND 90 
      THEN i.balance_due 
      ELSE 0 
    END), 0) as outstanding_61_90,
    COALESCE(SUM(CASE 
      WHEN CURRENT_DATE - i.invoice_date::date > 90 
      THEN i.balance_due 
      ELSE 0 
    END), 0) as outstanding_90_plus,
    COALESCE(SUM(i.balance_due), 0) as total_outstanding
  FROM departments d
  LEFT JOIN invoices i ON i.department_id = d.id 
    AND i.status IN ('issued', 'draft')
    AND i.balance_due > 0
  WHERE d.hospital_id = p_hospital_id AND d.is_active = true
  GROUP BY d.id, d.name
  ORDER BY total_outstanding DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Top defaulters
CREATE OR REPLACE FUNCTION get_top_defaulters(
  p_hospital_id uuid,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  patient_id uuid,
  patient_name text,
  total_outstanding numeric,
  oldest_invoice_date date,
  invoice_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.full_name,
    COALESCE(SUM(i.balance_due), 0) as total_outstanding,
    MIN(i.invoice_date::date) as oldest_invoice_date,
    COUNT(i.id) as invoice_count
  FROM patients p
  INNER JOIN invoices i ON i.patient_id = p.id
  WHERE i.hospital_id = p_hospital_id
    AND i.status IN ('issued', 'draft')
    AND i.balance_due > 0
  GROUP BY p.id, p.full_name
  ORDER BY total_outstanding DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
