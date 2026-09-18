-- Who dispensed (for ledger pharmacist_name); ledger view of dispensed lines per hospital.
alter table public.prescriptions add column if not exists dispensed_by uuid;

comment on column public.prescriptions.dispensed_by is 'practitioners.id of pharmacist who dispensed; set by dispense_prescription (p_pharmacist_id).';

create or replace function public.dispense_prescription(
  p_prescription_id uuid,
  p_dispensed_quantity integer,
  p_pharmacist_id uuid,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_rx uuid := p_prescription_id;
  v_qty integer := p_dispensed_quantity;
  v_notes text := p_notes;
  v_total integer;
  v_updated int;
begin
  v_org := public.auth_org();
  if v_org is null then
    raise exception 'no hospital context';
  end if;

  if p_pharmacist_id is distinct from auth.uid() then
    raise exception 'pharmacist_id must match the signed-in user';
  end if;

  if not exists (
    select 1
    from public.practitioners pr
    where pr.hospital_id = v_org
      and (pr.id = auth.uid() or pr.user_id = auth.uid())
  ) then
    raise exception 'not a practitioner for this hospital';
  end if;

  if v_qty is null or v_qty < 1 then
    raise exception 'dispensed_quantity must be at least 1';
  end if;

  select p.total_quantity
  into v_total
  from public.prescriptions p
  inner join public.opd_encounters e on e.id = p.encounter_id
  where p.id = v_rx
    and e.hospital_id = v_org
    and p.status = 'ordered';

  if not found then
    raise exception 'prescription not found, not ordered, or wrong hospital';
  end if;

  v_total := greatest(coalesce(v_total, 1), 1);
  if v_qty > v_total then
    raise exception 'dispensed_quantity cannot exceed prescribed quantity';
  end if;

  if v_qty < v_total and nullif(trim(coalesce(v_notes, '')), '') is null then
    raise exception 'notes are required when dispensing less than the full quantity';
  end if;

  update public.prescriptions p
  set
    status = 'dispensed',
    dispensed_quantity = v_qty,
    dispensing_notes = nullif(trim(coalesce(v_notes, '')), ''),
    dispensed_at = now(),
    dispensed_by = p_pharmacist_id
  from public.opd_encounters e
  where p.id = v_rx
    and p.encounter_id = e.id
    and e.hospital_id = v_org
    and p.status = 'ordered';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'could not update prescription (concurrent change?)';
  end if;
end;
$$;

create or replace view public.pharmacy_dispensed_prescriptions
with (security_invoker = true) as
select
  p.id as prescription_id,
  (p.dispensed_at::timestamptz)::date as dispensed_at,
  pt.full_name as patient_name,
  p.medicine_name,
  coalesce(
    nullif(trim(pr.full_name), ''),
    nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
    '—'
  ) as pharmacist_name,
  e.hospital_id
from public.prescriptions p
inner join public.opd_encounters e on e.id = p.encounter_id
inner join public.patients pt on pt.id = e.patient_id
left join public.practitioners pr
  on p.dispensed_by is not null
  and (pr.id = p.dispensed_by or pr.user_id = p.dispensed_by)
where p.status = 'dispensed'
  and p.dispensed_at is not null;

comment on view public.pharmacy_dispensed_prescriptions is
  'Dispensed lines: dispensed_at::date, patient, drug, pharmacist; filter .eq(hospital_id, org).';

grant select on public.pharmacy_dispensed_prescriptions to authenticated;
