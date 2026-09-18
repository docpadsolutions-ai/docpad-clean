-- Admin-only edit of the DPDP grievance officer and privacy notice settings.
-- Kept apart from update_hospital_profile() so the privacy contact has its own
-- audited entry point and a narrower permission.
create or replace function public.update_grievance_officer(
  p_name                 text default null,
  p_email                text default null,
  p_phone                text default null,
  p_privacy_notice_url   text default null,
  p_privacy_notice_version text default null,
  p_data_retention_years int default null
) returns json
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_hospital uuid := auth_hospital_id();
  v_role     text;
  v json;
begin
  if v_hospital is null then
    raise exception 'Your account is not linked to a hospital' using errcode = 'P0002';
  end if;

  select user_role into v_role from practitioners
   where user_id = auth.uid() and hospital_id = v_hospital limit 1;

  if coalesce(v_role, '') not in ('admin', 'owner', 'super_admin') then
    raise exception 'Only an administrator can change the grievance officer'
      using errcode = '42501';
  end if;

  update hospitals
     set grievance_officer_name  = coalesce(nullif(btrim(p_name), ''), grievance_officer_name),
         grievance_officer_email = coalesce(nullif(btrim(p_email), ''), grievance_officer_email),
         grievance_officer_phone = coalesce(nullif(btrim(p_phone), ''), grievance_officer_phone),
         privacy_notice_url      = coalesce(nullif(btrim(p_privacy_notice_url), ''), privacy_notice_url),
         privacy_notice_version  = coalesce(nullif(btrim(p_privacy_notice_version), ''), privacy_notice_version),
         data_retention_years    = coalesce(p_data_retention_years, data_retention_years),
         updated_at              = now()
   where id = v_hospital;

  select json_build_object('success', true,
                           'name', h.grievance_officer_name,
                           'email', h.grievance_officer_email,
                           'phone', h.grievance_officer_phone,
                           'privacy_notice_url', h.privacy_notice_url,
                           'privacy_notice_version', h.privacy_notice_version,
                           'data_retention_years', h.data_retention_years)
    into v from hospitals h where h.id = v_hospital;
  return v;
end;
$function$;

-- The grievance register across the hospital, for the admin queue.
create or replace function public.list_data_principal_requests(
  p_status text default null,
  p_limit  int  default 200
) returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v json; v_hospital uuid := auth_hospital_id();
begin
  if v_hospital is null then return '[]'::json; end if;

  select json_agg(row_to_json(r) order by r.raised_at desc) into v
  from (
    select d.id, d.request_type, d.status, d.subject, d.details,
           d.requested_by_name, d.requested_by_relation, d.contact_phone, d.contact_email,
           d.raised_at, d.sla_due_at, d.reviewed_at, d.resolution, d.applied_changes,
           d.patient_id, pt.full_name as patient_name, pt.docpad_id,
           rb.full_name as raised_by_name, rv.full_name as reviewed_by_name,
           (d.status in ('open', 'under_review') and d.sla_due_at < now()) as overdue
      from data_principal_requests d
      left join patients pt on pt.id = d.patient_id
      left join practitioners rb on rb.id = d.raised_by
      left join practitioners rv on rv.id = d.reviewed_by
     where d.hospital_id = v_hospital
       and (p_status is null or d.status = p_status)
     order by d.raised_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) r;

  return coalesce(v, '[]'::json);
end;
$function$;

revoke all on function public.update_grievance_officer(text, text, text, text, text, int) from public, anon;
revoke all on function public.list_data_principal_requests(text, int) from public, anon;
grant execute on function public.update_grievance_officer(text, text, text, text, text, int) to authenticated, service_role;
grant execute on function public.list_data_principal_requests(text, int) to authenticated, service_role;
