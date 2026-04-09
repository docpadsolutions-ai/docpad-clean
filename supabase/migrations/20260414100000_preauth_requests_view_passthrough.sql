-- PostgREST cannot infer FK embeddings (e.g. to patient_insurance_coverage) on the
-- previous multi-table preauth_requests view. Passthrough to insurance_preauths so
-- the API exposes the same FK graph as the base table; UI uses nested selects for names.
drop view if exists public.preauth_requests;

create view public.preauth_requests
with (security_invoker = true) as
select * from public.insurance_preauths;

comment on view public.preauth_requests is
  'Passthrough to insurance_preauths so PostgREST nested selects resolve (single source table).';

grant select on public.preauth_requests to authenticated;
