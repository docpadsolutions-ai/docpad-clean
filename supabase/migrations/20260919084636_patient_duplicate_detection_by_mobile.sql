-- Wave 3, item 13: duplicate detection on a mobile hash, and item 14: a merge-review
-- path instead of a hard stop.
--
-- Today the only duplicate check in the app is `check_patient_exists(aadhaar_hash)`.
-- A patient who has no Aadhaar, or who declines to give it, has no duplicate check at
-- all, and the registration screen currently *requires* Aadhaar before it will let
-- anyone past step 1 -- so a patient without Aadhaar cannot be registered today. Both
-- are fixed on the application side in this change; this migration is the database
-- half: a mobile-number hash that is actually populated, and a lookup RPC for it.
--
-- `patients.mobile_hash` has existed since the original schema and has never been
-- written to (0 of 37 rows have a value). It is computed server-side from `phone` via
-- a trigger, not client-side like the Aadhaar hash, because phone is already stored
-- in the clear on this table -- hashing it buys no confidentiality, only a stable,
-- normalized key to look up against, the same shape as the Aadhaar check.
--
-- `check_patient_exists` is extended (dropped and recreated, since its return shape
-- changes) to also return the patient's id and age, so the application can offer
-- "open their existing record" as a real action rather than only a name and ID in an
-- error string.
--
-- `registered_despite_duplicate_of` records the case where staff were shown a
-- possible match and confirmed it was a different person anyway -- so a chart that
-- looks like a duplicate later has a reason on file rather than looking like a bug.

-- 1. Mobile hash: computed on write, not asked of the client.

create or replace function public.trg_set_mobile_hash()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.phone is not null and btrim(NEW.phone) <> '' then
    NEW.mobile_hash := encode(extensions.digest(NEW.phone, 'sha256'), 'hex');
  else
    NEW.mobile_hash := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists set_mobile_hash on public.patients;
create trigger set_mobile_hash
  before insert or update of phone on public.patients
  for each row execute function public.trg_set_mobile_hash();

-- Backfill the 37 existing patients, all of whom have a phone number on file.
update public.patients
set mobile_hash = encode(extensions.digest(phone, 'sha256'), 'hex')
where phone is not null and btrim(phone) <> '' and mobile_hash is null;

create index if not exists idx_patients_mobile_hash
  on public.patients (hospital_id, mobile_hash)
  where mobile_hash is not null;

-- 2. The lookup RPC, same shape and access pattern as the Aadhaar one.

create or replace function public.check_patient_exists_by_phone(p_phone text)
returns table(existing_id uuid, existing_docpad_id text, existing_name text, existing_age_years integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hash text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    return;
  end if;
  v_hash := encode(extensions.digest(p_phone, 'sha256'), 'hex');
  return query
  select p.id, p.docpad_id, p.full_name, p.age_years
  from patients p
  where p.mobile_hash = v_hash
    and p.hospital_id = auth_hospital_id()
    and p.is_active = true
  order by p.created_at desc
  limit 5;
end;
$$;

revoke all on function public.check_patient_exists_by_phone(text) from public, anon;
grant execute on function public.check_patient_exists_by_phone(text) to authenticated;

-- 3. Extend check_patient_exists so a duplicate hit carries enough to act on, not just
-- enough to display. Return shape changes, so this has to be a drop-and-recreate.

drop function if exists public.check_patient_exists(text);

create function public.check_patient_exists(p_aadhaar_hash text)
returns table(existing_id uuid, existing_docpad_id text, existing_name text, existing_age_years integer)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  select p.id, p.docpad_id, p.full_name, p.age_years
  from patients p
  join identity_vault.aadhaar_mapping v on p.aadhaar_reference_key = v.reference_key
  where v.aadhaar_hash = p_aadhaar_hash
    and p.hospital_id = auth_hospital_id();
end;
$$;

revoke all on function public.check_patient_exists(text) from public, anon;
grant execute on function public.check_patient_exists(text) to authenticated;

-- 4. The merge-review audit trail: set when staff are shown a possible duplicate and
-- say it is a different person anyway.

alter table public.patients
  add column if not exists registered_despite_duplicate_of uuid references public.patients(id);

comment on column public.patients.registered_despite_duplicate_of is
  'Set when registration flagged a possible duplicate (by Aadhaar or mobile) and staff confirmed this is a different patient. Points at the record that looked like a match, for audit.';

-- Self-check: fail the migration loudly rather than leaving a silent gap.
do $$
begin
  perform public._assert_column('patients', 'mobile_hash');
  perform public._assert_column('patients', 'registered_despite_duplicate_of');
  perform public._assert_function('check_patient_exists_by_phone', 'p_phone text');
  perform public._assert_function('check_patient_exists', 'p_aadhaar_hash text');

  if (select count(*) from public.patients where phone is not null and btrim(phone) <> '' and mobile_hash is null) > 0 then
    raise exception 'mobile_hash backfill left rows unset';
  end if;

  raise notice 'patient duplicate-detection-by-mobile: all checks passed';
end $$;
