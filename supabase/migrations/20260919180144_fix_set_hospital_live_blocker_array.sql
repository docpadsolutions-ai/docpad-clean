-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260919180144.

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
    v_missing := array_append(v_missing, 'grievance officer name');
  end if;
  if coalesce(btrim(h.grievance_officer_email), '') = '' then
    v_missing := array_append(v_missing, 'grievance officer email');
  end if;
  if coalesce(btrim(h.privacy_notice_url), '') = '' then
    v_missing := array_append(v_missing, 'privacy notice URL');
  end if;

  select count(*) into v_staff
    from public.practitioners p
   where p.hospital_id = p_hospital_id
     and coalesce(p.is_active, true);

  if v_staff = 0 then
    v_missing := array_append(v_missing, 'at least one active staff member');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot go live. Still missing: %', array_to_string(v_missing, ', ');
  end if;

  update public.hospitals set onboarding_status = 'live' where id = p_hospital_id;
end;
$$;

grant execute on function public.set_hospital_live(uuid) to authenticated;
