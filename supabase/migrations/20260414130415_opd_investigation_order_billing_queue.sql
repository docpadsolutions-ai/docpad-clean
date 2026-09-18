-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414130415.

-- OPD investigation orders: do not create a rolling invoice at order time; queue for reception.
-- Supplement charge pricing from investigation_price_master when definitions are missing or zero-priced.

create or replace function public.create_charge_item_for_event(
  p_hospital_id uuid,
  p_patient_id uuid,
  p_category text,
  p_display_label text,
  p_source_type text,
  p_source_id uuid,
  p_encounter_id uuid default null::uuid,
  p_requesting_pract_id uuid default null::uuid,
  p_quantity numeric default 1
)
returns table(charge_item_id uuid, unit_price numeric, definition_found boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_def_id     uuid;
  v_price      numeric := 0;
  v_found      boolean := false;
  v_ci_id      uuid;
  v_account_id uuid;
  v_master     numeric;
begin
  select id, base_price into v_def_id, v_price
  from public.charge_item_definitions
  where hospital_id = p_hospital_id
    and category = p_category
    and status = 'active'
    and display_name ilike '%' || p_display_label || '%'
  order by created_at desc
  limit 1;

  if v_def_id is not null then
    v_found := true;
    if v_price is null or v_price = 0 then
      select coalesce(
        nullif(ipm.final_price, 0),
        nullif(ipm.base_price, 0),
        nullif(ipm.panel_price, 0)
      )
      into v_master
      from public.investigation_price_master ipm
      where ipm.hospital_id = p_hospital_id
        and ipm.test_name = p_display_label
        and ipm.is_active = true
      order by ipm.updated_at desc nulls last
      limit 1;
      if v_master is not null and v_master > 0 then
        v_price := v_master;
      else
        v_found := false;
      end if;
    end if;
  else
    select coalesce(
      nullif(ipm.final_price, 0),
      nullif(ipm.base_price, 0),
      nullif(ipm.panel_price, 0)
    )
    into v_price
    from public.investigation_price_master ipm
    where ipm.hospital_id = p_hospital_id
      and ipm.test_name = p_display_label
      and ipm.is_active = true
    order by ipm.updated_at desc nulls last
    limit 1;
    if v_price is not null and v_price > 0 then
      v_found := true;
    else
      v_price := 0;
    end if;
  end if;

  select id into v_account_id
  from public.accounts
  where hospital_id = p_hospital_id
    and subject_id = p_patient_id
    and subject_type = 'Patient'
    and status = 'active'
  limit 1;

  insert into public.charge_items (
    hospital_id, patient_id, account_id, definition_id,
    category, charge_code_display, display_label,
    source_type, source_id, encounter_id,
    requesting_practitioner_id,
    quantity_value, unit_price, net_amount,
    unit_price_snapshot,
    status,
    override_reason
  ) values (
    p_hospital_id, p_patient_id, v_account_id, v_def_id,
    p_category, p_display_label, p_display_label,
    p_source_type, p_source_id, p_encounter_id,
    p_requesting_pract_id,
    p_quantity, v_price, v_price * p_quantity,
    v_price,
    case when v_found then 'billable' else 'planned' end,
    case when not v_found then 'UNPRICED: awaiting manual price entry' else null end
  ) returning id into v_ci_id;

  return query select v_ci_id, v_price, v_found;
end;
$function$;

create or replace function public.trg_fn_investigation_to_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ci_id  uuid;
  v_price  numeric;
  v_found  boolean;
  v_master numeric;
begin
  if new.status = 'cancelled' or new.billing_status != 'unbilled' then
    return new;
  end if;

  select ci.charge_item_id, ci.unit_price, ci.definition_found
  into v_ci_id, v_price, v_found
  from public.create_charge_item_for_event(
    new.hospital_id,
    new.patient_id,
    case new.test_category
      when 'imaging' then 'imaging'
      else 'lab_test'
    end,
    new.test_name,
    'service_request',
    new.id,
    new.encounter_id,
    new.doctor_id
  ) ci;

  if (v_price is null or v_price = 0) and v_ci_id is not null then
    select coalesce(
      nullif(ipm.final_price, 0),
      nullif(ipm.base_price, 0),
      nullif(ipm.panel_price, 0)
    )
    into v_master
    from public.investigation_price_master ipm
    where ipm.hospital_id = new.hospital_id
      and ipm.test_name = new.test_name
      and ipm.is_active = true
    order by ipm.updated_at desc nulls last
    limit 1;
    if v_master is not null and v_master > 0 then
      v_price := v_master;
      update public.charge_items
      set
        unit_price = v_price,
        unit_price_snapshot = v_price,
        net_amount = v_price * coalesce(quantity_value, 1),
        status = 'billable',
        override_reason = null
      where id = v_ci_id;
    end if;
  end if;

  update public.investigations
  set
    billing_status = 'sent_to_billing',
    bill_id = null
  where id = new.id;

  return new;
end;
$function$;

create or replace function public.auto_create_investigation_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_def_id uuid;
  v_price numeric;
  v_mapped_category text;
begin
  if tg_op = 'insert' then
    if exists (
      select 1
      from public.charge_items ci
      where ci.source_type = 'service_request'
        and ci.source_id = new.id
    ) then
      return new;
    end if;

    v_mapped_category := case lower(new.test_category)
      when 'lab' then 'lab_test'
      when 'lab_test' then 'lab_test'
      when 'biochemistry' then 'lab_test'
      when 'haematology' then 'lab_test'
      when 'hematology' then 'lab_test'
      when 'microbiology' then 'lab_test'
      when 'serology' then 'lab_test'
      when 'coagulation' then 'lab_test'
      when 'immunology' then 'lab_test'
      when 'urine' then 'lab_test'
      when 'imaging' then 'imaging'
      when 'radiology' then 'imaging'
      when 'xray' then 'imaging'
      when 'x-ray' then 'imaging'
      when 'mri' then 'imaging'
      when 'ct' then 'imaging'
      when 'ultrasound' then 'imaging'
      when 'cardiac' then 'procedure'
      when 'ecg' then 'procedure'
      when 'echo' then 'procedure'
      when 'advanced' then 'procedure'
      when 'procedure' then 'procedure'
      else 'lab_test'
    end;

    select cid.id, cid.base_price into v_def_id, v_price
    from public.charge_item_definitions cid
    where cid.hospital_id = new.hospital_id
      and cid.category in ('lab_test', 'imaging')
      and cid.display_name ilike '%' || new.test_name || '%'
      and cid.status = 'active'
    limit 1;

    if v_def_id is null or v_price is null or v_price = 0 then
      select coalesce(
        nullif(ipm.final_price, 0),
        nullif(ipm.base_price, 0),
        nullif(ipm.panel_price, 0)
      )
      into v_price
      from public.investigation_price_master ipm
      where ipm.hospital_id = new.hospital_id
        and ipm.test_name = new.test_name
        and ipm.is_active = true
      order by ipm.updated_at desc nulls last
      limit 1;
    end if;

    if v_price is not null and v_price > 0 then
      insert into public.charge_items (
        hospital_id,
        status,
        charge_code_display,
        category,
        patient_id,
        encounter_id,
        department_id,
        definition_id,
        requesting_practitioner_id,
        unit_price,
        net_amount,
        quantity_value,
        source_type,
        source_id
      ) values (
        new.hospital_id,
        'billable',
        new.test_name,
        v_mapped_category,
        new.patient_id,
        new.encounter_id,
        (select department_id from public.opd_encounters where id = new.encounter_id limit 1),
        v_def_id,
        new.doctor_id,
        v_price,
        v_price,
        1,
        'service_request',
        new.id
      );
    end if;
  end if;

  return new;
end;
$function$;
