-- Production `feature_flags` uses `feature_key` (NOT NULL); earlier RPC targeted `flag_name` only, leaving `feature_key` null.

create or replace function public.set_feature_flag_for_hospital(
  p_hospital_id uuid,
  p_flag_name text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  v_key text := btrim(p_flag_name);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_key is null or v_key = '' then
    raise exception 'flag key required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized to manage feature flags';
  end if;

  if p_enabled then
    update public.feature_flags
    set updated_at = now()
    where hospital_id = p_hospital_id and feature_key = v_key;
    get diagnostics n = row_count;
    if n = 0 then
      insert into public.feature_flags (hospital_id, feature_key, updated_at)
      values (p_hospital_id, v_key, now());
    end if;
  else
    delete from public.feature_flags
    where hospital_id = p_hospital_id and feature_key = v_key;
  end if;
end;
$$;

comment on function public.set_feature_flag_for_hospital(uuid, text, boolean) is
  'Admin-only feature flag DML; uses column feature_key (app still passes values as p_flag_name).';
