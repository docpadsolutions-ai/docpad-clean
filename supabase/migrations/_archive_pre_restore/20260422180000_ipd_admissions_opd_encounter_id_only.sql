-- Prefer `opd_encounter_id` on `ipd_admissions`; drop legacy `source_opd_encounter_id` after backfill.
-- Safe when the table or columns are missing (fresh / partial environments).

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'ipd_admissions'
  ) then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ipd_admissions' and column_name = 'opd_encounter_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ipd_admissions' and column_name = 'source_opd_encounter_id'
  ) then
    execute $u$
      update public.ipd_admissions
      set opd_encounter_id = coalesce(opd_encounter_id, source_opd_encounter_id)
      where opd_encounter_id is null and source_opd_encounter_id is not null
    $u$;
    execute 'alter table public.ipd_admissions drop column source_opd_encounter_id';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ipd_admissions' and column_name = 'source_opd_encounter_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ipd_admissions' and column_name = 'opd_encounter_id'
  ) then
    execute 'alter table public.ipd_admissions rename column source_opd_encounter_id to opd_encounter_id';
  end if;
end $$;

-- public.admit_patient: PostgREST sends `p_opd_encounter_id` from the app (see app/lib/ipdData.ts).
-- If your database still defines `p_source_opd_encounter_id` only, replace the function in the SQL
-- editor with an updated signature using `p_opd_encounter_id` (same type/position), preserving the body.
