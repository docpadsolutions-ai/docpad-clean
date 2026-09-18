-- p_pharmacist_id is practitioners.id where user_id = auth.uid() (not auth.users id).
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

  if not exists (
    select 1
    from public.practitioners pr
    where pr.id = p_pharmacist_id
      and pr.user_id = auth.uid()
      and pr.hospital_id = v_org
  ) then
    raise exception 'pharmacist_id must be your practitioner row (practitioners.id for this session user and hospital)';
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

comment on function public.dispense_prescription(uuid, integer, uuid, text) is
  'Mark prescription dispensed; p_pharmacist_id = practitioners.id where user_id = auth.uid() and hospital_id = auth_org().';
