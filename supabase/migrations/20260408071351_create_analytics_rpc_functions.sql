-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408071351.

-- 1. Revenue by Department
CREATE OR REPLACE FUNCTION get_revenue_by_department(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  department_id uuid,
  department_name text,
  total_revenue numeric,
  patient_count bigint,
  avg_revenue_per_patient numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.name,
    COALESCE(SUM(i.total_gross - i.total_discount), 0) as total_revenue,
    COUNT(DISTINCT i.patient_id) as patient_count,
    CASE 
      WHEN COUNT(DISTINCT i.patient_id) > 0 
      THEN (SUM(i.total_gross - i.total_discount) / COUNT(DISTINCT i.patient_id))
      ELSE 0 
    END as avg_revenue_per_patient
  FROM departments d
  LEFT JOIN invoices i ON i.department_id = d.id 
    AND i.invoice_date::date BETWEEN p_start_date AND p_end_date
  WHERE d.hospital_id = p_hospital_id AND d.is_active = true
  GROUP BY d.id, d.name
  ORDER BY total_revenue DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Revenue by Service Category
CREATE OR REPLACE FUNCTION get_revenue_by_category(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  category text,
  total_billed numeric,
  total_collected numeric,
  collection_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ci.category,
    COALESCE(SUM(ci.net_amount), 0) as total_billed,
    COALESCE(SUM(
      CASE WHEN i.status IN ('issued', 'balanced') 
      THEN i.amount_paid 
      ELSE 0 END
    ), 0) as total_collected,
    CASE 
      WHEN SUM(ci.net_amount) > 0 
      THEN (SUM(i.amount_paid)::numeric / SUM(ci.net_amount)::numeric * 100)
      ELSE 0 
    END as collection_rate
  FROM charge_items ci
  LEFT JOIN invoice_line_items ili ON ili.charge_item_id = ci.id
  LEFT JOIN invoices i ON i.id = ili.invoice_id
  WHERE ci.hospital_id = p_hospital_id
    AND ci.created_at::date BETWEEN p_start_date AND p_end_date
  GROUP BY ci.category
  ORDER BY total_billed DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Provider Revenue Contribution
CREATE OR REPLACE FUNCTION get_provider_revenue(
  p_hospital_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(
  provider_id uuid,
  provider_name text,
  patient_count bigint,
  total_revenue numeric,
  avg_per_patient numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.full_name,
    COUNT(DISTINCT e.patient_id),
    COALESCE(SUM(i.total_gross - i.total_discount), 0),
    CASE 
      WHEN COUNT(DISTINCT e.patient_id) > 0 
      THEN SUM(i.total_gross - i.total_discount) / COUNT(DISTINCT e.patient_id)
      ELSE 0 
    END
  FROM practitioners p
  LEFT JOIN opd_encounters e ON e.doctor_id = p.id
  LEFT JOIN invoices i ON i.encounter_id = e.id
  WHERE p.hospital_id = p_hospital_id
    AND (p_department_id IS NULL OR p.primary_department_id = p_department_id)
    AND (p_start_date IS NULL OR e.encounter_date >= p_start_date)
    AND (p_end_date IS NULL OR e.encounter_date <= p_end_date)
  GROUP BY p.id, p.full_name
  ORDER BY total_revenue DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Collection Efficiency
CREATE OR REPLACE FUNCTION get_collection_efficiency(
  p_hospital_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  payment_method text,
  transaction_count bigint,
  total_collected numeric,
  avg_transaction numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pm.payment_method,
    COUNT(*),
    SUM(pm.amount),
    AVG(pm.amount)
  FROM payments pm
  WHERE pm.hospital_id = p_hospital_id
    AND pm.payment_date::date BETWEEN p_start_date AND p_end_date
    AND pm.status = 'confirmed'
  GROUP BY pm.payment_method
  ORDER BY total_collected DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
