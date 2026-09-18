-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417174220.

-- Add missing columns to nursing_procedure_logs
ALTER TABLE nursing_procedure_logs
  ADD COLUMN IF NOT EXISTS charge_item_def_id uuid,
  ADD COLUMN IF NOT EXISTS performed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_billed boolean DEFAULT false;

-- Rewrite RPC to be safe against missing data
CREATE OR REPLACE FUNCTION public.get_unbilled_nursing_charges(p_admission_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(source text, source_id uuid, description text, quantity numeric, unit text, unit_price numeric, total numeric, used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT 
    'consumable'::text, cul.id, wi.item_name,
    cul.quantity_used, COALESCE(cul.unit_of_measure, 'unit'),
    COALESCE(wi.unit_cost, 0), (COALESCE(wi.unit_cost, 0) * cul.quantity_used),
    cul.used_at
  FROM consumable_usage_logs cul
  JOIN ward_inventory wi ON wi.id = cul.ward_inventory_id
  WHERE cul.admission_id = p_admission_id AND cul.is_billed = false

  UNION ALL

  SELECT 
    'procedure'::text, npl.id, npl.procedure_name,
    1, 'procedure',
    COALESCE(cid.base_price, 0), COALESCE(cid.base_price, 0),
    COALESCE(npl.performed_at, npl.created_at)
  FROM nursing_procedure_logs npl
  LEFT JOIN charge_item_definitions cid ON cid.id = npl.charge_item_def_id
  WHERE npl.admission_id = p_admission_id AND npl.is_billed = false

  ORDER BY used_at;
$$;

NOTIFY pgrst, 'reload schema';
