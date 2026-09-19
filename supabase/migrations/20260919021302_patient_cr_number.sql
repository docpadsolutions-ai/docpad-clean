-- Wave 3.11 - the CR number.
--
-- Proposal v1.0 2.3 specifies a persistent patient banner showing "photo, name,
-- age/sex, DocPad ID and CR number". The CR number did not exist. Not the column,
-- not a generator, not a single reference anywhere in the code: a search of the whole
-- tree for cr_number, cr_no, "CR No", case record and central registration returned
-- nothing.
--
-- It is not decoration. In an Indian OPD the CR number is the number the patient
-- knows, the number written on the card in their hand, and the number called out at
-- the counter. docpad_id is ours; the CR number is theirs. Identifying a patient by
-- an identifier they cannot read back to you is how the wrong chart gets opened.
--
-- Format. A plain per-hospital running number, zero-padded to six, because that is
-- what a paper OPD card carries and what a patient can read out over a telephone.
-- hospitals.cr_number_prefix exists for sites that want "GMC/000123" or a year
-- segment; it defaults to empty and costs nothing if unused.
--
-- Allocation runs under a per-hospital advisory lock, the same pattern
-- check_in_appointment already uses for OPD tokens, so two desks registering at the
-- same moment cannot hand out the same number.

alter table public.hospitals
  add column if not exists cr_number_prefix text not null default '';

comment on column public.hospitals.cr_number_prefix is
  'Optional prefix for CR numbers, e.g. "GMC/". Empty means a bare running number, which is what most sites want.';

alter table public.patients
  add column if not exists cr_number text;

comment on column public.patients.cr_number is
  'Central Registration number: the identifier the PATIENT holds and reads back. Per hospital, allocated on insert, never reused. Distinct from docpad_id, which is ours.';

-- Per hospital, not globally. Two hospitals both having CR 000001 is correct.
create unique index if not exists patients_cr_number_unique
  on public.patients (hospital_id, cr_number) where cr_number is not null;


create or replace function public.next_cr_number(p_hospital_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prefix text := '';
  v_next   integer;
begin
  if p_hospital_id is null then return null; end if;

  select coalesce(cr_number_prefix, '') into v_prefix from hospitals where id = p_hospital_id;

  -- Serialise allocation for this hospital only, for the length of the transaction.
  perform pg_advisory_xact_lock(hashtextextended('cr:' || p_hospital_id::text, 0));

  -- Read the highest number actually issued rather than keeping a counter, so the
  -- sequence survives a restore and cannot drift away from the data.
  select coalesce(max(
           nullif(regexp_replace(cr_number, '^.*?(\d+)$', '\1'), '')::integer
         ), 0) + 1
    into v_next
    from patients
   where hospital_id = p_hospital_id
     and cr_number is not null
     and cr_number ~ '\d+$';

  return v_prefix || lpad(v_next::text, 6, '0');
end;
$function$;

revoke all on function public.next_cr_number(uuid) from public, anon;
grant execute on function public.next_cr_number(uuid) to authenticated, service_role;


create or replace function public.trg_assign_cr_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.cr_number is null or btrim(NEW.cr_number) = '' then
    NEW.cr_number := public.next_cr_number(NEW.hospital_id);
  end if;
  return NEW;
end;
$function$;

drop trigger if exists aa_assign_cr_number on public.patients;
create trigger aa_assign_cr_number
  before insert on public.patients
  for each row execute function public.trg_assign_cr_number();


-- Backfill in registration order, so the oldest patient is 000001. Done per hospital
-- in one pass rather than through the trigger, which would take the advisory lock
-- once per row.
do $$
declare h record;
begin
  for h in select id from hospitals loop
    with ordered as (
      select id, row_number() over (order by created_at nulls last, id) as n
        from patients
       where hospital_id = h.id and cr_number is null
    )
    update patients p
       set cr_number = (select coalesce(cr_number_prefix, '') from hospitals where id = h.id)
                       || lpad(o.n::text, 6, '0')
      from ordered o
     where p.id = o.id;
  end loop;
end $$;
