-- Align `invoices` FK column with app + `20260412140000` (`encounter_id` instead of `opd_encounter_id`).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'opd_encounter_id'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'encounter_id'
  ) then
    alter table public.invoices rename column opd_encounter_id to encounter_id;
  end if;
end $$;
