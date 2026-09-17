-- SECURITY DEFINER functions bypass RLS. Signed-out (anon) callers must not reach them.
-- Kept for anon: the two public RPCs, plus the helpers that RLS policies call
-- (they return NULL/false for anon, but policies need EXECUTE to evaluate).
-- Trigger functions are also removed from `authenticated` (triggers do not need caller EXECUTE).
do $$
declare
  r record;
  keep_anon constant text[] := array[
    'get_public_prescription', 'get_invitation_by_token',
    'has_permission', 'get_my_hospital_id', 'auth_hospital_id'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    if r.proname = any (keep_anon) then
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.is_trigger then
      execute format('revoke execute on function %s from authenticated', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end
$$;

-- New functions created by migrations are no longer executable by anon/PUBLIC unless granted explicitly.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
