-- RPC for nursing portal: insert nursing_procedure_logs with server-side auth + IDs.

create or replace function public.log_nursing_procedure(
  p_admission_id uuid,
  p_charge_item_def_id uuid,
  p_performed_at timestamptz,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
  v_hospital uuid;
  v_patient uuid;
  v_def public.charge_item_definitions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select a.hospital_id, a.patient_id
  into v_hospital, v_patient
  from public.ipd_admissions a
  where a.id = p_admission_id;

  if v_hospital is null or v_patient is null then
    return jsonb_build_object('success', false, 'error', 'Admission not found');
  end if;

  select pr.id
  into v_me
  from public.practitioners pr
  where pr.hospital_id = v_hospital
    and (pr.user_id = v_uid or pr.id = v_uid)
  limit 1;

  if v_me is null then
    return jsonb_build_object('success', false, 'error', 'Practitioner not found for this hospital');
  end if;

  select * into v_def
  from public.charge_item_definitions
  where id = p_charge_item_def_id
    and hospital_id = v_hospital
    and status = 'active';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Procedure definition not found');
  end if;

  insert into public.nursing_procedure_logs (
    hospital_id,
    patient_id,
    admission_id,
    procedure_name,
    procedure_code,
    performed_at,
    performed_by,
    charge_item_def_id,
    notes
  ) values (
    v_hospital,
    v_patient,
    p_admission_id,
    coalesce(nullif(trim(v_def.display_name), ''), 'Procedure'),
    coalesce(nullif(trim(v_def.code), ''), '—'),
    p_performed_at,
    v_me,
    p_charge_item_def_id,
    nullif(trim(p_notes), '')
  );

  return jsonb_build_object('success', true);
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$fn$;

comment on function public.log_nursing_procedure(uuid, uuid, timestamptz, text) is
  'Nursing portal: log procedure row + trigger charge_items; resolves hospital, patient, performed_by from session.';

grant execute on function public.log_nursing_procedure(uuid, uuid, timestamptz, text) to authenticated, service_role;
