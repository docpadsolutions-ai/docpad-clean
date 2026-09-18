-- Invited staff/doctor signup: provision `public.practitioners` from `auth.users` + user metadata.
-- Client calls `supabase.auth.signUp({ email, password, options: { data: { invite_token, ... } } })` only.
-- No direct INSERT into `practitioners` or `users` from the browser.

alter table public.practitioners
  add column if not exists qualification text;

comment on column public.practitioners.qualification is
  'Degrees / qualifications when captured at signup or profile.';

-- Ensure we can upsert by auth user id (PostgREST/JS upsert uses this target).
create unique index if not exists practitioners_user_id_key
  on public.practitioners (user_id);

-- FK to auth identity (Supabase canonical reference for login users).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'practitioners_user_id_fkey'
      and conrelid = 'public.practitioners'::regclass
  ) then
    alter table public.practitioners
      add constraint practitioners_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;

comment on constraint practitioners_user_id_fkey on public.practitioners is
  'Links hospital staff/doctor profile row to Supabase Auth user (auth.users.id).';

-- Optional free-text from invite form (staff experience notes, etc.).
alter table public.practitioners
  add column if not exists profile_notes text;

comment on column public.practitioners.profile_notes is
  'Optional notes captured at invite signup (e.g. experience); not clinical data.';

create or replace function public.handle_invited_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  v_token text;
  inv public.invitations%rowtype;
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

  select *
  into inv
  from public.invitations
  where token::text = v_token
    and status = 'pending'
    and lower(btrim(email)) = lower(btrim(coalesce(new.email, '')))
  limit 1;

  if not found then
    raise exception 'Invalid or expired invitation for this email.';
  end if;

  if v_full_name is null then
    raise exception 'Missing full name in signup metadata.';
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
    new.id,
    inv.hospital_id,
    v_full_name,
    new.email,
    inv.role,
    inv.role,
    inv.designation,
    true,
    v_hpr_id,
    v_qual,
    v_spec,
    v_phone,
    v_notes
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
  where token::text = v_token
    and status = 'pending';

  return new;
end;
$$;

comment on function public.handle_invited_auth_user() is
  'AFTER INSERT on auth.users: if raw_user_meta_data.invite_token is set, validate invitation and upsert practitioners.';

drop trigger if exists on_auth_user_created_invited_practitioner on auth.users;

create trigger on_auth_user_created_invited_practitioner
  after insert on auth.users
  for each row
  execute function public.handle_invited_auth_user();

revoke all on function public.handle_invited_auth_user() from public;

-- If RLS is enabled on practitioners, allow each user to insert/update their own row (signup + profile).
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'practitioners'
      and c.relrowsecurity
  ) then
    drop policy if exists "practitioners_insert_own_user_id" on public.practitioners;
    create policy "practitioners_insert_own_user_id"
      on public.practitioners
      for insert
      to authenticated
      with check (user_id = (select auth.uid()));

    drop policy if exists "practitioners_update_own_user_id" on public.practitioners;
    create policy "practitioners_update_own_user_id"
      on public.practitioners
      for update
      to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;
