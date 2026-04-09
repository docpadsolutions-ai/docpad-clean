-- Dashboard list: expose preauths as preauth_requests with display columns (select * from the client).
create or replace view public.preauth_requests
with (security_invoker = true) as
select
  p.*,
  coalesce(pt.full_name, '')::text as patient_full_name,
  coalesce(ic.name, '—')::text as insurance_name
from public.insurance_preauths p
inner join public.patients pt on pt.id = p.patient_id
left join public.insurance_companies ic on ic.id = p.insurance_company_id;

comment on view public.preauth_requests is
  'insurance_preauths plus patient_full_name and insurance_name for billing UI lists.';

grant select on public.preauth_requests to authenticated;
