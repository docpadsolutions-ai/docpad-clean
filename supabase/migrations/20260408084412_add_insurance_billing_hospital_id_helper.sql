-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408084412.

create or replace function public._insurance_billing_hospital_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v uuid;
begin
  select pr.hospital_id
  into v
  from public.practitioners pr
  where pr.user_id = auth.uid() or pr.id = auth.uid()
  limit 1;
  return v;
end;
$fn$;

revoke all on function public._insurance_billing_hospital_id() from public;
grant execute on function public._insurance_billing_hospital_id() to authenticated, service_role;
