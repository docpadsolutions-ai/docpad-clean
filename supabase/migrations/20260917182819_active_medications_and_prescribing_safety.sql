-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917182819.

-- SOW 2.2: the patient's currently active medications, the interaction check run against that list
-- (not only against the drugs inside the current prescription), duplicate-therapy detection, and a
-- per-medication continue / stop / modify decision recorded against the encounter.

-- "3d", "5 days", "1 week", "2 weeks", "1 month", "10" -> days
create or replace function public._duration_to_days(p_duration text)
returns integer language sql immutable as $$
  select case
    when p_duration is null or btrim(p_duration) = '' then null
    when lower(p_duration) ~ '(continuous|ongoing|sos|prn|long term|lifelong)' then 3650
    else (
      coalesce((regexp_match(p_duration, '(\d+)'))[1]::int, 0) *
      case
        when lower(p_duration) ~ '(month|mon\M|mth)' then 30
        when lower(p_duration) ~ '(week|wk\M)' then 7
        else 1
      end
    )
  end
$$;

-- Per-medication decision at the point of prescribing.
create table if not exists public.medication_reconciliation (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id),
  encounter_id uuid not null references public.opd_encounters(id) on delete cascade,
  patient_id uuid not null references public.patients(id),
  source_prescription_id uuid references public.prescriptions(id) on delete set null,
  medicine_name text not null,
  generic_name text,
  action text not null check (action in ('continue', 'stop', 'modify')),
  note text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  unique (encounter_id, source_prescription_id, medicine_name)
);
create index if not exists idx_medication_reconciliation_encounter on public.medication_reconciliation (encounter_id);
create index if not exists idx_medication_reconciliation_patient on public.medication_reconciliation (patient_id, created_at desc);
create index if not exists idx_medication_reconciliation_hospital_id on public.medication_reconciliation (hospital_id);

alter table public.medication_reconciliation enable row level security;
drop policy if exists medrec_select on public.medication_reconciliation;
drop policy if exists medrec_write on public.medication_reconciliation;
create policy medrec_select on public.medication_reconciliation for select to authenticated
  using (hospital_id = (select auth_hospital_id()));
create policy medrec_write on public.medication_reconciliation for insert to authenticated
  with check (hospital_id = (select auth_hospital_id()));
revoke all on public.medication_reconciliation from anon;
grant select, insert on public.medication_reconciliation to authenticated;

drop trigger if exists zz_audit_row on public.medication_reconciliation;
create trigger zz_audit_row after insert or update or delete on public.medication_reconciliation
  for each row execute function public.trg_audit_row();

-- Active = prescribed on a finalised/ordered/dispensed line, still inside its duration window,
-- and not stopped by a later reconciliation decision.
create or replace function public.get_active_medications(p_patient_id uuid, p_exclude_encounter uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result json;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);
  perform public.log_phi_read('patient', p_patient_id);

  select json_agg(row_to_json(m) order by m.prescribed_at desc) into v_result
  from (
    select distinct on (lower(coalesce(p.active_ingredient_name, p.medicine_name)))
      p.id                                   as prescription_id,
      p.encounter_id,
      p.medicine_name,
      p.active_ingredient_name               as generic_name,
      coalesce(p.dosage_text, p.dosage)      as dose,
      p.frequency,
      p.duration,
      p.instructions,
      p.status,
      p.created_at                           as prescribed_at,
      (p.created_at::date + coalesce(_duration_to_days(p.duration), 30)) as expected_end,
      e.encounter_number,
      (select mr.action from medication_reconciliation mr
        where mr.source_prescription_id = p.id order by mr.created_at desc limit 1) as last_action
    from prescriptions p
    join opd_encounters e on e.id = p.encounter_id
    where p.patient_id = p_patient_id
      and (p_exclude_encounter is null or p.encounter_id <> p_exclude_encounter)
      and coalesce(p.status, 'ordered') in ('ordered', 'dispensed', 'finalized', 'active')
      and (p.created_at::date + coalesce(_duration_to_days(p.duration), 30)) >= current_date
      and not exists (
        select 1 from medication_reconciliation mr
        where mr.source_prescription_id = p.id and mr.action = 'stop'
          and mr.created_at > p.created_at)
    order by lower(coalesce(p.active_ingredient_name, p.medicine_name)), p.created_at desc
  ) m;

  return coalesce(v_result, '[]'::json);
end;
$$;
revoke all on function public.get_active_medications(uuid, uuid) from public, anon;
grant execute on function public.get_active_medications(uuid, uuid) to authenticated, service_role;

-- Safety check for the prescription being written: interactions across (new drugs + active list)
-- and duplicate therapy where a new drug repeats an active generic.
create or replace function public.check_prescription_safety(
  p_patient_id uuid,
  p_new_medicines jsonb,          -- [{"medicine_name": "...", "generic_name": "..."}]
  p_exclude_encounter uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active jsonb;
  v_new_generics text[];
  v_active_generics text[];
  v_interactions json;
  v_duplicates json;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  v_active := public.get_active_medications(p_patient_id, p_exclude_encounter)::jsonb;

  select array_agg(distinct lower(btrim(g))) into v_new_generics
  from jsonb_array_elements(coalesce(p_new_medicines, '[]'::jsonb)) x,
       lateral (select coalesce(nullif(x ->> 'generic_name', ''), x ->> 'medicine_name') as g) y
  where g is not null and btrim(g) <> '';

  select array_agg(distinct lower(btrim(g))) into v_active_generics
  from jsonb_array_elements(v_active) a,
       lateral (select coalesce(nullif(a ->> 'generic_name', ''), a ->> 'medicine_name') as g) y
  where g is not null and btrim(g) <> '';

  -- interactions over the union, annotated with where each side came from
  select json_agg(json_build_object(
           'drug_a', d.drug_a, 'drug_b', d.drug_b,
           'severity', d.severity, 'description', d.description, 'description_hi', d.description_hi,
           'clinical_effect', d.clinical_effect, 'management', d.management,
           'severity_rank', d.severity_rank,
           'involves_active', (
             exists (select 1 from unnest(coalesce(v_active_generics, '{}')) ag
                     where lower(d.drug_a) like '%' || ag || '%' or ag like '%' || lower(d.drug_a) || '%'
                        or lower(d.drug_b) like '%' || ag || '%' or ag like '%' || lower(d.drug_b) || '%'))
         ) order by d.severity_rank)
  into v_interactions
  from check_ddi_by_names(
        (select array_agg(distinct g) from unnest(coalesce(v_new_generics, '{}') || coalesce(v_active_generics, '{}')) g)
       ) d;

  -- duplicate therapy: a new medicine whose generic is already active
  select json_agg(json_build_object(
           'medicine_name', x ->> 'medicine_name',
           'generic_name', x ->> 'generic_name',
           'active_medicine_name', a ->> 'medicine_name',
           'active_prescription_id', a ->> 'prescription_id',
           'active_since', a ->> 'prescribed_at'))
  into v_duplicates
  from jsonb_array_elements(coalesce(p_new_medicines, '[]'::jsonb)) x
  join jsonb_array_elements(v_active) a
    on lower(btrim(coalesce(nullif(x ->> 'generic_name', ''), x ->> 'medicine_name')))
     = lower(btrim(coalesce(nullif(a ->> 'generic_name', ''), a ->> 'medicine_name')));

  return json_build_object(
    'active_medications', v_active,
    'interactions', coalesce(v_interactions, '[]'::json),
    'duplicates', coalesce(v_duplicates, '[]'::json));
end;
$$;
revoke all on function public.check_prescription_safety(uuid, jsonb, uuid) from public, anon;
grant execute on function public.check_prescription_safety(uuid, jsonb, uuid) to authenticated, service_role;

-- Record the continue / stop / modify decisions taken in the prescription writer.
create or replace function public.record_medication_reconciliation(p_encounter_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_count integer := 0;
begin
  perform public._assert_hospital_scope('encounter', p_encounter_id);

  select e.id, e.hospital_id, e.patient_id into v_enc
  from opd_encounters e where e.id = p_encounter_id;
  if not found then
    raise exception 'Encounter not found' using errcode = 'P0002';
  end if;

  insert into medication_reconciliation (
    hospital_id, encounter_id, patient_id, source_prescription_id,
    medicine_name, generic_name, action, note, recorded_by)
  select v_enc.hospital_id, v_enc.id, v_enc.patient_id,
         nullif(i ->> 'prescription_id', '')::uuid,
         i ->> 'medicine_name',
         nullif(i ->> 'generic_name', ''),
         i ->> 'action',
         nullif(i ->> 'note', ''),
         (select p.id from practitioners p where p.user_id = auth.uid() or p.id = auth.uid() limit 1)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where i ->> 'action' in ('continue', 'stop', 'modify')
    and coalesce(i ->> 'medicine_name', '') <> ''
  on conflict (encounter_id, source_prescription_id, medicine_name) do update
     set action = excluded.action, note = excluded.note, created_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.record_medication_reconciliation(uuid, jsonb) from public, anon;
grant execute on function public.record_medication_reconciliation(uuid, jsonb) to authenticated, service_role;
