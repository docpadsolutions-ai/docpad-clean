-- IPD nursing shift handover notes (SBAR) + RPCs.

create table if not exists public.ipd_shift_handovers (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.ipd_admissions (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  shift_date date not null,
  shift_type text not null,
  handover_by uuid references public.practitioners (id) on delete set null,
  handover_to uuid references public.practitioners (id) on delete set null,
  handover_time timestamptz not null default timezone('utc', now()),
  received_time timestamptz,
  situation text,
  background text,
  assessment text,
  recommendation text,
  current_vitals_json jsonb not null default '{}'::jsonb,
  pending_tasks jsonb not null default '[]'::jsonb,
  pending_investigations jsonb not null default '[]'::jsonb,
  iv_access text,
  drain_status text,
  pain_score numeric,
  mobility_status text,
  special_concerns text,
  is_signed_by_receiver boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ipd_shift_handovers_shift_type_chk check (
    lower(trim(shift_type)) in ('morning', 'afternoon', 'night')
  )
);

create unique index if not exists ipd_shift_handovers_adm_date_shift_uidx
  on public.ipd_shift_handovers (admission_id, shift_date, shift_type);

create index if not exists ipd_shift_handovers_admission_idx
  on public.ipd_shift_handovers (admission_id, shift_date desc);

comment on table public.ipd_shift_handovers is
  'SBAR shift handover between IPD nurses; one row per admission per calendar shift.';

-- ---------------------------------------------------------------------------
-- get_latest_handover(p_admission_id, p_shift_date?, p_shift_type?)
-- When shift_date + shift_type are set, returns that slot; when both null, latest by handover_time.
-- ---------------------------------------------------------------------------
create or replace function public.get_latest_handover(
  p_admission_id uuid,
  p_shift_date date default null,
  p_shift_type text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(h)
  from public.ipd_shift_handovers h
  where h.admission_id = p_admission_id
    and (
      (p_shift_date is null and p_shift_type is null)
      or (
        p_shift_date is not null
        and p_shift_type is not null
        and h.shift_date = p_shift_date
        and lower(trim(h.shift_type)) = lower(trim(p_shift_type))
      )
    )
  order by h.handover_time desc nulls last
  limit 1;
$$;

grant execute on function public.get_latest_handover(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sign_handover_received(p_handover_id) — incoming nurse acknowledges
-- ---------------------------------------------------------------------------
create or replace function public.sign_handover_received(p_handover_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner uuid := public._nursing_tasks_current_practitioner_id();
  v_row public.ipd_shift_handovers%rowtype;
begin
  if v_practitioner is null then
    raise exception 'Not authenticated as practitioner';
  end if;

  select * into v_row
  from public.ipd_shift_handovers h
  where h.id = p_handover_id;

  if not found then
    raise exception 'Handover not found';
  end if;

  if v_row.is_signed_by_receiver then
    raise exception 'Already acknowledged';
  end if;

  if v_row.handover_by is not null and v_row.handover_by = v_practitioner then
    raise exception 'Outgoing nurse cannot acknowledge their own handover';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.id = v_practitioner
      and pr.hospital_id = v_row.hospital_id
  ) then
    raise exception 'Not allowed';
  end if;

  update public.ipd_shift_handovers h
  set
    is_signed_by_receiver = true,
    received_time = timezone('utc', now()),
    handover_to = v_practitioner,
    updated_at = timezone('utc', now())
  where h.id = p_handover_id
    and h.is_signed_by_receiver = false;

  if not found then
    raise exception 'Could not update handover';
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.sign_handover_received(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ipd_shift_handovers enable row level security;

drop policy if exists ipd_shift_handovers_select_staff on public.ipd_shift_handovers;
create policy ipd_shift_handovers_select_staff
  on public.ipd_shift_handovers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ipd_admissions a
      inner join public.practitioners pr
        on pr.hospital_id = a.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where a.id = ipd_shift_handovers.admission_id
    )
  );

drop policy if exists ipd_shift_handovers_insert_staff on public.ipd_shift_handovers;
create policy ipd_shift_handovers_insert_staff
  on public.ipd_shift_handovers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ipd_admissions a
      inner join public.practitioners pr
        on pr.hospital_id = a.hospital_id
        and pr.hospital_id = ipd_shift_handovers.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where a.id = ipd_shift_handovers.admission_id
    )
  );

drop policy if exists ipd_shift_handovers_update_staff on public.ipd_shift_handovers;
create policy ipd_shift_handovers_update_staff
  on public.ipd_shift_handovers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.ipd_admissions a
      inner join public.practitioners pr
        on pr.hospital_id = a.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where a.id = ipd_shift_handovers.admission_id
    )
  )
  with check (
    exists (
      select 1
      from public.ipd_admissions a
      inner join public.practitioners pr
        on pr.hospital_id = a.hospital_id
        and (pr.user_id = (select auth.uid()) or pr.id = (select auth.uid()))
      where a.id = ipd_shift_handovers.admission_id
    )
  );

grant select, insert, update on public.ipd_shift_handovers to authenticated, service_role;
