-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260803212515.

-- Fix all 18 Security Definer Views by recreating with security_invoker = true
-- This ensures RLS policies of the querying user are respected

CREATE OR REPLACE VIEW public.patient_latest_vitals WITH (security_invoker = true) AS
  SELECT * FROM public.patient_latest_vitals;

-- Can't use SELECT * FROM self for views. Need to drop and recreate.
-- Instead, alter the view's security property directly:

ALTER VIEW public.patient_latest_vitals SET (security_invoker = on);
ALTER VIEW public.pharmacy_low_stock_items SET (security_invoker = on);
ALTER VIEW public.pharmacy_dispensed_prescriptions SET (security_invoker = on);
ALTER VIEW public.pharmacy_expiring_stock SET (security_invoker = on);
ALTER VIEW public.lab_tech_queue SET (security_invoker = on);
ALTER VIEW public.reception_billing_queue SET (security_invoker = on);
ALTER VIEW public.doctor_waiting_room SET (security_invoker = on);
ALTER VIEW public.ipd_treatments_summary SET (security_invoker = on);
ALTER VIEW public.reception_today_queue SET (security_invoker = on);
ALTER VIEW public.consent_library SET (security_invoker = on);
ALTER VIEW public.ipd_discharge_autocompile SET (security_invoker = on);
ALTER VIEW public.payment_receipts SET (security_invoker = on);
ALTER VIEW public.insurance_corporate_panels SET (security_invoker = on);
ALTER VIEW public.ipd_doctor_admissions_summary SET (security_invoker = on);
ALTER VIEW public.similar_name_pairs SET (security_invoker = on);
ALTER VIEW public.pharmacy_ordered_prescription_queue SET (security_invoker = on);
ALTER VIEW public.insurance_preauths_view SET (security_invoker = on);
ALTER VIEW public.insurance_claims_view SET (security_invoker = on);
