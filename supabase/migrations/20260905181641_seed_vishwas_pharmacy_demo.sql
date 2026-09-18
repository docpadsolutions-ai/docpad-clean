-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260905181641.

-- Vishwas must exist in organizations (parallel tenant table used by
-- hospital_inventory, audit_logs, patient_billing_accounts).
insert into public.organizations (id, name)
values ('a99b9b99-8f7c-4d09-819b-5ce1a5b653ab','Vishwas Clinic')
on conflict (id) do nothing;

create temp table _drug_map on commit drop as
select id as old_id, gen_random_uuid() as new_id
from public.drugs
where hospital_id = 'e90e4607-dd60-4821-b736-02a2577432e0';

insert into public.drugs (
  id, hospital_id, generic_name, brand_name, category, dosage_form, strength,
  manufacturer, hsn_code, purchase_price, mrp, markup_percent, min_stock_level,
  is_active, snomed_sctid, snomed_term, drug_class
)
select m.new_id, 'a99b9b99-8f7c-4d09-819b-5ce1a5b653ab',
       d.generic_name, d.brand_name, d.category, d.dosage_form, d.strength,
       d.manufacturer, d.hsn_code, d.purchase_price, d.mrp, d.markup_percent,
       d.min_stock_level, d.is_active, d.snomed_sctid, d.snomed_term, d.drug_class
from public.drugs d
join _drug_map m on m.old_id = d.id;

insert into public.hospital_inventory (
  hospital_id, brand_name, generic_name, dosage_form_code, dosage_form_name, strength,
  is_high_risk, is_lasa, storage_instructions, batch_number, expiry_date,
  stock_quantity, reorder_level, snomed_ct_code, abdm_registry_id, batches,
  manufacturer, dosage_form, unit_of_measure, storage_conditions, is_active, drug_id
)
select 'a99b9b99-8f7c-4d09-819b-5ce1a5b653ab',
       hi.brand_name, hi.generic_name, hi.dosage_form_code, hi.dosage_form_name, hi.strength,
       hi.is_high_risk, hi.is_lasa, hi.storage_instructions, hi.batch_number, hi.expiry_date,
       hi.stock_quantity, hi.reorder_level, hi.snomed_ct_code, hi.abdm_registry_id, hi.batches,
       hi.manufacturer, hi.dosage_form, hi.unit_of_measure, hi.storage_conditions,
       hi.is_active, m.new_id
from public.hospital_inventory hi
left join _drug_map m on m.old_id = hi.drug_id
where hi.hospital_id = 'e90e4607-dd60-4821-b736-02a2577432e0';

update public.hospitals
set enabled_modules = enabled_modules || jsonb_build_object('pharmacy', true),
    updated_at = now()
where id = 'a99b9b99-8f7c-4d09-819b-5ce1a5b653ab';

NOTIFY pgrst, 'reload schema';
