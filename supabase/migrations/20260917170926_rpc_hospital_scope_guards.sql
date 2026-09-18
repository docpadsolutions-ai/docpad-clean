-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260917170926.

-- 127 SECURITY DEFINER RPCs took hospital/patient/admission/... ids from the caller and never checked
-- that the record belongs to the caller's hospital (definer functions bypass RLS).
-- Each now starts with _assert_hospital_scope() for every id parameter it accepts.
-- Checks apply only to signed-in API callers; cron, triggers and service_role are unaffected.
create or replace function public._assert_hospital_scope(p_kind text, p_id uuid)
returns void language plpgsql stable security definer set search_path = public
as $$
declare v_mine uuid; v_target uuid;
begin
  if p_id is null or coalesce(auth.role(), '') <> 'authenticated' then return; end if;
  v_target := case p_kind
    when 'hospital' then p_id
    when 'patient' then (select hospital_id from patients where id = p_id)
    when 'encounter' then (select hospital_id from opd_encounters where id = p_id)
    when 'admission' then (select hospital_id from ipd_admissions where id = p_id)
    when 'practitioner' then (select hospital_id from practitioners where id = p_id or user_id = p_id limit 1)
    when 'bed' then (select hospital_id from ipd_beds where id = p_id)
    when 'ward' then (select hospital_id from ipd_wards where id = p_id)
    when 'invoice' then (select hospital_id from invoices where id = p_id)
    when 'invoice_line' then (select i.hospital_id from invoice_line_items l join invoices i on i.id = l.invoice_id where l.id = p_id)
    when 'account' then (select hospital_id from accounts where id = p_id)
    when 'charge_item' then (select hospital_id from charge_items where id = p_id)
    when 'claim' then (select hospital_id from insurance_claims where id = p_id)
    when 'preauth' then (select hospital_id from insurance_preauths where id = p_id)
    when 'inventory' then (select hospital_id from hospital_inventory where id = p_id)
    when 'note' then (select hospital_id from ipd_progress_notes where id = p_id)
    when 'treatment' then (select hospital_id from ipd_treatments where id = p_id)
    when 'task' then (select hospital_id from nursing_tasks where id = p_id)
    when 'investigation' then (select hospital_id from investigations where id = p_id)
    when 'ipd_order' then (select hospital_id from ipd_investigation_orders where id = p_id)
    when 'prescription' then (select e.hospital_id from prescriptions r join opd_encounters e on e.id = r.encounter_id where r.id = p_id)
    when 'ward_inventory' then (select hospital_id from ward_inventory where id = p_id)
    when 'department' then (select hospital_id from departments where id = p_id)
    when 'consent' then (select hospital_id from ipd_admission_consents where id = p_id)
    when 'xray_template' then (select hospital_id from xray_measurement_templates where id = p_id)
    when 'xray_measurement' then (select hospital_id from xray_measurements where id = p_id)
    else null end;
  if v_target is null then return; end if;  -- missing row: the RPC's own "not found" handling applies
  v_mine := auth_hospital_id();
  if v_mine is null or v_target <> v_mine then
    raise exception 'Not permitted: record belongs to another hospital' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public._assert_hospital_scope(text, uuid) from public, anon;
grant execute on function public._assert_hospital_scope(text, uuid) to authenticated, service_role;

do $$
declare
  f record; i int; pname text; kind text; guards text; n int;
  def text; body_start int; pos int;
begin
  for f in
    select p.oid, p.proname, l.lanname, p.pronargs, p.proargnames, p.proargtypes
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where ns.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and l.lanname in ('sql', 'plpgsql')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prosrc !~* '(auth\.uid|auth_hospital_id|get_my_hospital_id|_caller_is|has_permission|auth\.jwt|auth_org|_insurance_billing_hospital_id|_assert_hospital_scope)'
      and p.proname not in ('get_public_prescription','get_invitation_by_token','encounter_hospital_id',
                            'patient_hospital_id','patient_hospital_id_from_object','has_permission',
                            'provision_practitioner_for_invite_token','complete_invitation_signup',
                            'abha_verify_otp','check_patient_exists','_assert_hospital_scope')
  loop
    guards := ''; n := 0;
    for i in 1 .. f.pronargs loop
      pname := f.proargnames[i];
      continue when pname is null or f.proargtypes[i - 1] <> 'uuid'::regtype;
      kind := case
        when pname in ('p_hospital_id','hospital_id_input','org_id_input') then 'hospital'
        when pname = 'p_patient_id' then 'patient'
        when pname in ('p_encounter_id','p_opd_encounter_id','p_source_opd_encounter_id') then 'encounter'
        when pname = 'p_admission_id' then 'admission'
        when pname in ('p_doctor_id','p_admitting_doctor_id','p_nurse_id','p_pharmacist_id','pharmacist_id',
                       'p_requesting_pract_id','p_user_id','p_recipient_id','invited_by')
          or pname ~ '^p_[a-z_]+_by$' then 'practitioner'
        when pname in ('p_bed_id','p_to_bed_id') then 'bed'
        when pname in ('p_ward_id','p_to_ward_id') then 'ward'
        when pname = 'p_invoice_id' then 'invoice'
        when pname = 'p_line_item_id' then 'invoice_line'
        when pname = 'p_account_id' then 'account'
        when pname = 'p_charge_item_id' then 'charge_item'
        when pname = 'p_claim_id' then 'claim'
        when pname = 'p_preauth_id' then 'preauth'
        when pname in ('p_item_id','item_id') then 'inventory'
        when pname in ('p_note_id','p_progress_note_id') then 'note'
        when pname = 'p_treatment_id' then 'treatment'
        when pname in ('p_task_id','p_nursing_task_id') then 'task'
        when pname = 'p_investigation_id' then 'investigation'
        when pname in ('p_investigation_order_id','p_order_id') then 'ipd_order'
        when pname in ('p_prescription_id','prescription_id') then 'prescription'
        when pname = 'p_ward_inventory_id' then 'ward_inventory'
        when pname in ('p_department_id','p_admitting_department_id') then 'department'
        when pname = 'p_consent_id' then 'consent'
        when pname = 'p_id' and f.proname in ('get_claim_by_id','update_claim_status') then 'claim'
        when pname = 'p_id' and f.proname in ('get_preauth_by_id','update_preauth_status') then 'preauth'
        when pname = 'p_id' and f.proname in ('use_xray_template','save_xray_template','delete_xray_template') then 'xray_template'
        when pname = 'p_id' and f.proname = 'upsert_xray_measurement' then 'xray_measurement'
        else null end;
      continue when kind is null;
      n := n + 1;
      if f.lanname = 'plpgsql' then
        guards := guards || format(E'\n  perform public._assert_hospital_scope(%L, %I);', kind, pname);
      else
        guards := guards || format(E'\nselect public._assert_hospital_scope(%L, %I);', kind, pname);
      end if;
    end loop;
    continue when n = 0;

    def := pg_get_functiondef(f.oid);
    -- pg_trgm / pgcrypto / vector live in the extensions schema (e.g. get_similar_patient_names was broken)
    def := replace(def, E' SET search_path TO ''public''\n', E' SET search_path TO ''public'', ''extensions''\n');
    body_start := strpos(def, 'AS $function$') + length('AS $function$');
    if f.lanname = 'plpgsql' then
      pos := body_start - 1 + regexp_instr(substr(def, body_start), '\mbegin\M', 1, 1, 1, 'i');
      def := left(def, pos - 1) || guards || substr(def, pos);
    else
      def := left(def, body_start - 1) || guards || substr(def, body_start);
    end if;
    execute def;
  end loop;
end
$$;
