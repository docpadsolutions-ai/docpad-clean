-- Shared provisioning for invite acceptance (new auth user via trigger, or existing user via RPC).

create or replace function public.provision_practitioner_for_invite_token(
  p_user_id uuid,
  p_email text,
  p_invite_token text,
  p_full_name text,
  p_hpr_id text,
  p_qualification text,
  p_specialization text,
  p_phone text,
  p_staff_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  v_full_name text;
begin
  v_full_name := nullif(btrim(p_full_name), '');
  if v_full_name is null then
    raise exception 'Missing full name.';
  end if;

  select *
  into inv
  from public.invitations
  where token::text = p_invite_token
    and status = 'pending'
    and lower(btrim(email)) = lower(btrim(coalesce(p_email, '')))
  limit 1;

  if not found then
    raise exception 'Invalid or expired invitation for this email.';
  end if;

  insert into public.practitioners (
    user_id,
    hospital_id,
    full_name,
    email,
    user_role,
    role,
    designation,
    is_active,
    hpr_id,
    qualification,
    specialization,
    phone,
    profile_notes
  )
  values (
    p_user_id,
    inv.hospital_id,
    v_full_name,
    p_email,
    inv.role,
    inv.role,
    inv.designation,
    true,
    nullif(btrim(p_hpr_id), ''),
    nullif(btrim(p_qualification), ''),
    nullif(btrim(p_specialization), ''),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_staff_notes), '')
  )
  on conflict (user_id) do update set
    hospital_id = excluded.hospital_id,
    full_name = excluded.full_name,
    email = excluded.email,
    user_role = excluded.user_role,
    role = excluded.role,
    designation = excluded.designation,
    is_active = excluded.is_active,
    hpr_id = excluded.hpr_id,
    qualification = excluded.qualification,
    specialization = excluded.specialization,
    phone = excluded.phone,
    profile_notes = excluded.profile_notes;

  update public.invitations
  set status = 'accepted'
  where token::text = p_invite_token
    and status = 'pending';
end;
$$;

comment on function public.provision_practitioner_for_invite_token(uuid, text, text, text, text, text, text, text, text) is
  'Upsert practitioners + accept invitation; used by auth trigger and by complete_invitation_signup.';

revoke all on function public.provision_practitioner_for_invite_token(uuid, text, text, text, text, text, text, text, text) from public;

-- Called from the client after sign-in when the email already has an auth account (signUp returns duplicate).
create or replace function public.complete_invitation_signup(
  p_invite_token text,
  p_full_name text,
  p_hpr_id text default null,
  p_qualification text default null,
  p_specialization text default null,
  p_phone text default null,
  p_staff_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  em text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select u.email into em
  from auth.users u
  where u.id = uid;

  if em is null then
    raise exception 'Not authenticated';
  end if;

  perform public.provision_practitioner_for_invite_token(
    uid,
    em,
    p_invite_token,
    p_full_name,
    p_hpr_id,
    p_qualification,
    p_specialization,
    p_phone,
    p_staff_notes
  );
end;
$$;

comment on function public.complete_invitation_signup is
  'Authenticated user accepts a pending invite (same email as session); creates/updates practitioners row.';

revoke all on function public.complete_invitation_signup(text, text, text, text, text, text, text) from public;
grant execute on function public.complete_invitation_signup(text, text, text, text, text, text, text) to authenticated;

-- Trigger: delegate to shared provisioner (same behavior as before).
create or replace function public.handle_invited_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  v_token text;
  v_full_name text;
  v_hpr_id text;
  v_qual text;
  v_spec text;
  v_phone text;
  v_notes text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_token := nullif(btrim(meta->>'invite_token'), '');

  if v_token is null then
    return new;
  end if;

  v_full_name := nullif(btrim(meta->>'full_name'), '');
  v_hpr_id := nullif(btrim(meta->>'hpr_id'), '');
  v_qual := nullif(btrim(meta->>'qualification'), '');
  v_spec := nullif(btrim(meta->>'specialization'), '');
  v_phone := nullif(btrim(meta->>'phone'), '');
  v_notes := nullif(btrim(meta->>'staff_notes'), '');

  perform public.provision_practitioner_for_invite_token(
    new.id,
    new.email,
    v_token,
    coalesce(v_full_name, ''),
    v_hpr_id,
    v_qual,
    v_spec,
    v_phone,
    v_notes
  );

  return new;
end;
$$;

comment on function public.handle_invited_auth_user() is
  'AFTER INSERT on auth.users: if raw_user_meta_data.invite_token is set, validate invitation and upsert practitioners.';

revoke all on function public.handle_invited_auth_user() from public;
