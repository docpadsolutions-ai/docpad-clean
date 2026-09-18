-- invitations.token is uuid in many projects; comparing uuid = text raises "operator does not exist: uuid = text".
-- Compare as text on both sides (works for uuid or text column types).

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

revoke all on function public.provision_practitioner_for_invite_token(uuid, text, text, text, text, text, text, text, text) from public;
