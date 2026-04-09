-- Same catalog as 20260412150000_seed_charge_item_definitions.sql, but for every organization.
-- The prior seed only targeted the first org by created_at; practitioners/patients often use a different org row → empty charge list.

insert into public.charge_item_definitions (
  hospital_id,
  code,
  code_system,
  display_name,
  category,
  base_price,
  currency,
  tax_type,
  tax_rate,
  applicability_rules,
  eligible_for_packages,
  status,
  effective_from
)
select
  o.id,
  v.code,
  'http://snomed.info/sct',
  v.display_name,
  v.category,
  v.base_price,
  'INR',
  'gst_exempt',
  0,
  '{}'::jsonb,
  false,
  'active',
  current_date
from public.organizations o
cross join (
  values
    ('CHG-CONS-001', 'OPD Consultation (General)', 'consultation'::text, 500::numeric),
    ('CHG-CONS-002', 'OPD Consultation (Specialist)', 'consultation', 1000),
    ('CHG-CONS-003', 'Follow-up Visit', 'consultation', 300),
    ('CHG-XRAY-001', 'X-Ray (Single View)', 'imaging', 600),
    ('CHG-XRAY-002', 'X-Ray (Two Views)', 'imaging', 900),
    ('CHG-ECG-001', 'ECG', 'procedure', 400),
    ('CHG-PROC-001', 'Dressing (Minor)', 'procedure', 200),
    ('CHG-PROC-002', 'Suturing', 'procedure', 800),
    ('CHG-LAB-001', 'CBC', 'lab_test', 300),
    ('CHG-LAB-002', 'Blood Sugar (Random)', 'lab_test', 100),
    ('CHG-LAB-003', 'Urine Routine', 'lab_test', 150),
    ('CHG-ROOM-001', 'General Ward (per day)', 'room_charge', 1500),
    ('CHG-ROOM-002', 'Private Room (per day)', 'room_charge', 3000)
) as v(code, display_name, category, base_price)
on conflict (hospital_id, code, code_system) do nothing;
