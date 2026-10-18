-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260919180005.

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
  v_id uuid := gen_random_uuid();
  v_name text := btrim(p_name);
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorised to provision hospitals' using errcode = '42501';
  end if;

  if coalesce(v_name, '') = '' then
    raise exception 'Hospital name is required';
  end if;
  if coalesce(btrim(p_cr_number_prefix), '') = '' then
    raise exception 'Case-record number prefix is required';
  end if;

  insert into public.organizations (id, name)
  values (v_id, v_name);

  insert into public.hospitals (
    id, name, cr_number_prefix, city, state, phone, email, registration_no,
    grievance_officer_name, grievance_officer_email, grievance_officer_phone,
    privacy_notice_url, enabled_modules, onboarding_status, created_by
  ) values (
    v_id, v_name, btrim(p_cr_number_prefix), p_city, p_state, p_phone, p_email, p_registration_no,
    p_grievance_officer_name, p_grievance_officer_email, p_grievance_officer_phone,
    p_privacy_notice_url, coalesce(p_enabled_modules, '{}'::jsonb), 'pending_admin', auth.uid()
  );

  return v_id;
end;
$$;

grant execute on function public.provision_hospital(
  text, text, text, text, text, text, text, text, text, text, text, jsonb
) to authenticated;
