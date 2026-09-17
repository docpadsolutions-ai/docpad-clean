-- Lab queue: only investigations that have been paid at reception (not merely sent to billing).
-- Full workflow statuses (ordered → collected → resulted) remain in the result set; unpaid rows are excluded.

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
    and io.billing_status = 'paid'
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
    and io.billing_status = 'paid'
    and coalesce(io.is_in_house, true) = false
  order by io.created_at asc;
$$;

grant execute on function public.get_lab_queue_external(uuid) to authenticated, service_role;
