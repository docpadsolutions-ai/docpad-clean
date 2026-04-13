-- IPD investigation ordering: catalogue flags, billing columns, lab queue RPCs, payment confirmation.

-- ─── test_catalogue ───────────────────────────────────────────────────────────
alter table public.test_catalogue
  add column if not exists is_in_house boolean not null default true;

alter table public.test_catalogue
  add column if not exists external_lab_name text;

alter table public.test_catalogue
  add column if not exists list_price numeric(12, 2);

comment on column public.test_catalogue.is_in_house is 'In-house lab vs send-out / external reference lab.';
comment on column public.test_catalogue.external_lab_name is 'When not in-house, partner lab display name.';
comment on column public.test_catalogue.list_price is 'Default patient-facing price for billing (IPD investigation orders).';

-- ─── ipd_investigation_orders (additive) ─────────────────────────────────────
alter table public.ipd_investigation_orders
  add column if not exists billing_status text not null default 'pending_payment';

alter table public.ipd_investigation_orders
  add column if not exists test_catalogue_id uuid;

alter table public.ipd_investigation_orders
  add column if not exists is_in_house boolean;

alter table public.ipd_investigation_orders
  add column if not exists external_lab_name text;

alter table public.ipd_investigation_orders
  add column if not exists order_amount numeric(12, 2);

alter table public.ipd_investigation_orders
  add column if not exists priority text;

alter table public.ipd_investigation_orders
  add column if not exists sample_type text;

alter table public.ipd_investigation_orders
  add column if not exists requires_fasting boolean;

alter table public.ipd_investigation_orders
  add column if not exists expected_tat_hrs numeric(8, 2);

alter table public.ipd_investigation_orders
  add column if not exists sample_collected_at timestamptz;

alter table public.ipd_investigation_orders
  add column if not exists sample_collected_by uuid;

alter table public.ipd_investigation_orders
  add column if not exists result_available_at timestamptz;

alter table public.ipd_investigation_orders
  add column if not exists result_text text;

alter table public.ipd_investigation_orders
  add column if not exists report_file_path text;

alter table public.ipd_investigation_orders
  add column if not exists ordered_by_id uuid;

alter table public.ipd_investigation_orders
  add column if not exists ordered_on_day integer;

-- Backfill ordered_by_id from existing ordering practitioner column if present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ipd_investigation_orders' and column_name = 'ordering_practitioner_id'
  ) then
    update public.ipd_investigation_orders
    set ordered_by_id = coalesce(ordered_by_id, ordering_practitioner_id)
    where ordered_by_id is null and ordering_practitioner_id is not null;
  end if;
end $$;

-- ─── place_investigation_order ────────────────────────────────────────────────
create or replace function public.place_investigation_order(
  p_hospital_id uuid,
  p_admission_id uuid,
  p_patient_id uuid,
  p_progress_note_id uuid,
  p_test_name text,
  p_test_category text,
  p_loinc_code text,
  p_priority text,
  p_ordered_by uuid,
  p_investigation_id uuid,
  p_ordered_on_day integer,
  p_ordered_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cov uuid;
  v_pri text := lower(trim(coalesce(p_priority, 'routine')));
  v_billing text;
  v_cat record;
  v_id uuid;
  v_in_house boolean := true;
  v_ext text;
  v_amt numeric(12, 2);
  v_sample text;
  v_fast boolean;
  v_tat numeric(8, 2);
begin
  select a.coverage_id into v_cov
  from public.ipd_admissions a
  where a.id = p_admission_id;

  select
    tc.is_in_house,
    tc.external_lab_name,
    tc.list_price,
    tc.sample_type,
    tc.requires_fasting,
    tc.expected_tat_hours
  into v_cat
  from public.test_catalogue tc
  where tc.id = p_investigation_id;

  if found then
    v_in_house := coalesce(v_cat.is_in_house, true);
    v_ext := v_cat.external_lab_name;
    v_amt := v_cat.list_price;
    v_sample := v_cat.sample_type;
    v_fast := v_cat.requires_fasting;
    v_tat := v_cat.expected_tat_hours;
  end if;

  if v_pri = 'stat' then
    v_billing := 'emergency_override';
  elsif v_cov is not null then
    v_billing := 'insurance_covered';
  else
    v_billing := 'pending_payment';
  end if;

  insert into public.ipd_investigation_orders (
    hospital_id,
    admission_id,
    patient_id,
    progress_note_id,
    test_name,
    test_category,
    loinc_code,
    priority,
    status,
    billing_status,
    test_catalogue_id,
    is_in_house,
    external_lab_name,
    order_amount,
    sample_type,
    requires_fasting,
    expected_tat_hrs,
    ordered_by_id,
    ordered_on_day,
    ordered_date,
    ordering_practitioner_id,
    created_at
  ) values (
    p_hospital_id,
    p_admission_id,
    p_patient_id,
    p_progress_note_id,
    p_test_name,
    coalesce(p_test_category, 'General'),
    nullif(trim(p_loinc_code), ''),
    coalesce(p_priority, 'routine'),
    'ordered',
    v_billing,
    p_investigation_id,
    v_in_house,
    v_ext,
    v_amt,
    v_sample,
    v_fast,
    v_tat,
    p_ordered_by,
    p_ordered_on_day,
    coalesce(p_ordered_date, (current_date)),
    p_ordered_by,
    now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'order_id', v_id,
    'billing_status', v_billing
  );
end;
$$;

grant execute on function public.place_investigation_order(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, uuid, integer, date
) to authenticated, service_role;

-- ─── confirm_investigation_payment ───────────────────────────────────────────
create or replace function public.confirm_investigation_payment(
  p_order_id uuid,
  p_confirmed_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ipd_investigation_orders
  set billing_status = 'paid'
  where id = p_order_id
    and billing_status = 'pending_payment';
end;
$$;

grant execute on function public.confirm_investigation_payment(uuid, uuid) to authenticated, service_role;

-- ─── confirm_investigation_emergency_override ───────────────────────────────
create or replace function public.confirm_investigation_emergency_override(
  p_order_id uuid,
  p_confirmed_by uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ipd_investigation_orders
  set billing_status = 'emergency_override'
  where id = p_order_id
    and billing_status = 'pending_payment';
end;
$$;

grant execute on function public.confirm_investigation_emergency_override(uuid, uuid, text)
  to authenticated, service_role;

-- ─── get_lab_queue ────────────────────────────────────────────────────────────
create or replace function public.get_lab_queue(p_hospital_id uuid)
returns table (
  order_id uuid,
  patient_id uuid,
  test_name text,
  test_category text,
  priority text,
  status text,
  patient_name text,
  patient_age integer,
  patient_sex text,
  ward_name text,
  bed_number text,
  admission_number text,
  sample_type text,
  requires_fasting boolean,
  expected_tat_hrs numeric,
  ordered_by_name text,
  ordered_by_id uuid,
  ordered_at timestamptz,
  is_in_house boolean,
  external_lab_name text,
  billing_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    io.id as order_id,
    io.patient_id,
    io.test_name::text,
    io.test_category::text,
    io.priority::text,
    io.status::text,
    coalesce(pt.full_name, '')::text as patient_name,
    case
      when pt.date_of_birth is not null then extract(year from age(pt.date_of_birth))::integer
      else null
    end as patient_age,
    coalesce(pt.sex, '')::text as patient_sex,
    coalesce(w.name, '')::text as ward_name,
    coalesce(b.bed_number, '')::text as bed_number,
    coalesce(adm.admission_number, '')::text as admission_number,
    coalesce(io.sample_type, '')::text,
    coalesce(io.requires_fasting, false),
    io.expected_tat_hrs,
    coalesce(pr.full_name, pr.first_name || ' ' || pr.last_name, '')::text as ordered_by_name,
    io.ordered_by_id,
    io.created_at as ordered_at,
    coalesce(io.is_in_house, true),
    io.external_lab_name::text,
    io.billing_status::text
  from public.ipd_investigation_orders io
  left join public.patients pt on pt.id = io.patient_id
  left join public.ipd_admissions adm on adm.id = io.admission_id
  left join public.ipd_beds b on b.id = adm.bed_id
  left join public.ipd_wards w on w.id = coalesce(adm.ward_id, b.ward_id)
  left join public.practitioners pr on pr.id = io.ordered_by_id
  where io.hospital_id = p_hospital_id
    and io.billing_status in ('paid', 'insurance_covered', 'emergency_override')
    and coalesce(io.is_in_house, true) = true
  order by io.created_at asc;
$$;

grant execute on function public.get_lab_queue(uuid) to authenticated, service_role;

create or replace function public.get_lab_queue_external(p_hospital_id uuid)
returns table (
  order_id uuid,
  patient_id uuid,
  test_name text,
  test_category text,
  priority text,
  status text,
  patient_name text,
  patient_age integer,
  patient_sex text,
  ward_name text,
  bed_number text,
  admission_number text,
  sample_type text,
  requires_fasting boolean,
  expected_tat_hrs numeric,
  ordered_by_name text,
  ordered_by_id uuid,
  ordered_at timestamptz,
  is_in_house boolean,
  external_lab_name text,
  billing_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    io.id as order_id,
    io.patient_id,
    io.test_name::text,
    io.test_category::text,
    io.priority::text,
    io.status::text,
    coalesce(pt.full_name, '')::text as patient_name,
    case
      when pt.date_of_birth is not null then extract(year from age(pt.date_of_birth))::integer
      else null
    end as patient_age,
    coalesce(pt.sex, '')::text as patient_sex,
    coalesce(w.name, '')::text as ward_name,
    coalesce(b.bed_number, '')::text as bed_number,
    coalesce(adm.admission_number, '')::text as admission_number,
    coalesce(io.sample_type, '')::text,
    coalesce(io.requires_fasting, false),
    io.expected_tat_hrs,
    coalesce(pr.full_name, pr.first_name || ' ' || pr.last_name, '')::text as ordered_by_name,
    io.ordered_by_id,
    io.created_at as ordered_at,
    coalesce(io.is_in_house, true),
    io.external_lab_name::text,
    io.billing_status::text
  from public.ipd_investigation_orders io
  left join public.patients pt on pt.id = io.patient_id
  left join public.ipd_admissions adm on adm.id = io.admission_id
  left join public.ipd_beds b on b.id = adm.bed_id
  left join public.ipd_wards w on w.id = coalesce(adm.ward_id, b.ward_id)
  left join public.practitioners pr on pr.id = io.ordered_by_id
  where io.hospital_id = p_hospital_id
    and io.billing_status in ('paid', 'insurance_covered', 'emergency_override')
    and coalesce(io.is_in_house, true) = false
  order by io.created_at asc;
$$;

grant execute on function public.get_lab_queue_external(uuid) to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.ipd_investigation_orders;
exception
  when duplicate_object then null;
end $$;
