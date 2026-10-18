-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260919175302.

-- Hospital onboarding pipeline: platform-admin provisioning, first-admin invite,
-- and a hard go-live gate. Replaces hand-written INSERTs into public.hospitals.

-- 1. Who is allowed to provision a hospital -------------------------------------
alter table public.practitioners
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.practitioners.is_platform_admin is
  'Platform operator (DocPad side), not hospital staff. Grants hospital provisioning rights.';

-- 2. Onboarding state on the hospital record ------------------------------------
alter table public.hospitals
  add column if not exists onboarding_status text not null default 'live',
  add column if not exists created_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hospitals_onboarding_status_check'
  ) then
    alter table public.hospitals
      add constraint hospitals_onboarding_status_check
      check (onboarding_status in ('provisioning', 'pending_admin', 'configuring', 'live', 'suspended'));
  end if;
end $$;

comment on column public.hospitals.onboarding_status is
  'provisioning -> pending_admin -> configuring -> live. Set live only via set_hospital_live().';

-- 3. Platform-admin predicate ----------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_platform_admin
       from public.practitioners p
      where (p.user_id = auth.uid() or p.id = auth.uid())
        and coalesce(p.is_active, true)
      limit 1),
    false);
$$;

grant execute on function public.is_platform_admin() to authenticated;

-- 4. Provision a hospital --------------------------------------------------------
create or replace function public.provision_hospital(
  p_name text,
  p_cr_number_prefix text,
  p_city text default null,
  p_state text default null,
  p_phone text default null,
  p_email text default null,
  p_registration_no text default null,
  p_grievance_officer_name text default null,
  p_grievance_officer_email text default null,
  p_grievance_officer_phone text default null,
  p_privacy_notice_url text default null,
  p_enabled_modules jsonb default '{"opd": true, "ipd": true, "lab": true, "billing": true, "pharmacy": true}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised to provision hospitals' using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Hospital name is required';
  end if;
  if coalesce(btrim(p_cr_number_prefix), '') = '' then
    raise exception 'Case-record number prefix is required';
  end if;

  insert into public.hospitals (
    name, cr_number_prefix, city, state, phone, email, registration_no,
    grievance_officer_name, grievance_officer_email, grievance_officer_phone,
    privacy_notice_url, enabled_modules, onboarding_status, created_by
  ) values (
    btrim(p_name), btrim(p_cr_number_prefix), p_city, p_state, p_phone, p_email, p_registration_no,
    p_grievance_officer_name, p_grievance_officer_email, p_grievance_officer_phone,
    p_privacy_notice_url, coalesce(p_enabled_modules, '{}'::jsonb), 'pending_admin', auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.provision_hospital(
  text, text, text, text, text, text, text, text, text, text, text, jsonb
) to authenticated;

-- 5. Invite the hospital's first admin -------------------------------------------
-- Deliberately does NOT go through requireStaff(): at a brand-new hospital nobody
-- is staff yet, so the platform-admin check is the gate instead.
create or replace function public.invite_first_admin(
  p_hospital_id uuid,
  p_email text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised to invite a hospital administrator' using errcode = '42501';
  end if;

  if not exists (select 1 from public.hospitals h where h.id = p_hospital_id) then
    raise exception 'Hospital not found';
  end if;

  if coalesce(btrim(p_email), '') = '' then
    raise exception 'Email is required';
  end if;

  insert into public.invitations (email, role, designation, hospital_id)
  values (btrim(p_email), 'admin', null, p_hospital_id)
  returning token into v_token;

  update public.hospitals
     set onboarding_status = 'configuring'
   where id = p_hospital_id
     and onboarding_status = 'pending_admin';

  return v_token;
end;
$$;

grant execute on function public.invite_first_admin(uuid, text) to authenticated;

-- 6. Go-live: the hard gate -------------------------------------------------------
create or replace function public.set_hospital_live(p_hospital_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hospitals%rowtype;
  v_staff int;
  v_missing text[] := '{}';
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised to change hospital status' using errcode = '42501';
  end if;

  select * into h from public.hospitals where id = p_hospital_id;
  if not found then
    raise exception 'Hospital not found';
  end if;

  if coalesce(btrim(h.grievance_officer_name), '') = '' then
    v_missing := v_missing || 'grievance officer name';
  end if;
  if coalesce(btrim(h.grievance_officer_email), '') = '' then
    v_missing := v_missing || 'grievance officer email';
  end if;
  if coalesce(btrim(h.privacy_notice_url), '') = '' then
    v_missing := v_missing || 'privacy notice URL';
  end if;

  select count(*) into v_staff
    from public.practitioners p
   where p.hospital_id = p_hospital_id
     and coalesce(p.is_active, true);

  if v_staff = 0 then
    v_missing := v_missing || 'at least one active staff member';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot go live. Still missing: %', array_to_string(v_missing, ', ');
  end if;

  update public.hospitals set onboarding_status = 'live' where id = p_hospital_id;
end;
$$;

grant execute on function public.set_hospital_live(uuid) to authenticated;

-- 7. Pipeline view for the platform admin ------------------------------------------
create or replace function public.list_hospitals_for_platform_admin()
returns table (
  id uuid,
  name text,
  city text,
  onboarding_status text,
  staff_count bigint,
  pending_invites bigint,
  go_live_blockers text[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select
    h.id,
    h.name,
    h.city,
    h.onboarding_status,
    (select count(*) from public.practitioners p
      where p.hospital_id = h.id and coalesce(p.is_active, true)),
    (select count(*) from public.invitations i where i.hospital_id = h.id),
    (
      select coalesce(array_agg(x), '{}')
        from (
          select 'grievance officer name' as x where coalesce(btrim(h.grievance_officer_name), '') = ''
          union all
          select 'grievance officer email' where coalesce(btrim(h.grievance_officer_email), '') = ''
          union all
          select 'privacy notice URL' where coalesce(btrim(h.privacy_notice_url), '') = ''
        ) blockers
    ),
    h.created_at
  from public.hospitals h
  order by h.created_at desc nulls last;
end;
$$;

grant execute on function public.list_hospitals_for_platform_admin() to authenticated;
