-- audit_logs existed but nothing ever wrote to it. Every change to patient, clinical, staff and
-- money tables is now recorded with the full row before and after, who did it and when.

create or replace function public._uuid_or_null(p_text text)
returns uuid language sql immutable as $$
  select case when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then p_text::uuid end
$$;
revoke all on function public._uuid_or_null(text) from public, anon;
grant execute on function public._uuid_or_null(text) to authenticated, service_role;

create or replace function public.trg_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_uid uuid := auth.uid();
  v_hospital uuid;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if v_old = v_new then
      return new;   -- no-op update, nothing to record
    end if;
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
  end if;

  v_row := coalesce(v_new, v_old);

  v_hospital := _uuid_or_null(v_row ->> 'hospital_id');
  if v_hospital is null and v_row ? 'patient_id' then
    v_hospital := patient_hospital_id(_uuid_or_null(v_row ->> 'patient_id'));
  end if;
  if v_hospital is null and v_row ? 'encounter_id' then
    v_hospital := encounter_hospital_id(_uuid_or_null(v_row ->> 'encounter_id'));
  end if;
  if v_hospital is null and v_row ? 'admission_id' then
    select a.hospital_id into v_hospital from ipd_admissions a
    where a.id = _uuid_or_null(v_row ->> 'admission_id');
  end if;

  insert into audit_logs (
    hospital_id, user_id, practitioner_id, action, resource_type, resource_id, old_values, new_values)
  values (
    v_hospital,
    v_uid,
    (select p.id from practitioners p where p.user_id = v_uid or p.id = v_uid limit 1),
    tg_op,
    tg_table_name,
    _uuid_or_null(v_row ->> 'id'),
    v_old,
    v_new);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.trg_audit_row() from public, anon, authenticated;

-- Attach to every table holding patient data or money, plus staff identity and permissions.
do $$
declare
  t record;
begin
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'id')
      and (
        exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = c.relname
                  and col.column_name in ('patient_id', 'admission_id', 'encounter_id', 'opd_encounter_id'))
        or c.relname in (
          'patients', 'practitioners', 'role_permissions', 'invitations', 'hospitals',
          'invoices', 'invoice_line_items', 'payments', 'charge_items', 'billing_accounts', 'accounts',
          'insurance_claims', 'insurance_preauths', 'patient_wallet', 'wallet_transactions',
          'ipd_daily_charges', 'procedure_estimates', 'opd_bills', 'investigation_bills',
          'investigation_bill_items', 'hospital_inventory', 'stock_transactions', 'ipd_beds')
      )
      and c.relname not in (
        'audit_logs', 'billing_audit_log', 'doctor_interaction_embeddings', 'icd10_library',
        'snomed_cache', 'snomed_concept_cache', 'snomed_drug_map', 'snomed_dosage_forms',
        'abdm_webhook_inbox', 'notifications')
  loop
    execute format('drop trigger if exists zz_audit_row on public.%I', t.tbl);
    execute format(
      'create trigger zz_audit_row after insert or update or delete on public.%I
         for each row execute function public.trg_audit_row()', t.tbl);
  end loop;
end
$$;

-- Staff must not be able to write or forge audit entries; only the triggers (definer) insert.
drop policy if exists audit_insert on public.audit_logs;
alter policy audit_select on public.audit_logs to authenticated
  using (hospital_id = (select auth_hospital_id())
         and (select _caller_is_hospital_staff_admin(hospital_id)));
revoke insert, update, delete on public.audit_logs from authenticated;

create index if not exists idx_audit_logs_hospital_created on public.audit_logs (hospital_id, created_at desc);
create index if not exists idx_audit_logs_resource on public.audit_logs (resource_type, resource_id);
create index if not exists idx_audit_logs_user on public.audit_logs (user_id, created_at desc);

comment on table public.audit_logs is
  'Immutable audit trail. Written only by trg_audit_row() and log_phi_read(); readable by hospital admins. Retention: 24 months (pg_cron job audit-logs-retention).';
