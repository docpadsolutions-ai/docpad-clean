-- Invitees are not signed in yet, so the join page cannot read `invitations` under RLS.
-- This returns one pending, unexpired invitation for an exact token (uuid) and nothing else.
create or replace function public.get_invitation_by_token(p_token text)
returns table (token uuid, email text, hospital_id uuid, role text, designation text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    return;
  end;

  return query
    select i.token, i.email, i.hospital_id, i.role, i.designation
    from invitations i
    where i.token = v_token
      and i.status = 'pending'
      and (i.expires_at is null or i.expires_at > now())
    limit 1;
end;
$$;

revoke all on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
