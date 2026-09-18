-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917182721.

-- SOW 2.1: the audit table must be append-only, enforced by the database rather than by grants,
-- so that a direct UPDATE or DELETE fails for every role including the table owner.
-- The only exception is the retention job, which sets a session flag the trigger recognises.
create or replace function public.trg_audit_logs_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('docpad.audit_retention', true), '') = 'on' and tg_op = 'DELETE' then
    return old;   -- prune_audit_logs() only
  end if;
  raise exception 'audit_logs is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;
revoke all on function public.trg_audit_logs_append_only() from public, anon, authenticated;

drop trigger if exists zz_audit_logs_append_only on public.audit_logs;
create trigger zz_audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.trg_audit_logs_append_only();

-- Retention (24 months) now runs through a function that opens the one permitted gap.
create or replace function public.prune_audit_logs(p_keep_months integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  perform set_config('docpad.audit_retention', 'on', true);
  delete from audit_logs where created_at < now() - make_interval(months => p_keep_months);
  get diagnostics v_deleted = row_count;
  perform set_config('docpad.audit_retention', 'off', true);
  return v_deleted;
end;
$$;
revoke all on function public.prune_audit_logs(integer) from public, anon, authenticated;

select cron.unschedule('audit-logs-retention');
select cron.schedule('audit-logs-retention', '17 3 1 * *', $cron$select public.prune_audit_logs(24)$cron$);

comment on trigger zz_audit_logs_append_only on public.audit_logs is
  'SOW 2.1 acceptance test: a direct UPDATE or DELETE against audit_logs must fail at the database layer.';
