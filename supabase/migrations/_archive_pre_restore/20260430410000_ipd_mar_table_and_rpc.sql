-- MAR (Medication Administration Record) rows + slot generation + dose marking.

create table if not exists public.ipd_mar (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.organizations (id) on delete cascade,
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete set null,
  treatment_id uuid references public.ipd_treatments (id) on delete set null,
  drug_name text not null,
  dose text,
  route text,
  frequency text,
  scheduled_date date not null,
  scheduled_time text not null,
  status text not null default 'pending',
  administered_at timestamptz,
  administered_by uuid references public.practitioners (id) on delete set null,
  hold_reason text,
  iv_site text,
  adverse_event boolean not null default false,
  notes text,
  actual_dose_given text,
  actual_route text,
  verified_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ipd_mar_status_check check (
    status in ('pending', 'given', 'held', 'refused', 'omitted')
  )
);

create unique index if not exists ipd_mar_treatment_slot_uniq
  on public.ipd_mar (treatment_id, scheduled_date, scheduled_time)
  where treatment_id is not null;

create index if not exists ipd_mar_admission_date_idx
  on public.ipd_mar (admission_id, scheduled_date);

comment on table public.ipd_mar is
  'IPD medication administration record — scheduled doses per treatment/day/time.';

alter table public.ipd_mar enable row level security;

drop policy if exists ipd_mar_select_hospital on public.ipd_mar;
create policy ipd_mar_select_hospital
  on public.ipd_mar for select to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_mar.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists ipd_mar_insert_hospital on public.ipd_mar;
create policy ipd_mar_insert_hospital
  on public.ipd_mar for insert to authenticated
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_mar.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

drop policy if exists ipd_mar_update_hospital on public.ipd_mar;
create policy ipd_mar_update_hospital
  on public.ipd_mar for update to authenticated
  using (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_mar.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.practitioners pr
      where pr.hospital_id = ipd_mar.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.ipd_mar to authenticated, service_role;

-- Map frequency text → standard MAR clock times (must match app grid).
create or replace function public._mar_frequency_slots(p_frequency text)
returns text[]
language plpgsql
immutable
set search_path = public
as $f$
declare
  t text := lower(trim(coalesce(p_frequency, '')));
begin
  if t = '' then
    return array['08:00']::text[];
  end if;
  if t ~ 'tid' then
    return array['08:00', '14:00', '20:00']::text[];
  end if;
  if t ~ 'qid' then
    return array['06:00', '12:00', '18:00', '22:00']::text[];
  end if;
  if t ~ 'q6h' or t ~ '6\s*hour' then
    return array['00:00', '06:00', '12:00', '18:00']::text[];
  end if;
  if t ~ 'bd' or t ~ 'b\.?\s*i\.?\s*d' then
    return array['08:00', '20:00']::text[];
  end if;
  if t ~ '^od$' or t ~ 'once' or t ~ 'q\.?\s*d' or t ~ 'daily' then
    return array['08:00']::text[];
  end if;
  if t ~ 'sos' then
    return array['08:00']::text[];
  end if;
  return array['08:00', '20:00']::text[];
end;
$f$;

create or replace function public.generate_mar_slots(p_treatment_id uuid, p_for_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hospital_id uuid;
  v_admission_id uuid;
  v_patient_id uuid;
  v_name text;
  v_dose text;
  v_route text;
  v_frequency text;
  v_status text;
  v_ins int;
begin
  if p_treatment_id is null or p_for_date is null then
    raise exception 'p_treatment_id and p_for_date required';
  end if;

  select
    t.hospital_id,
    t.admission_id,
    t.patient_id,
    t.name,
    t.dose,
    t.route,
    t.frequency,
    t.status
  into
    v_hospital_id,
    v_admission_id,
    v_patient_id,
    v_name,
    v_dose,
    v_route,
    v_frequency,
    v_status
  from public.ipd_treatments t
  where t.id = p_treatment_id;

  if v_hospital_id is null then
    raise exception 'treatment not found';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = v_hospital_id
      and (pr.user_id = auth.uid() or pr.id = auth.uid())
  ) then
    raise exception 'not authorized for this hospital';
  end if;

  if v_status is null or v_status not in ('active', 'ordered', 'planned') then
    return 0;
  end if;

  insert into public.ipd_mar (
    hospital_id,
    admission_id,
    patient_id,
    treatment_id,
    drug_name,
    dose,
    route,
    frequency,
    scheduled_date,
    scheduled_time,
    status
  )
  select
    v_hospital_id,
    v_admission_id,
    v_patient_id,
    p_treatment_id,
    coalesce(nullif(trim(v_name), ''), 'Medication'),
    v_dose,
    v_route,
    v_frequency,
    p_for_date,
    u.slot,
    'pending'
  from unnest(public._mar_frequency_slots(v_frequency)) as u(slot)
  where not exists (
    select 1
    from public.ipd_mar m
    where m.treatment_id = p_treatment_id
      and m.scheduled_date = p_for_date
      and m.scheduled_time = u.slot
  );

  get diagnostics v_ins = row_count;
  return coalesce(v_ins, 0);
end;
$fn$;

grant execute on function public.generate_mar_slots(uuid, date) to authenticated, service_role;

create or replace function public.mark_mar_dose(
  p_mar_id uuid,
  p_status text,
  p_actual_dose text default null,
  p_actual_route text default null,
  p_hold_reason text default null,
  p_iv_site text default null,
  p_notes text default null,
  p_adverse_event boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hosp uuid;
  v_nurse uuid;
  st text;
begin
  if p_mar_id is null then
    raise exception 'p_mar_id required';
  end if;

  st := lower(trim(coalesce(p_status, '')));
  if st not in ('given', 'held', 'refused', 'omitted') then
    raise exception 'invalid status';
  end if;

  select ia.hospital_id into v_hosp
  from public.ipd_mar m
  inner join public.ipd_admissions ia on ia.id = m.admission_id
  where m.id = p_mar_id;

  if v_hosp is null then
    raise exception 'MAR row not found';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = v_hosp
      and (pr.user_id = auth.uid() or pr.id = auth.uid())
  ) then
    raise exception 'not authorized';
  end if;

  select id into v_nurse from public.practitioners where user_id = auth.uid() limit 1;
  if v_nurse is null then
    select id into v_nurse from public.practitioners where id = auth.uid() limit 1;
  end if;

  update public.ipd_mar
  set
    status = st,
    actual_dose_given = p_actual_dose,
    actual_route = p_actual_route,
    hold_reason = case when st in ('held', 'refused') then p_hold_reason else null end,
    iv_site = p_iv_site,
    notes = coalesce(p_notes, notes),
    adverse_event = coalesce(p_adverse_event, adverse_event),
    administered_at = case when st = 'given' then timezone('utc', now()) else null end,
    administered_by = case when st = 'given' then v_nurse else null end,
    updated_at = timezone('utc', now())
  where id = p_mar_id;
end;
$fn$;

grant execute on function public.mark_mar_dose(uuid, text, text, text, text, text, text, boolean) to authenticated, service_role;
