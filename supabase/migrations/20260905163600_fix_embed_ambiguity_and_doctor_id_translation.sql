-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260905163600.

-- 1. Remove unused FKs to practitioners so PostgREST can resolve
--    reception_queue -> practitioners to a single relationship.
--    Columns are retained; only the constraints are dropped.
alter table public.reception_queue drop constraint if exists reception_queue_doctor_id_fkey;
alter table public.reception_queue drop constraint if exists reception_queue_triage_by_fkey;
alter table public.reception_queue drop constraint if exists reception_queue_no_show_marked_by_fkey;
alter table public.reception_queue drop constraint if exists reception_queue_payment_override_by_fkey;

-- 2. Accept an auth.uid() in opd_encounters.doctor_id and translate it to the
--    matching practitioners.id, so the FK is satisfied regardless of which id
--    the client sends. Also backfills hospital_id when omitted.
create or replace function public.normalize_encounter_doctor_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_hid uuid;
begin
  if new.doctor_id is not null
     and not exists (select 1 from practitioners p where p.id = new.doctor_id) then
    select p.id, p.hospital_id into v_pid, v_hid
    from practitioners p
    where p.user_id = new.doctor_id
    limit 1;

    if v_pid is not null then
      new.doctor_id := v_pid;
      if new.hospital_id is null then
        new.hospital_id := v_hid;
      end if;
    end if;
  end if;

  if new.hospital_id is null then
    select p.hospital_id into new.hospital_id
    from practitioners p
    where p.user_id = auth.uid()
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_encounter_doctor_id_trg on public.opd_encounters;
create trigger normalize_encounter_doctor_id_trg
  before insert or update on public.opd_encounters
  for each row execute function public.normalize_encounter_doctor_id();

NOTIFY pgrst, 'reload schema';
