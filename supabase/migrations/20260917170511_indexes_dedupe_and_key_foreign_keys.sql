-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917170511.

-- Duplicate indexes
drop index if exists public.idx_doctor_frequency;
drop index if exists public.invoice_line_items_invoice_idx;
do $$
begin
  -- keep whichever of the two identical unique indexes backs a constraint
  if exists (select 1 from pg_constraint where conindid = 'public.uq_ipd_admissions_number'::regclass) then
    execute 'drop index if exists public.idx_ipd_admissions_number';
  elsif not exists (select 1 from pg_constraint where conindid = 'public.idx_ipd_admissions_number'::regclass) then
    execute 'drop index if exists public.idx_ipd_admissions_number';
  else
    execute 'drop index if exists public.uq_ipd_admissions_number';
  end if;
end
$$;

-- Covering indexes for unindexed single-column foreign keys on the columns used by joins and RLS
-- (hospital / patient / encounter / admission / billing links).
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, cls.relname, a.attname as col
    from pg_constraint c
    join pg_class cls on cls.oid = c.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and n.nspname = 'public'
      and array_length(c.conkey, 1) = 1
      and a.attname in ('hospital_id','patient_id','encounter_id','admission_id','opd_encounter_id',
                        'doctor_id','practitioner_id','invoice_id','account_id','ward_id','bed_id',
                        'billing_account_id','ipd_admission_id','investigation_id','prescription_id',
                        'order_id','claim_id','preauth_id','coverage_id','department_id')
      and not exists (
        select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s (%I)',
                   left('idx_' || r.relname || '_' || r.col, 63), r.tbl, r.col);
  end loop;
end
$$;
