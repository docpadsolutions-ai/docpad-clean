-- System security: hospital-scoped backup audit log, schedule metadata, and Storage bucket `hospital-backups`.
-- NABH 6th Ed §9.4.2 (data security & backups); DPDPA 2023 §8 (technical safeguards).
--
-- Note: PostgreSQL cannot execute pg_dump from plpgsql. public.trigger_manual_backup records the job and
-- optionally invokes the DocPad Node worker via pg_net (when backup_worker_settings is configured).
-- Otherwise the app calls POST /api/admin/backups/run after RPC (local dev).

-- ---------------------------------------------------------------------------
-- backup_worker_settings: single row for pg_net → application worker (optional).
-- Set base_url to your deployed app origin, bearer_secret must match DATABASE_BACKUP_INTERNAL_SECRET on the server.
-- ---------------------------------------------------------------------------
create table if not exists public.backup_worker_settings (
  id smallint primary key default 1 check (id = 1),
  base_url text not null default '',
  bearer_secret text not null default ''
);

insert into public.backup_worker_settings (id, base_url, bearer_secret)
values (1, '', '')
on conflict (id) do nothing;

revoke all on table public.backup_worker_settings from public;

comment on table public.backup_worker_settings is
  'Optional pg_net worker target for trigger_manual_backup; not readable by authenticated API roles.';

-- ---------------------------------------------------------------------------
-- backup_logs: one row per backup attempt (manual or scheduled).
-- ---------------------------------------------------------------------------
create table if not exists public.backup_logs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  size_bytes bigint,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  encrypted boolean not null default false,
  encryption_key_hash text,
  storage_object_path text,
  initiated_by uuid,
  error_message text
);

create index if not exists backup_logs_hospital_created_idx
  on public.backup_logs (hospital_id, created_at desc);

comment on table public.backup_logs is
  'Audit trail for encrypted schema backups uploaded to Storage bucket hospital-backups.';
comment on column public.backup_logs.encryption_key_hash is
  'SHA-256 (hex) of the AES-256 key material used for this object; never store the raw key.';

alter table public.backup_logs enable row level security;

-- No direct table access for authenticated clients; use SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------------
-- hospital_backup_schedule: UI + cron metadata (execution wired separately).
-- ---------------------------------------------------------------------------
create table if not exists public.hospital_backup_schedule (
  hospital_id uuid primary key references public.organizations (id) on delete cascade,
  frequency text not null default 'daily'
    check (frequency in ('daily', 'weekly', 'monthly')),
  run_at time not null default time '02:00',
  timezone text not null default 'Asia/Kolkata',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.hospital_backup_schedule is
  'Preferred automated backup window per hospital; wire pg_cron → worker using these values.';

alter table public.hospital_backup_schedule enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: hospital-backups (private; uploads via service role from worker).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hospital-backups',
  'hospital-backups',
  false,
  5368709120,
  array['application/octet-stream']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit),
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- trigger_manual_backup: admin gate, insert audit row, optional pg_net worker kick.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_manual_backup(p_hospital_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_base text;
  v_secret text;
  v_client_required boolean := true;
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  insert into public.backup_logs (hospital_id, status, initiated_by)
  values (p_hospital_id, 'queued', auth.uid())
  returning id into v_id;

  select nullif(trim(base_url), ''), nullif(trim(bearer_secret), '')
  into v_base, v_secret
  from public.backup_worker_settings
  where id = 1;

  if v_base is not null and v_secret is not null
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_post(
      url := rtrim(v_base, '/') || '/api/internal/database-backup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object(
        'backup_id', v_id::text,
        'hospital_id', p_hospital_id::text
      )
    );
    v_client_required := false;
  end if;

  return jsonb_build_object(
    'backup_id', v_id,
    'client_run_required', v_client_required
  );
end;
$fn$;

comment on function public.trigger_manual_backup(uuid) is
  'Hospital admin starts a backup job. pg_dump + AES-256 + Storage upload run in the DocPad Node worker (see app backup API). NABH §9.4.2; DPDPA §8.';

revoke all on function public.trigger_manual_backup(uuid) from public;
grant execute on function public.trigger_manual_backup(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- list_hospital_backups
-- ---------------------------------------------------------------------------
create or replace function public.list_hospital_backups(p_hospital_id uuid, p_limit int default 10)
returns table (
  id uuid,
  created_at timestamptz,
  completed_at timestamptz,
  size_bytes bigint,
  status text,
  encrypted boolean,
  encryption_key_hash text,
  storage_object_path text,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_limit is null or p_limit < 1 then
    p_limit := 10;
  end if;
  if p_limit > 50 then
    p_limit := 50;
  end if;

  return query
  select
    b.id,
    b.created_at,
    b.completed_at,
    b.size_bytes,
    b.status,
    b.encrypted,
    b.encryption_key_hash,
    b.storage_object_path,
    b.error_message
  from public.backup_logs b
  where b.hospital_id = p_hospital_id
  order by b.created_at desc
  limit p_limit;
end;
$fn$;

revoke all on function public.list_hospital_backups(uuid, int) from public;
grant execute on function public.list_hospital_backups(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_hospital_backup_schedule / upsert_hospital_backup_schedule
-- ---------------------------------------------------------------------------
create or replace function public.get_hospital_backup_schedule(p_hospital_id uuid)
returns table (
  hospital_id uuid,
  frequency text,
  run_at time,
  timezone text,
  enabled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if exists (select 1 from public.hospital_backup_schedule s where s.hospital_id = p_hospital_id) then
    return query
    select
      s.hospital_id,
      s.frequency,
      s.run_at,
      s.timezone,
      s.enabled,
      s.updated_at
    from public.hospital_backup_schedule s
    where s.hospital_id = p_hospital_id;
  else
    return query
    select
      p_hospital_id,
      'daily'::text,
      time '02:00',
      'Asia/Kolkata'::text,
      true,
      now()::timestamptz;
  end if;
end;
$fn$;

revoke all on function public.get_hospital_backup_schedule(uuid) from public;
grant execute on function public.get_hospital_backup_schedule(uuid) to authenticated, service_role;

create or replace function public.upsert_hospital_backup_schedule(
  p_hospital_id uuid,
  p_frequency text,
  p_run_at time,
  p_timezone text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_hospital_id is null then
    raise exception 'hospital_id required';
  end if;

  if not public._caller_is_hospital_staff_admin(p_hospital_id) then
    raise exception 'not authorized';
  end if;

  if p_frequency is null or p_frequency not in ('daily', 'weekly', 'monthly') then
    raise exception 'invalid frequency';
  end if;

  insert into public.hospital_backup_schedule (hospital_id, frequency, run_at, timezone, enabled, updated_at)
  values (
    p_hospital_id,
    p_frequency,
    coalesce(p_run_at, time '02:00'),
    coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'),
    coalesce(p_enabled, true),
    now()
  )
  on conflict (hospital_id) do update set
    frequency = excluded.frequency,
    run_at = excluded.run_at,
    timezone = excluded.timezone,
    enabled = excluded.enabled,
    updated_at = now();
end;
$fn$;

revoke all on function public.upsert_hospital_backup_schedule(uuid, text, time, text, boolean) from public;
grant execute on function public.upsert_hospital_backup_schedule(uuid, text, time, text, boolean)
  to authenticated, service_role;
